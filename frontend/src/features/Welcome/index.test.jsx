import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { setGlobal } from 'reactn';
import Welcome from './index';

// A picture that cannot load (stale reference after the picture was changed elsewhere, a blocker, an
// outage) must fall back to the initials instead of leaving an empty circle.
const withPicture = (shieldedID) => ({ firstName: 'Adarsh', lastName: 'Arya', picture: { shieldedID } });

beforeEach(async () => {
  await setGlobal({ user: withPicture('old-shield'), version: '2.9.1' });
});

describe('Welcome avatar', () => {
  it('shows the picture when it loads', () => {
    render(<Welcome />);
    expect(screen.getByRole('img', { name: 'Adarsh Arya' }).getAttribute('src')).toContain('/api/images/old-shield/512');
    expect(screen.queryByText('AA')).toBeNull();
  });

  it('falls back to the initials when the picture fails to load', () => {
    render(<Welcome />);
    fireEvent.error(screen.getByRole('img', { name: 'Adarsh Arya' }));
    expect(screen.queryByRole('img', { name: 'Adarsh Arya' })).toBeNull();
    expect(screen.getByText('AA')).toBeInTheDocument();
  });

  it('tries again when the stored profile gets a new picture', async () => {
    render(<Welcome />);
    fireEvent.error(screen.getByRole('img', { name: 'Adarsh Arya' }));
    expect(screen.getByText('AA')).toBeInTheDocument();

    await act(async () => {
      await setGlobal({ user: withPicture('new-shield') });
    });

    expect(screen.getByRole('img', { name: 'Adarsh Arya' }).getAttribute('src')).toContain('/api/images/new-shield/512');
  });
});
