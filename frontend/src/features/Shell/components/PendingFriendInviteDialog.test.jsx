import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setGlobal, getGlobal } from 'reactn';
import PendingFriendInviteDialog from './PendingFriendInviteDialog';

vi.mock('../../../actions/invites', () => ({
  previewFriendInvite: vi.fn(),
  acceptFriendInvite: vi.fn(),
}));

// eslint-disable-next-line import/first
import { previewFriendInvite, acceptFriendInvite } from '../../../actions/invites';

beforeEach(async () => {
  previewFriendInvite.mockReset();
  acceptFriendInvite.mockReset();
  await setGlobal({ pendingFriendInviteToken: null });
});

describe('PendingFriendInviteDialog', () => {
  it('renders nothing when there is no pending token', () => {
    render(<PendingFriendInviteDialog />);
    expect(screen.queryByText(/invited you/i)).not.toBeInTheDocument();
  });

  it('previews and shows the inviter once a pending token is set', async () => {
    previewFriendInvite.mockResolvedValue({
      data: { inviter: { username: 'alice', firstName: 'Alice', lastName: 'A' } },
    });
    await setGlobal({ pendingFriendInviteToken: 'tok123' });
    render(<PendingFriendInviteDialog />);

    await waitFor(() => expect(screen.getByText('Alice A')).toBeInTheDocument());
    expect(previewFriendInvite).toHaveBeenCalledWith('tok123', expect.anything());
  });

  it('accepts the invite and clears the pending token on "Add Friend"', async () => {
    previewFriendInvite.mockResolvedValue({
      data: { inviter: { username: 'alice', firstName: 'Alice', lastName: 'A' } },
    });
    acceptFriendInvite.mockResolvedValue({ data: { relationship: { status: 'accepted' } } });
    await setGlobal({ pendingFriendInviteToken: 'tok123' });
    const userEv = userEvent.setup();
    render(<PendingFriendInviteDialog />);

    const button = await screen.findByRole('button', { name: /add friend/i });
    await userEv.click(button);

    await waitFor(() => expect(acceptFriendInvite).toHaveBeenCalledWith('tok123'));
    await waitFor(() => expect(getGlobal().pendingFriendInviteToken).toBeNull());
  });

  it('clears the pending token on "Not now" without accepting', async () => {
    previewFriendInvite.mockResolvedValue({
      data: { inviter: { username: 'alice', firstName: 'Alice', lastName: 'A' } },
    });
    await setGlobal({ pendingFriendInviteToken: 'tok123' });
    const userEv = userEvent.setup();
    render(<PendingFriendInviteDialog />);

    const button = await screen.findByRole('button', { name: /not now/i });
    await userEv.click(button);

    expect(acceptFriendInvite).not.toHaveBeenCalled();
    await waitFor(() => expect(getGlobal().pendingFriendInviteToken).toBeNull());
  });

  it('shows an unavailable state and clears the token on dismiss when the preview fails', async () => {
    previewFriendInvite.mockRejectedValue({ response: { data: { reason: 'INVITE_NOT_FOUND' } } });
    await setGlobal({ pendingFriendInviteToken: 'tok123' });
    const userEv = userEvent.setup();
    render(<PendingFriendInviteDialog />);

    await screen.findByText(/invite unavailable/i);
    await userEv.click(screen.getByRole('button', { name: /dismiss/i }));

    await waitFor(() => expect(getGlobal().pendingFriendInviteToken).toBeNull());
  });
});
