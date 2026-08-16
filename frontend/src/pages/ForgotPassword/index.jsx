import { useState } from 'react';
import Div100vh from 'react-div-100vh';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Credits from './components/Credits';
import Logo from './components/Logo';
import Input from './components/Input';
import sendCode from '../../actions/sendCode';
import changePassword from '../../actions/changePassword';
import backgroundImage from '../../assets/background.jpg';

function ForgotPassword() {
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [password, setPassword] = useState('');
  const [codeErrors, setCodeErrors] = useState({});
  const [changeErrors, setChangeErrors] = useState({});
  const [sent, setSent] = useState(false);
  const [showCredits, setShowCredits] = useState(false);

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
      <div className="text-center text-sm text-destructive" key={key}>
        {codeErrors[key]}
      </div>
    ));

  const changeInfo = Object.keys(changeErrors)
    .filter((key) => changeErrors[key] !== 'error')
    .map((key) => (
      <div className="text-center text-sm text-destructive" key={key}>
        {changeErrors[key]}
      </div>
    ));

  const loginStyle = {
    backgroundImage: `url('${backgroundImage}')`,
  };

  return (
    <Div100vh>
      <div
        className="relative flex h-full w-screen items-center justify-center overflow-hidden bg-cover bg-center text-white"
        style={loginStyle}
      >
        <div className="absolute inset-0 bg-[rgba(0,71,171,0.54)]" />
        <div className="relative z-10 flex h-full w-full items-center justify-center overflow-y-auto">
          <Credits onShowCredits={() => setShowCredits(true)} />

          <div className="flex min-h-[420px] w-[400px] max-w-full flex-col items-center justify-center p-2">
            <Logo />

            {!showCredits && (
              <div className="w-full text-foreground">
                {!sent && (
                  <form onSubmit={onCode} className="flex flex-col gap-2">
                    {codeInfo}
                    <Input
                      icon="mail"
                      placeholder="Email"
                      type="text"
                      onChange={(e) => setEmail(e.target.value)}
                      value={email}
                    />
                    <Button type="submit" className="w-full rounded-full">
                      SEND CODE
                    </Button>
                  </form>
                )}

                {sent && (
                  <form onSubmit={onChange} className="flex flex-col gap-2">
                    {changeInfo}
                    <Input
                      icon="lock"
                      placeholder="Auth Code"
                      type="text"
                      onChange={(e) => setAuthCode(e.target.value)}
                      value={authCode}
                    />
                    <Input
                      icon="lock"
                      placeholder="New Password"
                      type="password"
                      onChange={(e) => setPassword(e.target.value)}
                      value={password}
                    />
                    <Button type="submit" className="w-full rounded-full">
                      CHANGE PASSWORD
                    </Button>
                  </form>
                )}

                <div className="mt-2 text-center text-sm">
                  <Link to="/login" className="underline">
                    Back to Login
                  </Link>
                </div>
              </div>
            )}

            {showCredits && (
              <div className="w-full text-center text-sm text-foreground">
                {'The default background image is from '}
                <a href="https://picsum.photos/" target="_blank" rel="noopener noreferrer" className="underline">
                  Picsum Photos
                </a>
                <br />
                <br />A big thank you to all contributors to React, Redux, Socket.IO, Emoji Mart, Axios, SASS and Moment
                <div className="mt-4">
                  <Button variant="ghost" size="sm" onClick={() => setShowCredits(false)}>
                    <ArrowLeft className="mr-1 h-4 w-4" />
                    Close Credits
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Div100vh>
  );
}

export default ForgotPassword;
