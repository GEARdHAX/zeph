import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InviteFriend from './InviteFriend';

vi.mock('../../../actions/invites', () => ({ createFriendInvite: vi.fn() }));
// eslint-disable-next-line import/first
import { createFriendInvite } from '../../../actions/invites';

// jsdom's navigator.clipboard is a getter-only property — defineProperty
// (not Object.assign) is required to stub it. userEvent.setup() installs its
// own clipboard stub, so this must run AFTER setup() in each test, not in
// beforeEach, or userEvent's stub silently wins.
const stubClipboard = () => Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: vi.fn().mockResolvedValue() },
  configurable: true,
});

beforeEach(() => {
  createFriendInvite.mockReset();
});

describe('InviteFriend', () => {
  it('creates an invite link on mount and enables the actions once loaded', async () => {
    createFriendInvite.mockResolvedValue({ data: { url: '/invite/f/abc123' } });
    render(<InviteFriend onClose={() => {}} />);

    await waitFor(() => expect(screen.getByRole('button', { name: /copy link/i })).toBeEnabled());
  });

  it('copies the full origin-qualified link to the clipboard', async () => {
    createFriendInvite.mockResolvedValue({ data: { url: '/invite/f/abc123' } });
    const userEv = userEvent.setup();
    stubClipboard();
    render(<InviteFriend onClose={() => {}} />);

    const copyBtn = await screen.findByRole('button', { name: /copy link/i });
    await waitFor(() => expect(copyBtn).toBeEnabled());
    await userEv.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/invite/f/abc123`);
  });

  it('toggles the QR code visibility', async () => {
    createFriendInvite.mockResolvedValue({ data: { url: '/invite/f/abc123' } });
    const userEv = userEvent.setup();
    render(<InviteFriend onClose={() => {}} />);

    const qrBtn = await screen.findByRole('button', { name: /show qr/i });
    await waitFor(() => expect(qrBtn).toBeEnabled());
    await userEv.click(qrBtn);

    expect(await screen.findByRole('button', { name: /hide qr/i })).toBeInTheDocument();
  });
});
