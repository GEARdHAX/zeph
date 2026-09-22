import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { setGlobal } from 'reactn';
import MeetingInvitePreview from './MeetingInvitePreview';

vi.mock('../../actions/meetingInvites', () => ({
  previewMeetingInvite: vi.fn(),
  acceptMeetingInvite: vi.fn(),
}));
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// eslint-disable-next-line import/first
import { previewMeetingInvite, acceptMeetingInvite } from '../../actions/meetingInvites';

function renderPreview(token = 'tok123') {
  render(
    <MemoryRouter initialEntries={[`/invite/m/${token}`]}>
      <Routes>
        <Route path="/invite/m/:token" element={<MeetingInvitePreview />} />
        <Route path="/meeting/:id" element={<div>MeetingRoute</div>} />
        <Route path="/login" element={<div>LoginRoute</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  previewMeetingInvite.mockReset();
  acceptMeetingInvite.mockReset();
  await setGlobal({ token: null });
});

describe('MeetingInvitePreview', () => {
  it('shows the invalid-link message on INVITE_NOT_FOUND', async () => {
    previewMeetingInvite.mockRejectedValue({ response: { data: { reason: 'INVITE_NOT_FOUND' } } });
    renderPreview();

    await waitFor(() => expect(screen.getByText('This invite link is invalid.')).toBeInTheDocument());
  });

  it('shows the expired message distinctly', async () => {
    previewMeetingInvite.mockRejectedValue({ response: { data: { reason: 'INVITE_EXPIRED' } } });
    renderPreview();

    await waitFor(() => expect(screen.getByText('This meeting invite has expired.')).toBeInTheDocument());
  });

  it('shows the revoked/exhausted fallback message', async () => {
    previewMeetingInvite.mockRejectedValue({ response: { data: {} } });
    renderPreview();

    await waitFor(() => expect(screen.getByText('This meeting invite is no longer active.')).toBeInTheDocument());
  });

  it('renders meeting title and inviter from a successful preview', async () => {
    previewMeetingInvite.mockResolvedValue({
      data: {
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        meeting: { id: 'm1', title: 'DSA Interview Discussion' },
        invitedBy: 'Adarsh',
      },
    });
    renderPreview();

    await waitFor(() => expect(screen.getByText('DSA Interview Discussion')).toBeInTheDocument());
    expect(screen.getByText('Invited by Adarsh')).toBeInTheDocument();
  });

  it('shows "Sign in to join" instead of accepting when logged out, and never calls acceptMeetingInvite', async () => {
    previewMeetingInvite.mockResolvedValue({
      data: { status: 'ACTIVE', expiresAt: new Date().toISOString(), meeting: { id: 'm1', title: 'Standup' } },
    });
    renderPreview();

    await waitFor(() => expect(screen.getByRole('button', { name: /sign in to join/i })).toBeInTheDocument());
    expect(acceptMeetingInvite).not.toHaveBeenCalled();
  });

  it('navigates to /login when "Sign in to join" is clicked', async () => {
    previewMeetingInvite.mockResolvedValue({
      data: { status: 'ACTIVE', expiresAt: new Date().toISOString(), meeting: { id: 'm1', title: 'Standup' } },
    });
    const user = userEvent.setup();
    renderPreview();

    const button = await screen.findByRole('button', { name: /sign in to join/i });
    await user.click(button);

    expect(await screen.findByText('LoginRoute')).toBeInTheDocument();
  });

  it('calls acceptMeetingInvite and navigates to the meeting when logged in and "Join meeting" is clicked', async () => {
    await setGlobal({ token: 'fake-token' });
    previewMeetingInvite.mockResolvedValue({
      data: { status: 'ACTIVE', expiresAt: new Date().toISOString(), meeting: { id: 'm1', title: 'Standup' } },
    });
    acceptMeetingInvite.mockResolvedValue({ data: { status: 'success', meeting: { id: 'm1', title: 'Standup' } } });
    const user = userEvent.setup();
    renderPreview();

    const button = await screen.findByRole('button', { name: /join meeting/i });
    await user.click(button);

    await waitFor(() => expect(acceptMeetingInvite).toHaveBeenCalledWith('tok123'));
    expect(await screen.findByText('MeetingRoute')).toBeInTheDocument();
  });

  it('does not auto-accept on mount — acceptMeetingInvite only fires after an explicit click', async () => {
    await setGlobal({ token: 'fake-token' });
    previewMeetingInvite.mockResolvedValue({
      data: { status: 'ACTIVE', expiresAt: new Date().toISOString(), meeting: { id: 'm1', title: 'Standup' } },
    });
    renderPreview();

    await screen.findByRole('button', { name: /join meeting/i });
    expect(acceptMeetingInvite).not.toHaveBeenCalled();
  });

  // Regression: the invite creator opening their own link while already
  // connected used to accept successfully and navigate straight into a
  // second callManager.join() call — a real duplicate "ghost" tile with no
  // media in the call grid. The backend now refuses with ALREADY_IN_MEETING;
  // this must render as its own distinct state, not the generic error toast,
  // and its "Go to meeting" button must navigate WITHOUT calling accept again.
  it('shows "already in this meeting" instead of a generic error on ALREADY_IN_MEETING, and navigates without re-accepting', async () => {
    await setGlobal({ token: 'fake-token' });
    previewMeetingInvite.mockResolvedValue({
      data: { status: 'ACTIVE', expiresAt: new Date().toISOString(), meeting: { id: 'm1', title: 'Standup' } },
    });
    acceptMeetingInvite.mockRejectedValue({
      response: { data: { error: true, reason: 'ALREADY_IN_MEETING', meeting: { id: 'm1' } } },
    });
    const user = userEvent.setup();
    renderPreview();

    await user.click(await screen.findByRole('button', { name: /join meeting/i }));

    expect(await screen.findByText('You’re already in this meeting')).toBeInTheDocument();
    expect(acceptMeetingInvite).toHaveBeenCalledTimes(1);

    const goToMeetingBtn = screen.getByRole('button', { name: /go to meeting/i });
    await user.click(goToMeetingBtn);

    expect(await screen.findByText('MeetingRoute')).toBeInTheDocument();
    // Navigating away must not have triggered a second accept call.
    expect(acceptMeetingInvite).toHaveBeenCalledTimes(1);
  });
});
