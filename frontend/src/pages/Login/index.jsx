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
import loginBg from '../../assets/login-bg.png';

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
    if (e && e.preventDefault) e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    zephLoader.show('Logging in');
    try {
      const res = await login(email, password);
      if (keep) localStorage.setItem('token', res.data.token);
      else sessionStorage.setItem('token', res.data.token);
      setAuthToken(res.data.token);
      setUser(jwtDecode(res.data.token));
      setToken(res.data.token);
      dispatch(initIO(res.data.token));
      navigate(['/login', '/'].includes(entryPath) ? '/' : entryPath, { replace: true });
      await setEntryPath(null);
    } catch (err) {
      let errors = {};
      if (!err.response || typeof err.response.data !== 'object') errors.generic = 'Invalid credentials';
      else errors = err.response.data;
      setLoginErrors(errors);
    } finally {
      zephLoader.hide();
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const onRegister = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
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
      const res = await login(registerEmail, registerPassword);
      if (keep) localStorage.setItem('token', res.data.token);
      else sessionStorage.setItem('token', res.data.token);
      setAuthToken(res.data.token);
      setUser(jwtDecode(res.data.token));
      setToken(res.data.token);
      dispatch(initIO(res.data.token));
      await setIsNewRegistration(true);

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
        {/* Left Side: Dark Hero Marketing Panel with background */}
        <div className="relative hidden w-[45%] max-w-[560px] min-w-[380px] shrink-0 flex-col justify-between overflow-hidden bg-[#070708] p-10 text-white lg:flex xl:p-14">
          {/* Background Binary Wave Image */}
          <div
            className="pointer-events-none absolute inset-0 bg-cover bg-bottom bg-no-repeat opacity-40"
            style={{ backgroundImage: `url(${loginBg})` }}
          />

          {/* Top Branding (Always dark surface logo) */}
          <div className="relative z-10">
            <Link to="/login" className="flex items-center gap-3">
              <BrandLogo variant="dark" className="h-8 w-8" />
              <ZephWordmark className="text-2xl font-extrabold tracking-tight text-white" />
            </Link>

            <h1 className="mt-14 text-4xl font-extrabold leading-[1.15] tracking-tight xl:text-[42px]">
              Your conversations.
              <br />
              <span className="text-primary">Simplified.</span>
            </h1>
            <p className="mt-4 max-w-[340px] text-sm leading-relaxed text-zinc-300 drop-shadow-sm">
              Real-time messaging, voice &amp; video calls, group chats and more. Built for speed, security and
              seamless communication.
            </p>

            {/* Feature List */}
            <div className="mt-10 flex flex-col gap-4">
              {FEATURES.map(({ Icon, title, text }) => (
                <div key={title} className="flex items-start gap-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black/50 text-primary border border-white/10 backdrop-blur-none">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-zinc-100">{title}</div>
                    <div className="text-xs text-zinc-300 mt-0.5">{text}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer branding and credits */}
          <div className="text-xs text-zinc-400 z-10 flex items-center gap-1">
            <span>© {new Date().getFullYear()}</span>
            <ZephWordmark className="text-xs font-semibold text-zinc-300" />
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
        </div>

        {/* Right Side: Auth Forms */}
        <div className="flex flex-1 flex-col justify-between overflow-y-auto p-6 sm:p-10 lg:p-14">
          {/* Top Bar: Mobile Brand + Theme Toggle */}
          <div className="flex w-full items-center justify-between">
            <div className="lg:hidden">
              <Link to="/login" className="flex items-center gap-2">
                <BrandLogo className="h-7 w-7" />
                <ZephWordmark className="text-lg font-extrabold tracking-tight" />
              </Link>
            </div>
            <div className="ml-auto">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleTheme}
                className="h-9 w-9 rounded-xl text-muted-foreground hover:text-foreground"
                aria-label="Toggle theme"
              >
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          {/* Center Content: Login / Register Box or Credits Panel */}
          <div className="mx-auto my-auto w-full max-w-[400px] py-8">
            {showCredits ? (
              <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-lg font-bold">Credits & Acknowledgements</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowCredits(false)}
                    className="h-8 px-2 text-xs"
                  >
                    <ArrowLeft className="mr-1 h-3.5 w-3.5" />
                    Back
                  </Button>
                </div>
                <div className="space-y-4 text-xs text-muted-foreground">
                  <div>
                    <div className="font-semibold text-foreground">Avatars & Placeholders</div>
                    <div>Picsum Photos (Lorem Picsum) by David Walsh</div>
                  </div>
                  <div>
                    <div className="font-semibold text-foreground">Sound Effects</div>
                    <div>Notification and call audio tracks licensed under Creative Commons.</div>
                  </div>
                  <div>
                    <div className="font-semibold text-foreground">Open Source Libraries</div>
                    <div>React, Tailwind CSS, Radix UI, Lucide Icons, Mediasoup, Socket.io</div>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                {/* Header: Icon + Welcome back + Greeting */}
                <div className="mb-6 flex flex-col items-center text-center">
                  <div className="mb-3 flex h-14 w-14 items-center justify-center">
                    <BrandLogo className="h-12 w-12" />
                  </div>
                  <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
                    {tab === 'login' ? 'Welcome back' : 'Create an account'}
                  </h2>
                  <p className="mt-1.5 text-xs text-muted-foreground sm:text-sm">
                    {tab === 'login'
                      ? 'Enter your credentials to access your account'
                      : 'Get started with your free account today'}
                  </p>
                </div>

                {/* Tabs Switcher */}
                <div className="mb-6 flex border-b border-border">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'login'}
                    onClick={() => {
                      setTab('login');
                      setLoginErrors({});
                    }}
                    className={`relative flex-1 pb-3 text-center text-sm font-semibold transition-all duration-200 ${
                      tab === 'login'
                        ? 'text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Log In
                    {tab === 'login' && (
                      <span className="absolute bottom-0 left-0 h-0.5 w-full bg-primary" />
                    )}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'register'}
                    onClick={() => {
                      setTab('register');
                      setRegisterErrors({});
                    }}
                    className={`relative flex-1 pb-3 text-center text-sm font-semibold transition-all duration-200 ${
                      tab === 'register'
                        ? 'text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Register
                    {tab === 'register' && (
                      <span className="absolute bottom-0 left-0 h-0.5 w-full bg-primary" />
                    )}
                  </button>
                </div>

                {/* Forms */}
                {tab === 'login' ? (
                  <form onSubmit={onLogin} className="space-y-4">
                    {loginInfo}
                    <div>
                      <Input
                        id="login-email"
                        type="text"
                        placeholder="Username or email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className="h-11 rounded-xl"
                      />
                    </div>
                    <div>
                      <Input
                        id="login-password"
                        type={showLoginPassword ? 'text' : 'password'}
                        placeholder="Password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        className="h-11 rounded-xl"
                        showPasswordToggle
                        isPasswordVisible={showLoginPassword}
                        onTogglePassword={() => setShowLoginPassword(!showLoginPassword)}
                      />
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="keep-login"
                          checked={keep}
                          onCheckedChange={(checked) => setKeep(!!checked)}
                        />
                        <Label
                          htmlFor="keep-login"
                          className="cursor-pointer text-xs font-normal text-muted-foreground"
                        >
                          Keep me logged in
                        </Label>
                      </div>
                      <Link
                        to="/forgot-password"
                        className="font-medium text-primary transition-colors hover:underline"
                      >
                        Forgot password?
                      </Link>
                    </div>

                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      className="h-11 w-full rounded-xl text-sm font-bold shadow-md transition-all hover:shadow-lg"
                    >
                      {isSubmitting ? 'Logging in...' : 'Log In'}
                      {!isSubmitting && <ArrowRight className="ml-2 h-4 w-4" />}
                    </Button>
                  </form>
                ) : (
                  <form onSubmit={onRegister} className="space-y-3.5">
                    {registerInfo}
                    <div className="grid grid-cols-2 gap-2.5">
                      <Input
                        type="text"
                        placeholder="First Name"
                        value={registerFirstName}
                        onChange={(e) => setRegisterFirstName(e.target.value)}
                        required
                        className="h-10 rounded-xl"
                      />
                      <Input
                        type="text"
                        placeholder="Last Name"
                        value={registerLastName}
                        onChange={(e) => setRegisterLastName(e.target.value)}
                        required
                        className="h-10 rounded-xl"
                      />
                    </div>
                    <Input
                      type="text"
                      placeholder="Username"
                      value={registerUsername}
                      onChange={(e) => setRegisterUsername(e.target.value)}
                      required
                      className="h-10 rounded-xl"
                    />
                    <Input
                      type="email"
                      placeholder="Email"
                      value={registerEmail}
                      onChange={(e) => setRegisterEmail(e.target.value)}
                      required
                      className="h-10 rounded-xl"
                    />
                    <Input
                      type={showRegisterPassword ? 'text' : 'password'}
                      placeholder="Password"
                      value={registerPassword}
                      onChange={(e) => setRegisterPassword(e.target.value)}
                      required
                      className="h-10 rounded-xl"
                      showPasswordToggle
                      isPasswordVisible={showRegisterPassword}
                      onTogglePassword={() => setShowRegisterPassword(!showRegisterPassword)}
                    />
                    <Input
                      type={showRegisterRepeatPassword ? 'text' : 'password'}
                      placeholder="Repeat Password"
                      value={registerRepeatPassword}
                      onChange={(e) => setRegisterRepeatPassword(e.target.value)}
                      required
                      className="h-10 rounded-xl"
                      showPasswordToggle
                      isPasswordVisible={showRegisterRepeatPassword}
                      onTogglePassword={() => setShowRegisterRepeatPassword(!showRegisterRepeatPassword)}
                    />

                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      className="mt-2 h-11 w-full rounded-xl text-sm font-bold shadow-md transition-all hover:shadow-lg"
                    >
                      {isSubmitting ? 'Creating account...' : 'Create Account'}
                      {!isSubmitting && <ArrowRight className="ml-2 h-4 w-4" />}
                    </Button>
                  </form>
                )}

                {/* Footer terms / switch */}
                <div className="mt-6 text-center text-xs text-muted-foreground">
                  {tab === 'login' ? (
                    <span>
                      Don&apos;t have an account?{' '}
                      <button
                        type="button"
                        onClick={() => {
                          setTab('register');
                          setRegisterErrors({});
                        }}
                        className="font-bold text-primary transition-colors hover:underline"
                      >
                        Register now
                      </button>
                    </span>
                  ) : (
                    <span>
                      Already have an account?{' '}
                      <button
                        type="button"
                        onClick={() => {
                          setTab('login');
                          setLoginErrors({});
                        }}
                        className="font-bold text-primary transition-colors hover:underline"
                      >
                        Log In
                      </button>
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Bottom spacer for balance */}
          <div className="hidden lg:block" />
        </div>
      </div>
    </Div100vh>
  );
}

export default Login;
