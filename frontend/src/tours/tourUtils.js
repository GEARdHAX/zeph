// Small, reusable DOM-readiness utilities — the single place a tour ever
// waits for a target to exist. No permanent polling/listeners (spec §24):
// every MutationObserver created here is scoped to one waitForElement()
// call and disconnects itself the moment it resolves, times out, or is
// aborted — never left running.

// Resolves with the matching Element once `selector` exists in the DOM, or
// null if it never appears within `timeoutMs`. Uses MutationObserver
// (falls back to a bounded poll if MutationObserver isn't available — spec
// §28) rather than an arbitrary setTimeout/setInterval loop running for the
// full timeout regardless of when the element actually appears.
export const waitForElement = (selector, {
  timeoutMs = 4000, root = document.body, signal,
} = {}) => new Promise((resolve) => {
  const existing = document.querySelector(selector);
  if (existing) {
    resolve(existing);
    return;
  }

  let settled = false;
  let observer = null;
  let pollId = null;
  let timeoutId = null;

  const cleanup = () => {
    if (observer) observer.disconnect();
    if (pollId) clearInterval(pollId);
    if (timeoutId) clearTimeout(timeoutId);
    if (signal) signal.removeEventListener('abort', onAbort);
  };

  const finish = (result) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolve(result);
  };

  const onAbort = () => finish(null);
  if (signal) {
    if (signal.aborted) {
      finish(null);
      return;
    }
    signal.addEventListener('abort', onAbort);
  }

  if (typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) finish(el);
    });
    observer.observe(root, { childList: true, subtree: true });
  } else {
    // Fallback for an environment with no MutationObserver — bounded
    // interval, not an unbounded one; cleared by the timeout below either way.
    pollId = setInterval(() => {
      const el = document.querySelector(selector);
      if (el) finish(el);
    }, 150);
  }

  timeoutId = setTimeout(() => finish(null), timeoutMs);
});

// Respects the OS/browser-level reduced-motion preference (spec §23/§24).
// matchMedia can be absent in some test/embedded environments — treat that
// as "no preference" rather than throwing.
export const prefersReducedMotion = () => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {
    return false;
  }
};

// The one JS-level mobile/desktop signal this codebase didn't have before
// (confirmed by audit — the app is 100% CSS-breakpoint-driven). Tours need
// this because a step's target selector can differ between the mobile and
// desktop DOM (spec §17) — CSS alone can't tell a tour definition which
// selector to look for. 768px matches Tailwind's `md:` breakpoint already
// used throughout Home/index.jsx, so "mobile" here means exactly what
// `hidden md:flex` already means everywhere else in this app.
export const MOBILE_BREAKPOINT_PX = 768;
export const isMobileViewport = () => {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < MOBILE_BREAKPOINT_PX;
};
