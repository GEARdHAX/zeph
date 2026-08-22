import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setGlobal } from 'reactn';
import ProfileView from './ProfileView';

vi.mock('../../../actions/resolveUser', () => ({ default: vi.fn() }));
vi.mock('../../../actions/sendFriendRequest', () => ({ default: vi.fn() }));
vi.mock('../../../actions/respondFriendRequest', () => ({ default: vi.fn() }));
vi.mock('../../../actions/blockUser', () => ({ default: vi.fn() }));
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// eslint-disable-next-line import/first
import resolveUser from '../../../actions/resolveUser';
// eslint-disable-next-line import/first
import blockUser from '../../../actions/blockUser';

const ME = { id: 'me-1', firstName: 'Me', lastName: 'Self' };

function renderProfileView(props = {}) {
  const onClose = vi.fn();
  const onOpenChat = vi.fn();
  render(<ProfileView username="target" onClose={onClose} onOpenChat={onOpenChat} {...props} />);
  return { onClose, onOpenChat };
}

beforeEach(async () => {
  await setGlobal({ user: ME });
  resolveUser.mockReset();
  blockUser.mockReset();
});

describe('ProfileView — self viewing', () => {
  it('shows "This is you" and no Start Chat/Add Friend/Block/Report buttons when viewing your own profile', async () => {
    resolveUser.mockResolvedValue({
      data: {
        user: {
          _id: 'me-1', username: 'myself', firstName: 'Me', lastName: 'Self', bio: '',
        },
        relationship: null,
        commonGroups: [],
      },
    });
    renderProfileView();

    expect(await screen.findByText('This is you')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start chat/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add friend/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /block/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Report')).not.toBeInTheDocument();
  });
});

describe('ProfileView — blocked relationship', () => {
  it('shows only "User unavailable", no bio/friends-since/common-groups/action buttons', async () => {
    resolveUser.mockResolvedValue({
      data: {
        user: {
          _id: 'u2', username: 'blocked', firstName: 'Blocked', lastName: 'User', bio: 'Hello there',
        },
        relationship: { status: 'blocked', direction: null },
        commonGroups: [],
      },
    });
    renderProfileView();

    expect(await screen.findByText('User unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Hello there')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start chat/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/friends since/i)).not.toBeInTheDocument();
  });
});

describe('ProfileView — stranger (no relationship)', () => {
  it('shows Start Chat and Add Friend, no friends-since/common-groups section', async () => {
    resolveUser.mockResolvedValue({
      data: {
        user: {
          _id: 'u3', username: 'stranger', firstName: 'Stranger', lastName: 'Danger', bio: '',
        },
        relationship: null,
        commonGroups: [],
      },
    });
    renderProfileView();

    expect(await screen.findByRole('button', { name: /start chat/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add friend/i })).toBeInTheDocument();
    expect(screen.queryByText(/friends since/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/group/i)).not.toBeInTheDocument();
  });

  it('the Report button is present but disabled', async () => {
    resolveUser.mockResolvedValue({
      data: {
        user: {
          _id: 'u3', username: 'stranger', firstName: 'Stranger', lastName: 'Danger', bio: '',
        },
        relationship: null,
        commonGroups: [],
      },
    });
    renderProfileView();

    const reportButton = await screen.findByRole('button', { name: /report/i });
    expect(reportButton).toBeDisabled();
  });
});

describe('ProfileView — accepted friend with common groups', () => {
  it('shows "Friends since" and the common-groups list', async () => {
    resolveUser.mockResolvedValue({
      data: {
        user: {
          _id: 'u4', username: 'friend', firstName: 'Good', lastName: 'Friend', bio: '',
        },
        relationship: { status: 'accepted', direction: null, respondedAt: '2024-03-15T00:00:00.000Z' },
        commonGroups: [{ _id: 'g1', title: 'Design Team', picture: null }],
      },
    });
    renderProfileView();

    expect(await screen.findByText(/friends since/i)).toBeInTheDocument();
    expect(screen.getByText('Mar 2024', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('1 group in common')).toBeInTheDocument();
    expect(screen.getByText('Design Team')).toBeInTheDocument();
  });

  it('renders the plural "N groups in common" label for more than one shared group', async () => {
    resolveUser.mockResolvedValue({
      data: {
        user: {
          _id: 'u4', username: 'friend', firstName: 'Good', lastName: 'Friend', bio: '',
        },
        relationship: { status: 'accepted', direction: null, respondedAt: '2024-03-15T00:00:00.000Z' },
        commonGroups: [
          { _id: 'g1', title: 'Design Team', picture: null },
          { _id: 'g2', title: 'Book Club', picture: null },
        ],
      },
    });
    renderProfileView();

    expect(await screen.findByText('2 groups in common')).toBeInTheDocument();
  });
});

describe('ProfileView — bio rendering', () => {
  it("parses the bio's own **bold** formatting syntax into a real <strong> element", async () => {
    resolveUser.mockResolvedValue({
      data: {
        user: {
          _id: 'u5', username: 'bioperson', firstName: 'Bio', lastName: 'Person', bio: 'I like **bold** text.',
        },
        relationship: null,
        commonGroups: [],
      },
    });
    renderProfileView();

    const strong = await screen.findByText('bold', { selector: 'strong' });
    expect(strong).toBeInTheDocument();
  });

  it('renders a literal HTML tag in a bio as inert visible text, never as real markup', async () => {
    resolveUser.mockResolvedValue({
      data: {
        user: {
          _id: 'u7', username: 'htmlperson', firstName: 'Html', lastName: 'Person', bio: '<strong>not bold</strong>',
        },
        relationship: null,
        commonGroups: [],
      },
    });
    renderProfileView();

    expect(await screen.findByText('<strong>not bold</strong>')).toBeInTheDocument();
    expect(document.querySelector('strong')).not.toBeInTheDocument();
  });
});

describe('ProfileView — block action', () => {
  it('clicking Block calls blockUser with the username and clears common groups', async () => {
    const user = userEvent.setup();
    resolveUser.mockResolvedValue({
      data: {
        user: {
          _id: 'u6', username: 'target', firstName: 'Target', lastName: 'Person', bio: '',
        },
        relationship: null,
        commonGroups: [{ _id: 'g1', title: 'Shared Group', picture: null }],
      },
    });
    blockUser.mockResolvedValue({ data: { relationship: { status: 'blocked' } } });
    renderProfileView();

    await user.click(await screen.findByRole('button', { name: /block/i }));

    expect(blockUser).toHaveBeenCalledWith('target');
    expect(await screen.findByText('User unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Shared Group')).not.toBeInTheDocument();
  });
});
