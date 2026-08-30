import { ZephLoadingOverlay } from './ui/zeph-loading-overlay';

// Shared Suspense fallback for lazy-loaded modals/panels (image/video
// editors, media viewer, profile preview). Without this, every one of
// these used <Suspense fallback={null}> — on a slow connection the chunk
// download is invisible, so a tap/click looks like it did nothing until
// the JS arrives. Reuses the same branded ZephLoadingOverlay App.jsx's
// global loader already renders (correct z-index tier, focus trap, body
// scroll lock) rather than a second bespoke overlay — Suspense pending is
// exactly the "isOpen" moment this component already models.
function LazyFallback() {
  return <ZephLoadingOverlay isOpen label="Loading" />;
}

export default LazyFallback;
