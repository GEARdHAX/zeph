import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'react-toastify';
import Reports from './Reports';

vi.mock('../../actions/adminReports', () => ({
  listReports: vi.fn(),
  reviewReport: vi.fn(),
  suspendUser: vi.fn(),
}));
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// eslint-disable-next-line import/first
import { listReports, reviewReport, suspendUser } from '../../actions/adminReports';

const REPORT = {
  _id: 'report-1',
  reason: 'SPAM',
  details: 'Sending unwanted links repeatedly',
  status: 'OPEN',
  createdAt: new Date().toISOString(),
  reporter: { _id: 'user-1', firstName: 'Riya', lastName: 'Sharma', username: 'riya' },
  reportedUser: { _id: 'user-2', firstName: 'Bad', lastName: 'Actor', username: 'badactor', accountStatus: 'ACTIVE' },
};

const renderReports = () =>
  render(
    <MemoryRouter>
      <Reports />
    </MemoryRouter>,
  );

beforeEach(() => {
  listReports.mockReset();
  reviewReport.mockReset();
  suspendUser.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  listReports.mockResolvedValue({ data: { reports: [REPORT] } });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('Admin Reports page', () => {
  it('loads with the OPEN status filter by default', async () => {
    renderReports();
    await waitFor(() => expect(listReports).toHaveBeenCalledWith({ status: 'OPEN' }));
  });

  it('renders a report row with reporter, reported user, reason, and status', async () => {
    renderReports();
    expect(await screen.findByText('Bad Actor')).toBeInTheDocument();
    expect(screen.getByText('Riya Sharma')).toBeInTheDocument();
    const row = screen.getByText('Bad Actor').closest('tr');
    expect(row).not.toBeNull();
    expect(within(row).getByText('SPAM')).toBeInTheDocument();
    expect(within(row).getByText('OPEN')).toBeInTheDocument();
  });

  it('shows "No reports found." when the queue is empty', async () => {
    listReports.mockResolvedValue({ data: { reports: [] } });
    renderReports();
    expect(await screen.findByText('No reports found.')).toBeInTheDocument();
  });

  it('marking a report reviewed calls reviewReport with REVIEWED and refreshes', async () => {
    reviewReport.mockResolvedValue({ data: { status: 'success' } });
    const user = userEvent.setup();
    renderReports();

    await user.click(await screen.findByRole('button', { name: /mark reviewed/i }));

    await waitFor(() => expect(reviewReport).toHaveBeenCalledWith('report-1', 'REVIEWED'));
    expect(listReports).toHaveBeenCalledTimes(2);
  });

  it('dismissing a report calls reviewReport with DISMISSED', async () => {
    reviewReport.mockResolvedValue({ data: { status: 'success' } });
    const user = userEvent.setup();
    renderReports();

    await user.click(await screen.findByRole('button', { name: /^dismiss$/i }));

    await waitFor(() => expect(reviewReport).toHaveBeenCalledWith('report-1', 'DISMISSED'));
  });

  it('suspending confirms, calls suspendUser(userId, true), and marks the OPEN report ACTIONED', async () => {
    suspendUser.mockResolvedValue({ data: { status: 'success', accountStatus: 'DEACTIVATED' } });
    reviewReport.mockResolvedValue({ data: { status: 'success' } });
    const user = userEvent.setup();
    renderReports();

    await user.click(await screen.findByRole('button', { name: /suspend user/i }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(suspendUser).toHaveBeenCalledWith('user-2', true));
    await waitFor(() => expect(reviewReport).toHaveBeenCalledWith('report-1', 'ACTIONED'));
    expect(toast.success).toHaveBeenCalledWith('Account suspended.');
  });

  it('does not call suspendUser when the confirm dialog is cancelled', async () => {
    window.confirm.mockReturnValue(false);
    const user = userEvent.setup();
    renderReports();

    await user.click(await screen.findByRole('button', { name: /suspend user/i }));

    expect(suspendUser).not.toHaveBeenCalled();
  });

  it('shows "Reactivate" instead of "Suspend user" for an already-suspended account, and calls suspendUser(userId, false)', async () => {
    listReports.mockResolvedValue({
      data: { reports: [{ ...REPORT, reportedUser: { ...REPORT.reportedUser, accountStatus: 'DEACTIVATED' } }] },
    });
    suspendUser.mockResolvedValue({ data: { status: 'success', accountStatus: 'ACTIVE' } });
    const user = userEvent.setup();
    renderReports();

    const reactivateBtn = await screen.findByRole('button', { name: /reactivate/i });
    await user.click(reactivateBtn);

    await waitFor(() => expect(suspendUser).toHaveBeenCalledWith('user-2', false));
    // Reactivating must not also mark the report ACTIONED.
    expect(reviewReport).not.toHaveBeenCalled();
  });

  it('shows a specific error toast when the target has admin access', async () => {
    suspendUser.mockRejectedValue({ response: { data: { reason: 'CANNOT_SUSPEND_PRIVILEGED' } } });
    const user = userEvent.setup();
    renderReports();

    await user.click(await screen.findByRole('button', { name: /suspend user/i }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('This user has admin access and cannot be suspended here.'),
    );
  });
});
