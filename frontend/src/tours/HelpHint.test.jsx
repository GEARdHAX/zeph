import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setGlobal } from 'reactn';
import HelpHint from './HelpHint';

const startAtMock = vi.fn();
vi.mock('./useTour', () => ({ default: vi.fn(() => ({ startAt: startAtMock })) }));

beforeEach(async () => {
  startAtMock.mockClear();
  await setGlobal({ user: { id: 'u1' } });
});

describe('HelpHint', () => {
  it('calls startAt with the given stepIndex and ctx on click', async () => {
    const user = userEvent.setup();
    render(<HelpHint tourId="groups" stepIndex={2} label="What do roles mean?" ctx={{ myRole: 'ADMIN' }} />);

    await user.click(screen.getByRole('button', { name: 'What do roles mean?' }));

    expect(startAtMock).toHaveBeenCalledWith(2, { myRole: 'ADMIN' });
  });

  it('does not trigger a parent onClick (stopPropagation) — safe to place inside a clickable row', async () => {
    const parentClick = vi.fn();
    const user = userEvent.setup();
    render(
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
      <div onClick={parentClick}>
        <HelpHint tourId="chat" stepIndex={0} />
      </div>,
    );

    await user.click(screen.getByRole('button', { name: 'Help' }));

    expect(parentClick).not.toHaveBeenCalled();
    expect(startAtMock).toHaveBeenCalledWith(0, undefined);
  });
});
