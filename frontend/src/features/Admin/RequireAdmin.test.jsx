import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { setGlobal } from 'reactn';
import RequireAdmin from './RequireAdmin';

const renderWith = () => render(
  <RequireAdmin>
    <div>Admin Content</div>
  </RequireAdmin>,
);

describe('RequireAdmin', () => {
  it('renders NotFound (404) for a standard user, not the admin content', async () => {
    await setGlobal({ user: { id: 'u1', level: 'standard' } });
    renderWith();
    expect(screen.getByText('404')).toBeInTheDocument();
    expect(screen.queryByText('Admin Content')).not.toBeInTheDocument();
  });

  it('renders NotFound for a logged-out user (no user global at all)', async () => {
    await setGlobal({ user: null });
    renderWith();
    expect(screen.getByText('404')).toBeInTheDocument();
  });

  it('renders the admin content for a user with an elevated level', async () => {
    await setGlobal({ user: { id: 'u2', level: 'root' } });
    renderWith();
    expect(screen.getByText('Admin Content')).toBeInTheDocument();
    expect(screen.queryByText('404')).not.toBeInTheDocument();
  });

  it('renders the admin content for any non-standard level (e.g. "admin")', async () => {
    await setGlobal({ user: { id: 'u3', level: 'admin' } });
    renderWith();
    expect(screen.getByText('Admin Content')).toBeInTheDocument();
  });
});
