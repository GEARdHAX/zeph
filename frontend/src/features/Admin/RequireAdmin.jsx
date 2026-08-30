import { useGlobal } from 'reactn';
import NotFound from '../NotFound';

// Client-side gate for /admin/* — the backend's isPrivileged() (level !==
// 'standard') is the REAL enforcement (every admin route already 404s a
// standard user's requests), but until now nothing stopped a logged-in
// standard user from reaching the admin UI SHELL itself by typing the URL
// directly (no link to it exists anywhere in the app's own nav). Renders
// the same NotFound a bad route gets, rather than redirecting to /login or
// showing an "access denied" page — a standard user shouldn't be able to
// tell the difference between "route doesn't exist" and "route exists but
// you can't see it" (same anti-enumeration reasoning the backend's own
// isPrivileged() 404s already use).
function RequireAdmin({ children }) {
  const user = useGlobal('user')[0];
  if (!user || !user.level || user.level === 'standard') return <NotFound />;
  return children;
}

export default RequireAdmin;
