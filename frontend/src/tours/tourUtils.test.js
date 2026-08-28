import {
  describe, it, expect, afterEach, vi,
} from 'vitest';
import {
  waitForElement, prefersReducedMotion, isMobileViewport, MOBILE_BREAKPOINT_PX,
} from './tourUtils';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('waitForElement', () => {
  it('resolves immediately when the element already exists', async () => {
    document.body.innerHTML = '<div data-tour="already-here"></div>';
    const el = await waitForElement('[data-tour="already-here"]');
    expect(el).not.toBeNull();
    expect(el.getAttribute('data-tour')).toBe('already-here');
  });

  it('resolves once the element is added to the DOM shortly after (spec: dynamic/conditional elements)', async () => {
    const promise = waitForElement('[data-tour="appears-later"]', { timeoutMs: 2000 });

    setTimeout(() => {
      const el = document.createElement('div');
      el.setAttribute('data-tour', 'appears-later');
      document.body.appendChild(el);
    }, 50);

    const el = await promise;
    expect(el).not.toBeNull();
  });

  it('resolves to null (never throws) when the element never appears within the timeout', async () => {
    const el = await waitForElement('[data-tour="never-appears"]', { timeoutMs: 100 });
    expect(el).toBeNull();
  });

  it('resolves to null when aborted via an AbortSignal', async () => {
    const controller = new AbortController();
    const promise = waitForElement('[data-tour="aborted-target"]', { timeoutMs: 5000, signal: controller.signal });
    controller.abort();
    const el = await promise;
    expect(el).toBeNull();
  });

  it('resolves to null immediately for an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const el = await waitForElement('[data-tour="whatever"]', { signal: controller.signal });
    expect(el).toBeNull();
  });
});

describe('prefersReducedMotion', () => {
  it('returns false when matchMedia is unavailable (spec: browser compatibility fallback)', () => {
    const original = window.matchMedia;
    // @ts-ignore
    delete window.matchMedia;
    expect(prefersReducedMotion()).toBe(false);
    window.matchMedia = original;
  });

  it('reflects a matching media query', () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    expect(prefersReducedMotion()).toBe(true);
    window.matchMedia = original;
  });

  it('returns false (not throw) if matchMedia itself throws', () => {
    const original = window.matchMedia;
    window.matchMedia = () => { throw new Error('unsupported'); };
    expect(prefersReducedMotion()).toBe(false);
    window.matchMedia = original;
  });
});

describe('isMobileViewport', () => {
  it('reports mobile below the breakpoint', () => {
    const original = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: MOBILE_BREAKPOINT_PX - 1, configurable: true });
    expect(isMobileViewport()).toBe(true);
    Object.defineProperty(window, 'innerWidth', { value: original, configurable: true });
  });

  it('reports desktop at/above the breakpoint', () => {
    const original = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: MOBILE_BREAKPOINT_PX, configurable: true });
    expect(isMobileViewport()).toBe(false);
    Object.defineProperty(window, 'innerWidth', { value: original, configurable: true });
  });
});
