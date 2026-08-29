import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ZephSpinner } from './zeph-spinner';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ZephSpinner', () => {
  it('renders with an accessible status role and label', () => {
    render(<ZephSpinner />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  it('accepts a custom label', () => {
    render(<ZephSpinner label="Sending message" />);
    expect(screen.getByRole('status', { name: 'Sending message' })).toBeInTheDocument();
  });

  it('starts empty (bounce phase) and types out "zeph" fully by the end of the type phase', async () => {
    const { container } = render(<ZephSpinner />);
    const wordmark = container.querySelector('.zeph-spinner-wordmark');
    expect(wordmark.textContent).toBe('');

    // Land partway into typing (bounce+squash 480ms + 2 chars): a partial,
    // growing word, not yet complete.
    await act(async () => { await vi.advanceTimersByTimeAsync(480 + 50 * 2); });
    expect(wordmark.textContent.length).toBeGreaterThan(0);
    expect(wordmark.textContent.length).toBeLessThan(4);
    expect('zeph'.startsWith(wordmark.textContent)).toBe(true);

    // Finish typing + the hold.
    await act(async () => { await vi.advanceTimersByTimeAsync(50 * 2 + 150); });
    expect(wordmark.textContent).toBe('zeph');
  });

  it('deletes back to empty after typing, blinking, and holding', async () => {
    const { container } = render(<ZephSpinner />);
    const wordmark = container.querySelector('.zeph-spinner-wordmark');

    // bounce+squash + full type + hold + full blink, with slack for
    // fencepost rounding across chained awaits — lands somewhere in delete.
    await act(async () => { await vi.advanceTimersByTimeAsync(480 + 200 + 150 + 800 + 40); });
    expect(wordmark.textContent.length).toBeLessThan(4);

    // Enough further time to guarantee delete has finished.
    await act(async () => { await vi.advanceTimersByTimeAsync(25 * 4 + 90); });
    expect(wordmark.textContent).toBe('');
  });

  it('stops updating state after unmount (no act warnings / no crash)', async () => {
    const { unmount } = render(<ZephSpinner />);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  });

  it('scales the dot/wordmark size via the size prop', () => {
    const { container } = render(<ZephSpinner size={72} />);
    const root = container.querySelector('.zeph-spinner-container');
    expect(root.style.getPropertyValue('--zeph-size')).toBe('72px');
  });
});
