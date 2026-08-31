// Unit tests for the pure resource-tracking cleanup logic in
// src/mediasoup/index.js — Phase 7 audit findings:
//   1. producerTransports/consumerTransports/producers/consumers map
//      entries were only ever .close()d, never delete()d — permanent
//      per-socket entries accumulated for the life of the process.
//   2. closeConsumer looked up consumers[socketId] by consumer.id, but
//      that map is actually keyed by producerID — the lookup never
//      matched, so transportclose/producerclose cleanup was a silent
//      no-op.
//
// A real mediasoup worker/transport/producer/consumer requires native
// code + a real Linux kernel with UDP port access — not available in this
// dev environment (see docs/PHASE7-AUDIT.md and the Phase 4 eBPF sensor's
// own equivalent infrastructure finding). These tests exercise the pure
// map-management logic with plain fake objects standing in for real
// mediasoup transport/producer/consumer instances, which is everything
// cleanupSocketResources/closeProducer/closeConsumer actually touch.
const mediasoupModule = require('../src/mediasoup/index');

const {
  cleanupSocketResources, closeProducer, closeConsumer, producerTransports, consumerTransports, producers, consumers,
} = mediasoupModule.__testHelpers;

const fakeTransport = () => ({ closed: false, close() { this.closed = true; } });
const fakeMediaObject = () => ({ closed: false, close: jest.fn(async function close() { this.closed = true; }) });

afterEach(() => {
  // These are module-level singletons shared across the whole test file
  // (and, in a real process, the whole app) — clear every key after each
  // test so tests don't leak state into each other.
  Object.keys(producerTransports).forEach((k) => delete producerTransports[k]);
  Object.keys(consumerTransports).forEach((k) => delete consumerTransports[k]);
  Object.keys(producers).forEach((k) => delete producers[k]);
  Object.keys(consumers).forEach((k) => delete consumers[k]);
});

describe('cleanupSocketResources', () => {
  it('closes and deletes a producer transport for the given socket', () => {
    const transport = fakeTransport();
    producerTransports['sock-1'] = transport;
    cleanupSocketResources('sock-1');
    expect(transport.closed).toBe(true);
    expect('sock-1' in producerTransports).toBe(false);
  });

  it('closes and deletes a consumer transport for the given socket', () => {
    const transport = fakeTransport();
    consumerTransports['sock-1'] = transport;
    cleanupSocketResources('sock-1');
    expect(transport.closed).toBe(true);
    expect('sock-1' in consumerTransports).toBe(false);
  });

  it('deletes the entire producers/consumers bucket for the socket', () => {
    producers['sock-1'] = { 'producer-a': fakeMediaObject() };
    consumers['sock-1'] = { 'producer-a': fakeMediaObject() };
    cleanupSocketResources('sock-1');
    expect('sock-1' in producers).toBe(false);
    expect('sock-1' in consumers).toBe(false);
  });

  it('is a no-op (does not throw) for a socket with no tracked resources at all', () => {
    expect(() => cleanupSocketResources('never-connected')).not.toThrow();
  });

  it('does not affect a different socket\'s resources', () => {
    const keepTransport = fakeTransport();
    producerTransports['sock-keep'] = keepTransport;
    producerTransports['sock-remove'] = fakeTransport();

    cleanupSocketResources('sock-remove');

    expect('sock-remove' in producerTransports).toBe(false);
    expect('sock-keep' in producerTransports).toBe(true);
    expect(keepTransport.closed).toBe(false);
  });

  it('is idempotent — calling it twice for the same socket does not throw', () => {
    producerTransports['sock-1'] = fakeTransport();
    cleanupSocketResources('sock-1');
    expect(() => cleanupSocketResources('sock-1')).not.toThrow();
  });
});

describe('closeProducer', () => {
  it('closes and deletes the specific producer entry, keyed by producer.id', async () => {
    const producer = fakeMediaObject();
    producer.id = 'producer-a';
    producers['sock-1'] = { 'producer-a': producer };

    await closeProducer(producer, 'sock-1');

    expect(producer.close).toHaveBeenCalled();
    expect('producer-a' in producers['sock-1']).toBe(false);
  });

  it('leaves sibling producers for the same socket untouched', async () => {
    const producerA = fakeMediaObject();
    producerA.id = 'producer-a';
    const producerB = fakeMediaObject();
    producerB.id = 'producer-b';
    producers['sock-1'] = { 'producer-a': producerA, 'producer-b': producerB };

    await closeProducer(producerA, 'sock-1');

    expect('producer-b' in producers['sock-1']).toBe(true);
    expect(producerB.close).not.toHaveBeenCalled();
  });

  it('does not throw when the socket has no producers bucket at all (e.g. already cleaned up)', async () => {
    const producer = fakeMediaObject();
    producer.id = 'producer-a';
    await expect(closeProducer(producer, 'never-connected')).resolves.toBeUndefined();
  });

  it('does not throw when the specific producer was already removed', async () => {
    const producer = fakeMediaObject();
    producer.id = 'producer-a';
    producers['sock-1'] = {}; // bucket exists, entry doesn't
    await expect(closeProducer(producer, 'sock-1')).resolves.toBeUndefined();
  });
});

describe('closeConsumer — regression test for the producerID-vs-consumer.id keying bug', () => {
  it('closes and deletes the consumer entry when looked up by producerID (the ACTUAL storage key)', async () => {
    const consumer = fakeMediaObject();
    consumer.id = 'consumer-xyz'; // deliberately different from the producerID it's stored under
    consumers['sock-1'] = { 'producer-a': consumer };

    await closeConsumer('producer-a', 'sock-1');

    expect(consumer.close).toHaveBeenCalled();
    expect('producer-a' in consumers['sock-1']).toBe(false);
  });

  it('does NOT find the entry if looked up by consumer.id instead of producerID — proves the old code\'s lookup was broken', async () => {
    const consumer = fakeMediaObject();
    consumer.id = 'consumer-xyz';
    consumers['sock-1'] = { 'producer-a': consumer };

    // The old buggy call site: closeConsumer(consumer.id, socketId).
    await closeConsumer(consumer.id, 'sock-1');

    expect(consumer.close).not.toHaveBeenCalled(); // never found — this is exactly the bug that was fixed at the call site (consume handler now passes data.producerID instead)
    expect('producer-a' in consumers['sock-1']).toBe(true); // untouched
  });

  it('does not throw when the socket has no consumers bucket at all', async () => {
    await expect(closeConsumer('producer-a', 'never-connected')).resolves.toBeUndefined();
  });
});
