import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { listAiIncidents, getAiIncident } from '../../actions/securityAi';

const SEVERITY_CLASSES = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  high: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  critical: 'bg-destructive/15 text-destructive',
};

// Phase 6 minimal viewer (spec section 45-46) — a correlated-incident list
// + detail panel. Every AI-derived field is clearly labeled "AI-assisted
// analysis" / "AI recommendation" — NEVER presented as an authoritative
// security decision (spec section 46: the actual decision comes from Zero
// Trust, not from anything shown here). An incident with no aiAnalysis yet
// (AI disabled, provider unavailable, or not yet processed) shows that
// honestly rather than a blank/misleading state.
function SecurityAiIncidents() {
  const navigate = useNavigate();
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [severityFilter, setSeverityFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [selectedLoading, setSelectedLoading] = useState(false);

  const back = () => navigate('/admin');

  useEffect(() => {
    setLoading(true);
    const params = {};
    if (severityFilter) params.severity = severityFilter;
    listAiIncidents(params)
      .then((res) => setIncidents(res.data.incidents || []))
      .catch(() => setIncidents([]))
      .finally(() => setLoading(false));
  }, [severityFilter]);

  const onSelectIncident = (incidentId) => {
    setSelectedLoading(true);
    setSelected({ incidentId });
    getAiIncident(incidentId)
      .then((res) => setSelected(res.data.incident))
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
            <Sparkles className="h-4 w-4 text-primary" />
            AI Security Incidents
          </h1>
          <p className="text-xs text-muted-foreground">Correlated anomalies with AI-assisted analysis — advisory only, not a security decision</p>
        </div>
      </div>

      <div className="flex-1 p-6 max-w-5xl w-full mx-auto">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select
            className="h-9 rounded-xl border border-input bg-card/60 px-3 text-xs font-medium text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
          >
            <option value="">All severities</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="critical">critical</option>
          </select>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/40 shadow-sm backdrop-blur-sm">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border/60 bg-muted/40 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Last Seen</th>
                <th className="px-4 py-3">Severity</th>
                <th className="px-4 py-3">Signals</th>
                <th className="px-4 py-3">Events</th>
                <th className="px-4 py-3">AI Assessment</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!loading && incidents.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">No incidents found.</td></tr>
              )}
              {!loading && incidents.map((incident) => (
                <tr
                  key={incident.incidentId}
                  className="cursor-pointer border-b border-border/40 hover:bg-muted/40"
                  onClick={() => onSelectIncident(incident.incidentId)}
                >
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{new Date(incident.lastSeenAt).toLocaleString()}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${SEVERITY_CLASSES[incident.severity] || SEVERITY_CLASSES.low}`}>
                      {incident.severity}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{(incident.signals || []).join(', ') || '—'}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{incident.eventCount}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {incident.aiAnalysis?.anomalous === true && `Anomalous (${incident.aiAnalysis.confidence}%)`}
                    {incident.aiAnalysis?.anomalous === false && 'Not anomalous'}
                    {incident.aiAnalysis?.anomalous == null && 'Not yet analyzed'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setSelected(null)}>
          <div
            className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-foreground">Incident Detail</h2>
              <Button variant="ghost" size="sm" className="h-7 rounded-lg text-xs" onClick={() => setSelected(null)}>Close</Button>
            </div>
            {selectedLoading ? (
              <div className="py-8 text-center text-xs text-muted-foreground">Loading…</div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-xl border border-border/60 bg-muted/30 p-3 text-[11px]">
                  <div className="text-muted-foreground">Severity</div>
                  <div className="font-medium text-foreground">{selected.severity}</div>
                  <div className="text-muted-foreground">Signals</div>
                  <div className="font-medium text-foreground">{(selected.signals || []).join(', ') || '—'}</div>
                  <div className="text-muted-foreground">Hosts</div>
                  <div className="font-medium text-foreground">{(selected.hosts || []).join(', ') || '—'}</div>
                  <div className="text-muted-foreground">Sources</div>
                  <div className="font-medium text-foreground">{(selected.sources || []).join(', ') || '—'}</div>
                  <div className="text-muted-foreground">Events</div>
                  <div className="font-medium text-foreground">{selected.eventCount}</div>
                  <div className="text-muted-foreground">Started</div>
                  <div className="font-medium text-foreground">{selected.startedAt ? new Date(selected.startedAt).toLocaleString() : '—'}</div>
                </div>

                {/* AI assessment — clearly labeled advisory, never a decision (spec section 45-46). */}
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
                  <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
                    <Sparkles className="h-3.5 w-3.5" />
                    AI-Assisted Analysis (advisory only)
                  </div>
                  {selected.aiAnalysis?.analyzedAt ? (
                    <div className="space-y-1.5 text-[11px]">
                      <div>
                        <span className="text-muted-foreground">Assessment: </span>
                        <span className="font-medium text-foreground">
                          {selected.aiAnalysis.anomalous ? 'Anomalous' : 'Not anomalous'}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Confidence: </span>
                        <span className="font-medium text-foreground">{selected.aiAnalysis.confidence}%</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Explanation: </span>
                        <span className="text-foreground">{selected.aiAnalysis.summary}</span>
                      </div>
                      <div className="pt-1 text-[10px] text-muted-foreground">
                        Model:
                        {' '}
                        {selected.aiAnalysis.model || 'unknown'}
                        {' '}
                        — this is an AI recommendation, not a security decision. The actual access decision is made by Zero Trust.
                      </div>
                    </div>
                  ) : (
                    <div className="text-[11px] text-muted-foreground">No AI analysis available for this incident yet.</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default SecurityAiIncidents;
