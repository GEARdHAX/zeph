import {
  useEffect, useRef, useState,
} from 'react';
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
import useZephLoader from '../../lib/useZephLoader';
import BrandLogo from '../../components/BrandLogo';
import ZephWordmark from '../../components/ZephWordmark';
import Config from '../../config';

const FEATURES = [
  {
    Icon: MessageCircle,
    title: 'Real-time Messaging',
    text: 'Instant delivery across all your devices.',
  },
  {
    Icon: Video,
    title: 'Voice & Video Calls',
    text: 'High quality calls for you and your team.',
  },
  {
    Icon: Users,
    title: 'Group Communities',
    text: 'Collaborate with friends and colleagues seamlessly.',
  },
  {
    Icon: ShieldCheck,
    title: 'End-to-End Security',
    text: 'Your conversations are always private and protected.',
  },
];

function Login() {
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const [tab, setTab] = useState('login');
  const [showCredits, setShowCredits] = useState(false);
  const { theme, toggle: toggleTheme } = useTheme();
  const zephLoader = useZephLoader();

  // A ref, not state — must be readable/settable synchronously the instant
  // onLogin/onRegister runs, with zero re-render delay. A second submit
  // (double-click, double-Enter, or just clicking again before the overlay
  // has visually blocked the button on a slow first paint) previously fired
  // a second in-flight request; that second request's own show()/finally
  // hide() would then race the first one, and could leave zephLoading
  // toggling on/off mid-cycle — which restarts ZephSpinner's animation
  // loop from the beginning every time, looking exactly like "stuck on
  // the dot" even though the sequencer itself was never broken.
  const submittingRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form Fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [keep, setKeep] = useState(true);

  const [registerFirstName, setRegisterFirstName] = useState('');
  const [registerLastName, setRegisterLastName] = useState('');
  const [registerUsername, setRegisterUsername] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerRepeatPassword, setRegisterRepeatPassword] = useState('');

  // Password Visibility
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showRegisterRepeatPassword, setShowRegisterRepeatPassword] = useState(false);

  // Status & Global state
  const [loginErrors, setLoginErrors] = useState({});
  const [registerErrors, setRegisterErrors] = useState({});
  const [info, setInfo] = useState({});
  const [entryPath, setEntryPath] = useGlobal('entryPath');
  const setToken = useGlobal('token')[1];
  const setUser = useGlobal('user')[1];
  const setPendingFriendInviteToken = useGlobal('pendingFriendInviteToken')[1];
  const setIsNewRegistration = useGlobal('isNewRegistration')[1];

  useEffect(() => {
    getInfo().then((res) => setInfo(res.data)).catch(() => {});
  }, []);

  const onLogin = async (e) => {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    zephLoader.show('Logging in');
    try {
      const res = await login(email, password);
      // token/user must land in reactn global state, not just storage —
      // App.jsx's route guard reads useGlobal('token') on every render, so
      // without this the app immediately bounces back to /login right
      // after a successful login (storage alone doesn't drive routing).
      if (keep) localStorage.setItem('token', res.data.token);
      else sessionStorage.setItem('token', res.data.token);
      setAuthToken(res.data.token);
      setUser(jwtDecode(res.data.token));
      setToken(res.data.token);
      // initIO is a thunk (initIO(token) -> (dispatch) => {...}) — must be
      // dispatched, not called with dispatch as a second argument.
      dispatch(initIO(res.data.token));
      navigate(['/login', '/'].includes(entryPath) ? '/' : entryPath || '/', { replace: true });
      await setEntryPath(null);
    } catch (err) {
      let errors = {};
      if (!err.response || typeof err.response.data !== 'object') errors.generic = 'Could not connect to server.';
      else errors = err.response.data;
      setLoginErrors(errors);
    } finally {
      zephLoader.hide();
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const onRegister = async (e) => {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    zephLoader.show('Creating your account');
    try {
      await register({
        username: registerUsername,
        firstName: registerFirstName,
        lastName: registerLastName,
        email: registerEmail,
        password: registerPassword,
        repeatPassword: registerRepeatPassword,
      });
      // /api/register only creates the account and returns the user doc —
      // no token. A follow-up login() is what actually authenticates the
      // client, same credentials just submitted.
      const res = await login(registerEmail, registerPassword);
      if (keep) localStorage.setItem('token', res.data.token);
      else sessionStorage.setItem('token', res.data.token);
      setAuthToken(res.data.token);
      setUser(jwtDecode(res.data.token));
      setToken(res.data.token);
      dispatch(initIO(res.data.token));
      // Home reads this once to offer (not force) the onboarding tour —
      // only ever set here, never in onLogin above — a returning user
      // never sees this.
      await setIsNewRegistration(true);

      // Friend invites (spec A 24): never bounce a newly registered user
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
    } finally {
      zephLoader.hide();
      submittingRef.current = false;
      setIsSubmitting(false);
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
              <ZephWordmark className="text-2xl font-extrabold tracking-tight text-white" />
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
          <div className="text-xs text-zinc-500 z-10 flex items-center gap-1">
            <span>© {new Date().getFullYear()}</span>
            <ZephWordmark className="text-xs font-semibold text-zinc-400" />
            {/* <span>•</span> */}
            {/* <span className="text-primary font-medium">{Config.brand}</span> */}
            <span>{`v${info.version || '1.0.0'}`}</span>
            {Config.showCredits && (
              <>
                <span>•</span>
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
                <ZephWordmark className="text-lg font-extrabold tracking-tight" />
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
                    <ZephWordmark className="font-semibold text-foreground" />
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

                {/* Login Form */}
                {tab === 'login' ? (
                  <form onSubmit={onLogin} className="flex flex-col gap-4">
                    {loginInfo}
                    <Input
                      id="login-email"
                      type="text"
                      placeholder="Username or email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                    <Input
                      id="login-password"
                      type={showLoginPassword ? 'text' : 'password'}
                      placeholder="Password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      isPassword
                      showPassword={showLoginPassword}
                      onTogglePassword={() => setShowLoginPassword((prev) => !prev)}
                      required
                    />

                    {/* Keep me logged in checkbox */}
                    <div className="flex items-center justify-between pt-1">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="keep-login"
                          checked={keep}
                          onCheckedChange={(checked) => setKeep(Boolean(checked))}
                        />
                        <Label
                          htmlFor="keep-login"
                          className="cursor-pointer text-xs font-normal text-muted-foreground select-none"
                        >
                          Keep me logged in
                        </Label>
                      </div>
                      <Link to="/forgot-password" className="text-xs font-semibold text-primary hover:underline">
                        Forgot password?
                      </Link>
                    </div>

                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      className="mt-2 h-11 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-[0.99] disabled:opacity-70"
                    >
                      Log In
                      <ArrowRight className="ml-1.5 h-4 w-4" />
                    </Button>
                  </form>
                ) : (
                  /* Register Form */
                  <form onSubmit={onRegister} className="flex flex-col gap-3">
                    {registerInfo}
                    <div className="grid grid-cols-2 gap-2.5">
                      <Input
                        id="reg-first-name"
                        type="text"
                        placeholder="First Name"
                        value={registerFirstName}
                        onChange={(e) => setRegisterFirstName(e.target.value)}
                        required
                      />
                      <Input
                        id="reg-last-name"
                        type="text"
                        placeholder="Last Name"
                        value={registerLastName}
                        onChange={(e) => setRegisterLastName(e.target.value)}
                        required
                      />
                    </div>
                    <Input
                      id="reg-username"
                      type="text"
                      placeholder="Username"
                      value={registerUsername}
                      onChange={(e) => setRegisterUsername(e.target.value)}
                      required
                    />
                    <Input
                      id="reg-email"
                      type="email"
                      placeholder="Email"
                      value={registerEmail}
                      onChange={(e) => setRegisterEmail(e.target.value)}
                      required
                    />
                    <Input
                      id="reg-password"
                      type={showRegisterPassword ? 'text' : 'password'}
                      placeholder="Password"
                      value={registerPassword}
                      onChange={(e) => setRegisterPassword(e.target.value)}
                      isPassword
                      showPassword={showRegisterPassword}
                      onTogglePassword={() => setShowRegisterPassword((prev) => !prev)}
                      required
                    />
                    <Input
                      id="reg-repeat-password"
                      type={showRegisterRepeatPassword ? 'text' : 'password'}
                      placeholder="Repeat Password"
                      value={registerRepeatPassword}
                      onChange={(e) => setRegisterRepeatPassword(e.target.value)}
                      isPassword
                      showPassword={showRegisterRepeatPassword}
                      onTogglePassword={() => setShowRegisterRepeatPassword((prev) => !prev)}
                      required
                    />

                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      className="mt-2 h-11 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-[0.99] disabled:opacity-70"
                    >
                      Register
                      <ArrowRight className="ml-1.5 h-4 w-4" />
                    </Button>
                  </form>
                )}
              </div>
            ) : (
              /* Credits & Open Source Attributions Panel */
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2 border-b border-border/80 pb-3">
                  <button
                    type="button"
                    aria-label="Close credits"
                    onClick={() => setShowCredits(false)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <h3 className="text-base font-bold tracking-tight">Open Source Credits &amp; Thanks</h3>
                </div>

                <div className="flex flex-col gap-3 text-xs leading-relaxed text-muted-foreground">
                  <p>
                    Special thanks to the open source community and creators whose work helps power this platform:
                  </p>
                  <div className="rounded-xl border border-border/60 bg-muted/40 p-3.5 flex flex-col gap-2">
                    <div className="font-semibold text-foreground">Avatar Imagery</div>
                    <div>
                      Random initial user avatars provided by{' '}
                      <a
                        href="https://picsum.photos"
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline font-medium"
                      >
                        Picsum Photos
                      </a>
                      .
                    </div>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-muted/40 p-3.5 flex flex-col gap-2">
                    <div className="font-semibold text-foreground">Icons &amp; Assets</div>
                    <div>
                      Icons beautifully crafted by{' '}
                      <a
                        href="https://lucide.dev"
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline font-medium"
                      >
                        Lucide Icons
                      </a>
                      .
                    </div>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  className="mt-2 h-10 w-full rounded-xl text-xs font-semibold"
                  onClick={() => setShowCredits(false)}
                >
                  Back to Login
                </Button>
              </div>
            )}
          </div>

          {/* Right Bottom Footer: Disclaimer + Switch view */}
          <div className="flex flex-col items-center gap-1 text-center text-xs text-muted-foreground sm:flex-row sm:justify-between">
            <span>By continuing, you agree to our Terms.</span>
            <div className="flex items-center gap-1 font-medium text-foreground">
              {tab === 'login' ? (
                <>
                  <span>Don&apos;t have an account?</span>
                  <button
                    type="button"
                    onClick={() => setTab('register')}
                    className="font-bold text-primary transition-colors hover:underline"
                  >
                    Register
                  </button>
                </>
              ) : (
                <>
                  <span>Already have an account?</span>
                  <button
                    type="button"
                    onClick={() => setTab('login')}
                    className="font-bold text-primary transition-colors hover:underline"
                  >
                    Log In
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </Div100vh>
  );
}

export default Login;
