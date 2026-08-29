import { useEffect, useState } from 'react';
import { useGlobal } from 'reactn';
import { Link, useNavigate } from 'react-router-dom';
import jwtDecode from 'jwt-decode';
import { useDispatch } from 'react-redux';
import Div100vh from 'react-div-100vh';
import {
  ArrowLeft, ArrowRight, Moon, Sun, MessageCircle, Video, Users, ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import Input from './components/Input';
import login from '../../actions/login';
import register from '../../actions/register';
import setAuthToken from '../../actions/setAuthToken';
import initIO from '../../actions/initIO';
import getInfo from '../../actions/getInfo';
import useTheme from '../../lib/useTheme';
import BrandLogo from '../../components/BrandLogo';
import Config from '../../config';

const FEATURES = [
  { Icon: MessageCircle, title: 'Real-time Messaging', text: 'Instant delivery across all your devices.' },
  { Icon: Video, title: 'Voice & Video Calls', text: 'High quality calls for you and your team.' },
  { Icon: Users, title: 'Groups & Channels', text: 'Stay connected with everyone.' },
  { Icon: ShieldCheck, title: 'Secure & Private', text: 'Your data is always protected.' },
];

function Login() {
  const dispatch = useDispatch();
  const [info, setInfo] = useState({});
  const [tab, setTab] = useState('login');
  const [showCredits, setShowCredits] = useState(false);
  const { theme, toggle: toggleTheme } = useTheme();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [keep, setKeep] = useState(true);
  const [loginErrors, setLoginErrors] = useState({});

  const [registerUsername, setRegisterUsername] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerFirstName, setRegisterFirstName] = useState('');
  const [registerLastName, setRegisterLastName] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerRepeatPassword, setRegisterRepeatPassword] = useState('');
  const [registerErrors, setRegisterErrors] = useState({});

  const setToken = useGlobal('token')[1];
  const setUser = useGlobal('user')[1];
  const [entryPath, setEntryPath] = useGlobal('entryPath');
  const setPendingFriendInviteToken = useGlobal('pendingFriendInviteToken')[1];
  const setIsNewRegistration = useGlobal('isNewRegistration')[1];

  const navigate = useNavigate();

  useEffect(() => {
    getInfo().then((res) => {
      setInfo(res.data);
    });
  }, []);

  const onLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await login(email, password);
      if (keep) localStorage.setItem('token', res.data.token);
      if (keep) localStorage.setItem('user', JSON.stringify(jwtDecode(res.data.token)));
      setLoginErrors({});
      setAuthToken(res.data.token);
      setUser(jwtDecode(res.data.token));
      setToken(res.data.token);
      dispatch(initIO(res.data.token));
      navigate(['/login', '/'].includes(entryPath) ? '/' : entryPath, { replace: true });
      await setEntryPath(null);
    } catch (err) {
      let errors = {};
      if (!err.response || typeof err.response.data !== 'object') errors.generic = 'Could not connect to server.';
      else errors = err.response.data;
      setLoginErrors(errors);
    }
  };

  const onRegister = async (e) => {
    e.preventDefault();
    try {
      await register({
        username: registerUsername,
        email: registerEmail,
        firstName: registerFirstName,
        lastName: registerLastName,
        password: registerPassword,
        repeatPassword: registerRepeatPassword,
      });
      const res = await login(registerEmail, registerPassword);
      setRegisterErrors({});
      if (keep) localStorage.setItem('token', res.data.token);
      setAuthToken(res.data.token);
      setUser(jwtDecode(res.data.token));
      setToken(res.data.token);
      dispatch(initIO(res.data.token));
      // Home reads this once to offer (not force) the onboarding tour —
      // see init.js's isNewRegistration comment / spec §7. Only ever set
      // here, never in onLogin below — a returning user never sees this.
      await setIsNewRegistration(true);

      // A friend-invite link is the one entryPath that should NOT navigate
      // straight to its own page post-registration — Home instead pops an
      // "Add Friend" dialog over the inbox (see pendingFriendInviteToken in
      // init.js), so a brand-new user lands in the app, not on another
      // full-page interstitial. Every other entryPath (a group invite, a
      // deep-linked room, etc.) keeps navigating there directly, unchanged.
      const friendInviteMatch = entryPath?.match(/^\/invite\/f\/(.+)$/);
      if (friendInviteMatch) {
        await setPendingFriendInviteToken(friendInviteMatch[1]);
        navigate('/', { replace: true });
      } else {
        navigate(['/login', '/'].includes(entryPath) ? '/' : entryPath, { replace: true });
      }
      await setEntryPath(null);
    } catch (err) {
      let errors = {};
      if (!err.response || typeof err.response.data !== 'object') errors.generic = 'Could not connect to server.';
      else errors = err.response.data;
      setRegisterErrors(errors);
    }
  };

  const loginInfo = Object.keys(loginErrors).map((key) => (
    <div className="text-center text-sm font-medium text-destructive" key={key}>
      {loginErrors[key]}
    </div>
  ));

  const registerInfo = Object.keys(registerErrors).map((key) => (
    <div className="text-center text-sm font-medium text-destructive" key={key}>
      {registerErrors[key]}
    </div>
  ));

  return (
    <Div100vh>
      <div className="flex h-full w-full overflow-y-auto bg-background text-foreground lg:overflow-hidden">
        {/* Left Side: Dark Hero Marketing Panel */}
        <div className="relative hidden w-[45%] max-w-[560px] min-w-[380px] shrink-0 flex-col justify-between overflow-hidden bg-[#070708] p-10 text-white lg:flex xl:p-14">
          {/* Top Branding */}
          <div>
            <Link to="/login" className="flex items-center gap-3">
              <BrandLogo className="h-8 w-8" />
              <span className="font-zeph text-2xl font-extrabold tracking-tight text-white">{Config.brand}</span>
            </Link>

            <h1 className="mt-14 text-4xl font-extrabold leading-[1.15] tracking-tight xl:text-[42px]">
              Your conversations.
              <br />
              <span className="text-primary">Simplified.</span>
            </h1>
            <p className="mt-4 max-w-[340px] text-sm leading-relaxed text-zinc-400">
              Real-time messaging, voice &amp; video calls, group chats and more. Built for speed, security and
              seamless communication.
            </p>

            {/* Feature List */}
            <div className="mt-10 flex flex-col gap-4">
              {FEATURES.map(({ Icon, title, text }) => (
                <div key={title} className="flex items-start gap-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.04] text-primary border border-white/[0.05]">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-zinc-200">{title}</div>
                    <div className="text-xs text-zinc-400 mt-0.5">{text}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer branding and credits */}
          <div className="text-xs text-zinc-500 z-10">
            {`© ${new Date().getFullYear()} ${Config.brand} · `}
            <span className="text-primary font-medium">{Config.brand}</span>
            {` v${info.version || '2.9.1'}`}
            {Config.showCredits && (
              <>
                {' · '}
                <button
                  type="button"
                  className="text-primary underline hover:text-primary/80"
                  title="Special thanks and open source resources in use"
                  onClick={() => setShowCredits(true)}
                >
                  Credits
                </button>
              </>
            )}
          </div>

          {/* Refined Diagonal Accent Glow */}
          <div
            className="pointer-events-none absolute -bottom-28 -right-28 h-80 w-80 rounded-full opacity-35 blur-[90px]"
            style={{ background: 'radial-gradient(circle, var(--color-primary, #e11d48) 0%, transparent 70%)' }}
          />
          <div
            className="pointer-events-none absolute -bottom-10 right-0 h-48 w-48 rotate-45 opacity-20"
            style={{
              background: 'linear-gradient(135deg, transparent 40%, var(--color-primary, #e11d48) 100%)',
            }}
          />
        </div>

        {/* Right Side: Auth Panel with Equal Margins and Responsive Layout */}
        <div className="relative flex flex-1 flex-col justify-between overflow-y-auto px-6 py-6 sm:px-10 sm:py-8 lg:px-12 xl:px-16">
          {/* Top Bar: Mobile Brand + Theme Toggle */}
          <div className="flex w-full items-center justify-between">
            <div className="lg:hidden">
              <Link to="/login" className="flex items-center gap-2">
                <BrandLogo className="h-7 w-7" />
                <span className="font-zeph text-lg font-extrabold tracking-tight">{Config.brand}</span>
              </Link>
            </div>
            <div className="ml-auto">
              <button
                type="button"
                onClick={toggleTheme}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                {theme === 'dark' ? 'Light' : 'Dark'}
              </button>
            </div>
          </div>

          {/* Centered Form Box */}
          <div className="mx-auto my-auto w-full max-w-[420px] py-4">
            {!showCredits ? (
              <div>
                {/* Header: Icon + Welcome back + Greeting */}
                <div className="mb-6 flex flex-col items-center text-center">
                  <div className="mb-3 flex h-14 w-14 items-center justify-center">
                    <BrandLogo className="h-12 w-12" />
                  </div>
                  <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
                    Welcome back
                    {' '}
                    <span aria-hidden className="inline-block animate-pulse">👋</span>
                  </h2>
                  <p className="mt-1.5 text-xs text-muted-foreground sm:text-sm">
                    Login to continue to
                    {' '}
                    <span className="font-medium text-foreground">{Config.brand}</span>
                  </p>
                </div>

                {/* Switch Tabs (Clean underline/segmented style matching mockup) */}
                <div className="mb-6 flex w-full border-b border-border/80">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'login'}
                    onClick={() => setTab('login')}
                    className={`relative flex-1 pb-3 text-center text-sm font-semibold transition-all duration-200 ${
                      tab === 'login'
                        ? 'text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Log In
                    {tab === 'login' && (
                      <span className="absolute bottom-0 left-0 h-[2.5px] w-full rounded-t-full bg-primary" />
                    )}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'register'}
                    onClick={() => setTab('register')}
                    className={`relative flex-1 pb-3 text-center text-sm font-semibold transition-all duration-200 ${
                      tab === 'register'
                        ? 'text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Register
                    {tab === 'register' && (
                      <span className="absolute bottom-0 left-0 h-[2.5px] w-full rounded-t-full bg-primary" />
                    )}
                  </button>
                </div>

                {/* Tab 1: Log In */}
                {tab === 'login' && (
                  <form onSubmit={onLogin} className="flex flex-col gap-4">
                    {loginInfo}
                    <div className="flex flex-col gap-1.5">
                      <Input
                        id="login-email"
                        icon="mail"
                        placeholder="Username or email"
                        type="text"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Input
                        id="login-password"
                        icon="lock"
                        placeholder="Password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </div>

                    <div className="flex items-center justify-between text-xs sm:text-sm">
                      <label htmlFor="keep-login" className="flex cursor-pointer select-none items-center gap-2 text-muted-foreground hover:text-foreground">
                        <Checkbox
                          id="keep-login"
                          checked={keep}
                          onCheckedChange={(checked) => setKeep(checked === true)}
                          className="rounded data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                        />
                        <span>Keep me logged in</span>
                      </label>
                      {info.nodemailerEnabled && (
                        <Link to="/forgot-password" className="font-semibold text-primary hover:underline">
                          Forgot password?
                        </Link>
                      )}
                    </div>

                    <Button
                      type="submit"
                      size="lg"
                      className="mt-1 h-11 w-full gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-[0.99]"
                    >
                      Log In
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </form>
                )}

                {/* Tab 2: Register */}
                {tab === 'register' && (
                  <form onSubmit={onRegister} className="flex flex-col gap-3.5">
                    {registerInfo}
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        icon="pencil"
                        placeholder="First Name"
                        type="text"
                        value={registerFirstName}
                        onChange={(e) => setRegisterFirstName(e.target.value)}
                      />
                      <Input
                        icon="pencil"
                        placeholder="Last Name"
                        type="text"
                        value={registerLastName}
                        onChange={(e) => setRegisterLastName(e.target.value)}
                      />
                    </div>
                    <Input
                      icon="user"
                      placeholder="Username"
                      type="text"
                      value={registerUsername}
                      onChange={(e) => setRegisterUsername(e.target.value)}
                    />
                    <Input
                      icon="mail"
                      placeholder="Email"
                      type="email"
                      value={registerEmail}
                      onChange={(e) => setRegisterEmail(e.target.value)}
                    />
                    <Input
                      icon="lock"
                      placeholder="Password"
                      type="password"
                      value={registerPassword}
                      onChange={(e) => setRegisterPassword(e.target.value)}
                    />
                    <Input
                      icon="lock"
                      placeholder="Repeat Password"
                      type="password"
                      value={registerRepeatPassword}
                      onChange={(e) => setRegisterRepeatPassword(e.target.value)}
                    />
                    <Button
                      type="submit"
                      size="lg"
                      className="mt-1 h-11 w-full gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-[0.99]"
                    >
                      Register
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </form>
                )}

                {/* Bottom Toggle Prompt */}
                <div className="mt-6 text-center text-xs sm:text-sm text-muted-foreground">
                  {tab === 'login' ? "Don't have an account? " : 'Already have an account? '}
                  <button
                    type="button"
                    className="font-bold text-primary transition-colors hover:underline"
                    onClick={() => setTab(tab === 'login' ? 'register' : 'login')}
                  >
                    {tab === 'login' ? 'Register' : 'Log In'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border bg-card p-6 text-center text-sm shadow-sm">
                {'The default background image is from '}
                <a href="https://picsum.photos/" target="_blank" rel="noopener noreferrer" className="underline font-semibold">
                  Picsum Photos
                </a>
                <br />
                <br />
                A big thank you to all contributors to React, Redux, Socket.IO, Emoji Mart, Axios, SASS and Moment
                <div className="mt-5">
                  <Button variant="ghost" size="sm" onClick={() => setShowCredits(false)}>
                    <ArrowLeft className="mr-1 h-4 w-4" />
                    Close Credits
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Bottom spacing anchor for balanced equal margins */}
          <div className="hidden lg:block h-6" aria-hidden="true" />
        </div>
      </div>
    </Div100vh>
  );
}

export default Login;
