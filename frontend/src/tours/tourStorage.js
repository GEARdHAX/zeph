// Tour progress persistence — localStorage only, with an in-memory fallback
// for browsers where localStorage is unavailable/throws (private mode with
// storage disabled, some embedded webviews — see spec §28). Never stores
// chat content, tokens, or any auth/PII — only a status enum + step index +
// two timestamps per tour. See DECISIONS.md.

export const TourStatus = {
  NOT_STARTED: 'NOT_STARTED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  DISMISSED: 'DISMISSED',
};

const STORAGE_PREFIX = 'chitcx:tours:';

// User-scoped so two accounts sharing a browser never inherit each other's
// onboarding-completed state (spec §26). 'anon' is the pre-login fallback
// key namespace — a tour genuinely can't be user-scoped before a user
// object exists, and nothing tour-related runs pre-login today regardless
// (every tour trigger point is inside the authenticated Home shell).
const keyFor = (userId, tourId) => `${STORAGE_PREFIX}${userId || 'anon'}:${tourId}`;

// In-memory fallback store — module-scoped, so it survives across calls
// within the same page load (but never across a real reload, same as the
// spec's own "if localStorage is unavailable" framing implies: degrade
// gracefully, don't try to be clever about persistence during the outage).
const memoryStore = new Map();

let localStorageAvailable = null;
const isLocalStorageAvailable = () => {
  if (localStorageAvailable !== null) return localStorageAvailable;
  try {
    const testKey = '__chitcx_tour_storage_test__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    localStorageAvailable = true;
  } catch (e) {
    localStorageAvailable = false;
  }
  return localStorageAvailable;
};

const readRaw = (key) => {
  if (isLocalStorageAvailable()) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return memoryStore.get(key) ?? null;
    }
  }
  return memoryStore.get(key) ?? null;
};

const writeRaw = (key, value) => {
  if (isLocalStorageAvailable()) {
    try {
      window.localStorage.setItem(key, value);
      return;
    } catch (e) {
      // Fall through to memory store (e.g. quota exceeded mid-session).
    }
  }
  memoryStore.set(key, value);
};

const removeRaw = (key) => {
  if (isLocalStorageAvailable()) {
    try {
      window.localStorage.removeItem(key);
    } catch (e) {
      // Ignore — nothing more to do if even remove throws.
    }
  }
  memoryStore.delete(key);
};

// Returns null if nothing is stored yet (NOT_STARTED is represented by
// absence, not an explicit record — matches "don't store what you don't
// need to").
export const getTourState = (userId, tourId) => {
  const raw = readRaw(keyFor(userId, tourId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
};

export const setTourState = (userId, tourId, patch) => {
  const key = keyFor(userId, tourId);
  const existing = getTourState(userId, tourId) || {};
  const next = { ...existing, ...patch };
  writeRaw(key, JSON.stringify(next));
  return next;
};

export const clearTourState = (userId, tourId) => {
  removeRaw(keyFor(userId, tourId));
};

// Wipes every tour record for a user — called on logout (spec §26: "If
// user logs out: clear or isolate user-specific tour state"). Only
// possible via localStorage's own key-enumeration (memoryStore is trivial
// to filter directly).
export const clearAllTourStateForUser = (userId) => {
  const prefix = `${STORAGE_PREFIX}${userId || 'anon'}:`;
  if (isLocalStorageAvailable()) {
    try {
      const keysToRemove = [];
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i);
        if (key && key.startsWith(prefix)) keysToRemove.push(key);
      }
      keysToRemove.forEach((key) => window.localStorage.removeItem(key));
    } catch (e) {
      // Best-effort — nothing more to do.
    }
  }
  [...memoryStore.keys()].filter((key) => key.startsWith(prefix)).forEach((key) => memoryStore.delete(key));
};

export const STORAGE_KEY_PREFIX = STORAGE_PREFIX;
