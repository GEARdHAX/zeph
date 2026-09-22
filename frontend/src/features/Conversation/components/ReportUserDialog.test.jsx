import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'react-toastify';
import ReportUserDialog from './ReportUserDialog';

vi.mock('../../../actions/reports', () => ({ default: vi.fn() }));
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// eslint-disable-next-line import/first
import createReport from '../../../actions/reports';

beforeEach(() => {
  createReport.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe('ReportUserDialog', () => {
  it('the submit button is disabled and unclickable until a reason is chosen', async () => {
    render(<ReportUserDialog roomID="room-1" reportedUserId="user-2" reportedUserName="Other" onClose={() => {}} />);

    expect(screen.getByRole('button', { name: /submit report/i })).toBeDisabled();
    expect(createReport).not.toHaveBeenCalled();
  });

  it('submits the chosen reason and details, then closes on success', async () => {
    createReport.mockResolvedValue({ data: { status: 'success', reportId: 'r1' } });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ReportUserDialog roomID="room-1" reportedUserId="user-2" reportedUserName="Other" onClose={onClose} />);

    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: /spam/i }));
    await user.type(screen.getByLabelText(/additional details/i), 'They keep spamming links.');
    await user.click(screen.getByRole('button', { name: /submit report/i }));

    await waitFor(() =>
      expect(createReport).toHaveBeenCalledWith({
        roomID: 'room-1',
        reportedUserId: 'user-2',
        reason: 'SPAM',
        details: 'They keep spamming links.',
      }),
    );
    expect(toast.success).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows an error toast and does NOT close the dialog when submission fails', async () => {
    createReport.mockRejectedValue(new Error('network error'));
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ReportUserDialog roomID="room-1" reportedUserId="user-2" reportedUserName="Other" onClose={onClose} />);

    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: /harassment/i }));
    await user.click(screen.getByRole('button', { name: /submit report/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not submit the report. Please try again.'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
