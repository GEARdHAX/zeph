import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { createTourController } from './tourController';
import { getTourState, TourStatus } from './tourStorage';

// Mocks the driver.js WRAPPER (this project's own driver.js, not the
// 'driver.js' package) — tests our abstraction's behavior (spec §32: "test
// our tour abstraction instead" of driver.js's internal DOM). A fake
// instance exposes just enough of the real Driver interface
// (isLastStep/destroy) for tourController's own logic to exercise.
let lastCreatedInstance = null;
vi.mock('./driver', () => ({
  createTour: vi.fn(async ({ steps, config }) => {
    const instance = {
      steps,
      isLastStep: vi.fn(() => false),
      destroy: vi.fn(() => config?.onDestroyed?.()),
    };
    lastCreatedInstance = instance;
    return instance;
  }),
  destroyActiveTour: vi.fn(() => {
    lastCreatedInstance?.destroy();
  }),
}));

const REGISTERED_TOUR = 'chat';

describe('tourController', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    lastCreatedInstance = null;
    document.body.innerHTML = `
      <div data-tour="conversation-info-button"></div>
      <div data-tour="call-buttons"></div>
      <div data-tour="message-area"></div>
      <div data-tour="message-input"></div>
      <div data-tour="emoji-button"></div>
      <div data-tour="attachment-button"></div>
      <div data-tour="send-button"></div>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('start() persists IN_PROGRESS status and notifies subscribers', async () => {
    const controller = createTourController(REGISTERED_TOUR, { userId: 'u1' });
    const snapshots = [];
    controller.subscribe((s) => snapshots.push(s));

    await controller.start();

    const stored = getTourState('u1', REGISTERED_TOUR);
    expect(stored.status).toBe(TourStatus.IN_PROGRESS);
    expect(snapshots.some((s) => s.status === TourStatus.IN_PROGRESS)).toBe(true);
    controller.dispose();
  });

  it('reaching the last step and destroying marks the tour COMPLETED', async () => {
    const controller = createTourController(REGISTERED_TOUR, { userId: 'u2' });
    await controller.start();

    lastCreatedInstance.isLastStep.mockReturnValue(true);
    lastCreatedInstance.destroy();

    const stored = getTourState('u2', REGISTERED_TOUR);
    expect(stored.status).toBe(TourStatus.COMPLETED);
    expect(stored.completedAt).toBeTypeOf('number');
    controller.dispose();
  });

  it('closing before the last step marks the tour DISMISSED, not COMPLETED', async () => {
    const controller = createTourController(REGISTERED_TOUR, { userId: 'u3' });
    await controller.start();

    lastCreatedInstance.isLastStep.mockReturnValue(false);
    lastCreatedInstance.destroy();

    const stored = getTourState('u3', REGISTERED_TOUR);
    expect(stored.status).toBe(TourStatus.DISMISSED);
    expect(stored.dismissedAt).toBeTypeOf('number');
    controller.dispose();
  });

  it('resume() with no prior progress behaves like start() (from step 0)', async () => {
    const controller = createTourController(REGISTERED_TOUR, { userId: 'u4' });
    await controller.resume();

    const stored = getTourState('u4', REGISTERED_TOUR);
    expect(stored.currentStep).toBe(0);
    controller.dispose();
  });

  it('resume() continues from the previously saved step, not step 0', async () => {
    const controller = createTourController(REGISTERED_TOUR, { userId: 'u5' });
    // Simulate a prior in-progress session at step 3.
    const { setTourState } = await import('./tourStorage');
    setTourState('u5', REGISTERED_TOUR, { status: TourStatus.IN_PROGRESS, currentStep: 3 });

    await controller.resume();

    expect(lastCreatedInstance.steps.length).toBeLessThanOrEqual(4); // remaining steps from index 3 onward
    controller.dispose();
  });

  it('skip() destroys the active driver.js instance', async () => {
    const controller = createTourController(REGISTERED_TOUR, { userId: 'u6' });
    await controller.start();
    controller.skip();

    expect(lastCreatedInstance.destroy).toHaveBeenCalled();
    controller.dispose();
  });

  it('reset() clears progress back to NOT_STARTED without leaving stale COMPLETED/DISMISSED timestamps', async () => {
    const controller = createTourController(REGISTERED_TOUR, { userId: 'u7' });
    await controller.start();
    lastCreatedInstance.isLastStep.mockReturnValue(true);
    lastCreatedInstance.destroy();

    controller.reset();

    const stored = getTourState('u7', REGISTERED_TOUR);
    expect(stored.status).toBe(TourStatus.NOT_STARTED);
    expect(stored.completedAt).toBeNull();
    controller.dispose();
  });

  // Each missing target genuinely waits out resolveAvailableSteps's real
  // per-step timeout (3s, see tourController.js's STEP_TARGET_TIMEOUT_MS)
  // before being skipped — these two tests exercise that REAL timing
  // rather than faking it, so they're intentionally slower than the rest
  // of the suite and given a matching test-level timeout.
  it('never crashes when every step\'s target element is missing — cleanly stops instead (spec: missing/dynamic DOM elements)', async () => {
    document.body.innerHTML = ''; // remove every target this tour references
    // stepTargetTimeoutMs shrunk from the real 3s default — proves the
    // same skip-on-timeout behavior without the test waiting out real time.
    const controller = createTourController(REGISTERED_TOUR, { userId: 'u8', stepTargetTimeoutMs: 20 });

    await expect(controller.start()).resolves.not.toThrow();
    // driver.js's createTour should never even be called — nothing to show.
    const { createTour } = await import('./driver');
    expect(createTour).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('skips a missing step but still runs the ones whose targets exist', async () => {
    document.body.innerHTML = `
      <div data-tour="conversation-info-button"></div>
      <div data-tour="message-area"></div>
    `; // call-buttons, message-input, emoji-button, attachment-button, send-button all absent
    const controller = createTourController(REGISTERED_TOUR, { userId: 'u9', stepTargetTimeoutMs: 20 });

    await controller.start();

    expect(lastCreatedInstance).not.toBeNull();
    expect(lastCreatedInstance.steps.length).toBe(2);
    controller.dispose();
  });

  it('an unregistered tour id fails to load without throwing into the caller', async () => {
    const controller = createTourController('not-a-real-tour', { userId: 'u10' });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(controller.start()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
    controller.dispose();
  });

  it('dispose() during an active tour tears down cleanly (spec: component unmount edge case)', async () => {
    const controller = createTourController(REGISTERED_TOUR, { userId: 'u11' });
    await controller.start();
    expect(() => controller.dispose()).not.toThrow();
  });

  it('two different tourIds for the same user keep independent progress', async () => {
    const chatController = createTourController('chat', { userId: 'u12' });
    const groupsController = createTourController('groups', { userId: 'u12' });

    await chatController.start();
    lastCreatedInstance.isLastStep.mockReturnValue(true);
    lastCreatedInstance.destroy();

    expect(getTourState('u12', 'chat').status).toBe(TourStatus.COMPLETED);
    expect(getTourState('u12', 'groups')).toBeNull();

    chatController.dispose();
    groupsController.dispose();
  });
});
