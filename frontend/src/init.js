import { setGlobal } from 'reactn';
import jwtDecode from 'jwt-decode';
import axios from 'axios';
import setAuthToken from './actions/setAuthToken';
import initIO from './actions/initIO';
import store from './store';
import Config from './config';

const init = async () => {
  document.addEventListener('gesturestart', (e) => {
    e.preventDefault();
  });

  if (localStorage.getItem('app') !== 'zeph 3.x.x') {
    localStorage.clear();
    localStorage.setItem('app', 'zeph 3.x.x');
  }

  let token = localStorage.getItem('token');
  let userString = localStorage.getItem('user');
  let user = userString ? JSON.parse(userString) : null;

  if (token) {
    const decoded = jwtDecode(token, { complete: true });
    const dateNow = new Date();
    const isExpired = decoded.exp * 1000 < dateNow.getTime();

    let result;

    if (!isExpired) {
      try {
        const res = await axios({
          method: 'post',
          url: `${Config.url || ''}/api/check-user`,
          data: { token },
        });
        result = res.data;
      } catch (e) {
        result = null;
      }
    }

    if (!result || result.error) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      token = localStorage.getItem('token');
      userString = localStorage.getItem('user');
      user = userString ? JSON.parse(userString) : null;
    }
  }

  if (token) {
    setAuthToken(token);
    store.dispatch(initIO(token));
  }

  const storedTheme = localStorage.getItem('theme');

  const state = {
    version: '2.9.1',
    entryPath: window.location.pathname,
    theme: storedTheme === 'dark' || storedTheme === 'light' ? storedTheme : Config.theme,
    token,
    user: user || (token ? jwtDecode(token) : {}),
    rooms: [],
    searchResults: [],
    // Mirrors SearchBar.jsx's own useExplicitSearch loading state — lifted
    // to a global so Panel/index.jsx (where the "People" results actually
    // render) can show "Searching…" instead of nothing while a directory
    // lookup is in flight, same pattern AddPeople.jsx already uses locally.
    searchLoading: false,
    favorites: [],
    meetings: [],
    nav: 'rooms',
    // Private Vault step-up token — intentionally NOT persisted to
    // localStorage (unlike token/user above) or restored on refresh; a
    // 10-minute step-up expiring on reload is the expected/secure behavior.
    vaultToken: null,
    vaultRooms: [],
    search: '',
    over: null,
    isPicker: false,
    // Full-screen blocking loader (ZephLoadingOverlay) — either a bare
    // boolean, or a string used as the accessible label instead of the
    // component's "Loading" default (e.g. "Sending message"). See
    // useZephLoader.js.
    zephLoading: false,
    messages: [],
    streams: [],
    inCall: false,
    video: true,
    audio: true,
    audioStream: null,
    videoStream: null,
    screenStream: null,
    callStatus: null,
    counterpart: null,
    callDirection: null,
    meeting: null,
    showPanel: true,
    panel: 'standard',
    newGroupUsers: [],
    // Set by Login/index.jsx's onRegister when the visitor arrived via a
    // /invite/f/:token link and just created an account — Home reads this
    // once on mount to pop the "Add Friend" dialog over the inbox instead
    // of routing back to the full-page invite preview. Cleared once shown.
    pendingFriendInviteToken: null,
    // Set by Login/index.jsx's onRegister for EVERY brand-new account
    // (never on a plain login) — Home reads this once to show a subtle,
    // dismissible "Take a tour?" suggestion (spec §7: "Do NOT automatically
    // force the tour... prefer an optional first-login suggestion, ability
    // to skip"). This is NOT the tour itself starting — just a one-time
    // prompt offering it. Cleared once shown, same lifecycle as
    // pendingFriendInviteToken above.
    isNewRegistration: false,
  };

  setGlobal(state).then(() => console.log('Global state init complete!', state));
};

export default init;
