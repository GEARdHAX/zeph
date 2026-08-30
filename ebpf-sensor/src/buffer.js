// Bounded local buffer (spec section 17/18) — a sensor that outpaces the
// network/backend must drop, not grow unbounded (an unbounded queue on a
// host under attack is itself a resource-exhaustion risk). Drop-OLDEST:
// the most recent activity is the most operationally relevant during a
// live incident, so it's kept over stale backlog.
class BoundedBuffer {
  constructor(maxSize) {
    this.maxSize = maxSize;
    this.items = [];
    this.droppedCount = 0;
  }

  push(item) {
    this.items.push(item);
    if (this.items.length > this.maxSize) {
      this.items.shift();
      this.droppedCount += 1;
    }
  }

  takeBatch(n) {
    return this.items.splice(0, n);
  }

  // Failed delivery — put events back at the FRONT so retry preserves order
  // and doesn't reshuffle behind newly-observed events; still subject to the
  // same maxSize drop-oldest rule as push() (a long outage must still bound
  // memory, not accumulate forever).
  requeue(items) {
    this.items.unshift(...items);
    while (this.items.length > this.maxSize) {
      this.items.shift();
      this.droppedCount += 1;
    }
  }

  get size() {
    return this.items.length;
  }
}

module.exports = BoundedBuffer;
