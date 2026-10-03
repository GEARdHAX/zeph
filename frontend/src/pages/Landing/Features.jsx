import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Sparkles, CheckCircle2, Send } from 'lucide-react';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// --- ONE product visual, five internal states ---------------------------
// The shell (header + composer) never changes; only the body crossfades as
// the active feature changes, so it reads as the same product transforming.

function Avatar({ initials, online, size = 'size-8' }) {
  return (
    <span
      className={`relative flex ${size} shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-semibold text-white/75`}
    >
      {initials}
      {online && <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card bg-primary" />}
    </span>
  );
}

// Only claims the product supports (see git history of this file for the audit):
// conversation summaries are short stored prose that refresh as a thread grows;
// delivery is recoverable (outbox + ack + resync); AI context is bounded and
// governed. Nothing here implies source citations or structured extraction.

const KIND_TONE = {
  CHAT: 'border-border bg-white/[0.04] text-white/70',
  MEETING: 'border-primary/40 bg-primary/10 text-primary',
  AI: 'border-primary/40 bg-primary text-primary-foreground',
};

// 01 — Conversation continuity: one thread across chat, meeting and summary.
const TIMELINE = [
  { time: '10:42', kind: 'CHAT', text: '“Can we move the launch discussion to 4?”' },
  { time: '10:47', kind: 'MEETING', text: '3 members joined' },
  { time: '11:16', kind: 'MEETING', text: 'Meeting ended' },
  { time: '11:18', kind: 'AI', text: 'Meeting summary ready' },
  { time: '11:31', kind: 'CHAT', text: '“I’ll send the updated build.”' },
];

function ContextBody() {
  return (
    <div className="flex h-full flex-col">
      <p className="mb-4 text-[10px] font-semibold tracking-[0.16em] text-white/40">ONE THREAD</p>
      <ol className="relative flex flex-1 flex-col justify-between">
        <span className="absolute bottom-3 left-[52px] top-3 w-px bg-border" aria-hidden="true" />
        {TIMELINE.map((e) => (
          <li key={e.time} className="relative flex items-start gap-4">
            <span className="w-10 shrink-0 pt-0.5 text-right font-mono text-[11px] text-white/40">{e.time}</span>
            <span className="relative z-10 mt-1.5 size-2 shrink-0 rounded-full border border-border bg-card" aria-hidden="true" />
            <div className="min-w-0">
              <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.1em] ${KIND_TONE[e.kind]}`}>
                {e.kind}
              </span>
              <p className="mt-1.5 text-[13px] leading-snug text-white/80">{e.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// 02 — Context decay: a long thread condensed to a short stored summary.
const NOISE_WIDTHS = [78, 52, 90, 40, 66, 84, 48, 72, 58, 88, 44, 70];

function MemoryBody() {
  return (
    <div className="flex h-full flex-col gap-4">
      <div>
        <p className="mb-3 text-[10px] font-semibold tracking-[0.16em] text-white/40">142 MESSAGES &middot; 3 DAYS</p>
        <div className="relative space-y-1.5">
          {NOISE_WIDTHS.map((w, i) => (
            <span key={i} className="block h-1.5 rounded-full bg-white/[0.08]" style={{ width: `${w}%` }} />
          ))}
          <span className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent" />
        </div>
      </div>
      <div className="flex flex-1 flex-col justify-between gap-4 rounded-xl border border-primary/25 bg-primary/[0.06] p-4">
        <div>
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <span className="text-sm font-semibold text-white">Zeph AI summary</span>
          </div>
          <p className="text-[14px] leading-relaxed text-white/90">
            The team agreed to move the launch to Friday once QA confirmed Thursday sign-off. Design review stays on
            Thursday, and the beta group gets the rollout first.
          </p>
        </div>
        <div className="flex items-end gap-3">
          <span className="text-5xl font-bold leading-none text-white/25">142</span>
          <span className="pb-1 text-[11px] font-semibold tracking-[0.1em] text-white/40">MESSAGES</span>
          <ArrowRight className="mb-1.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="text-5xl font-bold leading-none text-primary">2–3</span>
          <span className="pb-1 text-[11px] font-semibold tracking-[0.1em] text-primary/80">SENTENCES</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {['STORED', 'REFRESHES AS THE THREAD GROWS'].map((t) => (
            <span key={t} className="rounded-md border border-border px-2 py-1 text-[10px] font-semibold tracking-[0.08em] text-white/55">
              {t}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// 03 — Continuity after failure: a message travelling through the recovery states.
const FLOW_STEPS = [
  { label: 'SENDING', note: 'Queued on this device', tone: 'muted' },
  { label: 'OFFLINE', note: 'Connection lost. Message kept', tone: 'bad' },
  { label: 'RECONNECTING', note: 'Back online, resyncing', tone: 'live' },
  { label: 'SYNCED', note: 'Delivered, order restored', tone: 'done' },
];

function FlowBody() {
  return (
    <div className="flex h-full flex-col gap-5">
      <div className="rounded-xl border border-border bg-white/[0.03] px-4 py-3">
        <p className="text-[10px] font-semibold tracking-[0.16em] text-white/40">MESSAGE</p>
        <p className="mt-1 text-[14px] text-white/85">“Pushing the final copy now.”</p>
      </div>
      <div className="relative pl-9">
        <span className="absolute bottom-6 left-[11px] top-6 w-px bg-border" aria-hidden="true" />
        <span
          className="flow-token absolute left-[7px] top-[19px] z-10 size-[9px] rounded-full bg-primary shadow-[0_0_14px_3px_hsl(var(--primary)/0.55)]"
          aria-hidden="true"
        />
        <ol className="flex flex-col gap-[10px]">
          {FLOW_STEPS.map((st, i) => (
            <li
              key={st.label}
              style={{ '--i': i }}
              className={`flow-step flex h-12 items-center gap-3 rounded-xl border px-3.5 ${
                st.tone === 'done'
                  ? 'border-primary/40 bg-primary/10'
                  : st.tone === 'bad'
                    ? 'border-destructive/40 bg-destructive/10'
                    : st.tone === 'live'
                      ? 'border-primary/25 bg-white/[0.03]'
                      : 'border-border bg-white/[0.02]'
              }`}
            >
              <span
                className={`rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-[0.08em] ${
                  st.tone === 'done' ? 'bg-primary text-primary-foreground' : 'bg-white/10 text-white/70'
                }`}
              >
                {st.label}
              </span>
              <span className="truncate text-[12px] text-white/65">{st.note}</span>
            </li>
          ))}
        </ol>
      </div>
      <p className="flow-done mt-auto flex items-center gap-2 text-[13px] text-primary">
        <CheckCircle2 className="size-4" />
        3 messages recovered in original order
      </p>
    </div>
  );
}

// 04 — Attention has states: presence as a field around you, not a list.
const FIELD = [
  { name: 'Alex', state: 'ONLINE', x: 28, y: 24, tone: 'on' },
  { name: 'Marcus', state: 'TYPING', x: 74, y: 30, tone: 'typing' },
  { name: 'Priya', state: 'ONLINE', x: 22, y: 72, tone: 'on' },
  { name: 'Dana', state: 'AWAY', x: 80, y: 76, tone: 'away' },
];
const YOU = { x: 52, y: 52 };

function PresenceBody() {
  return (
    <div className="relative h-full">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden="true">
        {FIELD.map((m) => (
          <line
            key={m.name}
            x1={YOU.x}
            y1={YOU.y}
            x2={m.x}
            y2={m.y}
            stroke="hsl(var(--primary))"
            strokeOpacity={m.tone === 'away' ? 0.08 : m.tone === 'typing' ? 0.5 : 0.25}
            strokeWidth="0.4"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2 text-center"
        style={{ left: `${YOU.x}%`, top: `${YOU.y}%` }}
      >
        <span className="relative flex size-12 items-center justify-center rounded-full border border-primary/50 bg-primary/15 text-[11px] font-semibold text-white">
          YOU
        </span>
      </div>
      {FIELD.map((m) => (
        <div
          key={m.name}
          className="absolute -translate-x-1/2 -translate-y-1/2 text-center"
          style={{ left: `${m.x}%`, top: `${m.y}%`, opacity: m.tone === 'away' ? 0.4 : 1 }}
        >
          <span
            className={`relative mx-auto flex size-10 items-center justify-center rounded-full border text-[10px] font-semibold text-white/80 ${
              m.tone === 'typing' ? 'border-primary/60 bg-primary/15 shadow-[0_0_0_5px_hsl(var(--primary)/0.12)]' : 'border-border bg-white/10'
            }`}
          >
            {m.name.slice(0, 2).toUpperCase()}
            {m.tone === 'on' && <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card bg-primary" />}
          </span>
          <p className="mt-1.5 text-[11px] font-medium text-white/80">{m.name}</p>
          {m.tone === 'typing' ? (
            <span className="mt-1 flex justify-center gap-1">
              <span className="typing-dot size-1 rounded-full bg-primary" />
              <span className="typing-dot size-1 rounded-full bg-primary" />
              <span className="typing-dot size-1 rounded-full bg-primary" />
            </span>
          ) : (
            <p className="text-[9px] font-semibold tracking-[0.12em] text-white/40">{m.state}</p>
          )}
        </div>
      ))}
      <p className="absolute inset-x-0 bottom-0 text-center text-[10px] font-semibold tracking-[0.16em] text-white/35">
        PRESENCE INFORMS. IT DOESN&apos;T DEMAND.
      </p>
    </div>
  );
}

// 05 — AI with boundaries: question -> bounded context -> answer, under governance.
function AiBody() {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="rounded-xl border border-border bg-white/[0.03] px-4 py-3">
        <p className="text-[10px] font-semibold tracking-[0.16em] text-white/40">THREAD &middot; 142 MESSAGES</p>
        <p className="mt-1.5 text-[13px] text-white/80">“What did we decide about the launch date?”</p>
      </div>
      <div className="mx-auto h-4 w-px bg-border" aria-hidden="true" />
      <div className="rounded-xl border border-dashed border-primary/40 bg-primary/[0.04] px-4 py-3 text-center">
        <p className="text-[10px] font-semibold tracking-[0.16em] text-primary">BOUNDED CONTEXT</p>
        <p className="mt-1 text-[12px] text-white/55">Only what fits the context budget reaches the model</p>
      </div>
      <div className="mx-auto h-4 w-px bg-border" aria-hidden="true" />
      <div className="flex flex-1 flex-col justify-between gap-4 rounded-xl border border-primary/25 bg-primary/[0.06] p-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <span className="text-sm font-semibold text-white">Zeph AI</span>
          </div>
          <p className="text-[15px] leading-relaxed text-white/90">Launch moved to Friday.</p>
        </div>
        <div>
          <div className="flex gap-[3px]" aria-hidden="true">
            {Array.from({ length: 36 }, (_, i) => (
              <span key={i} className={`h-5 flex-1 rounded-[2px] ${i >= 26 ? 'bg-primary/70' : 'bg-white/[0.08]'}`} />
            ))}
          </div>
          <p className="mt-2 text-[10px] font-semibold tracking-[0.12em] text-white/45">ANSWERED FROM THE CONTEXT WINDOW, NOT THE WHOLE THREAD</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {['PER-USER QUOTA', 'CONTEXT LIMIT', 'VALIDATED OUTPUT'].map((t) => (
          <span key={t} className="rounded-md border border-border px-2 py-1 text-[10px] font-semibold tracking-[0.08em] text-white/55">
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

const BODIES = [ContextBody, MemoryBody, FlowBody, PresenceBody, AiBody];

// crossfade (desktop): all five states stay mounted as stacked layers so the old
// one can fade out while the new one fades in. Mobile renders only its own state.
function ProductVisual({ active, crossfade = false }) {
  const layers = crossfade ? BODIES.map((Body, i) => [Body, i]) : [[BODIES[active], active]];
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7),0_0_90px_-35px_hsl(var(--primary)/0.4)]">
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div className="flex items-center gap-3">
          <Avatar initials="LS" online />
          <div>
            <p className="text-sm font-semibold text-white">Launch sync</p>
            <p className="text-[11px] text-white/45">5 members &middot; 4 online</p>
          </div>
        </div>
        <div className="flex -space-x-2">
          {['AR', 'PS', 'MC'].map((i) => (
            <span
              key={i}
              className="flex size-7 items-center justify-center rounded-full border-2 border-card bg-white/10 text-[9px] font-semibold text-white/70"
            >
              {i}
            </span>
          ))}
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        {layers.map(([Body, i]) => (
          <div
            key={i}
            data-state={crossfade && i !== active ? 'off' : 'on'}
            data-xf={crossfade ? '' : undefined}
            aria-hidden={crossfade && i !== active ? true : undefined}
            className="feature-layer absolute inset-0 overflow-hidden px-5 py-5"
          >
            <Body />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 border-t border-border px-5 py-3.5">
        <span className="flex-1 rounded-full bg-white/[0.05] px-4 py-2.5 text-[13px] text-white/35">Message Launch sync&hellip;</span>
        <span className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Send className="size-4" />
        </span>
      </div>
    </div>
  );
}

// --- Feature copy -------------------------------------------------------
const FEATURES = [
  {
    number: '01',
    label: 'CONVERSATION CONTINUITY',
    title: "A conversation shouldn't reset when the medium changes.",
    description:
      "Chat becomes a meeting. The meeting becomes a summary. The summary becomes the next message. Zeph keeps those moments connected so moving between ways of communicating doesn't mean starting over.",
  },
  {
    number: '02',
    label: 'CONTEXT DECAY',
    title: "Conversations shouldn't become less useful just because they're longer.",
    description:
      'Important information shouldn’t compete with hundreds of messages for your attention. Zeph can condense a long-running conversation into a short summary, stored and refreshed as the thread grows, without replacing the conversation itself.',
  },
  {
    number: '03',
    label: 'CONTINUITY AFTER FAILURE',
    title: "The conversation keeps going, even when the connection doesn't.",
    description:
      'A weak connection shouldn’t make you wonder whether a message actually sent. Zeph treats delivery as a recoverable process: messages are kept until they’re acknowledged, and order is restored when the connection returns.',
  },
  {
    number: '04',
    label: 'ATTENTION HAS STATES',
    title: 'Not every signal deserves your attention.',
    description:
      'Someone being online doesn’t mean they’re available. Someone typing doesn’t mean they need you. Zeph treats presence as lightweight context around the conversation, something you can understand without being interrupted by it.',
  },
  {
    number: '05',
    label: 'AI WITH BOUNDARIES',
    title: 'AI should stay inside the thread it’s working on.',
    description:
      'Instead of asking AI to know everything, Zeph keeps it grounded in the conversation it’s operating on. Questions stay inside the thread, context is bounded, and requests are governed by quotas and validation.',
  },
];

// --- Desktop: one sticky visual, five scrolling text chapters ------------
// Layout is never conditional on prefers-reduced-motion (sticky isn't
// motion); reduced motion only disables the crossfade (see index.css).
function DesktopStory() {
  const [active, setActive] = useState(0);
  const chapterRefs = useRef([]);

  useEffect(() => {
    // Zero-height band at the viewport's vertical center: the chapter
    // crossing it is the active one. Fires on crossings, not per pixel.
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setActive(Number(e.target.dataset.chapter));
        });
      },
      { rootMargin: '-50% 0px -50% 0px' },
    );
    chapterRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const jumpTo = (i) =>
    chapterRefs.current[i]?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });

  return (
    <div className="mx-auto hidden max-w-7xl grid-cols-[2fr_3fr] items-start gap-12 px-6 pb-24 md:grid lg:gap-20">
      <div>
        {FEATURES.map((f, i) => {
          const isActive = i === active;
          return (
            <div
              key={f.number}
              ref={(el) => {
                chapterRefs.current[i] = el;
              }}
              data-chapter={i}
              className="flex min-h-[80vh] flex-col justify-center transition-opacity duration-500"
              style={{ opacity: isActive ? 1 : 0.3 }}
            >
              <button
                type="button"
                onClick={() => jumpTo(i)}
                aria-current={isActive ? 'true' : undefined}
                className="flex items-center gap-3 self-start rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className={`size-1.5 rounded-full transition-all duration-500 ${isActive ? 'scale-150 bg-primary' : 'bg-white/20'}`} />
                <span className={`text-xs font-semibold tracking-[0.1em] transition-colors duration-500 ${isActive ? 'text-primary' : 'text-white/40'}`}>
                  {f.number} / {f.label}
                </span>
              </button>
              <h3 className="mt-4 max-w-md text-3xl font-bold leading-tight text-white lg:text-4xl">{f.title}</h3>
              <p className="mt-4 max-w-md text-base leading-relaxed text-muted-foreground">{f.description}</p>
            </div>
          );
        })}
      </div>
      <div data-aos="fade-left" className="sticky top-[12vh] h-[72vh] max-h-[760px] min-h-[480px]">
        <ProductVisual active={active} crossfade />
      </div>
    </div>
  );
}

// --- Mobile: stacked chapters, each with a large visual ------------------
function MobileChapter({ feature, index }) {
  return (
    <div className="py-12">
      <p data-aos="fade-up" className="flex items-center gap-2 text-xs font-semibold tracking-[0.1em] text-primary">
        <span className="size-1.5 rounded-full bg-primary" />
        {feature.number} / {feature.label}
      </p>
      <h3 data-aos="fade-up" data-aos-delay="60" className="mt-3 text-2xl font-bold leading-tight text-white">
        {feature.title}
      </h3>
      <p data-aos="fade-up" data-aos-delay="120" className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {feature.description}
      </p>
      <div data-aos="fade-up" data-aos-delay="200" className="mt-6 h-[600px] sm:h-[580px]">
        <ProductVisual active={index} />
      </div>
    </div>
  );
}

function Features() {
  return (
    <section className="relative shrink-0 border-t border-border bg-background" id="features">
      <div className="px-4 pb-16 pt-24 md:pb-20 md:pt-32">
        <div className="mx-auto max-w-5xl text-center">
          <p data-aos="fade-up" className="text-xs font-semibold tracking-[0.18em] text-primary">THE CONVERSATION HAS A MEMORY</p>
          <h2 data-aos="fade-up" data-aos-delay="80" className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl md:text-5xl">
            Communication should remember where it was going.
          </h2>
          <p data-aos="fade-up" data-aos-delay="160" className="mx-auto mt-5 max-w-xl text-sm text-muted-foreground sm:text-base md:text-lg">
            Zeph is built around what happens between messages — the decisions, interruptions, reconnects, meetings and context that usually get lost along the way.
          </p>
        </div>
      </div>

      <DesktopStory />

      <div className="px-4 pb-16 md:hidden">
        {FEATURES.map((feature, index) => (
          <MobileChapter key={feature.number} feature={feature} index={index} />
        ))}
      </div>
    </section>
  );
}

export default Features;
