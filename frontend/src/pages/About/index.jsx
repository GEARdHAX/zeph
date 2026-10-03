import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import useAosScroll from '@/lib/useAosScroll';
import { usePageMeta } from '@/lib/seo';
import { Button } from '@/components/ui/button';
import { GlobeCdn } from '@/components/ui/cobe-globe-cdn';
import Navbar from '../Landing/Navbar';
import { FragmentToFlow, FlowLine, Architecture } from './Diagrams';

// Every technical statement on this page was checked against the repo:
//   stack          backend/package.json, frontend/package.json
//   recovery       frontend/src/lib/outboxDb.js (IndexedDB), POST /messages/sync,
//                  unique {room, author, clientID} index on messages
//   measured scale docs/PHASE8-CAPACITY-REPORT.md, backend/loadtest/
//   governed AI    backend/src/ai (quota, context budget, dedupe, validation)
//   security       server-side authorization + Zero Trust policy engine
// Nothing about E2EE, scale numbers, team size or customers is claimed.

const Eyebrow = ({ children, delay = 0 }) => (
  <p data-aos="fade-up" data-aos-delay={delay} className="text-xs font-semibold tracking-[0.18em] text-primary">
    {children}
  </p>
);

const SECTION = 'relative px-6 py-28 md:py-40';

const BELIEFS = [
  ['01', 'CONTEXT SHOULD TRAVEL', "People shouldn't have to rebuild context every time a conversation changes form."],
  ['02', 'COMPLEXITY SHOULD STAY UNDER THE SURFACE', 'The product should feel simple even when the infrastructure behind it is not.'],
  ['03', 'AI SHOULD ASSIST, NOT TAKE OVER', 'AI should make conversations easier to understand without becoming the conversation itself.'],
  ['04', 'SECURITY SHOULD BE ARCHITECTURAL', 'Trust should be built into the boundaries of the system rather than added as a marketing layer.'],
];

const PRINCIPLES = [
  ['REAL SYSTEMS', 'Build around actual failure modes, not ideal network conditions.'],
  ['MEASURED SCALE', 'Use measured performance instead of invented scale numbers.'],
  ['FAILURE RECOVERY', 'Reconnect, retry and recover without losing state.'],
  ['GOVERNED AI', 'Keep AI bounded by context, quotas and validation.'],
  ['SECURITY BOUNDARIES', 'Keep sensitive decisions server-side.'],
];

const DIRECTIONS = [
  { label: 'BETTER CONTEXT' },
  { label: 'MORE NATURAL MEETINGS' },
  { label: 'DEEPER AI ASSISTANCE' },
  { label: 'STRONGER SECURITY SIGNALS' },
  { label: 'BETTER RECOVERY' },
];

// The globe reads its canvas width once at init, so it is re-mounted when the
// viewport crosses a ~250px width bucket (resize/rotate) to keep it sharp.
// Width only: mobile URL-bar height changes while scrolling must not remount it.
function useViewportWidth() {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    let t;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(() => setWidth(window.innerWidth), 200);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      clearTimeout(t);
    };
  }, []);
  return width;
}

function AboutHero() {
  const width = useViewportWidth();
  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none relative z-10 mx-auto flex max-w-[1800px] flex-col px-6 pb-10 pt-36 lg:min-h-[max(95vh,640px)] lg:justify-center lg:px-[clamp(24px,5vw,96px)] lg:pb-16 lg:pt-32">
        <div className="pointer-events-auto lg:w-[42%] lg:max-w-[620px]">
          <Eyebrow>ABOUT ZEPH</Eyebrow>
          <h1
            data-aos="fade-up"
            data-aos-delay="80"
            className="mt-6 text-4xl font-bold leading-[1.06] tracking-tight sm:text-5xl lg:text-[clamp(2.75rem,3.8vw,4.5rem)]"
          >
            Built around the way conversations actually move.
          </h1>
          <p data-aos="fade-up" data-aos-delay="160" className="mt-7 text-base leading-relaxed text-muted-foreground md:text-lg lg:text-xl">
            Zeph is a connected communication workspace built around a simple idea: conversations should be able to move
            naturally between messages, meetings, context and intelligence without becoming fragmented.
          </p>
        </div>
      </div>

      {/* Below lg: stacked under the text and cropped. From lg: absolutely
          positioned in the right column (see .about-globe in index.css). */}
      <div className="about-globe-stage" data-aos="fade" data-aos-duration="1400">
        <div className="about-globe" aria-hidden="true">
          <GlobeCdn key={Math.round(width / 250)} className="opacity-90" />
        </div>
      </div>
    </section>
  );
}

