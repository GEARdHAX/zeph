import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setGlobal } from 'reactn';
import useZephLoader from './useZephLoader';

function TestHarness() {
  const { isLoading, label, show, hide } = useZephLoader();
  return (
    <div>
      <span data-testid="loading">{isLoading ? 'loading' : 'idle'}</span>
      <span data-testid="label">{label || ''}</span>
      <button type="button" onClick={() => show()}>Show</button>
      <button type="button" onClick={() => show('Sending message')}>Show with label</button>
      <button type="button" onClick={hide}>Hide</button>
    </div>
  );
}

beforeEach(async () => {
  await setGlobal({ zephLoading: false });
});

describe('useZephLoader', () => {
  it('starts idle', () => {
    render(<TestHarness />);
    expect(screen.getByTestId('loading').textContent).toBe('idle');
  });

  it('show() sets loading true with no label', async () => {
    const user = userEvent.setup();
    render(<TestHarness />);

    await user.click(screen.getByText('Show'));
    expect(screen.getByTestId('loading').textContent).toBe('loading');
    expect(screen.getByTestId('label').textContent).toBe('');
  });

  it('show(label) sets loading true and exposes the label', async () => {
    const user = userEvent.setup();
    render(<TestHarness />);

    await user.click(screen.getByText('Show with label'));
    expect(screen.getByTestId('loading').textContent).toBe('loading');
    expect(screen.getByTestId('label').textContent).toBe('Sending message');
  });

  it('hide() returns to idle', async () => {
    const user = userEvent.setup();
    render(<TestHarness />);

    await user.click(screen.getByText('Show with label'));
    await user.click(screen.getByText('Hide'));
    expect(screen.getByTestId('loading').textContent).toBe('idle');
    expect(screen.getByTestId('label').textContent).toBe('');
  });
});
