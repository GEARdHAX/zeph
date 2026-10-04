// --- Problem: fragmented -> connected ------------------------------------
// Parent carries data-aos; once AOS reveals it, `.aos-animate` draws the red
// line across the previously disconnected nodes (see index.css).
export function FragmentToFlow() {
  const items = ['CHAT', 'MEETING', 'NOTES', 'AI', 'CHAT'];
  return (
    <div className="relative flex flex-col items-center gap-9 py-2 md:flex-row md:justify-between md:gap-0">
      <span className="absolute inset-x-0 top-1/2 hidden border-t border-dashed border-white/15 md:block" aria-hidden="true" />
      <span className="absolute inset-y-0 left-1/2 border-l border-dashed border-white/15 md:hidden" aria-hidden="true" />
      <span className="about-line-x absolute inset-x-0 top-1/2 hidden h-px bg-primary md:block" aria-hidden="true" />
      <span className="about-line-y absolute inset-y-0 left-1/2 w-px bg-primary md:hidden" aria-hidden="true" />
      {items.map((label, i) => (
        <span
          key={`${label}-${i}`}
          className="relative z-10 rounded-full border border-border bg-background px-5 py-2 text-[11px] font-semibold tracking-[0.16em] text-white/80"
        >
          {label}
        </span>
      ))}
    </div>
  );
}

// --- Idea / roadmap: nodes along one drawn line ---------------------------
export function FlowLine({ items }) {
  return (
    <div className={`relative grid gap-10 md:gap-6 ${items.length === 5 ? 'md:grid-cols-5' : 'md:grid-cols-4'}`}>
      <span className="about-line-x absolute left-0 right-0 top-[7px] hidden h-px bg-primary/60 md:block" aria-hidden="true" />
      <span className="about-line-y absolute bottom-2 left-[7px] top-2 w-px bg-primary/60 md:hidden" aria-hidden="true" />
      {items.map((item) => (
        <div key={item.label} className="relative pl-9 md:pl-0 md:pt-9">
          <span className="absolute left-0 top-0 size-[15px] rounded-full border-2 border-primary bg-background" aria-hidden="true" />
          <p className="text-[11px] font-semibold tracking-[0.16em] text-primary">{item.label}</p>
          {item.text && <p className="mt-2 text-base leading-snug text-white/80">{item.text}</p>}
        </div>
      ))}
    </div>
  );
}

// --- Architecture ---------------------------------------------------------
// Only technologies verified in package.json / source (see About/index.jsx).
function Group({ title, items, accent = false }) {
  return (
    <div className={`rounded-xl border p-5 ${accent ? 'border-primary/40 bg-primary/[0.06]' : 'border-border bg-card'}`}>
      <p className={`text-[11px] font-semibold tracking-[0.16em] ${accent ? 'text-primary' : 'text-white/55'}`}>{title}</p>
      <ul className="mt-3 space-y-1.5 text-sm text-white/80">
        {items.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

function Rail() {
  return <div className="mx-auto h-8 w-px bg-border" aria-hidden="true" />;
}

export function Architecture() {
  return (
    <div>
      <div className="grid gap-3 md:grid-cols-3">
        <Group title="CLIENT" items={['React + Redux', 'Socket.IO client', 'WebRTC', 'IndexedDB outbox']} />
        <Group title="REAL-TIME" items={['Socket.IO', 'Redis adapter', 'Cloudflare Realtime SFU', 'mediasoup (self-hosted option)']} />
        <Group title="AI" items={['Provider gateway', 'BullMQ workers', 'Local or hosted models']} />
      </div>
      <Rail />
      <Group title="BACKEND" items={['Node.js + Express']} accent />
      <Rail />
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Group title="DATA" items={['MongoDB']} />
        <Group title="REDIS" items={['Socket.IO adapter', 'Rate limiting', 'BullMQ queues']} />
        <Group title="SECURITY" items={['Policy layer + Zero Trust', 'Argon2 passwords', 'Redacted structured logs']} />
        <Group title="OBJECT STORAGE" items={['S3-compatible']} />
      </div>
      <p className="mt-6 text-center text-[11px] tracking-[0.14em] text-white/40">PACKAGED WITH DOCKER</p>
    </div>
  );
}
