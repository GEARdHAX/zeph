import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { ArrowLeft, Flag, ShieldOff, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { listReports, reviewReport, suspendUser } from '../../actions/adminReports';

const REASONS = ['SPAM', 'HARASSMENT', 'HATE_SPEECH', 'INAPPROPRIATE_CONTENT', 'SCAM', 'OTHER'];
const STATUSES = ['OPEN', 'REVIEWED', 'ACTIONED', 'DISMISSED'];

const STATUS_CLASSES = {
  OPEN: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  REVIEWED: 'bg-muted text-muted-foreground',
  ACTIONED: 'bg-destructive/15 text-destructive',
  DISMISSED: 'bg-muted text-muted-foreground',
};

const nameOf = (user) => (user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || `@${user.username}` : '—');

// Report review queue (spec-less internal feature, "report in DM" ->
// TopBar.jsx's Report action). Deliberately not the full moderation
// dashboard SecurityEvents.jsx's own comment describes for THAT page — just
// a filterable list plus the two actions a reviewer actually needs: mark
// the report's own status, and suspend/reactivate the REPORTED user's
// account (backend/src/routes/admin/user-suspend.js) — two independent
// actions, not one bundled button, since a report can be reviewed/dismissed
// with no account action at all.
function Reports() {
  const navigate = useNavigate();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: 'OPEN', reason: '' });
  const [actingId, setActingId] = useState(null);

  const back = () => navigate('/admin');

  const load = () => {
    setLoading(true);
    const params = {};
    if (filters.status) params.status = filters.status;
    listReports(params)
      .then((res) => {
        const rows = res.data.reports || [];
        setReports(filters.reason ? rows.filter((r) => r.reason === filters.reason) : rows);
      })
      .catch(() => setReports([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, [filters.status, filters.reason]); // eslint-disable-line react-hooks/exhaustive-deps

  const onFilterChange = (key) => (e) => setFilters((prev) => ({ ...prev, [key]: e.target.value }));

  const onReview = async (report, status) => {
    setActingId(report._id);
    try {
      await reviewReport(report._id, status);
      toast.success(`Report marked ${status.toLowerCase()}.`);
      load();
    } catch (err) {
      toast.error('Could not update the report.');
    } finally {
      setActingId(null);
    }
  };

  const onSuspendToggle = async (report) => {
    const target = report.reportedUser;
    const currentlySuspended = target?.accountStatus === 'DEACTIVATED';
    const confirmMsg = currentlySuspended
      ? `Reactivate @${target?.username}'s account?`
      : `Suspend @${target?.username}'s account? They'll be signed out immediately.`;
    // eslint-disable-next-line no-alert
    if (!window.confirm(confirmMsg)) return;

    setActingId(report._id);
    try {
      await suspendUser(target._id, !currentlySuspended);
      toast.success(currentlySuspended ? 'Account reactivated.' : 'Account suspended.');
      // Marking the report ACTIONED is the natural follow-through of
      // actually taking action against the reported user — not forced on
      // reactivation, since undoing a suspension isn't itself "acting on"
      // the original report.
      if (!currentlySuspended && report.status === 'OPEN') {
        await reviewReport(report._id, 'ACTIONED');
      }
      load();
    } catch (err) {
      const reason = err.response?.data?.reason;
      toast.error(
        reason === 'CANNOT_SUSPEND_PRIVILEGED'
          ? 'This user has admin access and cannot be suspended here.'
          : 'Could not update this account.',
      );
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground overflow-y-auto">
      <div className="flex h-16 w-full shrink-0 items-center gap-3 border-b border-border/60 bg-card px-6">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={back}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="flex items-center gap-2 text-base font-bold text-foreground">
            <Flag className="h-4 w-4 text-primary" />
            Reports
          </h1>
          <p className="text-xs text-muted-foreground">User-filed reports from DMs and group chats</p>
        </div>
      </div>

      <div className="flex-1 p-6 max-w-6xl w-full mx-auto">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select
            className="h-9 rounded-xl border border-input bg-card/60 px-3 text-xs font-medium text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            value={filters.status}
            onChange={onFilterChange('status')}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            className="h-9 rounded-xl border border-input bg-card/60 px-3 text-xs font-medium text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            value={filters.reason}
            onChange={onFilterChange('reason')}
          >
            <option value="">All reasons</option>
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/40 shadow-sm backdrop-blur-sm">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border/60 bg-muted/40 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Reported</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Details</th>
                <th className="px-4 py-3">Reporter</th>
                <th className="px-4 py-3">Filed</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && reports.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                    No reports found.
                  </td>
                </tr>
              )}
              {!loading &&
                reports.map((report) => {
                  const suspended = report.reportedUser?.accountStatus === 'DEACTIVATED';
                  const acting = actingId === report._id;
                  return (
                    <tr key={report._id} className="border-b border-border/40 align-top">
                      <td className="px-4 py-2.5 font-semibold text-foreground">{nameOf(report.reportedUser)}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{report.reason}</td>
                      <td className="max-w-[220px] truncate px-4 py-2.5 text-muted-foreground" title={report.details}>
                        {report.details || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{nameOf(report.reporter)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                        {new Date(report.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLASSES[report.status] || STATUS_CLASSES.REVIEWED}`}
                        >
                          {report.status}
                        </span>
                        {suspended && (
                          <span className="ml-1 rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold text-destructive">
                            Suspended
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-[11px]"
                            disabled={acting || report.status === 'DISMISSED'}
                            onClick={() => onReview(report, 'DISMISSED')}
                          >
                            Dismiss
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-[11px]"
                            disabled={acting || report.status === 'REVIEWED'}
                            onClick={() => onReview(report, 'REVIEWED')}
                          >
                            Mark reviewed
                          </Button>
                          <Button
                            variant={suspended ? 'outline' : 'destructive'}
                            size="sm"
                            className="h-7 gap-1 px-2 text-[11px]"
                            disabled={acting || !report.reportedUser}
                            onClick={() => onSuspendToggle(report)}
                            title={suspended ? 'Reactivate this account' : 'Suspend this account'}
                          >
                            {suspended ? <ShieldCheck className="h-3 w-3" /> : <ShieldOff className="h-3 w-3" />}
                            {suspended ? 'Reactivate' : 'Suspend user'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default Reports;
