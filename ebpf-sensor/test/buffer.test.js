const BoundedBuffer = require('../src/buffer');

describe('BoundedBuffer', () => {
  it('pushes and reports size', () => {
    const buf = new BoundedBuffer(10);
    buf.push('a');
    buf.push('b');
    expect(buf.size).toBe(2);
  });

  it('drops the OLDEST item once maxSize is exceeded', () => {
    const buf = new BoundedBuffer(2);
    buf.push('a');
    buf.push('b');
    buf.push('c');
    expect(buf.size).toBe(2);
    expect(buf.takeBatch(2)).toEqual(['b', 'c']);
    expect(buf.droppedCount).toBe(1);
  });

  it('takeBatch removes and returns up to n items, in order', () => {
    const buf = new BoundedBuffer(10);
    [1, 2, 3, 4].forEach((n) => buf.push(n));
    expect(buf.takeBatch(2)).toEqual([1, 2]);
    expect(buf.size).toBe(2);
    expect(buf.takeBatch(10)).toEqual([3, 4]);
  });

  it('requeue puts items back at the front, preserving order for retry', () => {
    const buf = new BoundedBuffer(10);
    buf.push('c');
    buf.requeue(['a', 'b']);
    expect(buf.takeBatch(3)).toEqual(['a', 'b', 'c']);
  });

  it('requeue still respects maxSize (drop-oldest even during a retry pileup)', () => {
    const buf = new BoundedBuffer(2);
    buf.requeue(['a', 'b', 'c']);
    expect(buf.size).toBe(2);
    expect(buf.droppedCount).toBe(1);
  });
});
