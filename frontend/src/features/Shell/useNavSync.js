import { useEffect } from 'react';
import { useGlobal } from 'reactn';
import { useLocation } from 'react-router-dom';

// Phase 1: the global nav rail now uses real routes, but Panel's internal tab
// content (Search/Favorites/Meetings/Settings bodies) still switches on the
// existing `nav` reactn global — redesigning that content is later phases'
// scope. This hook is the thin bridge: URL is the source of truth, `nav`
// stays in sync so every existing `nav === 'x'` check keeps working unchanged.
const ROUTE_TO_NAV = {
  '/': 'rooms',
  '/search': 'search',
  '/favorites': 'favorites',
  '/meetings': 'meetings',
  '/settings': 'settings',
  '/profile': 'settings',
};

const useNavSync = () => {
  const location = useLocation();
  const setNav = useGlobal('nav')[1];
  const setShowPanel = useGlobal('showPanel')[1];
  const setOver = useGlobal('over')[1];

  useEffect(() => {
    const nextNav = ROUTE_TO_NAV[location.pathname];
    if (nextNav) {
      setNav(nextNav);
      setShowPanel(true);
      setOver(false);
    }
  }, [location.pathname]);
};

export default useNavSync;
