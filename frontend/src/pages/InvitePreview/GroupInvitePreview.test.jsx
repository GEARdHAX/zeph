import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { setGlobal } from 'reactn';
import GroupInvitePreview from './GroupInvitePreview';

vi.mock('../../actions/invites', () => ({
  previewGroupInvite: vi.fn(),
  joinGroupInvite: vi.fn(),
}));

// eslint-disable-next-line import/first
import { previewGroupInvite, joinGroupInvite } from '../../actions/invites';

function renderPreview(token = 'tok123') {
  render(
    <MemoryRouter initialEntries={[`/invite/g/${token}`]}>
      <Routes>
        <Route path="/invite/g/:token" element={<GroupInvitePreview />} />
        <Route path="/room/:id" element={<div>Room</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  previewGroupInvite.mockReset();
  joinGroupInvite.mockReset();
  await setGlobal({ token: null });
});

describe('GroupInvitePreview', () => {
  it('shows the invalid/expired state when the preview request fails', async () => {
    previewGroupInvite.mockRejectedValue({ response: { data: { reason: 'INVITE_NOT_FOUND' } } });
    renderPreview();

    await waitFor(() => expect(screen.getByText(/invite unavailable/i)).toBeInTheDocument());
  });

  it('shows the limit-reached message distinctly', async () => {
    previewGroupInvite.mockRejectedValue({ response: { data: { reason: 'INVITE_LIMIT_REACHED' } } });
    renderPreview();

    await waitFor(() => expect(screen.getByText(/reached its usage limit/i)).toBeInTheDocument());
  });

  it('renders group info from a successful preview', async () => {
    previewGroupInvite.mockResolvedValue({
      data: { group: { name: 'Study Group', memberCount: 3, privacy: 'PRIVATE' } },
    });
    renderPreview();

    await waitFor(() => expect(screen.getByText('Study Group')).toBeInTheDocument());
    expect(screen.getByText('3 members')).toBeInTheDocument();
  });

  it('prompts login instead of join when logged out', async () => {
    previewGroupInvite.mockResolvedValue({ data: { group: { name: 'Study Group', memberCount: 1 } } });
    renderPreview();

    await waitFor(() => expect(screen.getByRole('button', { name: /log in to join/i })).toBeInTheDocument());
    expect(joinGroupInvite).not.toHaveBeenCalled();
  });

  it('calls joinGroupInvite when logged in and Join Group is clicked', async () => {
    await setGlobal({ token: 'fake-token' });
    previewGroupInvite.mockResolvedValue({ data: { group: { name: 'Study Group', memberCount: 1 } } });
    joinGroupInvite.mockResolvedValue({ data: { group: { _id: 'g1', name: 'Study Group' } } });
    const userEv = userEvent.setup();
    renderPreview();

    const button = await screen.findByRole('button', { name: /join group/i });
    await userEv.click(button);

    await waitFor(() => expect(joinGroupInvite).toHaveBeenCalledWith('tok123'));
  });
});
