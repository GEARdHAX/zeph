import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InviteGroup from './InviteGroup';

vi.mock('../../../actions/invites', () => ({ createGroupInvite: vi.fn() }));
// eslint-disable-next-line import/first
import { createGroupInvite } from '../../../actions/invites';

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
