import { useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';

// Every statement here was checked against the backend and docs:
//   Zero Trust   backend/src/services/zeroTrust (policyEngine, riskEngine, policies)
//   Host sensor  ebpf-sensor/README.md (optional, bpftrace, separate Linux host,
//                unit-tested, not yet run on a real kernel)
//   Network      docs/PHASE5-NETWORK-INTELLIGENCE.md (flow + DNS metadata only)
//   Intel / AI   services/threatIntel, services/securityAi (advisory only)
// Deliberately NOT shown: DPI, payload inspection, TLS decryption, automated
// blocking/killing/isolation. Host/network findings are NOT part of the Zero
// Trust risk score (riskEngine.js says so); they feed correlation + admin review.

// Scroll-driven activation: true once the element has scrolled ~25% into the
// viewport (IntersectionObserver, disconnected after firing). Latches on, so the
// architecture builds up as you read down the page instead of flickering.
function useLit() {
  const ref = useRef(null);
  const [lit, setLit] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setLit(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setLit(true);
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -25% 0px', threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, lit];
}

function Wire({ delay = 0 }) {
  return (
    <span className="relative block h-5 w-px shrink-0 self-center bg-border lg:h-px lg:w-6" aria-hidden="true">
      <span className="trust-signal size-1.5 rounded-full bg-primary" style={{ '--d': `${delay}s` }} />
    </span>
  );
}

function Node({ label, sub, i = 0, accent = false, dashed = false }) {
  return (
    <div
      style={{ '--i': i }}
      className={`sec-node rounded-lg border px-3 py-2 text-left ${
        accent ? 'border-primary/40 bg-primary/10' : dashed ? 'border-dashed border-border bg-white/[0.02]' : 'border-border bg-card'
      }`}
    >
      <p className={`text-[11px] font-semibold tracking-[0.08em] ${accent ? 'text-primary' : 'text-white/85'}`}>{label}</p>
      {sub && <p className="mt-0.5 text-[10px] leading-snug text-white/45">{sub}</p>}
    </div>
  );
}

function LaneLabel({ children }) {
  return <p className="mb-3 text-[10px] font-semibold tracking-[0.16em] text-white/40">{children}</p>;
}

// --- Central control-plane graph ----------------------------------------
function ControlPlane() {
  const [laneA, litA] = useLit();
  const [laneB, litB] = useLit();
  return (
    <div className="rounded-2xl border border-border bg-card p-5 sm:p-7">
      <div className="grid gap-8 lg:grid-cols-[1fr_230px] lg:gap-10">
        <div className="min-w-0">
          {/* Lane A: the access decision */}
          <LaneLabel>ACCESS DECISION &middot; SENSITIVE ACTIONS</LaneLabel>
          <div ref={laneA} data-lit={litA} className="sec-lane flex flex-col items-stretch lg:flex-row lg:items-center">
            <div style={{ '--i': 0 }} className="sec-node grid grid-cols-2 gap-2 lg:w-44 lg:grid-cols-1">
              <Node label="SESSION & DEVICE" sub="context" />
              <Node label="SECURITY EVENTS" sub="failed logins, denials" />
              <Node label="IP REPUTATION" sub="threat intel, bounded" />
              <Node label="ADVISORY AI" sub="auth anomaly, bounded" />
            </div>
            <Wire delay={0} />
            <Node i={1} label="RISK SCORE" sub="deterministic weights" />
            <Wire delay={0.6} />
            <Node i={2} label="ZERO TRUST POLICY" sub="auth · session · RBAC · risk" accent />
            <Wire delay={1.2} />
            <div style={{ '--i': 3 }} className="sec-node grid grid-cols-3 gap-2 lg:w-28 lg:grid-cols-1">
              {['ALLOW', 'STEP-UP', 'DENY'].map((d) => (
                <div
                  key={d}
                  className="rounded-lg border border-primary/30 bg-primary/[0.07] px-2 py-2 text-center text-[11px] font-semibold tracking-[0.08em] text-primary"
                >
                  {d}
                </div>
              ))}
            </div>
          </div>

          <div className="my-7 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <p className="max-w-xs text-center text-[10px] leading-snug tracking-[0.08em] text-white/40">
              OBSERVATION INFORMS PEOPLE, NOT POLICY
            </p>
            <span className="h-px flex-1 bg-border" />
          </div>

          {/* Lane B: observation */}
          <LaneLabel>OBSERVATION &middot; ADVISORY</LaneLabel>
          <div ref={laneB} data-lit={litB} className="sec-lane flex flex-col items-stretch lg:flex-row lg:items-center">
            <div style={{ '--i': 0 }} className="sec-node grid grid-cols-2 gap-2 lg:w-40 lg:grid-cols-1">
              <Node label="HOST SENSOR" sub="optional · Linux host" dashed />
              <Node label="NETWORK METADATA" sub="flow · DNS" />
            </div>
            <Wire delay={0.3} />
            <Node i={1} label="SECURITY EVENTS" sub="validated server-side" />
            <Wire delay={0.9} />
            <Node i={2} label="CORRELATION" sub="per sensor, 15 min" />
            <Wire delay={1.5} />
            <Node i={3} label="ADVISORY AI" sub="incident summary" />
            <Wire delay={2.1} />
            <Node i={4} label="ADMIN REVIEW" sub="a person decides" accent />
          </div>
        </div>

        {/* Status panel */}
        <div className="rounded-xl border border-border bg-background/60 p-4 lg:self-start">
          <p className="mb-3 text-[10px] font-semibold tracking-[0.16em] text-white/40">SECURITY PIPELINE</p>
          <dl className="space-y-2.5">
            {[
              ['ZERO TRUST', 'ON SENSITIVE ACTIONS', true],
              ['HOST SENSOR', 'OPTIONAL'],
              ['NETWORK ANALYSIS', 'METADATA ONLY'],
              ['THREAT INTEL', 'OPTIONAL · BOUNDED'],
              ['SECURITY AI', 'ADVISORY · OPT-IN'],
            ].map(([k, v, on]) => (
              <div key={k} className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-2.5 last:border-b-0 last:pb-0">
                <dt className="text-[10px] font-medium tracking-[0.08em] text-white/55">{k}</dt>
                <dd className={`text-right text-[10px] font-semibold tracking-[0.06em] ${on ? 'text-primary' : 'text-white/80'}`}>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}

// --- Capability diagrams -------------------------------------------------
function ZeroTrustDiagram() {
  const steps = ['AUTHENTICATED?', 'SESSION VALID?', 'RBAC', 'DEVICE · SESSION CONTEXT', 'RISK THRESHOLD'];
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mx-auto w-fit rounded-full border border-border px-3 py-1 text-[10px] font-semibold tracking-[0.12em] text-white/70">
        REQUEST
      </div>
      {steps.map((s, i) => (
        <div key={s}>
          <div className="mx-auto h-3 w-px bg-border" />
          <div className="flex items-center gap-3 rounded-lg border border-border bg-white/[0.02] px-3 py-2">
            <span className="text-[10px] font-semibold text-primary">0{i + 1}</span>
            <span className="text-[11px] font-semibold tracking-[0.06em] text-white/85">{s}</span>
          </div>
        </div>
      ))}
      <div className="mx-auto h-3 w-px bg-border" />
      <div className="grid grid-cols-3 gap-2">
        {['ALLOW', 'STEP-UP', 'DENY'].map((d) => (
          <div key={d} className="rounded-lg border border-primary/30 bg-primary/[0.07] py-2 text-center text-[11px] font-semibold tracking-[0.08em] text-primary">
            {d}
          </div>
        ))}
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-white/45">
        Wired to account, group and security-data actions. Ordinary activity, like sending a message, doesn&apos;t pass
        through it. A revoked session is always denied, and a low risk score never grants what RBAC denies.
      </p>
    </div>
  );
}

function HostSensorDiagram() {
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[1fr_auto_1fr]">
      <div className="rounded-xl border border-dashed border-border bg-card p-4">
        <p className="mb-3 text-[10px] font-semibold tracking-[0.14em] text-primary">OPTIONAL · LINUX HOST</p>
        <ul className="space-y-2">
          {['PROCESS EXEC / EXIT', 'OUTBOUND TCP', 'FLOW SUMMARY', 'DNS QUERY METADATA'].map((r) => (
            <li key={r} className="rounded-md border border-border bg-white/[0.02] px-2.5 py-1.5 text-[11px] font-semibold tracking-[0.06em] text-white/80">
              {r}
            </li>
          ))}
        </ul>
      </div>
      <ArrowRight className="mx-auto size-4 rotate-90 text-primary/70 sm:rotate-0" />
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="mb-3 text-[10px] font-semibold tracking-[0.14em] text-white/50">ZEPH BACKEND</p>
        <ul className="space-y-2 text-[12px] leading-snug text-white/70">
          <li>Sensor data is untrusted input</li>
          <li>Allowlisted fields only</li>
          <li>Verdicts computed server-side</li>
        </ul>
      </div>
    </div>
  );
}

function NetworkDiagram() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-xl border border-primary/30 bg-primary/[0.05] p-4">
        <p className="mb-3 text-[10px] font-semibold tracking-[0.14em] text-primary">METADATA &middot; ANALYZED</p>
        <ul className="space-y-2 text-[12px] text-white/85">
          <li className="flex gap-2"><span className="text-primary">✓</span> Flow information</li>
          <li className="flex gap-2"><span className="text-primary">✓</span> DNS query metadata</li>
        </ul>
        <p className="mt-4 text-[11px] leading-relaxed text-white/45">
          Rules look for port scans, host scans, possible beaconing and DNS anomalies.
        </p>
      </div>
      <div className="rounded-xl border border-dashed border-border p-4">
        <p className="mb-3 text-[10px] font-semibold tracking-[0.14em] text-white/45">PAYLOAD &middot; OUTSIDE THE BOUNDARY</p>
        <ul className="space-y-2 text-[12px] text-white/45">
          <li className="flex gap-2"><span>×</span> Message contents</li>
          <li className="flex gap-2"><span>×</span> HTTP payload inspection</li>
          <li className="flex gap-2"><span>×</span> TLS decryption</li>
        </ul>
      </div>
    </div>
  );
}

function IntelDiagram() {
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="mb-3 text-[10px] font-semibold tracking-[0.14em] text-white/55">THREAT INTELLIGENCE</p>
          <ul className="space-y-1.5 text-[12px] text-white/75">
            {['AbuseIPDB · IP reputation', '6-hour cache', 'Single-flight lookups', 'Daily request budget', 'Circuit breaker'].map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="mb-3 text-[10px] font-semibold tracking-[0.14em] text-white/55">ADVISORY SECURITY AI</p>
          <ul className="space-y-1.5 text-[12px] text-white/75">
            {['Allowlisted inputs only', 'Schema-validated output', 'Circuit breaker + cache', 'Optional local Ollama model'].map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mx-auto h-4 w-px bg-border" />
      <div className="rounded-lg border border-border bg-white/[0.02] px-3 py-2 text-center text-[11px] font-semibold tracking-[0.08em] text-white/80">
        SECURITY CONTEXT
      </div>
      <div className="mx-auto h-4 w-px bg-border" />
      <div className="rounded-lg border border-primary/30 bg-primary/[0.07] px-3 py-2 text-center text-[11px] font-semibold tracking-[0.08em] text-primary">
        POLICY ENGINE &middot; ADMIN REVIEW
      </div>
      <p className="mt-3 text-center text-[11px] text-white/45">
        Neither can authorize, deny, block or revoke.
      </p>
    </div>
  );
}

const CAPABILITIES = [
  {
    n: '01',
    tag: 'ACCESS CONTROL',
    title: 'Zero Trust, where it matters.',
    body: 'Sensitive actions pass through policy checks for authentication, session validity, RBAC, device and session context, and risk thresholds.',
    Diagram: ZeroTrustDiagram,
  },
  {
    n: '02',
    tag: 'OPTIONAL · LINUX HOST',
    title: 'Host signals, without touching payloads.',
    body: 'An optional Linux host sensor observes process execution, outbound TCP activity, flow summaries and DNS query metadata. Zeph treats sensor data as untrusted input and computes the resulting verdicts in the backend.',
    Diagram: HostSensorDiagram,
  },
  {
    n: '03',
    tag: 'METADATA ONLY',
    title: 'See the shape of traffic, not its contents.',
    body: 'Zeph can reason about network flow and DNS metadata without inspecting communication payloads.',
    Diagram: NetworkDiagram,
  },
  {
    n: '04',
    tag: 'ADVISORY',
    title: 'Signals become context.',
    body: 'Threat intelligence and advisory security AI add bounded context to security decisions without directly authorizing, denying or blocking actions.',
    Diagram: IntelDiagram,
  },
];

function CapabilityRow({ n, tag, title, body, Diagram, index }) {
  const [ref, lit] = useLit();
  return (
    <div
      ref={ref}
      data-aos="fade-up"
      data-aos-delay={100 + index * 80}
      className="relative grid gap-6 pb-16 last:pb-0 lg:grid-cols-[5fr_7fr] lg:gap-12"
    >
      <span
        className={`absolute left-[-29px] top-1.5 size-2 rounded-full transition-all duration-700 lg:left-[-45px] ${
          lit ? 'scale-125 bg-primary shadow-[0_0_0_5px_hsl(var(--primary)/0.15)]' : 'bg-white/25'
        }`}
        aria-hidden="true"
      />
      <div>
        <p className="flex flex-wrap items-center gap-3 text-[11px] font-semibold tracking-[0.12em]">
          <span className="text-primary">{n}</span>
          <span className="rounded-full border border-border px-2.5 py-0.5 text-white/55">{tag}</span>
        </p>
        <h3 className="mt-3 text-2xl font-bold leading-tight text-white">{title}</h3>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
      <div className="min-w-0">
        <Diagram />
      </div>
    </div>
  );
}

function Security() {
  return (
    <section className="relative shrink-0 border-t border-border bg-background px-4 py-24 md:py-32" id="security">
      <div className="mx-auto max-w-5xl text-center">
        <p data-aos="fade-up" className="text-xs font-semibold tracking-[0.18em] text-primary">
          DETECTION &amp; ACCESS CONTROL
        </p>
        <h2
          data-aos="fade-up"
          data-aos-delay="80"
          className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl md:text-5xl"
        >
          Security that watches the boundaries.
        </h2>
        <p data-aos="fade-up" data-aos-delay="160" className="mx-auto mt-5 max-w-2xl text-sm text-muted-foreground sm:text-base md:text-lg">
          Zeph combines policy-driven access control, host and network signals, threat intelligence and advisory security
          AI without inspecting communication payloads.
        </p>
      </div>

      <div data-aos="fade-up" data-aos-delay="100" className="mx-auto mt-14 max-w-6xl">
        <ControlPlane />
      </div>

      <p data-aos="fade-up" className="mt-24 text-center text-xs font-semibold tracking-[0.18em] text-white/50">
        THE EVIDENCE
      </p>

      <div className="relative mx-auto mt-10 max-w-6xl border-l border-border pl-6 lg:pl-10">
        {CAPABILITIES.map((c, i) => (
          <CapabilityRow key={c.n} {...c} index={i} />
        ))}
      </div>

      <div data-aos="fade-up" className="mx-auto mt-24 max-w-2xl border-y border-border py-10 text-center">
        <p className="text-sm font-bold tracking-[0.2em] text-white">METADATA, NOT PAYLOADS.</p>
        <p className="mt-2 text-sm font-bold tracking-[0.2em] text-primary">ADVISORY AI, NOT AUTO-BLOCKING.</p>
        <p className="mx-auto mt-5 max-w-md text-sm leading-relaxed text-muted-foreground">
          We analyze signals around communication, not the contents of communication.
        </p>
      </div>
    </section>
  );
}

export default Security;
