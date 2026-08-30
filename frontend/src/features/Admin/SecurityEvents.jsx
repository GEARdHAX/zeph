import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { listSecurityEvents, getSecurityEvent } from '../../actions/securityEvents';

const EVENT_TYPES = [
  'LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'TOKEN_REFRESH', 'TOKEN_REVOKED',
  'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_SUCCESS', 'PASSWORD_RESET_FAILED', 'MFA_FAILED',
  'RATE_LIMIT_TRIGGERED', 'PERMISSION_DENIED', 'UNAUTHORIZED_ACCESS',
  'FILE_UPLOAD', 'FILE_UPLOAD_REJECTED', 'GROUP_JOIN', 'GROUP_LEAVE', 'MESSAGE_SENT',
  'CALL_STARTED', 'CALL_ENDED', 'ADMIN_ACTION',
  // Phase 2 — Zero Trust
  'ZERO_TRUST_ALLOW', 'ZERO_TRUST_STEP_UP', 'ZERO_TRUST_DENY',
  'SESSION_SUSPICIOUS', 'SESSION_REVOKED', 'DEVICE_REGISTERED', 'DEVICE_MARKED_SUSPICIOUS',
];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const RESULTS = ['success', 'failure', 'blocked', 'unknown'];

const SEVERITY_CLASSES = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  high: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  critical: 'bg-destructive/15 text-destructive',
};

