import { useGlobal } from 'reactn';

// Where the marketing landing page lives for this visitor: '/' when logged out
// (the root renders it), '/landing' when logged in ('/' is the app for them).
export default function useLandingPath() {
  const token = useGlobal('token')[0];
  return token ? '/landing' : '/';
}
