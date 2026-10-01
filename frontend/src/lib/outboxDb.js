// Durable client-side outbox for outgoing text messages — survives tab
// close/reload/network loss between "user pressed Send" and "server
// confirmed receipt" (Redux/in-memory state alone does not: BottomBar.jsx's
// retryWithBackoff already retries within one page session, but a closed
// tab loses anything not yet acknowledged). Messages are sent over the
// existing HTTP POST /api/message, not WebSocket — this only adds
// durability around that existing, already-idempotent call (Message.js's
// unique {room,author,clientID} index already makes a retried send safe
// server-side; this closes the client-side gap where the retry itself
// never happens because the tab is gone).
//
// Native IndexedDB, no dependency — the stored record is a handful of
// fields, not large structured data that would justify a wrapper library.
//
// Scope: text messages only (see sendMail-style comment in BottomBar.jsx
// for why media attachments are excluded) — an upload already has its own
// durable server-side state (the Media record) once it completes, so only
// the message-row creation needs outbox coverage, and attachment binaries
// must never be duplicated into browser storage.

const DB_NAME = 'zeph-outbox';
const DB_VERSION = 1;
const STORE = 'outbox';

let dbPromise = null;

const openDb = () => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'clientID' });
        store.createIndex('userId', 'userId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
};

// Only what's needed to retry the exact same POST /api/message body later —
// deliberately not the full optimistic UI message shape (see Section 4's
// "store only what's required to reconstruct the outbound request").
export const outboxPut = async ({ clientID, userId, roomID, content, type }) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({
      clientID,
      userId,
      roomID,
      content,
      type,
      createdAt: Date.now(),
      retryCount: 0,
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

export const outboxDelete = async (clientID) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(clientID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

export const outboxIncrementRetry = async (clientID) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const getReq = store.get(clientID);
    getReq.onsuccess = () => {
      const record = getReq.result;
      if (record) {
        record.retryCount += 1;
        record.lastAttemptAt = Date.now();
        store.put(record);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

// Pending messages for one account only — never another account's, even on
// a shared browser (see logout.js's clearAllTourStateForUser for the same
// per-user isolation convention applied to tour state).
export const outboxGetAllForUser = async (userId) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).index('userId').getAll(userId);
    req.onsuccess = () => resolve(req.result.sort((a, b) => a.createdAt - b.createdAt));
    req.onerror = () => reject(req.error);
  });
};

// Logout/account-switch isolation (Section 58) — never let one account's
// unsent drafts get flushed under a different account's session.
export const outboxClearForUser = async (userId) => {
  const pending = await outboxGetAllForUser(userId).catch(() => []);
  await Promise.all(pending.map((record) => outboxDelete(record.clientID).catch(() => {})));
};
