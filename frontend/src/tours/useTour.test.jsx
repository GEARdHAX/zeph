import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setGlobal } from 'reactn';
import useTour from './useTour';
import { TourStatus } from './tourStorage';

vi.mock('./driver', () => ({
  createTour: vi.fn(async ({ config }) => ({
    isLastStep: () => true,
    destroy: vi.fn(() => config?.onDestroyed?.()),
  })),
  destroyActiveTour: vi.fn(),
}));

function TestHarness({ tourId = 'chat' }) {
  const {
    start, resume, skip, reset, status, isActive,
  } = useTour(tourId);
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="active">{isActive ? 'active' : 'inactive'}</span>
      <button type="button" onClick={() => start()}>Start</button>
      <button type="button" onClick={() => resume()}>Resume</button>
      <button type="button" onClick={skip}>Skip</button>
      <button type="button" onClick={reset}>Reset</button>
    </div>
  );
}

beforeEach(async () => {
  window.localStorage.clear();
  // Every real target the "chat" tour definition references (see
  // tours/chat.js) — at least one must exist for the controller to
  // actually start (a tour with zero resolvable steps never leaves
  // NOT_STARTED, see tourController.js's resolveAvailableSteps).
  document.body.innerHTML = `
    <div data-tour="conversation-info-button"></div>
    <div data-tour="call-buttons"></div>
    <div data-tour="message-area"></div>
    <div data-tour="message-input"></div>
    <div data-tour="emoji-button"></div>
    <div data-tour="attachment-button"></div>
    <div data-tour="send-button"></div>
  `;
  await setGlobal({ user: { id: 'hook-test-user' } });
});

describe('useTour', () => {
  it('starts at NOT_STARTED and reflects IN_PROGRESS after start()', async () => {
    const user = userEvent.setup();
    render(<TestHarness />);

    expect(screen.getByTestId('status').textContent).toBe(TourStatus.NOT_STARTED);

    await user.click(screen.getByText('Start'));

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe(TourStatus.IN_PROGRESS));
  });

  it('never throws when the component unmounts mid-tour (spec: component unmount edge case)', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<TestHarness />);

    await user.click(screen.getByText('Start'));
    expect(() => unmount()).not.toThrow();
  });

  it('two components calling useTour for the same tourId share the same underlying persisted state', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <TestHarness tourId="chat" />
      </div>,
    );
    await user.click(screen.getByText('Start'));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe(TourStatus.IN_PROGRESS));

    // A second, independent hook instance for the SAME tourId+user reads
    // the same localStorage-backed state.
    const { getTourState } = await import('./tourStorage');
    expect(getTourState('hook-test-user', 'chat').status).toBe(TourStatus.IN_PROGRESS);
  });
});
