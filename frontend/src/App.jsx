import { useEffect } from 'react';
import { getGlobal, useGlobal, setGlobal } from 'reactn';
import {
  BrowserRouter as Router, Routes, Route, Navigate, useNavigate,
} from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { ToastContainer, toast } from 'react-toastify';
import jwtDecode from 'jwt-decode';
import Home from './pages/Home';
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import FriendInvitePreview from './pages/InvitePreview/FriendInvitePreview';
import GroupInvitePreview from './pages/InvitePreview/GroupInvitePreview';
import setAuthToken from './actions/setAuthToken';
import initIO from './actions/initIO';
import PictureInPicture from './features/PictureInPicture';
import { registerNavigate } from './lib/navigation';
import { ZephLoadingOverlay } from './components/ui/zeph-loading-overlay';
import useZephLoader from './lib/useZephLoader';

import 'react-toastify/dist/ReactToastify.css';

// initIO.js fires a new-message toast that needs to navigate on click, but
// it's a plain action (no component tree), so useNavigate() can't be called
// there directly. This registers the real navigate function for it to use —
// rendered here since it must be inside <Router> to call the hook.
function NavigateRegistrar() {
  const navigate = useNavigate();
  useEffect(() => {
    registerNavigate(navigate);
  }, [navigate]);
  return null;
}

function App() {
  const dispatch = useDispatch();
  const io = useSelector((state) => state.io.io);

  const token = useGlobal('token')[0];
  const setStartingPoint = useGlobal('entryPath')[1];
  const theme = useGlobal('theme')[0];
  const zephLoader = useZephLoader();

  // CSS dark-mode overrides target :root (i.e. <html>), not this component's
  // own div — React can't render attributes onto <html> directly, so it's
  // set imperatively here with both data-theme and Tailwind's .dark class.
  useEffect(() => {
    const activeTheme = theme || localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', activeTheme);
    if (activeTheme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  useEffect(() => {
    if (!io || !getGlobal().user || !token) return;
    let focusCount = 0;
    const interval = setInterval(() => {
      if (!document.hasFocus()) {
        focusCount++;
        if (focusCount === 10) {
          io.emit('status', { status: 'away' });
        }
      } else if (focusCount !== 0) {
        focusCount = 0;
        io.emit('status', { status: 'online' });
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [io, token]);

  useEffect(() => {
    return () => {
      try {
        if (getGlobal().audioStream) {
          getGlobal()
            .audioStream.getTracks()
            .forEach((track) => track.stop());
        }
      } catch (e) {}
      try {
        if (getGlobal().videoStream) {
          getGlobal()
            .videoStream.getTracks()
            .forEach((track) => track.stop());
        }
      } catch (e) {}
    };
  }, []);

  if (!window.loaded) {
    setStartingPoint(window.location.pathname);
    const splitPath = window.location.pathname.split('/');
    const route = splitPath[1];
    const token = splitPath[2];
    if (route === 'login' && token && token.length > 20) {
      let decoded;
      try {
        decoded = jwtDecode(token);
        if (typeof decoded !== 'object' || typeof decoded.id !== 'string') return;
        setAuthToken(token);
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(decoded));
        setGlobal({
          user: decoded,
          token,
        }).then(() => {
          dispatch(initIO(token));
        });
      } catch (e) {
        toast.error('Invalid token provided in URL. You can still login manually.');
      }
    }
    window.loaded = true;
  }

  return (
    <div className="fixed h-full w-full overflow-hidden bg-background">
      <ZephLoadingOverlay isOpen={zephLoader.isLoading} label={zephLoader.label} />
      <ToastContainer
        position="bottom-right"
        autoClose={5000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        icon={false}
        toastClassName="!rounded-2xl !border !border-border !bg-card !text-card-foreground !shadow-2xl !p-0 !min-h-0"
        bodyClassName="!p-4 !m-0"
        progressClassName="!bg-primary"
        closeButton={false}
      />
      <Router>
        <NavigateRegistrar />
        <Routes>
          <Route path="/forgot-password" element={token ? <Navigate to="/" /> : <ForgotPassword />} />
          <Route path="/login" element={token ? <Navigate to="/" /> : <Login />} />
          {/* Public — reachable logged-out so a shared link/QR scan can preview
              before requiring login (entryPath already carries the visitor
              back here post-login, see init.js/Login/index.jsx). */}
          <Route path="/invite/f/:token" element={<FriendInvitePreview />} />
          <Route path="/invite/g/:token" element={<GroupInvitePreview />} />
          <Route path="/*" element={!token ? <Navigate to="/login" /> : <Home />} />
        </Routes>
        {/* Sibling to <Routes>, not inside any Route — never unmounted by
            navigation, so an active call stays visible while browsing
            other chats/tabs instead of silently broadcasting off-screen. */}
        {token && <PictureInPicture />}
      </Router>
    </div>
  );
}

export default App;
