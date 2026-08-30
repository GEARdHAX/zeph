import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Network } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getNetworkSummary } from '../../actions/networkIntel';

const SEVERITY_CLASSES = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  high: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  critical: 'bg-destructive/15 text-destructive',
};

// Phase 5 minimal viewer (spec section 47) — Recent Network Alerts, Top
// Suspicious Destinations, counts by type. Deliberately NOT a full
// Security Command Center, NOT a raw-traffic/packet view (spec section 47:
// "do not expose raw traffic... packet payloads") — every field shown here
// is metadata already covered by the privacy boundary documented in
// ebpf-sensor/README.md. Sensor status itself lives on the existing
// Sensors.jsx page (Phase 4); raw event browsing (any type, including
// these) already works on SecurityEvents.jsx via its type filter.
function NetworkIntelligence() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  const back = () => navigate('/admin');

  useEffect(() => {
    getNetworkSummary()
      .then((res) => setSummary(res.data))
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground overflow-y-auto">
      <div className="flex h-16 w-full shrink-0 items-center gap-3 border-b border-border/60 bg-card px-6">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={back}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="flex items-center gap-2 text-base font-bold text-foreground">
            <Network className="h-4 w-4 text-primary" />
            Network Intelligence
          </h1>
          <p className="text-xs text-muted-foreground">Flow-level anomalies and threat-intel matches — metadata only, no packet payloads</p>
        </div>
      </div>

      <div className="flex-1 p-6 max-w-5xl w-full mx-auto space-y-6">
        {loading && <div className="py-10 text-center text-xs text-muted-foreground">Loading…</div>}

        {!loading && !summary && (
          <div className="py-10 text-center text-xs text-muted-foreground">Unable to load network intelligence summary.</div>
        )}

        {!loading && summary && (
          <>
            {/* Counts by type */}
            <div className="grid grid-cols-2 gap-3 rounded-2xl border border-border/70 bg-card/40 p-4 shadow-sm backdrop-blur-sm sm:grid-cols-3">
              {Object.keys(summary.countsByType).length === 0 && (
                <div className="col-span-full text-xs text-muted-foreground">No network anomalies in the last 24 hours.</div>
              )}
              {Object.entries(summary.countsByType).map(([type, count]) => (
                <div key={type}>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{type}</div>
                  <div className="mt-0.5 text-sm font-semibold text-foreground">{count}</div>
                </div>
              ))}
            </div>

            {/* Top suspicious destinations */}
            <div>
              <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Top Suspicious Destinations</h2>
              <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/40 shadow-sm backdrop-blur-sm">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border/60 bg-muted/40 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-3">Destination IP</th>
                      <th className="px-4 py-3">Alert Count</th>
                      <th className="px-4 py-3">Last Seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.topSuspiciousDestinations.length === 0 && (
                      <tr><td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">No suspicious destinations.</td></tr>
                    )}
                    {summary.topSuspiciousDestinations.map((d) => (
                      <tr key={d.destinationIp} className="border-b border-border/40">
                        <td className="px-4 py-2.5 font-semibold text-foreground">{d.destinationIp}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{d.count}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{new Date(d.lastSeen).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Recent alerts */}
            <div>
              <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Recent Network Alerts</h2>
              <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/40 shadow-sm backdrop-blur-sm">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border/60 bg-muted/40 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-3">Timestamp</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Severity</th>
                      <th className="px-4 py-3">Sensor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.recentAlerts.length === 0 && (
                      <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">No recent alerts.</td></tr>
                    )}
                    {summary.recentAlerts.map((event) => (
                      <tr key={event.eventId} className="border-b border-border/40">
                        <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{new Date(event.timestamp).toLocaleString()}</td>
                        <td className="px-4 py-2.5 font-semibold text-foreground">{event.type}</td>
                        <td className="px-4 py-2.5">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${SEVERITY_CLASSES[event.severity] || SEVERITY_CLASSES.low}`}>
                            {event.severity}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{event.metadata?.sensorId || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default NetworkIntelligence;
