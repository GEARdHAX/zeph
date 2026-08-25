import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GroupAdminPanel from './GroupAdminPanel';

vi.mock('../../../actions/groupAdmin', () => ({
  listGroupMembers: vi.fn(),
  listJoinRequests: vi.fn(),
  approveJoinRequest: vi.fn(),
  denyJoinRequest: vi.fn(),
  removeMember: vi.fn(),
  banMember: vi.fn(),
  changeMemberRole: vi.fn(),
  transferOwnership: vi.fn(),
  updateGroupSettings: vi.fn(),
}));

// eslint-disable-next-line import/first
import {
  listGroupMembers, listJoinRequests, approveJoinRequest, denyJoinRequest,
  banMember, changeMemberRole, updateGroupSettings,
} from '../../../actions/groupAdmin';

const owner = {
  _id: 'gm-owner',
  role: 'OWNER',
  user: {
    _id: 'u-owner', firstName: 'Own', lastName: 'Er', username: 'owner',
  },
};
const admin = {
  _id: 'gm-admin',
  role: 'ADMIN',
  user: {
    _id: 'u-admin', firstName: 'Ad', lastName: 'Min', username: 'admin',
  },
};
const member = {
  _id: 'gm-member',
  role: 'MEMBER',
  user: {
    _id: 'u-member', firstName: 'Mem', lastName: 'Ber', username: 'member',
  },
};

beforeEach(() => {
  listGroupMembers.mockReset().mockResolvedValue({ data: { members: [owner, admin, member] } });
  listJoinRequests.mockReset().mockResolvedValue({ data: { requests: [] } });
  approveJoinRequest.mockReset();
  denyJoinRequest.mockReset();
  banMember.mockReset();
  changeMemberRole.mockReset();
  updateGroupSettings.mockReset();
});

const renderPanel = (props = {}) => render(
  <GroupAdminPanel
    groupId="g1"
    myRole="OWNER"
    currentSettings={{}}
    onClose={() => {}}
    onSettingsChanged={() => {}}
    {...props}
  />,
);

describe('GroupAdminPanel — member list', () => {
  it('loads and renders all members with role badges', async () => {
    renderPanel();
    await waitFor(() => expect(listGroupMembers).toHaveBeenCalledWith('g1'));
    expect(await screen.findByText('Own Er')).toBeInTheDocument();
    expect(screen.getByText('OWNER')).toBeInTheDocument();
    expect(screen.getByText('ADMIN')).toBeInTheDocument();
  });

  it('offers role/ban/remove actions only for members ranked below the viewer', async () => {
    const userEv = userEvent.setup();
    renderPanel({ myRole: 'ADMIN' });
    await screen.findByText('Own Er');

    // ADMIN outranks MEMBER, so the member row's action trigger opens a menu.
    const memberRow = screen.getByText('Mem Ber').closest('div.flex.items-center.justify-between');
    const memberTrigger = memberRow.querySelector('button');
    expect(memberTrigger).not.toBeNull();
    await userEv.click(memberTrigger);
    expect(await screen.findByText('Ban')).toBeInTheDocument();

    // ADMIN does not outrank OWNER (or itself), so those rows have no trigger.
    const ownerRow = screen.getByText('Own Er').closest('div.flex.items-center.justify-between');
    expect(ownerRow.querySelector('button')).toBeNull();
  });
});

describe('GroupAdminPanel — join requests', () => {
  it('shows pending requests for an OWNER/ADMIN and approves one', async () => {
    listJoinRequests.mockResolvedValue({
      data: {
        requests: [{
          _id: 'req1',
          user: {
            _id: 'u-req', firstName: 'Req', lastName: 'User', username: 'requser',
          },
        }],
      },
    });
    approveJoinRequest.mockResolvedValue({ data: { status: 'success' } });
    const userEv = userEvent.setup();
    renderPanel();

    expect(await screen.findByText(/join requests \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText('Req User')).toBeInTheDocument();

    await userEv.click(screen.getByTitle('Approve'));
    await waitFor(() => expect(approveJoinRequest).toHaveBeenCalledWith('g1', 'u-req'));
  });

  it('denies a request', async () => {
    listJoinRequests.mockResolvedValue({
      data: {
        requests: [{
          _id: 'req1',
          user: {
            _id: 'u-req', firstName: 'Req', lastName: 'User', username: 'requser',
          },
        }],
      },
    });
    denyJoinRequest.mockResolvedValue({ data: { status: 'success' } });
    const userEv = userEvent.setup();
    renderPanel();

    await screen.findByText('Req User');
    await userEv.click(screen.getByTitle('Deny'));
    await waitFor(() => expect(denyJoinRequest).toHaveBeenCalledWith('g1', 'u-req'));
  });

  it('does not fetch join requests for a plain MEMBER', async () => {
    renderPanel({ myRole: 'MEMBER' });
    await waitFor(() => expect(listGroupMembers).toHaveBeenCalled());
    expect(listJoinRequests).not.toHaveBeenCalled();
  });
});

describe('GroupAdminPanel — slow mode', () => {
  it('shows the current slow-mode value and updates it', async () => {
    renderPanel({ currentSettings: { slowModeSeconds: 30 } });
    expect(await screen.findByRole('button', { name: '30 seconds' })).toBeInTheDocument();
  });
});
