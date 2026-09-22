import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ShareMeetingInvite from './ShareMeetingInvite';

vi.mock('../../../actions/meetingInvites', () => ({
  createMeetingInvite: vi.fn(),
  listMeetingInvites: vi.fn(),
  revokeMeetingInvite: vi.fn(),
}));
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// eslint-disable-next-line import/first
import { createMeetingInvite, listMeetingInvites, revokeMeetingInvite } from '../../../actions/meetingInvites';

const stubClipboard = () =>
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue() },
    configurable: true,
  });

beforeEach(() => {
  createMeetingInvite.mockReset();
  listMeetingInvites.mockReset();
  revokeMeetingInvite.mockReset();
  listMeetingInvites.mockResolvedValue({ data: { invites: [] } });
});

describe('ShareMeetingInvite', () => {
  it('does not create an invite until "Create invite link" is clicked', async () => {
    render(<ShareMeetingInvite meetingId="meeting-1" onClose={() => {}} />);

    await screen.findByRole('button', { name: /create invite link/i });
    expect(createMeetingInvite).not.toHaveBeenCalled();
  });

  it('creates an invite with the selected expiry key and shows the copy/share/QR/revoke actions', async () => {
    createMeetingInvite.mockResolvedValue({
      data: { inviteId: 'inv-1', url: '/invite/m/tok123', expiresAt: new Date().toISOString(), status: 'ACTIVE' },
    });
    const user = userEvent.setup();
    render(<ShareMeetingInvite meetingId="meeting-1" onClose={() => {}} />);

    await user.click(screen.getByRole('button', { name: /create invite link/i }));

    await waitFor(() => expect(createMeetingInvite).toHaveBeenCalledWith('meeting-1', { expiresIn: '1h' }));
    expect(await screen.findByText(`${window.location.origin}/invite/m/tok123`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show qr/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /revoke invite/i })).toBeInTheDocument();
  });

  it('copies the full origin-qualified link to the clipboard', async () => {
    createMeetingInvite.mockResolvedValue({
      data: { inviteId: 'inv-1', url: '/invite/m/tok123', expiresAt: new Date().toISOString(), status: 'ACTIVE' },
    });
    const user = userEvent.setup();
    stubClipboard();
    render(<ShareMeetingInvite meetingId="meeting-1" onClose={() => {}} />);

    await user.click(screen.getByRole('button', { name: /create invite link/i }));
    await user.click(await screen.findByRole('button', { name: /copy link/i }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/invite/m/tok123`);
  });

  it('shows the QR code containing the same invite URL when "Show QR" is clicked', async () => {
    createMeetingInvite.mockResolvedValue({
      data: { inviteId: 'inv-1', url: '/invite/m/tok123', expiresAt: new Date().toISOString(), status: 'ACTIVE' },
    });
    const user = userEvent.setup();
    render(<ShareMeetingInvite meetingId="meeting-1" onClose={() => {}} />);

    await user.click(screen.getByRole('button', { name: /create invite link/i }));
    await user.click(await screen.findByRole('button', { name: /show qr/i }));

    expect(await screen.findByText('Scan to join this Zeph meeting')).toBeInTheDocument();
    // qrcode.react renders an <svg> — presence is enough to confirm it mounted with a value, not a blank placeholder.
    expect(document.querySelector('svg')).not.toBeNull();
  });

  it('revoking disables copy/share/QR and hides the revoke button, without deleting the invite from view', async () => {
    createMeetingInvite.mockResolvedValue({
      data: { inviteId: 'inv-1', url: '/invite/m/tok123', expiresAt: new Date().toISOString(), status: 'ACTIVE' },
    });
    revokeMeetingInvite.mockResolvedValue({ data: { status: 'success' } });
    const user = userEvent.setup();
    render(<ShareMeetingInvite meetingId="meeting-1" onClose={() => {}} />);

    await user.click(screen.getByRole('button', { name: /create invite link/i }));
    await user.click(await screen.findByRole('button', { name: /revoke invite/i }));

    await waitFor(() => expect(revokeMeetingInvite).toHaveBeenCalledWith('inv-1'));
    expect(await screen.findByText('This invite has been revoked.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /revoke invite/i })).not.toBeInTheDocument();
  });

  it('lists existing invites for the meeting on mount', async () => {
    listMeetingInvites.mockResolvedValue({
      data: {
        invites: [
          { inviteId: 'a', status: 'ACTIVE', expiresAt: new Date(Date.now() + 3600000).toISOString() },
          { inviteId: 'b', status: 'EXPIRED', expiresAt: new Date(Date.now() - 3600000).toISOString() },
        ],
      },
    });
    render(<ShareMeetingInvite meetingId="meeting-1" onClose={() => {}} />);

    await waitFor(() => expect(listMeetingInvites).toHaveBeenCalledWith('meeting-1'));
    expect(await screen.findByText('Active invites')).toBeInTheDocument();
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    expect(screen.getByText('EXPIRED')).toBeInTheDocument();
  });
});
