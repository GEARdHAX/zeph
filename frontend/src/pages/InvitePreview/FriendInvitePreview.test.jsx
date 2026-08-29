import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { setGlobal } from 'reactn';
import FriendInvitePreview from './FriendInvitePreview';

vi.mock('../../actions/invites', () => ({
  previewFriendInvite: vi.fn(),
  acceptFriendInvite: vi.fn(),
}));

// eslint-disable-next-line import/first
import { previewFriendInvite, acceptFriendInvite } from '../../actions/invites';

function renderPreview(token = 'tok123') {
  render(
    <MemoryRouter initialEntries={[`/invite/f/${token}`]}>
      <Routes>
        <Route path="/invite/f/:token" element={<FriendInvitePreview />} />
        <Route path="/" element={<div>Home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  previewFriendInvite.mockReset();
  acceptFriendInvite.mockReset();
  await setGlobal({ token: null });
});

describe('FriendInvitePreview', () => {
  it('shows the invalid/expired state when the preview request fails', async () => {
    previewFriendInvite.mockRejectedValue({ response: { data: { reason: 'INVITE_NOT_FOUND' } } });
    renderPreview();

    await waitFor(() => expect(screen.getByText(/invite unavailable/i)).toBeInTheDocument());
  });

  it('renders inviter info from a successful preview', async () => {
    previewFriendInvite.mockResolvedValue({
      data: { inviter: { username: 'alice', firstName: 'Alice', lastName: 'A' } },
    });
    renderPreview();

    await waitFor(() => expect(screen.getByText('Alice A')).toBeInTheDocument());
    expect(screen.getByText('@alice invited you to connect on zeph.')).toBeInTheDocument();
  });

  it('prompts login instead of accept when logged out', async () => {
    previewFriendInvite.mockResolvedValue({
      data: { inviter: { username: 'alice', firstName: 'Alice', lastName: 'A' } },
    });
    renderPreview();

    await waitFor(() => expect(screen.getByRole('button', { name: /log in to accept/i })).toBeInTheDocument());
    expect(acceptFriendInvite).not.toHaveBeenCalled();
  });

  it('calls acceptFriendInvite when logged in and Add Friend is clicked', async () => {
    await setGlobal({ token: 'fake-token' });
    previewFriendInvite.mockResolvedValue({
      data: { inviter: { username: 'alice', firstName: 'Alice', lastName: 'A' } },
    });
    acceptFriendInvite.mockResolvedValue({ data: { relationship: { status: 'accepted' } } });
    const userEv = userEvent.setup();
    renderPreview();

    const button = await screen.findByRole('button', { name: /add friend/i });
    await userEv.click(button);

    await waitFor(() => expect(acceptFriendInvite).toHaveBeenCalledWith('tok123'));
  });
});
