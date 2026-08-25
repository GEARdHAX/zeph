import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  previewText, NewMessageToast, IncomingCallToast, AddedToGroupToast, RemovedFromGroupToast,
} from './initIO';

describe('previewText — message toast preview text', () => {
  it('shows the real text content for a text message, not a generic label', () => {
    expect(previewText({ type: 'text', content: 'Hey, are you coming?' })).toBe('Hey, are you coming?');
  });

  it('truncates a long text message to a safe length with an ellipsis', () => {
    const long = 'a'.repeat(200);
    const result = previewText({ type: 'text', content: long });
    expect(result.length).toBeLessThan(long.length);
    expect(result.endsWith('…')).toBe(true);
  });

  it('does not truncate a short text message', () => {
    expect(previewText({ type: 'text', content: 'short' })).toBe('short');
  });

  it('shows the real text content even when message.type is undefined (regression: BottomBar.jsx historically sent "contentType" instead of "type", so real text messages were persisted with no type at all and fell through to "Sent a file")', () => {
    expect(previewText({ content: 'Hey, are you coming?' })).toBe('Hey, are you coming?');
  });

  it('still correctly identifies a legacy image message (content: shieldedID, no media/file object) as an image, not text', () => {
    expect(previewText({ type: 'image', content: 'some-shielded-id' })).toBe('Sent a photo');
  });

  it.each([
    ['image', 'Sent a photo'],
    ['video', 'Sent a video'],
    ['audio', 'Sent an audio message'],
    ['pdf', 'Sent a document'],
    ['document', 'Sent a document'],
    ['archive', 'Sent an archive'],
    ['text', 'Sent a text file'],
  ])('shows the correct label for a new-format %s attachment (regression: previously fell through to "Sent a file")', (category, label) => {
    const message = { type: 'file', media: { category } };
    expect(previewText(message)).toBe(label);
  });

  it('falls back to a generic label only for a genuinely unrecognized category', () => {
    expect(previewText({ type: 'file', media: { category: 'unknown-future-category' } })).toBe('Sent a file');
  });
});

describe('NewMessageToast', () => {
  it('shows a sender name and the real text preview for a text message', () => {
    const room = { _id: 'r1', isGroup: false };
    const message = { type: 'text', content: 'Hey there', author: { firstName: 'Rohan', lastName: 'K' } };
    render(<NewMessageToast room={room} message={message} />);

    expect(screen.getByText('Rohan K')).toBeInTheDocument();
    expect(screen.getByText('Hey there')).toBeInTheDocument();
  });

  it('shows the group title for a group message instead of the author name', () => {
    const room = { _id: 'r2', isGroup: true, title: 'Weekend Trip' };
    const message = { type: 'text', content: 'hi', author: { firstName: 'Rohan', lastName: 'K' } };
    render(<NewMessageToast room={room} message={message} />);

    expect(screen.getByText('Weekend Trip')).toBeInTheDocument();
  });

  it('shows a correct media label, not "Sent a file", for a document attachment', () => {
    const room = { _id: 'r3', isGroup: false };
    const message = {
      type: 'file', media: { category: 'document' }, author: { firstName: 'Rohan', lastName: 'K' },
    };
    render(<NewMessageToast room={room} message={message} />);

    expect(screen.getByText('Sent a document')).toBeInTheDocument();
  });

  it('degrades gracefully when author is missing entirely (malformed payload)', () => {
    const room = { _id: 'r4', isGroup: false };
    const message = { type: 'text', content: 'hi' };
    expect(() => render(<NewMessageToast room={room} message={message} />)).not.toThrow();
  });
});

describe('IncomingCallToast', () => {
  it('shows the caller name and "Incoming call…" for a normal call', () => {
    render(<IncomingCallToast meetingID="m1" caller={{ firstName: 'Rohan', lastName: 'K' }} added={false} />);
    expect(screen.getByText('Rohan K')).toBeInTheDocument();
    expect(screen.getByText('Incoming call…')).toBeInTheDocument();
  });

  it('shows "Adding you to a meeting…" when added is true', () => {
    render(<IncomingCallToast meetingID="m1" caller={{ firstName: 'Rohan', lastName: 'K' }} added />);
    expect(screen.getByText('Adding you to a meeting…')).toBeInTheDocument();
  });

  it('degrades gracefully to a generic "Someone" label when caller info is missing (malformed payload), never throws', () => {
    expect(() => render(<IncomingCallToast meetingID="m1" caller={undefined} added={false} />)).not.toThrow();
    expect(screen.getByText('Someone')).toBeInTheDocument();
  });
});

describe('AddedToGroupToast', () => {
  it('shows the group title and an explanatory message', () => {
    const room = { _id: 'g1', title: 'Weekend Trip' };
    render(<AddedToGroupToast room={room} />);

    expect(screen.getByText('Weekend Trip')).toBeInTheDocument();
    expect(screen.getByText('You were added to this group')).toBeInTheDocument();
  });

  it('falls back to a generic "Group" label when the title is missing', () => {
    const room = { _id: 'g2' };
    render(<AddedToGroupToast room={room} />);

    expect(screen.getByText('Group')).toBeInTheDocument();
  });
});

describe('RemovedFromGroupToast', () => {
  it('shows "removed" wording with the actor name', () => {
    render(<RemovedFromGroupToast groupName="Weekend Trip" reason="removed" actorName="Alice Owner" />);

    expect(screen.getByText('Weekend Trip')).toBeInTheDocument();
    expect(screen.getByText('You were removed from this group by Alice Owner')).toBeInTheDocument();
  });

  it('shows "banned" wording distinctly from "removed"', () => {
    render(<RemovedFromGroupToast groupName="Weekend Trip" reason="banned" actorName="Bob Admin" />);

    expect(screen.getByText('You were banned from this group by Bob Admin')).toBeInTheDocument();
  });

  it('omits the actor clause when actorName is missing', () => {
    render(<RemovedFromGroupToast groupName="Weekend Trip" reason="removed" actorName={null} />);

    expect(screen.getByText('You were removed from this group')).toBeInTheDocument();
  });

  it('falls back to a generic "Group" label when the name is missing', () => {
    render(<RemovedFromGroupToast groupName={null} reason="removed" actorName={null} />);

    expect(screen.getByText('Group')).toBeInTheDocument();
  });
});