// Phase 1 minimal viewer (spec section 18) — deliberately not the
// full Security Command Center: a filterable, cursor-paginated table plus
// a click-through detail panel, nothing more (no charts, no real-time
// stream, no bulk actions). Backend RBAC (isPrivileged) is the actual
// enforcement — this page has no client-side gate of its own, matching how
// Admin/index.jsx itself doesn't either (a non-admin reaching this route
// just gets 404s from every request and an empty table).
function SecurityEvents() {
  const navigate = useNavigate();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(null);
  const [cursorStack, setCursorStack] = useState([]); // for a "previous page" back button
  const [filters, setFilters] = useState({
    type: '', severity: '', result: '', userId: '', ip: '',
  });
  const [selected, setSelected] = useState(null);
  const [selectedLoading, setSelectedLoading] = useState(false);

  const back = () => navigate('/admin');

  const load = (nextCursor) => {
    setLoading(true);
    const params = { limit: 30 };
    if (nextCursor) params.cursor = nextCursor;
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params[key] = value;
    });
    listSecurityEvents(params)
      .then((res) => {
        setEvents(res.data.events || []);
        setCursor(res.data.cursor);
      })
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setCursorStack([]);
    load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.type, filters.severity, filters.result, filters.userId, filters.ip]);

  const onNextPage = () => {
    if (!cursor) return;
    setCursorStack((prev) => [...prev, null]);
    load(cursor);
  };

  const onFilterChange = (key) => (e) => setFilters((prev) => ({ ...prev, [key]: e.target.value }));

  const onSelectEvent = (eventId) => {
    setSelectedLoading(true);
    setSelected({ eventId });
    getSecurityEvent(eventId)
      .then((res) => setSelected(res.data.event))
      .catch(() => setSelected(null))
      .finally(() => setSelectedLoading(false));
  };

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground overflow-y-auto">
      <div className="flex h-16 w-full shrink-0 items-center gap-3 border-b border-border/60 bg-card px-6">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={back}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="flex items-center gap-2 text-base font-bold text-foreground">
            <ShieldAlert className="h-4 w-4 text-primary" />
            Security Events
          </h1>
          <p className="text-xs text-muted-foreground">Authentication, authorization, and abuse telemetry</p>
        </div>
      </div>

      <div className="flex-1 p-6 max-w-6xl w-full mx-auto">
        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select
            className="h-9 rounded-xl border border-input bg-card/60 px-3 text-xs font-medium text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            value={filters.type}
            onChange={onFilterChange('type')}
          >
            <option value="">All types</option>
            {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select
            className="h-9 rounded-xl border border-input bg-card/60 px-3 text-xs font-medium text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            value={filters.severity}
            onChange={onFilterChange('severity')}
          >
            <option value="">All severities</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            className="h-9 rounded-xl border border-input bg-card/60 px-3 text-xs font-medium text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            value={filters.result}
            onChange={onFilterChange('result')}
          >
            <option value="">All results</option>
            {RESULTS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <input
            className="h-9 w-40 rounded-xl border border-input bg-card/60 px-3 text-xs font-medium text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            placeholder="User ID"
            value={filters.userId}
            onChange={onFilterChange('userId')}
          />
          <input
            className="h-9 w-36 rounded-xl border border-input bg-card/60 px-3 text-xs font-medium text-foreground placeholder:text-muted-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            placeholder="IP address"
            value={filters.ip}
            onChange={onFilterChange('ip')}
          />
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/40 shadow-sm backdrop-blur-sm">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border/60 bg-muted/40 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">Event</th>
                <th className="px-4 py-3">Severity</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">IP</th>
                <th className="px-4 py-3">Result</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!loading && events.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No security events found.</td></tr>
              )}
              {!loading && events.map((event) => (
                <tr
                  key={event.eventId}
                  className="cursor-pointer border-b border-border/40 hover:bg-muted/40"
                  onClick={() => onSelectEvent(event.eventId)}
                >
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                    {new Date(event.timestamp).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 font-semibold text-foreground">{event.type}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${SEVERITY_CLASSES[event.severity] || SEVERITY_CLASSES.low}`}>
                      {event.severity}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{event.actor?.userId || '—'}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{event.source?.ip || '—'}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{event.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl text-xs"
            disabled={cursorStack.length === 0 || loading}
            onClick={() => {
              const nextStack = cursorStack.slice(0, -1);
              setCursorStack(nextStack);
              load(nextStack[nextStack.length - 1] || null);
            }}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl text-xs"
            disabled={!cursor || loading}
            onClick={onNextPage}
          >
            Next
          </Button>
        </div>
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setSelected(null)}>
          <div
            className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-foreground">Event Detail</h2>
              <Button variant="ghost" size="sm" className="h-7 rounded-lg text-xs" onClick={() => setSelected(null)}>Close</Button>
            </div>
            {selectedLoading ? (
              <div className="py-8 text-center text-xs text-muted-foreground">Loading…</div>
            ) : (
              <>
                {/* Zero Trust summary (spec section 26) — shown only for
                    events the policy engine actually produced (metadata.
                    riskScore is set by lib/zeroTrust.js on every ALLOW/
                    STEP_UP/DENY it records); every other event type just
                    falls through to the raw-JSON view below, unchanged
                    from Phase 1. */}
                {typeof selected.metadata?.riskScore === 'number' && (
                  <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-xl border border-border/60 bg-muted/30 p-3 text-[11px]">
                    <div className="text-muted-foreground">User</div>
                    <div className="font-medium text-foreground">{selected.actor?.userId || '—'}</div>
                    <div className="text-muted-foreground">Session</div>
                    <div className="font-medium text-foreground">{selected.actor?.sessionId || '—'}</div>
                    <div className="text-muted-foreground">Device</div>
                    <div className="font-medium text-foreground">{selected.source?.deviceId ? 'Known' : 'Unknown'}</div>
                    <div className="text-muted-foreground">Risk</div>
                    <div className="font-medium text-foreground">
                      {selected.metadata.riskScore}
                      {' '}
                      (
                      {selected.metadata.riskLevel}
                      )
                    </div>
                    <div className="text-muted-foreground">Decision</div>
                    <div className={`font-semibold ${SEVERITY_CLASSES[selected.severity] || ''} inline-block w-fit rounded px-1.5`}>
                      {selected.type.replace('ZERO_TRUST_', '')}
                    </div>
                    <div className="text-muted-foreground">Policy</div>
                    <div className="font-medium text-foreground">{selected.metadata.policy || '—'}</div>
                    <div className="text-muted-foreground">Reason</div>
                    <div className="font-medium text-foreground">{selected.metadata.reason || '—'}</div>
                    <div className="text-muted-foreground">Timestamp</div>
                    <div className="font-medium text-foreground">{new Date(selected.timestamp).toLocaleString()}</div>
                  </div>
                )}
                <pre className="overflow-x-auto rounded-xl bg-muted/50 p-3 text-[11px] leading-relaxed text-foreground whitespace-pre-wrap break-all">
                  {JSON.stringify(selected, null, 2)}
                </pre>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default SecurityEvents;
