import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InviteGroup from './InviteGroup';

vi.mock('../../../actions/invites', () => ({ createGroupInvite: vi.fn(), addGroupMember: vi.fn() }));
vi.mock('../../../actions/getFriends', () => ({ default: vi.fn() }));
// eslint-disable-next-line import/first
import { createGroupInvite, addGroupMember } from '../../../actions/invites';
// eslint-disable-next-line import/first
import getFriends from '../../../actions/getFriends';

// jsdom's navigator.clipboard is a getter-only property — defineProperty
// (not Object.assign) is required to stub it. userEvent.setup() installs its
// own clipboard stub, so this must run AFTER setup() in each test, not in
// beforeEach, or userEvent's stub silently wins.
const stubClipboard = () => Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: vi.fn().mockResolvedValue() },
  configurable: true,
});

beforeEach(() => {
  createGroupInvite.mockReset();
  addGroupMember.mockReset();
  getFriends.mockReset();
  getFriends.mockResolvedValue({ data: { users: [] } });
});

describe('InviteGroup', () => {
  it('creates a group invite link scoped to the given groupId on mount', async () => {
    createGroupInvite.mockResolvedValue({ data: { url: '/invite/g/xyz789' } });
    render(<InviteGroup groupId="group-1" groupName="Study Group" onClose={() => {}} />);

    await waitFor(() => expect(createGroupInvite).toHaveBeenCalledWith('group-1'));
    expect(await screen.findByRole('button', { name: /copy link/i })).toBeEnabled();
  });

  it('copies the full origin-qualified link to the clipboard', async () => {
    createGroupInvite.mockResolvedValue({ data: { url: '/invite/g/xyz789' } });
    const userEv = userEvent.setup();
    stubClipboard();
    render(<InviteGroup groupId="group-1" groupName="Study Group" onClose={() => {}} />);

    const copyBtn = await screen.findByRole('button', { name: /copy link/i });
    await waitFor(() => expect(copyBtn).toBeEnabled());
    await userEv.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/invite/g/xyz789`);
  });
});

describe('InviteGroup — add from friends', () => {
  const FRIEND = {
    _id: 'friend-1', firstName: 'Riya', lastName: 'Sharma', username: 'riyasharma',
  };

  it('lists friends who are not already in the group', async () => {
    createGroupInvite.mockResolvedValue({ data: { url: '/invite/g/xyz789' } });
    getFriends.mockResolvedValue({ data: { users: [FRIEND] } });
    render(<InviteGroup groupId="group-1" groupName="Study Group" onClose={() => {}} />);

    expect(await screen.findByText('Riya Sharma')).toBeInTheDocument();
  });

  it('excludes friends who are already members', async () => {
    createGroupInvite.mockResolvedValue({ data: { url: '/invite/g/xyz789' } });
    getFriends.mockResolvedValue({ data: { users: [FRIEND] } });
    render(
      <InviteGroup
        groupId="group-1"
        groupName="Study Group"
        existingMemberIds={['friend-1']}
        onClose={() => {}}
      />,
    );

    await waitFor(() => expect(getFriends).toHaveBeenCalled());
    expect(screen.queryByText('Riya Sharma')).not.toBeInTheDocument();
  });

  it('adding a friend calls addGroupMember with the group and friend id, then shows Added', async () => {
    createGroupInvite.mockResolvedValue({ data: { url: '/invite/g/xyz789' } });
    getFriends.mockResolvedValue({ data: { users: [FRIEND] } });
    addGroupMember.mockResolvedValue({ data: { status: 'success' } });
    const userEv = userEvent.setup();
    render(<InviteGroup groupId="group-1" groupName="Study Group" onClose={() => {}} />);

    const addBtn = await screen.findByRole('button', { name: /add/i });
    await userEv.click(addBtn);

    await waitFor(() => expect(addGroupMember).toHaveBeenCalledWith('group-1', 'friend-1'));
    expect(await screen.findByRole('button', { name: /added/i })).toBeDisabled();
  });

  it('renders nothing extra when the friends list is empty', async () => {
    createGroupInvite.mockResolvedValue({ data: { url: '/invite/g/xyz789' } });
    getFriends.mockResolvedValue({ data: { users: [] } });
    render(<InviteGroup groupId="group-1" groupName="Study Group" onClose={() => {}} />);

    await waitFor(() => expect(getFriends).toHaveBeenCalled());
    expect(screen.queryByText('Add from your friends')).not.toBeInTheDocument();
  });
});
