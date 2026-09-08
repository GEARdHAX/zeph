import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Popup from './Popup';
import { getUserAiQuota, resetUserAiQuota } from '../../../actions/adminAiQuota';

vi.mock('../../../actions/admin', () => ({
  postCreate: vi.fn(),
  postUpdate: vi.fn(),
  postDelete: vi.fn(),
}));
vi.mock('../../../actions/adminAiQuota', () => ({
  getUserAiQuota: vi.fn(),
  resetUserAiQuota: vi.fn(),
}));
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const USER = { _id: 'u1', username: 'alice', email: 'a@x.com' };

const QUOTA = {
  data: {
    user: USER,
    usage: {
      minute: { used: 5, ttlSeconds: 42 },
      day: { used: 30, ttlSeconds: 3600 },
      concurrent: { used: 1 },
    },
    limits: { perMinute: 5, perDay: 50, concurrent: 2 },
  },
};

beforeEach(() => {
  getUserAiQuota.mockReset();
  resetUserAiQuota.mockReset();
});

describe('Popup — AI usage panel', () => {
  it("loads and shows the user's current usage against the limits", async () => {
    getUserAiQuota.mockResolvedValueOnce(QUOTA);
    render(<Popup type="ai-quota" user={USER} onClose={vi.fn()} />);

    expect(await screen.findByText('This minute')).toBeInTheDocument();
    expect(screen.getByText(/5 \/ 5 used/)).toBeInTheDocument();
    expect(screen.getByText(/30 \/ 50 used/)).toBeInTheDocument();
    expect(screen.getByText(/resets in 42s/)).toBeInTheDocument();
  });

  it('resets a single quota type and refreshes the displayed usage', async () => {
    getUserAiQuota.mockResolvedValueOnce(QUOTA);
    resetUserAiQuota.mockResolvedValueOnce({
      data: { ok: true, cleared: ['minute'], usage: { ...QUOTA.data.usage, minute: { used: 0, ttlSeconds: 0 } } },
    });
    const user = userEvent.setup();
    render(<Popup type="ai-quota" user={USER} onClose={vi.fn()} />);

    await screen.findByText('This minute');
    // the "This minute" row's Reset button is the first one
    const resetButtons = screen.getAllByRole('button', { name: 'Reset' });
    await user.click(resetButtons[0]);

    await waitFor(() => expect(resetUserAiQuota).toHaveBeenCalledWith('u1', ['minute']));
    await waitFor(() => expect(screen.getByText(/0 \/ 5 used/)).toBeInTheDocument());
  });

  it('"Reset all AI usage" calls the backend with ["all"]', async () => {
    getUserAiQuota.mockResolvedValueOnce(QUOTA);
    resetUserAiQuota.mockResolvedValueOnce({
      data: { ok: true, cleared: ['minute', 'day', 'concurrent'], usage: QUOTA.data.usage },
    });
    const user = userEvent.setup();
    render(<Popup type="ai-quota" user={USER} onClose={vi.fn()} />);

    await screen.findByText('This minute');
    await user.click(screen.getByRole('button', { name: 'Reset all AI usage' }));

    await waitFor(() => expect(resetUserAiQuota).toHaveBeenCalledWith('u1', ['all']));
  });

  it('shows a "tracking not active" message when the backend returns null usage (no Redis)', async () => {
    getUserAiQuota.mockResolvedValueOnce({ data: { user: USER, usage: null, limits: {} } });
    render(<Popup type="ai-quota" user={USER} onClose={vi.fn()} />);

    expect(await screen.findByText(/tracking is not active/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset all AI usage' })).not.toBeInTheDocument();
  });
});
