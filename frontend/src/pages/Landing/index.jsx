import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import useAosScroll from '@/lib/useAosScroll';
import { usePageMeta } from '@/lib/seo';
import WebThreads from '@/components/ui/web-threads';
import Navbar from './Navbar';
import Hero from './Hero';
import Product from './Product';
import Features from './Features';
import Security from './Security';

// Phase 3: floating navbar + hero + product showcase section.
// GlobeCdn (cobe-globe-cdn.jsx) is intentionally not rendered here — removed
// from the hero composition per request, but kept intact as a component for
// reuse elsewhere later.
function Landing() {
  // App.jsx wraps every route in a fixed inset-0 overflow-hidden shell
  // (correct for the logged-in chat UI, which is a fixed-viewport app, never
  // a scrolling document) — so this page needs its OWN scroll container,
  // sized to the viewport and scrolling independently, rather than relying
  // on the document/body to scroll (it structurally can't, here).
  const onScroll = useAosScroll();
  usePageMeta({
    title: 'Zeph — Connections that flow',
    description:
      'Zeph is a connected communication workspace: real-time chat, meetings and optional AI summaries, built so conversations stay connected instead of fragmenting across tools.',
    path: '/',
  });

  // Arriving from another page via /landing#section (e.g. the About navbar):
  // the browser can't scroll the inner container to a hash itself.
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'auto', block: 'start' });
  }, [hash]);

  return (
    <div
      onScroll={onScroll}
      className="relative flex h-full w-full flex-col overflow-y-auto overflow-x-hidden bg-background"
    >
      {/* Background thread effect, confined to the hero's own viewport-height
          block (not the whole scrollable page) — it's a Hero-level visual
          per the Product section brief, not a page-wide background. */}
      <div className="relative flex h-screen shrink-0 flex-col overflow-hidden">
        <div data-aos="fade" data-aos-delay="450" data-aos-duration="1400" className="absolute inset-0 z-0">
            <WebThreads
          className="absolute inset-0"
          color1="#8a0f1a"
          color2="#ff2b3d"
          color3="#ffffff"
          backgroundColor="#000000"
          speed={0.15}
          threadCount={5}
          frequency={4.2}
          spread={0.16}
          taper={0.9}
          position={0.55}
          fanMode="center"
          glow={0.015}
          falloff={0.65}
          thickness={1.3}
          brightness={0.18}
          opacity={0.5}
          mirror
          shimmer={false}
          grain
          grainIntensity={0.04}
          mouseInteraction={false}
        />
          </div>

        <Navbar />

        <div className="relative flex flex-1 flex-col overflow-hidden">
          <Hero />
        </div>
      </div>

      <Product />
      <Features />
      <Security />
    </div>
  );
}

export default Landing;
