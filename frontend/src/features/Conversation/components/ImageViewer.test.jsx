import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import ImageViewer from './ImageViewer';

describe('ImageViewer — rotation fit', () => {
  it('constrains against the container box at 0deg/180deg (upright/upside-down)', () => {
    const { container } = render(<ImageViewer src="blob:x" alt="" scale={1} rotation={0} />);
    const img = container.querySelector('img');
    expect(img.style.maxWidth).toBe('100%');
    expect(img.style.maxHeight).toBe('100%');
  });

  it('swaps the constrained axis at 90deg/270deg (sideways) instead of leaving both pinned to 100%', () => {
    // jsdom reports 0 for clientWidth/clientHeight (no real layout engine),
    // so the swapped values come out as 0px/0px here — the meaningful
    // assertion is that the sideways branch takes the swapped-pixel path at
    // all, rather than the original bug's `max-h-full max-w-full` (both
    // '100%') which let a wide image rotated 90° overflow the container.
    const { container } = render(<ImageViewer src="blob:x" alt="" scale={1} rotation={90} />);
    const img = container.querySelector('img');
    expect(img.style.maxWidth).not.toBe('100%');
    expect(img.style.maxHeight).not.toBe('100%');
  });

  it('never throws when rendered with rotation values outside 0-360', () => {
    expect(() => render(<ImageViewer src="blob:x" alt="" scale={1} rotation={270} />)).not.toThrow();
    expect(() => render(<ImageViewer src="blob:x" alt="" scale={1} rotation={-90} />)).not.toThrow();
  });
});
