import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Radar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { listThreatIndicators, getThreatIndicator, getThreatIntelStatus } from '../../actions/threatIntelligence';

const TYPES = ['IP', 'DOMAIN', 'URL', 'HASH'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];

const SEVERITY_CLASSES = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  high: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  critical: 'bg-destructive/15 text-destructive',
};

// Phase 3 minimal viewer (spec sections 30/36) — same shape as
// SecurityEvents.jsx (Phase 1): filterable cursor-paginated table + a
// click-through detail panel, nothing more. The status card at top is the
// ENTIRE "dashboard" this phase builds — no charts, no trends, no
// real-time stream (spec: "the exact dashboard can remain minimal until
// Phase 8").
function ThreatIntelligence() {
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const [indicators, setIndicators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(null);
  const [cursorStack, setCursorStack] = useState([]);
  const [filters, setFilters] = useState({ type: '', malicious: '', severity: '' });
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
    listThreatIndicators(params)
      .then((res) => {
        setIndicators(res.data.indicators || []);
        setCursor(res.data.cursor);
      })
      .catch(() => setIndicators([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    getThreatIntelStatus().then((res) => setStatus(res.data)).catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    setCursorStack([]);
    load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.type, filters.malicious, filters.severity]);

  const onFilterChange = (key) => (e) => setFilters((prev) => ({ ...prev, [key]: e.target.value }));

  const onSelectIndicator = (normalizedIndicator) => {
    setSelectedLoading(true);
    setSelected({ normalizedIndicator });
    getThreatIndicator(normalizedIndicator)
      .then((res) => setSelected(res.data.indicator))
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
            <Radar className="h-4 w-4 text-primary" />
            Threat Intelligence
          </h1>
          <p className="text-xs text-muted-foreground">IP reputation, provider health, and indicator history</p>
        </div>
      </div>

      <div className="flex-1 p-6 max-w-6xl w-full mx-auto">
        {/* Provider status card (spec section 36) */}
        {status && (
          <div className="mb-6 grid grid-cols-2 gap-3 rounded-2xl border border-border/70 bg-card/40 p-4 shadow-sm backdrop-blur-sm sm:grid-cols-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Provider</div>
              <div className="mt-0.5 text-sm font-semibold text-foreground">{status.provider}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Circuit</div>
              <div className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${status.circuitState === 'OPEN' ? SEVERITY_CLASSES.critical : SEVERITY_CLASSES.low}`}>
                {status.circuitState}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Today&apos;s Budget</div>
              <div className="mt-0.5 text-sm font-semibold text-foreground">
                {status.usedToday}
                {' / '}
                {status.dailyBudget}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Redis Cache</div>
              <div className="mt-0.5 text-sm font-semibold text-foreground">{status.redisConfigured ? 'Connected' : 'Not configured'}</div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select
            className="h-9 rounded-xl border border-input bg-card/60 px-3 text-xs font-medium text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            value={filters.type}
            onChange={onFilterChange('type')}
          >
            <option value="">All types</option>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select
            className="h-9 rounded-xl border border-input bg-card/60 px-3 text-xs font-medium text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            value={filters.malicious}
            onChange={onFilterChange('malicious')}
          >
            <option value="">Any status</option>
            <option value="true">Malicious</option>
            <option value="false">Not malicious</option>
          </select>
          <select
            className="h-9 rounded-xl border border-input bg-card/60 px-3 text-xs font-medium text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            value={filters.severity}
            onChange={onFilterChange('severity')}
          >
            <option value="">All severities</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/40 shadow-sm backdrop-blur-sm">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border/60 bg-muted/40 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Indicator</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Severity</th>
                <th className="px-4 py-3">Confidence</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Last Seen</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!loading && indicators.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No indicators found.</td></tr>
              )}
              {!loading && indicators.map((ind) => (
                <tr
                  key={ind._id || ind.normalizedIndicator}
                  className="cursor-pointer border-b border-border/40 hover:bg-muted/40"
                  onClick={() => onSelectIndicator(ind.normalizedIndicator)}
                >
                  <td className="px-4 py-2.5 font-semibold text-foreground">{ind.indicator}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{ind.type}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${SEVERITY_CLASSES[ind.severity] || SEVERITY_CLASSES.low}`}>
                      {ind.severity}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{ind.confidence}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{ind.source}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                    {new Date(ind.lastSeen).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{ind.status}</td>
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
            onClick={() => {
              if (!cursor) return;
              setCursorStack((prev) => [...prev, null]);
              load(cursor);
            }}
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
              <h2 className="text-sm font-bold text-foreground">Indicator Detail</h2>
              <Button variant="ghost" size="sm" className="h-7 rounded-lg text-xs" onClick={() => setSelected(null)}>Close</Button>
            </div>
            {selectedLoading ? (
              <div className="py-8 text-center text-xs text-muted-foreground">Loading…</div>
            ) : (
              <pre className="overflow-x-auto rounded-xl bg-muted/50 p-3 text-[11px] leading-relaxed text-foreground whitespace-pre-wrap break-all">
                {JSON.stringify(selected, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ThreatIntelligence;
