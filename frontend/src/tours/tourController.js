// The engine behind useTour() — framework-agnostic (no React here), so the
// hook stays a thin adapter and this stays unit-testable without rendering
// anything. One controller instance is created per hook call, but they all
// share driver.js's single-active-instance guarantee (see driver.js).

import { createTour, destroyActiveTour } from './driver';
import { loadTourDefinition } from './tourRegistry';
import { getTourState, setTourState, TourStatus } from './tourStorage';
import { waitForElement } from './tourUtils';

// How long a single step's target is allowed to take to appear before the
// tour gives up on that step (spec §14: "element doesn't appear within
// timeout -> skip step"). Deliberately short — a tour step target should
// already be on screen or appear within a normal render tick, not require
// the user to wait multiple seconds staring at an overlay for nothing.
// Exported (not just used internally) so tests can shrink it — the real
// timeout value itself isn't what a test needs to prove, just that a
// missing target eventually gets skipped rather than hanging forever.
export const STEP_TARGET_TIMEOUT_MS = 3000;

// Filters a raw step list down to only the steps whose target element
// genuinely exists (or appears in time) RIGHT NOW, in order, preserving
// each step's original index for progress-percentage purposes. Steps with
// no `element` at all (a pure informational/centered popover step) always
// pass through unfiltered — only element-targeted steps are checked.
const resolveAvailableSteps = async (steps, { signal, timeoutMs = STEP_TARGET_TIMEOUT_MS } = {}) => {
  const resolved = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const step of steps) {
    if (!step.element || typeof step.element !== 'string') {
      resolved.push(step);
      // eslint-disable-next-line no-continue
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const el = await waitForElement(step.element, { timeoutMs, signal });
    if (el) resolved.push(step);
    // else: silently skipped, matches spec §14 — "never leave the user stuck"
  }
  return resolved;
};

// One controller per useTour(tourId) call — NOT a singleton, so multiple
// components can independently ask "is the chat tour running" without
// stepping on each other's callback references, while still only ever
// having one real Driver.js instance alive at a time (enforced in driver.js).
export const createTourController = (tourId, { userId, stepTargetTimeoutMs } = {}) => {
  let currentDefinition = null;
  let currentInstance = null;
  let abortController = null;
  const listeners = new Set();

  const notify = () => listeners.forEach((fn) => fn(getSnapshot()));

  const getSnapshot = () => {
    const stored = getTourState(userId, tourId);
    return {
      status: stored?.status || TourStatus.NOT_STARTED,
      currentStep: stored?.currentStep ?? 0,
      version: stored?.version ?? null,
      isActive: !!currentInstance,
    };
  };

  const persist = (patch) => setTourState(userId, tourId, patch);

  const teardown = () => {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    currentInstance = null;
    currentDefinition = null;
  };

  // startIndex: resume point in the ORIGINAL (unfiltered) step array. A
  // dismissed/missing-target step is still counted for progress purposes —
  // "step 3 of 8" stays meaningful even if step 2 got silently skipped for
  // this particular viewer/viewport.
  const runFrom = async (ctx, startIndex) => {
    abortController = new AbortController();
    const { signal } = abortController;

    let definition;
    try {
      definition = await loadTourDefinition(tourId, ctx);
    } catch (err) {
      // A tour that fails to even load its own definition must never
      // surface as an uncaught error in the app (spec §25) — log and give
      // up quietly, same posture as a missing target.
      // eslint-disable-next-line no-console
      console.error(`[tours] Failed to load tour "${tourId}":`, err);
      return;
    }
    if (signal.aborted) return;
    currentDefinition = definition;

    const remainingSteps = definition.steps.slice(startIndex);
    const available = await resolveAvailableSteps(remainingSteps, { signal, timeoutMs: stepTargetTimeoutMs });
    if (signal.aborted) return;

    if (available.length === 0) {
      // Every remaining step's target vanished (route changed under us,
      // component unmounted, etc.) — nothing left to show. Treat as a
      // clean stop, not a crash, and not a false "completed".
      teardown();
      notify();
      return;
    }

    persist({ status: TourStatus.IN_PROGRESS, currentStep: startIndex, version: definition.version });
    notify();

    let stepCursor = startIndex;

    const onDestroyed = () => {
      // Distinguish "reached the end" from "closed early" — driver.js
      // doesn't itself tell us which, so this checks whether the instance's
      // own active index was the last available step at destroy time.
      const wasLastStep = currentInstance ? currentInstance.isLastStep() : false;
      if (wasLastStep) {
        persist({ status: TourStatus.COMPLETED, currentStep: definition.steps.length, completedAt: Date.now() });
      } else {
        persist({ status: TourStatus.DISMISSED, currentStep: stepCursor, dismissedAt: Date.now() });
      }
      teardown();
      notify();
    };

    const steps = available.map((step, i) => ({
      ...step,
      onHighlightStarted: (el, s, opts) => {
        stepCursor = startIndex + i;
        persist({ status: TourStatus.IN_PROGRESS, currentStep: stepCursor });
        step.onHighlightStarted?.(el, s, opts);
      },
    }));

    currentInstance = await createTour({
      steps,
      startIndex: 0,
      config: { onDestroyed },
    });
  };

  // Fresh start — always from step 0, regardless of any prior progress.
  // Used by "Take a tour" / "Restart" entry points (spec §7/§19).
  const start = (ctx = {}) => runFrom(ctx, 0);

  // Jumps straight to one specific step, bypassing whatever came before it
  // — this is what contextual help ("?" icons, spec §29) uses: a single
  // concept explained in place, not "restart the whole tour and click
  // Next repeatedly to reach the part you actually wanted". Does not
  // persist/resume progress the way start()/resume() do, since a one-off
  // contextual lookup isn't "progress" in the onboarding sense.
  const startAt = (ctx, stepIndex) => runFrom(ctx, stepIndex);

  // Continues from the last saved `currentStep`, or starts fresh if there's
  // no saved progress at all (spec §20 — resume is explicit-only, never
  // automatic on page load).
  const resume = (ctx = {}) => {
    const stored = getTourState(userId, tourId);
    const resumeIndex = stored && stored.status === TourStatus.IN_PROGRESS ? stored.currentStep : 0;
    return runFrom(ctx, resumeIndex);
  };

  const skip = () => {
    destroyActiveTour();
  };

  const reset = () => {
    destroyActiveTour();
    persist({
      status: TourStatus.NOT_STARTED, currentStep: 0, completedAt: null, dismissedAt: null,
    });
    notify();
  };

  const subscribe = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  const dispose = () => {
    listeners.clear();
    teardown();
  };

  return {
    start, startAt, resume, skip, reset, subscribe, getSnapshot, dispose,
  };
};
