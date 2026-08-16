import { useEffect, useState } from 'react';
import { useGlobal } from 'reactn';
import { Link, useNavigate } from 'react-router-dom';
import jwtDecode from 'jwt-decode';
import { useDispatch } from 'react-redux';
import Div100vh from 'react-div-100vh';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/components/ui/tabs';
import Credits from './components/Credits';
import Logo from './components/Logo';
import Input from './components/Input';
import login from '../../actions/login';
import register from '../../actions/register';
import setAuthToken from '../../actions/setAuthToken';
import initIO from '../../actions/initIO';
import getInfo from '../../actions/getInfo';
import backgroundImage from '../../assets/background.jpg';

function Login() {
  const dispatch = useDispatch();
  const [info, setInfo] = useState({});
  const [tab, setTab] = useState('login');
  const [showCredits, setShowCredits] = useState(false);

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
    } catch (err) {
      let errors = {};
      if (!err.response || typeof err.response.data !== 'object') errors.generic = 'Could not connect to server.';
      else errors = err.response.data;
      setRegisterErrors(errors);
    }
  };

  const loginInfo = Object.keys(loginErrors).map((key) => (
    <div className="text-center text-sm text-destructive" key={key}>
      {loginErrors[key]}
    </div>
  ));

  const registerInfo = Object.keys(registerErrors).map((key) => (
    <div className="text-center text-sm text-destructive" key={key}>
      {registerErrors[key]}
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
                <Tabs value={tab} onValueChange={setTab}>
                  <TabsList className="mb-2 w-full">
                    <TabsTrigger value="login" className="flex-1">
                      Log In
                    </TabsTrigger>
                    <TabsTrigger value="register" className="flex-1">
                      Register
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="login">
                    <form onSubmit={onLogin} className="flex flex-col gap-2">
                      {loginInfo}
                      <Input
                        icon="user"
                        placeholder="Username (or email)"
                        type="text"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                      <Input
                        icon="lock"
                        placeholder="Password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                      <Label className="my-1 gap-2 text-white">
                        <Checkbox checked={keep} onCheckedChange={(checked) => setKeep(checked === true)} />
                        Keep me logged in
                      </Label>
                      <Button type="submit" className="w-full rounded-full">
                        LOG IN
                      </Button>
                      {info.nodemailerEnabled && (
                        <div className="mt-2 text-center text-sm">
                          <Link to="/forgot-password" className="underline">
                            Forgot your password?
                          </Link>
                        </div>
                      )}
                    </form>
                  </TabsContent>

                  <TabsContent value="register">
                    <form onSubmit={onRegister} className="flex flex-col gap-2">
                      {registerInfo}
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
                      <Button type="submit" className="w-full rounded-full">
                        REGISTER
                      </Button>
                    </form>
                  </TabsContent>
                </Tabs>
              </div>
            )}

            {showCredits && (
              <div className="w-full text-center text-sm text-foreground">
                {'The default background image is from '}
                <a href="https://picsum.photos/" target="_blank" rel="noopener noreferrer" className="underline">
                  Picsum Photos
                </a>
                <br />
                <br />
                A big thank you to all contributors to React, Redux, Socket.IO, Emoji Mart, Axios, SASS and Moment
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

export default Login;
