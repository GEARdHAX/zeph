// Central registry — the ONLY place tour definitions are looked up from.
// Each entry is a lazy loader (not the tour module itself) so an
// unopened tour's step-definition code never ships in the initial bundle
// either, same rationale as driver.js itself being lazy (spec §3/§4).
//
// A tour module's default export must be a function:
//   (ctx) => TourDefinition
// where ctx carries whatever dynamic info the steps need to decide their
// own content (e.g. { myRole } for the RBAC-aware group tour) — never a
// static object, since two different callers can need two different step
// sets for the "same" tour id (spec §9).
//
// TourDefinition shape:
//   {
//     id: string,
//     version: number,
//     title: string,
//     requiredRoute?: string,        // informational; useTour() does not
//                                     // itself navigate — see tourController.
//     steps: DriveStep[],             // driver.js's own step shape
//   }

const loaders = {
  onboarding: () => import('./tours/onboarding'),
  home: () => import('./tours/home'),
  chat: () => import('./tours/chat'),
  groups: () => import('./tours/groups'),
  meetings: () => import('./tours/meetings'),
  calls: () => import('./tours/calls'),
  media: () => import('./tours/media'),
  notifications: () => import('./tours/notifications'),
  settings: () => import('./tours/settings'),
  admin: () => import('./tours/admin'),
};

export const KNOWN_TOUR_IDS = Object.keys(loaders);

export const isKnownTour = (tourId) => Object.prototype.hasOwnProperty.call(loaders, tourId);

// Resolves a tour id to its definition, given the current context. Throws
// on an unregistered id (a programmer error — every real call site uses a
// literal from KNOWN_TOUR_IDS) rather than silently returning nothing,
// since that class of bug should fail loudly in development, not produce a
// confusing silent no-op tour start.
export const loadTourDefinition = async (tourId, ctx = {}) => {
  if (!isKnownTour(tourId)) {
    throw new Error(`Unknown tour id: "${tourId}". Registered tours: ${KNOWN_TOUR_IDS.join(', ')}`);
  }
  const mod = await loaders[tourId]();
  const buildDefinition = mod.default;
  const definition = buildDefinition(ctx);
  if (!definition || !Array.isArray(definition.steps)) {
    throw new Error(`Tour "${tourId}" did not return a valid definition (missing steps array)`);
  }
  return definition;
};
