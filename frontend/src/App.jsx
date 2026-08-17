import { useEffect } from 'react';
import { getGlobal, useGlobal, setGlobal } from 'reactn';
import {
  BrowserRouter as Router, Routes, Route, Navigate,
} from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { ToastContainer, toast } from 'react-toastify';
import jwtDecode from 'jwt-decode';
import Home from './pages/Home';
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import setAuthToken from './actions/setAuthToken';
import initIO from './actions/initIO';
import PictureInPicture from './features/PictureInPicture';

import 'react-toastify/dist/ReactToastify.css';

function App() {
  const dispatch = useDispatch();
  const io = useSelector((state) => state.io.io);

  const token = useGlobal('token')[0];
  const setStartingPoint = useGlobal('entryPath')[1];
  const theme = useGlobal('theme')[0];

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
      />
      <Router>
        <Routes>
          <Route path="/forgot-password" element={token ? <Navigate to="/" /> : <ForgotPassword />} />
          <Route path="/login" element={token ? <Navigate to="/" /> : <Login />} />
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
