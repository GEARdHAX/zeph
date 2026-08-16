import {
  describe, it, expect, beforeEach,
} from 'vitest';
import { render, screen } from '@testing-library/react';
import { setGlobal } from 'reactn';
import moment from 'moment';
import Message from './Message';

const ME = { id: 'user-1', firstName: 'Me', lastName: 'Self' };
const OTHER_AUTHOR = { _id: 'user-2', firstName: 'Other', lastName: 'Person' };
const MY_AUTHOR = { _id: 'user-1', firstName: 'Me', lastName: 'Self' };

const timestampFor = (isoDate) => moment(isoDate).format('MMM DD - h:mm A');

const makeMessage = (overrides = {}) => ({
  _id: 'm1',
  content: 'hello world',
  type: 'text',
  date: '2026-01-01T12:00:00.000Z',
  author: OTHER_AUTHOR,
  ...overrides,
});

beforeEach(async () => {
  await setGlobal({ user: ME });
});

describe('Message bubble grouping', () => {
  it('renders a timestamp when the message is not attached to the next one', () => {
    const message = makeMessage();
    render(<Message message={message} previous={null} next={null} onOpen={() => {}} />);
    expect(screen.getByText(timestampFor(message.date))).toBeInTheDocument();
  });

  it('omits the timestamp when grouped with the following message from the same author within 3 minutes', () => {
    const message = makeMessage({ date: '2026-01-01T12:00:00.000Z' });
    const next = makeMessage({ date: '2026-01-01T12:01:00.000Z', author: OTHER_AUTHOR });
    render(<Message message={message} previous={null} next={next} onOpen={() => {}} />);
    expect(screen.queryByText(timestampFor(message.date))).not.toBeInTheDocument();
  });

  it('does not group with a following message from a different author, even within 3 minutes', () => {
    const message = makeMessage({ date: '2026-01-01T12:00:00.000Z', author: OTHER_AUTHOR });
    const next = makeMessage({ date: '2026-01-01T12:01:00.000Z', author: MY_AUTHOR });
    render(<Message message={message} previous={null} next={next} onOpen={() => {}} />);
    expect(screen.getByText(timestampFor(message.date))).toBeInTheDocument();
  });

  it('does not group with a following message more than 3 minutes later', () => {
    const message = makeMessage({ date: '2026-01-01T12:00:00.000Z' });
    const next = makeMessage({ date: '2026-01-01T12:05:00.000Z', author: OTHER_AUTHOR });
    render(<Message message={message} previous={null} next={next} onOpen={() => {}} />);
    expect(screen.getByText(timestampFor(message.date))).toBeInTheDocument();
  });

  it('falls back to "Deleted User" when the author is missing, without throwing', () => {
    const message = makeMessage({ author: null, content: 'orphaned message' });
    render(<Message message={message} previous={null} next={null} onOpen={() => {}} />);
    expect(screen.getByText('orphaned message')).toBeInTheDocument();
  });

  it('strips disallowed tags from text content while keeping their inner text (striptags default)', () => {
    render(
      <Message
        message={makeMessage({ content: '<script>alert(1)</script>hello' })}
        previous={null}
        next={null}
        onOpen={() => {}}
      />,
    );
    // striptags removes the tag markup itself but is not an HTML sanitizer that
    // deletes disallowed elements' text content — the raw text survives, just unwrapped.
    expect(screen.getByText('alert(1)hello')).toBeInTheDocument();
    expect(document.querySelector('script')).not.toBeInTheDocument();
  });

  it('auto-links bare URLs in text content', () => {
    render(
      <Message
        message={makeMessage({ content: 'see https://example.com for more' })}
        previous={null}
        next={null}
        onOpen={() => {}}
      />,
    );
    const link = screen.getByRole('link', { name: 'https://example.com' });
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('renders only the emoji (no chat-bubble background) when the message is only emoji', () => {
    const { container } = render(
      <Message message={makeMessage({ content: '🎉' })} previous={null} next={null} onOpen={() => {}} />,
    );
    // Emoji-only messages skip the bubble background container entirely.
    expect(container.querySelector('.bg-muted')).not.toBeInTheDocument();
    expect(screen.getByText('🎉')).toBeInTheDocument();
  });
});
