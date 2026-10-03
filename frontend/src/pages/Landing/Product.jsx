import { MessageSquare, Video, Sparkles, MoreVertical, Paperclip, Send, Circle, ArrowRight } from 'lucide-react';

const CONVERSATIONS = [
  { name: 'Alex Rivera', preview: 'Can we move the launch...', active: true, unread: 0, online: true },
  { name: 'Design team', preview: 'Updated the mockups', active: false, unread: 3, online: true },
  { name: 'Priya Shah', preview: 'Sounds good, thanks!', active: false, unread: 0, online: false },
  { name: 'Marcus Chen', preview: 'See you at 4', active: false, unread: 1, online: true },
];

const CAPABILITIES = [
  {
    icon: MessageSquare,
    title: 'TALK',
    copy: 'Conversations that stay in context.',
  },
  {
    icon: Video,
    title: 'MEET',
    copy: 'From a message to a meeting, without leaving the flow.',
  },
  {
    icon: Sparkles,
    title: 'UNDERSTAND',
    copy: 'AI that turns conversations into useful context.',
  },
];

// Desktop/tablet: realistic three-pane Zeph workspace mockup (sidebar,
// active conversation, AI panel) — a marketing representation of the real
// product, not a literal screenshot or an overloaded admin dashboard.
function WorkspaceMockup() {
  return (
    <div className="relative mx-auto hidden w-full max-w-5xl overflow-hidden rounded-2xl border border-border bg-card shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)] md:grid md:grid-cols-[200px_1fr_240px] lg:grid-cols-[220px_1fr_260px]">
      {/* Window chrome */}
      <div className="col-span-3 flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="size-2.5 rounded-full bg-white/10" />
        <span className="size-2.5 rounded-full bg-white/10" />
        <span className="size-2.5 rounded-full bg-white/10" />
        <span className="ml-3 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Circle className="size-2 fill-primary text-primary" />
          Live workspace
        </span>
      </div>

      {/* Sidebar */}
      <div className="border-r border-border px-3 py-4">
        <p className="mb-3 px-2 text-[11px] font-semibold tracking-[0.1em] text-muted-foreground">CONVERSATIONS</p>
        <ul className="space-y-1">
          {CONVERSATIONS.map((c) => (
            <li
              key={c.name}
              className={`flex items-center gap-2 rounded-lg px-2 py-2 text-left ${
                c.active ? 'bg-primary/10' : ''
              }`}
            >
              <span className="relative shrink-0">
                <span className="flex size-7 items-center justify-center rounded-full bg-white/10 text-[10px] font-semibold text-white/70">
                  {c.name
                    .split(' ')
                    .map((w) => w[0])
                    .join('')}
                </span>
                {c.online && (
                  <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full border-2 border-card bg-primary" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-xs font-medium ${c.active ? 'text-white' : 'text-white/80'}`}>
                  {c.name}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">{c.preview}</span>
              </span>
              {c.unread > 0 && (
                <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                  {c.unread}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* Active conversation */}
      <div className="flex flex-col border-r border-border">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-full bg-white/10 text-[10px] font-semibold text-white/70">
              AR
            </span>
            <span className="text-sm font-medium text-white">Alex Rivera</span>
            <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              <Video className="size-3" />
              Meeting started
            </span>
          </div>
          <MoreVertical className="size-4 text-muted-foreground" />
        </div>

        <div className="flex-1 space-y-3 px-4 py-4">
          <div className="flex items-end gap-2">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-[9px] font-semibold text-white/70">
              AR
            </span>
            <div>
              <div className="rounded-2xl rounded-bl-sm bg-white/[0.06] px-3 py-2 text-xs text-white/85">
                Can we move the launch discussion to 4?
              </div>
              <span className="mt-1 block text-[10px] text-muted-foreground">9:41 AM</span>
            </div>
          </div>
          <div className="flex justify-end">
            <div>
              <div className="rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-xs text-primary-foreground">
                Yep. Everything is ready.
              </div>
              <span className="mt-1 block text-right text-[10px] text-muted-foreground">9:42 AM</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 pl-8">
            <span className="size-1 animate-bounce rounded-full bg-white/40 [animation-delay:-0.3s]" />
            <span className="size-1 animate-bounce rounded-full bg-white/40 [animation-delay:-0.15s]" />
            <span className="size-1 animate-bounce rounded-full bg-white/40" />
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-border px-4 py-3">
          <Paperclip className="size-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate text-xs text-muted-foreground">Type a message...</span>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary">
            <Send className="size-3.5 text-primary-foreground" />
          </span>
        </div>
      </div>

      {/* AI panel */}
      <div className="flex flex-col px-4 py-4">
        <div className="mb-3 flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-primary" />
          <span className="text-xs font-semibold text-white">Zeph AI</span>
        </div>

        <div className="rounded-xl border border-border bg-white/[0.03] p-3">
          <p className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground">AI SUMMARY</p>
          <ul className="space-y-1.5 text-xs text-white/70">
            <li>3 decisions</li>
            <li>2 action items</li>
            <li>1 unresolved question</li>
          </ul>
        </div>

        <div className="mt-3 space-y-1.5">
          {['Summarize', 'Ask AI', 'Key points'].map((action) => (
            <button
              key={action}
              type="button"
              className="w-full rounded-lg border border-border px-2.5 py-1.5 text-left text-xs text-white/70 transition-colors hover:border-primary/40 hover:text-white"
            >
              {action}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Mobile: a native conversation UI instead of a squeezed three-column
// dashboard — per the brief, mobile gets its own intentional composition.
function MobileWorkspaceMockup() {
  return (
    <div className="mx-auto w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-card shadow-[0_20px_50px_-15px_rgba(0,0,0,0.6)] md:hidden">
      <div className="flex items-center gap-1.5 border-b border-border px-4 py-2.5">
        <Circle className="size-2 fill-primary text-primary" />
        <span className="text-[11px] font-semibold tracking-[0.1em] text-muted-foreground">LIVE WORKSPACE</span>
      </div>

      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <ArrowRight className="size-4 rotate-180 text-muted-foreground" />
          <span className="text-sm font-medium text-white">Alex</span>
        </div>
        <MoreVertical className="size-4 text-muted-foreground" />
      </div>

      <div className="space-y-3 px-4 py-4">
        <div className="flex items-end gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-[9px] font-semibold text-white/70">
            A
          </span>
          <div className="rounded-2xl rounded-bl-sm bg-white/[0.06] px-3 py-2 text-xs text-white/85">
            Are we still shipping today?
          </div>
        </div>
        <div className="flex justify-end">
          <div className="rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-xs text-primary-foreground">
            Yep. Everything is ready.
          </div>
        </div>
      </div>

      <div className="mx-4 mb-3 flex items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2">
        <Sparkles className="size-3.5 text-primary" />
        <span className="text-xs font-medium text-primary">Ask Zeph AI</span>
      </div>

      <div className="flex items-center gap-2 border-t border-border px-4 py-3">
        <span className="flex-1 truncate text-xs text-muted-foreground">Type a message...</span>
        <span className="text-xs font-medium text-primary">Send</span>
      </div>
    </div>
  );
}

function Product() {
  return (
    <section className="relative shrink-0 overflow-hidden bg-background px-4 py-24 md:py-32" id="product">
      {/* Subtle depth only — no second major background animation per the
          brief; WebThreads stays a Hero-only visual. */}
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-[480px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.07] blur-[120px]"
        style={{ background: 'radial-gradient(circle, #ff2b3d 0%, transparent 70%)' }}
      />

      <div className="relative mx-auto max-w-5xl text-center">
        <p data-aos="fade-up" className="text-xs font-semibold tracking-[0.18em] text-primary">THE ZEPH WORKSPACE</p>
        <h2 data-aos="fade-up" data-aos-delay="80" className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl md:text-5xl">
          Everything, in one connected flow.
        </h2>
        <p data-aos="fade-up" data-aos-delay="160" className="mx-auto mt-5 max-w-xl text-sm text-muted-foreground sm:text-base md:text-lg">
          Conversations, meetings and AI live together in one workspace — so you can move from talking to doing
          without breaking the flow.
        </p>
      </div>

      <div data-aos="fade-up" data-aos-delay="100" className="relative mt-14 md:mt-16">
        <WorkspaceMockup />
        <MobileWorkspaceMockup />
      </div>

      <div className="relative mx-auto mt-16 grid max-w-3xl gap-8 sm:grid-cols-3 md:mt-20">
        {CAPABILITIES.map(({ icon: Icon, title, copy }, i) => (
          <div key={title} data-aos="fade-up" data-aos-delay={i * 100} className="flex flex-col items-center gap-3 text-center sm:items-start sm:text-left">
            <span className="flex size-9 items-center justify-center rounded-lg border border-border bg-white/[0.03]">
              <Icon className="size-4 text-primary" />
            </span>
            <div>
              <p className="text-xs font-semibold tracking-[0.12em] text-white">{title}</p>
              <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{copy}</p>
            </div>
          </div>
        ))}
      </div>

      <p data-aos="fade-up" className="relative mx-auto mt-16 max-w-md text-center text-sm text-muted-foreground md:mt-20">
        One conversation. More ways to move it forward.
      </p>
    </section>
  );
}

export default Product;
