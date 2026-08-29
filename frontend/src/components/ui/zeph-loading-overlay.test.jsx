import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ZephLoadingOverlay } from './zeph-loading-overlay';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.style.overflow = '';
});

describe('ZephLoadingOverlay', () => {
  it('renders nothing when closed', () => {
    render(<ZephLoadingOverlay isOpen={false} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders the spinner with a default label when open', () => {
    render(<ZephLoadingOverlay isOpen />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  it('passes a custom label through to the spinner', () => {
    render(<ZephLoadingOverlay isOpen label="Sending message" />);
    expect(screen.getByRole('status', { name: 'Sending message' })).toBeInTheDocument();
  });

  it('locks body scroll while open and restores it on close/unmount', () => {
    const { rerender, unmount } = render(<ZephLoadingOverlay isOpen={false} />);
    expect(document.body.style.overflow).toBe('');

    rerender(<ZephLoadingOverlay isOpen />);
    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('blocks a click on the scrim from reaching anything behind it', async () => {
    const behindClick = vi.fn();
    vi.useRealTimers();
    const user = userEvent.setup();
    render(
      <div>
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
        <div onClick={behindClick} style={{ position: 'fixed', inset: 0 }}>behind</div>
        <ZephLoadingOverlay isOpen />
      </div>,
    );

    await user.click(screen.getByRole('status'));
    expect(behindClick).not.toHaveBeenCalled();
  });
});