function About() {
  const onScroll = useAosScroll();
  usePageMeta({
    title: 'About Zeph — built around the way conversations move',
    description:
      'Why Zeph exists and how it is built: a connected communication workspace where messages, meetings, context and AI stay part of one conversation.',
    path: '/about',
  });

  return (
    <div onScroll={onScroll} className="relative h-full w-full overflow-y-auto overflow-x-hidden bg-background text-white">
      <Navbar />

      {/* 01 — Hero */}
      <AboutHero />

      {/* 02 — The problem */}
      <section className={`${SECTION} border-t border-border`}>
        <div className="mx-auto max-w-5xl">
          <Eyebrow>THE PROBLEM</Eyebrow>
          <h2 data-aos="fade-up" data-aos-delay="80" className="mt-6 max-w-3xl text-3xl font-bold tracking-tight md:text-5xl">
            Communication became a collection of tabs.
          </h2>
          <div className="mt-14 space-y-3 text-2xl font-semibold leading-snug text-white/45 md:mt-20 md:text-4xl">
            <p data-aos="fade-up" className="text-white">A message starts a conversation.</p>
            <p data-aos="fade-up" data-aos-delay="100">A meeting takes it somewhere else.</p>
            <p data-aos="fade-up" data-aos-delay="200">The notes live somewhere else.</p>
            <p data-aos="fade-up" data-aos-delay="300">The context gets lost somewhere in between.</p>
          </div>
          <div data-aos="fade-up" className="mt-20 md:mt-28">
            <FragmentToFlow />
          </div>
          <p data-aos="fade-up" className="mt-14 text-xl font-semibold text-primary md:text-2xl">
            Zeph is built around keeping that thread connected.
          </p>
        </div>
      </section>

      {/* 03 — The idea */}
      <section className={`${SECTION} border-t border-border`}>
        <div className="mx-auto max-w-5xl">
          <Eyebrow>THE IDEA</Eyebrow>
          <h2 data-aos="fade-up" data-aos-delay="80" className="mt-6 max-w-3xl text-3xl font-bold tracking-tight md:text-5xl">
            One conversation. More ways to move it forward.
          </h2>
          <p data-aos="fade-up" data-aos-delay="160" className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
            Zeph treats communication as a continuous flow rather than a set of isolated tools.
          </p>
          <div data-aos="fade-up" className="mt-16 md:mt-24">
            <FlowLine
              items={[
                { label: 'MESSAGES', text: 'Messages can become meetings.' },
                { label: 'MEETINGS', text: 'Meetings can become context.' },
                { label: 'CONTEXT', text: 'Context can become useful intelligence.' },
                { label: 'THE THREAD', text: 'And the conversation remains the thread connecting them.' },
              ]}
            />
          </div>
        </div>
      </section>

      {/* 04 — What we believe */}
      <section className={`${SECTION} border-t border-border`}>
        <div className="mx-auto grid max-w-6xl gap-12 md:grid-cols-[1fr_2fr] md:gap-20">
          <div>
            <Eyebrow>WHAT WE BELIEVE</Eyebrow>
            <h2 data-aos="fade-up" data-aos-delay="80" className="mt-6 text-3xl font-bold tracking-tight md:text-4xl">
              Four ideas the product is built on.
            </h2>
          </div>
          <div>
            {BELIEFS.map(([n, title, body], i) => (
              <div key={n} data-aos="fade-up" data-aos-delay={i * 60} className="grid gap-3 border-t border-border py-9 first:border-t-0 first:pt-0 sm:grid-cols-[56px_1fr]">
                <span className="text-sm font-semibold text-primary">{n}</span>
                <div>
                  <h3 className="text-sm font-semibold tracking-[0.12em] text-white md:text-base">{title}</h3>
                  <p className="mt-3 max-w-lg text-lg leading-snug text-white/65 md:text-xl">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 05 — Under the surface */}
      <section className={`${SECTION} border-t border-border`}>
        <div className="mx-auto max-w-5xl">
          <div className="text-center">
            <Eyebrow>UNDER THE SURFACE</Eyebrow>
            <h2 data-aos="fade-up" data-aos-delay="80" className="mx-auto mt-6 max-w-3xl text-3xl font-bold tracking-tight md:text-5xl">
              Simple on the surface. Deliberate underneath.
            </h2>
          </div>
          <div data-aos="fade-up" className="mt-16 md:mt-20">
            <Architecture />
          </div>
        </div>
      </section>

      {/* 06 — Engineering philosophy */}
      <section className={`${SECTION} border-t border-border`}>
        <div className="mx-auto grid max-w-6xl gap-12 md:grid-cols-[1fr_2fr] md:gap-20">
          <div>
            <Eyebrow>ENGINEERING</Eyebrow>
            <h2 data-aos="fade-up" data-aos-delay="80" className="mt-6 text-3xl font-bold tracking-tight md:text-4xl">
              Built with constraints in mind.
            </h2>
            <p data-aos="fade-up" data-aos-delay="160" className="mt-5 max-w-sm text-base leading-relaxed text-muted-foreground">
              Infrastructure isn&apos;t invisible, and it isn&apos;t infinite. Zeph is designed around that.
            </p>
          </div>
          <dl>
            {PRINCIPLES.map(([term, body], i) => (
              <div key={term} data-aos="fade-up" data-aos-delay={i * 60} className="grid gap-2 border-t border-border py-6 first:border-t-0 first:pt-0 sm:grid-cols-[220px_1fr] sm:gap-8">
                <dt className="text-[11px] font-semibold tracking-[0.16em] text-primary">{term}</dt>
                <dd className="text-lg leading-snug text-white/80">{body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* 07 — Origin */}
      <section className={`${SECTION} border-t border-border`}>
        <div className="mx-auto max-w-3xl">
          <Eyebrow>WHERE IT STARTED</Eyebrow>
          <h2 data-aos="fade-up" data-aos-delay="80" className="mt-6 text-3xl font-bold tracking-tight md:text-5xl">
            Zeph started as an engineering problem.
          </h2>
          <div className="mt-12 space-y-7 text-lg leading-relaxed text-white/70 md:text-xl">
            <p data-aos="fade-up">
              How do you build communication software where messages, meetings, AI and security don&apos;t feel like four
              unrelated systems?
            </p>
            <p data-aos="fade-up" className="font-semibold text-white">That question became Zeph.</p>
            <p data-aos="fade-up">
              Instead of starting with a giant feature list, the project grew from the infrastructure upward: state,
              recovery, real-time communication, access control and AI governance.
            </p>
            <p data-aos="fade-up" className="text-base text-white/45">
              Zeph is an individual engineering project. It began from a commercial chat template, which was then
              hardened and extended: security, real-time architecture, queues, testing, the design system and AI.
            </p>
          </div>
        </div>
      </section>

      {/* 08 — What's next */}
      <section className={`${SECTION} border-t border-border`}>
        <div className="mx-auto max-w-5xl">
          <Eyebrow>WHAT&apos;S NEXT</Eyebrow>
          <h2 data-aos="fade-up" data-aos-delay="80" className="mt-6 text-3xl font-bold tracking-tight md:text-5xl">
            The flow keeps moving.
          </h2>
          <p data-aos="fade-up" data-aos-delay="160" className="mt-5 max-w-lg text-base leading-relaxed text-muted-foreground">
            Directions, not dates.
          </p>
          <div data-aos="fade-up" className="mt-16 md:mt-24">
            <FlowLine items={DIRECTIONS} />
          </div>
        </div>
      </section>

      {/* 09 — Closing */}
      <section className="relative border-t border-border px-6 py-32 text-center md:py-44">
        <div className="mx-auto max-w-4xl">
          <h2 data-aos="fade-up" className="text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl md:text-7xl">
            Communication should feel <span className="text-primary">connected.</span>
          </h2>
          <p data-aos="fade-up" data-aos-delay="100" className="mt-8 text-lg text-muted-foreground md:text-xl">
            That&apos;s what we&apos;re building with Zeph.
          </p>
          <div data-aos="fade-up" data-aos-delay="200" className="mt-12 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="rounded-full px-6">
              <Link to="/">
                Explore Zeph
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="rounded-full border-white/15 bg-white/[0.04] px-6 text-white hover:bg-white/10 hover:text-white">
              <Link to={{ pathname: '/', hash: '#product' }}>See how it works</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default About;
