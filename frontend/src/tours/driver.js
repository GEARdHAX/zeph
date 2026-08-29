// Single centralized Driver.js wrapper. NOTHING outside this module ever
// imports 'driver.js' directly or calls its constructor — components go
// through useTour() -> tourRegistry -> here. Driver.js itself is lazy-
// loaded (dynamic import, spec §3) so a user who never opens a tour never
// pays for it in the initial bundle.
//
// Enforces "never two Driver instances at once" (spec §2) via a single
// module-scoped instance reference — starting a new tour always destroys
// whatever's currently active first.

let activeDriverInstance = null;
let cssInjected = null; // the dynamic-import Promise, memoized so the CSS is fetched once

// driver.css is Driver.js's own stylesheet (layout/positioning — required,
// not visual branding) — imported once, lazily, alongside the JS. zeph's
// visual match (colors/radius/shadow matching index.css's design tokens)
// lives in tourTheme.css, a separate file THIS project owns (Driver's own
// CSS is never edited — spec's "do not modify Driver.js source" extends to
// its shipped stylesheet too).
const loadDriverAssets = async () => {
  if (!cssInjected) {
    cssInjected = Promise.all([
      import('driver.js/dist/driver.css'),
      import('./tourTheme.css'),
    ]);
  }
  await cssInjected;
  const mod = await import('driver.js');
  return mod.driver;
};

// opts: the DriveStep[] + any Config overrides (onDestroyed etc.) the
// caller (tourController, see below) needs. Returns the live Driver
// instance already `.drive()`-ing from `startIndex`.
export const createTour = async ({ steps, config = {}, startIndex = 0 }) => {
  if (activeDriverInstance) {
    activeDriverInstance.destroy();
    activeDriverInstance = null;
  }

  const driverFactory = await loadDriverAssets();

  const instance = driverFactory({
    steps,
    animate: !prefersReducedMotionSafe(),
    smoothScroll: true,
    allowClose: true,
    allowKeyboardControl: true,
    overlayOpacity: 0.65,
    stagePadding: 6,
    stageRadius: 8,
    popoverClass: 'zeph-tour-popover',
    showProgress: true,
    progressText: '{{current}} of {{total}}',
    nextBtnText: 'Next',
    prevBtnText: 'Back',
    doneBtnText: 'Done',
    ...config,
    onDestroyed: (...args) => {
      if (activeDriverInstance === instance) activeDriverInstance = null;
      config.onDestroyed?.(...args);
    },
  });

  activeDriverInstance = instance;
  instance.drive(startIndex);
  return instance;
};

// Reduced-motion check duplicated in miniature here (rather than importing
// tourUtils.js) to keep this module's only real dependency graph limited to
// driver.js itself — avoids a subtle circular-import risk with tourUtils
// being imported by tourController which imports this file. Same logic,
// intentionally small enough that duplication is cheaper than a shared
// import here.
const prefersReducedMotionSafe = () => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {
    return false;
  }
};

export const getActiveTourInstance = () => activeDriverInstance;

export const destroyActiveTour = () => {
  if (activeDriverInstance) {
    activeDriverInstance.destroy();
    activeDriverInstance = null;
  }
};
