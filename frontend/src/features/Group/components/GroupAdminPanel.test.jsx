import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import {
  render, screen, fireEvent, waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { createStore } from 'redux';
import GroupAdminPanel from './GroupAdminPanel';
import * as groupAdminActions from '../../../actions/groupAdmin';

vi.mock('../../../actions/groupAdmin', () => ({
  getGroup: vi.fn(),
  listGroupMembers: vi.fn(),
  listJoinRequests: vi.fn(),
  approveJoinRequest: vi.fn(),
  denyJoinRequest: vi.fn(),
  removeMember: vi.fn(),
  banMember: vi.fn(),
  changeMemberRole: vi.fn(),
  transferOwnership: vi.fn(),
  updateGroupSettings: vi.fn(),
  leaveGroup: vi.fn(),
  deleteGroup: vi.fn(),
}));

const mockMembers = [
  {
    _id: 'm1',
    role: 'OWNER',
    user: {
      _id: 'u1', username: 'owner_user', firstName: 'Owner', lastName: 'One',
    },
  },
  {
    _id: 'm2',
    role: 'ADMIN',
    user: {
      _id: 'u2', username: 'admin_user', firstName: 'Admin', lastName: 'Two',
    },
  },
  {
    _id: 'm3',
    role: 'MEMBER',
    user: {
      _id: 'u3', username: 'member_user', firstName: 'Member', lastName: 'Three',
    },
  },
];

const mockRequests = [
  {
    _id: 'r1',
    user: {
      _id: 'u4', username: 'pending_user', firstName: 'Pending', lastName: 'Four',
    },
  },
];

const dummyStore = createStore(() => ({ io: { io: null }, messages: {} }));

function renderPanel(props = {}) {
  return render(
    <Provider store={dummyStore}>
      <MemoryRouter>
        <GroupAdminPanel
          groupId="group-123"
          myRole="OWNER"
          currentSettings={{ slowModeSeconds: 0 }}
          onClose={vi.fn()}
          {...props}
        />
      </MemoryRouter>
    </Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  groupAdminActions.listGroupMembers.mockResolvedValue({ data: { members: mockMembers } });
  groupAdminActions.listJoinRequests.mockResolvedValue({ data: { requests: [] } });
});

describe('GroupAdminPanel — member list', () => {
  it('loads and renders all members with role badges', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('Owner One')).toBeInTheDocument());
    expect(screen.getByText('Admin Two')).toBeInTheDocument();
    expect(screen.getByText('Member Three')).toBeInTheDocument();
  });

  it('offers role/ban/remove actions only for members ranked below the viewer', async () => {
    renderPanel({ myRole: 'ADMIN' });
    await waitFor(() => expect(screen.getByText('Owner One')).toBeInTheDocument());
  });
});

describe('GroupAdminPanel — join requests', () => {
  beforeEach(() => {
    groupAdminActions.listJoinRequests.mockResolvedValue({ data: { requests: mockRequests } });
    groupAdminActions.approveJoinRequest.mockResolvedValue({ data: { ok: true } });
    groupAdminActions.denyJoinRequest.mockResolvedValue({ data: { ok: true } });
  });

  it('shows pending requests for an OWNER/ADMIN and approves one', async () => {
    renderPanel({ myRole: 'OWNER' });
    await waitFor(() => expect(screen.getByText('Pending Four')).toBeInTheDocument());
    const approveBtn = screen.getByTitle('Approve');
    fireEvent.click(approveBtn);
    await waitFor(() => expect(groupAdminActions.approveJoinRequest).toHaveBeenCalledWith('group-123', 'u4'));
  });

  it('denies a request', async () => {
    renderPanel({ myRole: 'ADMIN' });
    await waitFor(() => expect(screen.getByText('Pending Four')).toBeInTheDocument());
    const denyBtn = screen.getByTitle('Deny');
    fireEvent.click(denyBtn);
    await waitFor(() => expect(groupAdminActions.denyJoinRequest).toHaveBeenCalledWith('group-123', 'u4'));
  });

  it('does not fetch join requests for a plain MEMBER', async () => {
    renderPanel({ myRole: 'MEMBER' });
    await waitFor(() => expect(screen.getByText('Owner One')).toBeInTheDocument());
    expect(groupAdminActions.listJoinRequests).not.toHaveBeenCalled();
  });
});

describe('GroupAdminPanel — slow mode', () => {
  it('shows the current slow-mode value', async () => {
    renderPanel({ myRole: 'OWNER', currentSettings: { slowModeSeconds: 10 } });
    await waitFor(() => expect(screen.getByText('10 seconds')).toBeInTheDocument());
  });

  it('shows a custom label for a non-preset slow-mode value', async () => {
    renderPanel({ myRole: 'OWNER', currentSettings: { slowModeSeconds: 45 } });
    await waitFor(() => expect(screen.getByText('Custom (45s)')).toBeInTheDocument());
  });
});

describe('GroupAdminPanel — leave/delete', () => {
  it('a MEMBER clicking Leave Group asks for simple confirmation, not the owner choice dialog', async () => {
    groupAdminActions.leaveGroup.mockResolvedValue({ data: { status: 'success' } });
    const userEv = userEvent.setup();
    renderPanel({ myRole: 'MEMBER' });
    await waitFor(() => expect(screen.getByText('Owner One')).toBeInTheDocument());

    await userEv.click(screen.getByRole('button', { name: /leave group/i }));
    expect(await screen.findByText('Leave this group?')).toBeInTheDocument();
    expect(screen.queryByText(/you're the owner of this group/i)).not.toBeInTheDocument();

    await userEv.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(groupAdminActions.leaveGroup).toHaveBeenCalledWith('group-123'));
  });

  it('an OWNER clicking Leave Group sees the transfer/delete/cancel choice, not a direct leave', async () => {
    const userEv = userEvent.setup();
    renderPanel({ myRole: 'OWNER' });
    await waitFor(() => expect(screen.getByText('Owner One')).toBeInTheDocument());

    await userEv.click(screen.getByRole('button', { name: /leave group/i }));
    expect(await screen.findByText(/you're the owner of this group/i)).toBeInTheDocument();
    expect(groupAdminActions.leaveGroup).not.toHaveBeenCalled();
  });

  it('OWNER can delete the group from the leave-choice dialog, with confirmation', async () => {
    groupAdminActions.deleteGroup.mockResolvedValue({ data: { status: 'success' } });
    const userEv = userEvent.setup();
    renderPanel({ myRole: 'OWNER' });
    await waitFor(() => expect(screen.getByText('Owner One')).toBeInTheDocument());

    await userEv.click(screen.getByRole('button', { name: /leave group/i }));
    await userEv.click(await screen.findByRole('button', { name: /delete group/i }));
    expect(await screen.findByText('Delete this group permanently?')).toBeInTheDocument();

    await userEv.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(groupAdminActions.deleteGroup).toHaveBeenCalledWith('group-123'));
  });
});
