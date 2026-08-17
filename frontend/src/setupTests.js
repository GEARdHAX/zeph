// eslint-disable-next-line import/no-extraneous-dependencies
import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement ResizeObserver; several Radix primitives (used by
// shadcn/ui components) call it. A no-op stub is enough for tests that don't
// assert on resize-driven layout.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    // eslint-disable-next-line class-methods-use-this
    observe() {}

    // eslint-disable-next-line class-methods-use-this
    unobserve() {}

    // eslint-disable-next-line class-methods-use-this
    disconnect() {}
  };
}

// jsdom doesn't implement the Pointer Events capture API or scrollIntoView;
// Radix's DropdownMenu/Select/etc. call these during open/close/keyboard nav.
if (typeof Element.prototype.hasPointerCapture === 'undefined') {
  Element.prototype.hasPointerCapture = () => false;
}
if (typeof Element.prototype.setPointerCapture === 'undefined') {
  Element.prototype.setPointerCapture = () => {};
}
if (typeof Element.prototype.releasePointerCapture === 'undefined') {
  Element.prototype.releasePointerCapture = () => {};
}
if (typeof Element.prototype.scrollIntoView === 'undefined') {
  Element.prototype.scrollIntoView = () => {};
}
