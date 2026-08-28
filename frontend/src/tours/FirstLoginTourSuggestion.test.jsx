import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setGlobal, getGlobal } from 'reactn';
import { toast } from 'react-toastify';
import FirstLoginTourSuggestion from './FirstLoginTourSuggestion';

const startMock = vi.fn();
vi.mock('./useTour', () => ({ default: vi.fn(() => ({ start: startMock })) }));
vi.mock('react-toastify', () => ({ toast: vi.fn() }));

beforeEach(async () => {
  startMock.mockClear();
  toast.mockClear();
  await setGlobal({ isNewRegistration: false, user: { id: 'u1' } });
});

describe('FirstLoginTourSuggestion', () => {
  it('shows no toast on a plain login (isNewRegistration false)', async () => {
    render(<FirstLoginTourSuggestion />);
    await waitFor(() => expect(toast).not.toHaveBeenCalled());
  });

  it('shows a toast once when isNewRegistration is true, then clears the flag', async () => {
    await setGlobal({ isNewRegistration: true });
    render(<FirstLoginTourSuggestion />);

    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(getGlobal().isNewRegistration).toBe(false);
  });

  it('does not start the tour just by rendering the toast — only on explicit accept click', async () => {
    await setGlobal({ isNewRegistration: true });
    render(<FirstLoginTourSuggestion />);
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    expect(startMock).not.toHaveBeenCalled();
  });

  it('clicking the toast body calls start()', async () => {
    const user = userEvent.setup();
    await setGlobal({ isNewRegistration: true });
    render(<FirstLoginTourSuggestion />);
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));

    // toast() is mocked — render the JSX it was called with ourselves to
    // exercise the onAccept wiring without pulling in real react-toastify.
    const [toastBody] = toast.mock.calls[0];
    render(toastBody);
    await user.click(screen.getByRole('button'));
    expect(startMock).toHaveBeenCalledTimes(1);
  });
});
