import { useState } from 'react';
import Div100vh from 'react-div-100vh';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { ArrowLeft, ArrowRight, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Input from '../Login/components/Input';
import sendCode from '../../actions/sendCode';
import changePassword from '../../actions/changePassword';
import BrandLogo from '../../components/BrandLogo';
import ZephWordmark from '../../components/ZephWordmark';

// Same dark-hero / centered-card layout as Login/index.jsx — this page
// previously used a full-bleed background photo (assets/background.jpg)
// that was deleted from the repo before this rebuild, which crashed Vite's
// import resolution outright. Rather than restore a missing binary asset,
// migrating to the shared layout both fixes the crash and brings this page
// in line with CLAUDE.md's sitewide-consistency rule ("Do NOT make only
// the chat page polished... applies to authentication").
function ForgotPassword() {
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [codeErrors, setCodeErrors] = useState({});
  const [changeErrors, setChangeErrors] = useState({});
  const [sent, setSent] = useState(false);

  const onCode = async (e) => {
    e.preventDefault();
    try {
      await sendCode(email);
      setSent(true);
    } catch (err) {
      let errors = {};
      if (!err.response || typeof err.response.data !== 'object') errors.generic = 'Could not connect to server.';
      else errors = err.response.data;
      setCodeErrors(errors);
    }
  };

  const onChange = async (e) => {
    e.preventDefault();
    try {
      await changePassword(email, authCode, password);
      navigate('/login', { replace: true });
      setSent(false);
      toast.success('Password changed! You may now sign in.');
    } catch (err) {
      let errors = {};
      if (!err.response || typeof err.response.data !== 'object') errors.generic = 'Could not connect to server.';
      else errors = err.response.data;
      setChangeErrors(errors);
    }
  };

  const codeInfo = Object.keys(codeErrors)
    .filter((key) => codeErrors[key] !== 'error')
    .map((key) => (
      <div className="text-center text-sm font-medium text-destructive" key={key}>
        {codeErrors[key]}
      </div>
    ));

  const changeInfo = Object.keys(changeErrors)
    .filter((key) => changeErrors[key] !== 'error')
    .map((key) => (
      <div className="text-center text-sm font-medium text-destructive" key={key}>
        {changeErrors[key]}
      </div>
    ));

  return (
    <Div100vh>
      <div className="flex h-full w-full overflow-y-auto bg-background text-foreground lg:overflow-hidden">
        {/* Left Side: Dark Hero Panel — same treatment as Login */}
        <div className="relative hidden w-[45%] max-w-[560px] min-w-[380px] shrink-0 flex-col justify-between overflow-hidden bg-[#070708] p-10 text-white lg:flex xl:p-14">
          <div>
            <Link to="/login" className="flex items-center gap-3">
              <BrandLogo className="h-8 w-8" />
              <ZephWordmark className="text-2xl font-extrabold tracking-tight text-white" />
            </Link>

            <h1 className="mt-14 text-4xl font-extrabold leading-[1.15] tracking-tight xl:text-[42px]">
              Reset your
              <br />
              <span className="text-primary">password.</span>
            </h1>
            <p className="mt-4 max-w-[340px] text-sm leading-relaxed text-zinc-400">
              Enter your email to receive a verification code, then choose a new password to get back into your
              account.
            </p>
          </div>

          <div className="flex items-center gap-1 text-xs text-zinc-500 z-10">
            <span>{`© ${new Date().getFullYear()}`}</span>
            <ZephWordmark className="text-xs font-semibold text-zinc-400" />
          </div>

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

        {/* Right Side: Form Panel */}
        <div className="relative flex flex-1 flex-col justify-between overflow-y-auto px-6 py-6 sm:px-10 sm:py-8 lg:px-12 xl:px-16">
          <div className="flex w-full items-center justify-between lg:hidden">
            <Link to="/login" className="flex items-center gap-2">
              <BrandLogo className="h-7 w-7" />
              <ZephWordmark className="text-lg font-extrabold tracking-tight" />
            </Link>
          </div>

          <div className="mx-auto my-auto w-full max-w-[420px] py-4">
            <div className="mb-6 flex flex-col items-center text-center">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <KeyRound className="h-6 w-6" />
              </div>
              <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
                {sent ? 'Enter your code' : 'Forgot password?'}
              </h2>
              <p className="mt-1.5 text-xs text-muted-foreground sm:text-sm">
                {sent
                  ? "We sent a verification code to your email — enter it below with your new password."
                  : "No worries, we'll send a code to reset it."}
              </p>
            </div>

            {!sent ? (
              <form onSubmit={onCode} className="flex flex-col gap-4">
                {codeInfo}
                <Input
                  id="forgot-email"
                  placeholder="Email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <Button
                  type="submit"
                  size="lg"
                  className="mt-1 h-11 w-full gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-[0.99]"
                >
                  Send Code
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </form>
            ) : (
              <form onSubmit={onChange} className="flex flex-col gap-4">
                {changeInfo}
                <Input
                  id="forgot-code"
                  placeholder="Verification code"
                  type="text"
                  value={authCode}
                  onChange={(e) => setAuthCode(e.target.value)}
                />
                <Input
                  id="forgot-new-password"
                  placeholder="New password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  isPassword
                  showPassword={showPassword}
                  onTogglePassword={() => setShowPassword((prev) => !prev)}
                />
                <Button
                  type="submit"
                  size="lg"
                  className="mt-1 h-11 w-full gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-[0.99]"
                >
                  Change Password
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </form>
            )}

            <div className="mt-6 text-center text-xs sm:text-sm text-muted-foreground">
              <Link to="/login" className="inline-flex items-center gap-1 font-bold text-primary transition-colors hover:underline">
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to Log In
              </Link>
            </div>
          </div>

          <div className="hidden lg:block h-6" aria-hidden="true" />
        </div>
      </div>
    </Div100vh>
  );
}

export default ForgotPassword;
