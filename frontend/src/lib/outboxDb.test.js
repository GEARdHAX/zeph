// fake-indexeddb polyfills a real, spec-compliant IndexedDB in jsdom (which
// has none natively) — these tests exercise the actual IndexedDB API, not a
// mock of outboxDb's own functions.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

// outboxDb.js caches its open connection at module scope (by design — see
// its own comment), which is exactly what a real browser session does too.
// For per-test isolation, replace the global IndexedDB factory itself with
// a brand-new in-memory instance each time, rather than trying to close/
// delete the previous test's (now-cached, still-open) connection — deleting
// a database with an open connection blocks until that connection closes,
// which outboxDb.js never does between calls, so attempting to delete it
// from the test deadlocks instead of cleaning up. vi.resetModules() means
// outboxDb itself must be freshly (dynamically) imported after resetting,
// so each test gets both a fresh factory and a fresh module-level
// dbPromise pointing at it.
let outboxPut, outboxDelete, outboxIncrementRetry, outboxGetAllForUser, outboxClearForUser;

beforeEach(async () => {
  global.indexedDB = new IDBFactory();
  vi.resetModules();
  ({ outboxPut, outboxDelete, outboxIncrementRetry, outboxGetAllForUser, outboxClearForUser } = await import(
    './outboxDb'
  ));
});

describe('outboxDb', () => {
  it('put then getAllForUser returns the stored record', async () => {
    await outboxPut({ clientID: 'c1', userId: 'u1', roomID: 'r1', content: 'hi', type: 'text' });

    const pending = await outboxGetAllForUser('u1');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ clientID: 'c1', roomID: 'r1', content: 'hi', type: 'text', retryCount: 0 });
  });

  it('delete removes the record', async () => {
    await outboxPut({ clientID: 'c1', userId: 'u1', roomID: 'r1', content: 'hi', type: 'text' });
    await outboxDelete('c1');

    expect(await outboxGetAllForUser('u1')).toHaveLength(0);
  });

  it('isolates records by userId — one account never sees another account\'s pending messages', async () => {
    await outboxPut({ clientID: 'c1', userId: 'u1', roomID: 'r1', content: 'from u1', type: 'text' });
    await outboxPut({ clientID: 'c2', userId: 'u2', roomID: 'r2', content: 'from u2', type: 'text' });

    const u1Pending = await outboxGetAllForUser('u1');
    const u2Pending = await outboxGetAllForUser('u2');

    expect(u1Pending).toHaveLength(1);
    expect(u1Pending[0].clientID).toBe('c1');
    expect(u2Pending).toHaveLength(1);
    expect(u2Pending[0].clientID).toBe('c2');
  });

  it('incrementRetry bumps retryCount without otherwise changing the record', async () => {
    await outboxPut({ clientID: 'c1', userId: 'u1', roomID: 'r1', content: 'hi', type: 'text' });
    await outboxIncrementRetry('c1');
    await outboxIncrementRetry('c1');

    const [record] = await outboxGetAllForUser('u1');
    expect(record.retryCount).toBe(2);
    expect(record.content).toBe('hi');
  });

  it('getAllForUser returns records oldest-first', async () => {
    await outboxPut({ clientID: 'c1', userId: 'u1', roomID: 'r1', content: 'first', type: 'text' });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await outboxPut({ clientID: 'c2', userId: 'u1', roomID: 'r1', content: 'second', type: 'text' });

    const pending = await outboxGetAllForUser('u1');
    expect(pending.map((r) => r.clientID)).toEqual(['c1', 'c2']);
  });

  it('clearForUser removes only that user\'s records, leaving other accounts untouched', async () => {
    await outboxPut({ clientID: 'c1', userId: 'u1', roomID: 'r1', content: 'from u1', type: 'text' });
    await outboxPut({ clientID: 'c2', userId: 'u2', roomID: 'r2', content: 'from u2', type: 'text' });

    await outboxClearForUser('u1');

    expect(await outboxGetAllForUser('u1')).toHaveLength(0);
    expect(await outboxGetAllForUser('u2')).toHaveLength(1);
  });

  it('put is idempotent on the same clientID (retry does not create a second record)', async () => {
    await outboxPut({ clientID: 'c1', userId: 'u1', roomID: 'r1', content: 'hi', type: 'text' });
    await outboxPut({ clientID: 'c1', userId: 'u1', roomID: 'r1', content: 'hi', type: 'text' });

    expect(await outboxGetAllForUser('u1')).toHaveLength(1);
  });
});
