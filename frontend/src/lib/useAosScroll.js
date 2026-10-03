import { useCallback, useEffect, useRef } from 'react';
import AOS from 'aos';

// AOS listens to window scroll, but the marketing pages scroll inside their own
// container (App.jsx's shell is fixed + overflow-hidden). Spread the returned
// onScroll onto that container: it forwards scrolls to AOS.refresh(), which
// recomputes element positions and re-evaluates what is in view (rAF-throttled).
// Forwarding stops once every [data-aos] element has revealed (they run once),
// and is skipped entirely under reduced motion, where AOS is disabled.
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function useAosScroll() {
  const frame = useRef(0);
  const done = useRef(false);
  const onScroll = useCallback(() => {
    if (frame.current || done.current || reducedMotion()) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      AOS.refresh();
      done.current = !document.querySelector('[data-aos]:not(.aos-animate)');
    });
  }, []);
  useEffect(() => {
    AOS.refresh();
    return () => cancelAnimationFrame(frame.current);
  }, []);
  return onScroll;
}
