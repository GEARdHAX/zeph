import {
  useEffect, useMemo, useRef, useState,
} from 'react';
import { useGlobal } from 'reactn';
import { createTourController } from './tourController';
import { TourStatus } from './tourStorage';

// The ONLY way a component touches the tour system — components never
// import driver.js, tourController, or tourRegistry directly (spec's
// architecture diagram: UI Component -> useTour -> Registry -> Definition
// -> Driver.js -> DOM). One controller instance per hook call, disposed on
// unmount; multiple components calling useTour(sameId) simultaneously is
// safe (each gets its own controller + snapshot subscription, but they all
// resolve to the same underlying localStorage record and driver.js
// single-instance guarantee).
//
// Returns { start, startAt, resume, skip, reset, status, currentStep, isActive }.
// `start`/`resume`/`startAt` accept an optional ctx object forwarded to the
// tour definition's builder function (e.g. { myRole: 'ADMIN' } for the
// RBAC-aware groups tour) — see tourRegistry.js's TourDefinition contract.
const useTour = (tourId) => {
  const user = useGlobal('user')[0];
  const userId = user?.id || user?._id;

  // Recreated whenever tourId/userId changes (a ref, not state — the
  // controller itself is an implementation detail, never rendered), so a
  // component that keeps a stable useTour("chat") call across re-renders
  // reuses one controller for its whole lifetime, but switching which tour
  // a hook call refers to (rare, but not disallowed) gets a clean new one
  // rather than a stale controller pointed at the wrong tourId.
  const controllerRef = useRef(null);
  const identityRef = useRef(null);
  if (identityRef.current !== `${tourId}:${userId}`) {
    controllerRef.current?.dispose();
    controllerRef.current = createTourController(tourId, { userId });
    identityRef.current = `${tourId}:${userId}`;
  }

  const [snapshot, setSnapshot] = useState(() => controllerRef.current.getSnapshot());

  useEffect(() => {
    const controller = controllerRef.current;
    const unsubscribe = controller.subscribe(setSnapshot);
    setSnapshot(controller.getSnapshot());
    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, [tourId, userId]);

  return useMemo(() => ({
    status: snapshot.status,
    currentStep: snapshot.currentStep,
    isActive: snapshot.isActive,
    isCompleted: snapshot.status === TourStatus.COMPLETED,
    isDismissed: snapshot.status === TourStatus.DISMISSED,
    start: (ctx) => controllerRef.current.start(ctx),
    startAt: (stepIndex, ctx) => controllerRef.current.startAt(ctx, stepIndex),
    resume: (ctx) => controllerRef.current.resume(ctx),
    skip: () => controllerRef.current.skip(),
    reset: () => controllerRef.current.reset(),
  }), [snapshot]);
};

export default useTour;
