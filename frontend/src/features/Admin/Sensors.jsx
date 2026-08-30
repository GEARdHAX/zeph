import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Cpu, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getSensorStatus, registerSensor } from '../../actions/ebpfSensors';

const STATUS_CLASSES = {
  online: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  offline: 'bg-muted text-muted-foreground',
};

// Phase 4 minimal viewer (spec sections 38-39/46) — deliberately NOT a full
// EDR console: a small status table (sensor/host/status/version/last-
// heartbeat/events) plus a one-time credential-issuance form, nothing more.
// No sensor detail drill-down, no event stream — SecurityEvents.jsx already
// covers viewing the individual eBPF-sourced SecurityEvent documents
// (filter by type PROCESS_EXEC/PROCESS_EXIT/PROCESS_ANOMALY/
// NETWORK_CONNECTION/NETWORK_ANOMALY there).
function Sensors() {
  const navigate = useNavigate();
  const [sensors, setSensors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showRegister, setShowRegister] = useState(false);
  const [form, setForm] = useState({ sensorId: '', hostId: '' });
  const [registering, setRegistering] = useState(false);
  const [issued, setIssued] = useState(null);
  const [error, setError] = useState('');

  const back = () => navigate('/admin');

  const load = () => {
    setLoading(true);
    getSensorStatus()
      .then((res) => setSensors(res.data.sensors || []))
      .catch(() => setSensors([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const onRegister = (e) => {
    e.preventDefault();
    if (!form.sensorId || !form.hostId) return;
    setRegistering(true);
    setError('');
    registerSensor(form.sensorId, form.hostId)
      .then((res) => {
        setIssued(res.data);
        setForm({ sensorId: '', hostId: '' });
        load();
      })
      .catch((err) => setError(err.response?.data?.reason || 'Registration failed'))
      .finally(() => setRegistering(false));
  };

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground overflow-y-auto">
      <div className="flex h-16 w-full shrink-0 items-center justify-between border-b border-border/60 bg-card px-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={back}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="flex items-center gap-2 text-base font-bold text-foreground">
              <Cpu className="h-4 w-4 text-primary" />
              eBPF Sensors
            </h1>
            <p className="text-xs text-muted-foreground">Runtime security sensor fleet status</p>
          </div>
        </div>
        <Button
          size="sm"
          className="gap-2 rounded-xl bg-primary text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
          onClick={() => { setShowRegister(true); setIssued(null); setError(''); }}
        >
          <Plus className="h-4 w-4" />
          Register Sensor
        </Button>
      </div>

      <div className="flex-1 p-6 max-w-5xl w-full mx-auto">
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/40 shadow-sm backdrop-blur-sm">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border/60 bg-muted/40 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Sensor ID</th>
                <th className="px-4 py-3">Host</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Version</th>
                <th className="px-4 py-3">Last Heartbeat</th>
                <th className="px-4 py-3">Events (24h)</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!loading && sensors.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No sensors registered.</td></tr>
              )}
              {!loading && sensors.map((s) => (
                <tr key={s.sensorId} className="border-b border-border/40">
                  <td className="px-4 py-2.5 font-semibold text-foreground">{s.sensorId}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{s.hostId}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLASSES[s.status] || STATUS_CLASSES.offline}`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{s.version || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                    {s.lastHeartbeat ? new Date(s.lastHeartbeat).toLocaleString() : 'Never'}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{s.eventsLast24h}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showRegister && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowRegister(false)}>
          <div
            className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-foreground">Register Sensor</h2>
              <Button variant="ghost" size="sm" className="h-7 rounded-lg text-xs" onClick={() => setShowRegister(false)}>Close</Button>
            </div>

            {issued ? (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Save this credential now — it is shown exactly once and cannot be retrieved again.
                </p>
                <div className="rounded-xl bg-muted/50 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">ZEPH_SENSOR_CREDENTIAL</div>
                  <div className="mt-1 break-all font-mono text-[11px] text-foreground">{issued.credential}</div>
                </div>
                <Button size="sm" className="w-full rounded-xl text-xs" onClick={() => { setShowRegister(false); setIssued(null); }}>Done</Button>
              </div>
            ) : (
              <form className="space-y-3" onSubmit={onRegister}>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="sensorId">Sensor ID</label>
                  <input
                    id="sensorId"
                    className="h-9 w-full rounded-xl border border-input bg-card/60 px-3 text-xs font-medium text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    value={form.sensorId}
                    onChange={(e) => setForm((prev) => ({ ...prev, sensorId: e.target.value }))}
                    placeholder="prod-vps-1"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="hostId">Host ID</label>
                  <input
                    id="hostId"
                    className="h-9 w-full rounded-xl border border-input bg-card/60 px-3 text-xs font-medium text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    value={form.hostId}
                    onChange={(e) => setForm((prev) => ({ ...prev, hostId: e.target.value }))}
                    placeholder="prod-vps-1.example.com"
                  />
                </div>
                {error && <p className="text-xs text-destructive">{error}</p>}
                <Button type="submit" size="sm" disabled={registering} className="w-full rounded-xl text-xs">
                  {registering ? 'Registering…' : 'Register'}
                </Button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default Sensors;
