import { useRef, useState } from 'react';
import { useGlobal } from 'reactn';
import { toast } from 'react-toastify';
import {
  Pencil, Moon, Sun, KeyRound, ImageMinus, Shield, LogOut, PlusCircle,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import upload from '../../../actions/uploadImage';
import Config from '../../../config';
import changePicture from '../../../actions/changePicture';
import logoutAction from '../../../actions/logout';
import useTheme from '../../../lib/useTheme';
import Popup from './Popup';
import SessionsPopup from './SessionsPopup';

function Settings() {
  const navigate = useNavigate();
  const { theme, toggle: toggleTheme } = useTheme();

  const [user, setUser] = useGlobal('user');
  const setToken = useGlobal('token')[1];
  const setPanel = useGlobal('panel')[1];
  const [popup, showPopup] = useState(false);
  const [sessionsPopup, showSessionsPopup] = useState(false);

  const fileInput = useRef(null);

  const change = async (image) => {
    const picture = await upload(image, null, () => {}, 'square');
    await changePicture(picture.data.image._id);
    const newUser = { ...user, picture: picture.data.image };
    localStorage.setItem('user', JSON.stringify(newUser));
    await setUser(newUser);
  };

  const remove = async () => {
    await changePicture();
    const newUser = { ...user, picture: undefined };
    localStorage.setItem('user', JSON.stringify(newUser));
    await setUser(newUser);
  };

  const logout = async () => {
    const { username } = user;
    logoutAction().catch(() => {});
    localStorage.removeItem('token');
    await setToken(null);
    await setUser({});
    toast.success(`User ${username} logged out!`);
    navigate('/login', { replace: true });
  };

  const initials = `${(user.firstName || 'U').charAt(0)}${(user.lastName || '').charAt(0)}`.toUpperCase();

  return (
    <div className="flex flex-col gap-3 p-4">
      <input
        className="hidden"
        type="file"
        ref={fileInput}
        accept="image/*"
        onChange={(e) => change(e.target.files[0])}
      />

      {/* Profile Picture & Hover edit */}
      <div
        className="group relative mx-auto my-2 h-[120px] w-[120px] cursor-pointer"
        onClick={() => fileInput?.current?.click()}
      >
        {user.picture ? (
          <img
            src={`${Config.url || ''}/api/images/${user.picture.shieldedID}/256`}
            alt="Picture"
            className="h-[120px] w-[120px] rounded-full object-cover border border-white/10"
          />
        ) : (
          <div className="flex h-[120px] w-[120px] items-center justify-center rounded-full bg-gradient-to-br from-primary/80 to-rose-700 text-3xl font-extrabold text-white border border-white/10 shadow-lg">
            {initials}
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100">
          <Pencil className="h-6 w-6" />
        </div>
      </div>

      <div className="text-center mb-1">
        <h3 className="text-base font-bold text-foreground">
          {user.firstName}
          {' '}
          {user.lastName}
        </h3>
        <p className="text-xs text-muted-foreground">{`@${user.username || 'user'}`}</p>
      </div>

      {/* Theme Toggle Button */}
      <Button
        variant="outline"
        className="w-full justify-between rounded-xl border border-border bg-card/40 text-xs font-semibold hover:bg-muted"
        onClick={toggleTheme}
      >
        <span className="flex items-center gap-2">
          {theme === 'dark' ? <Moon className="h-4 w-4 text-primary" /> : <Sun className="h-4 w-4 text-primary" />}
          <span>Appearance</span>
        </span>
        <span className="text-xs font-normal text-muted-foreground capitalize">
          {theme === 'dark' ? 'Dark mode' : 'Light mode'}
        </span>
      </Button>

      {/* Settings Actions */}
      <Button
        variant="outline"
        className="w-full justify-start gap-2.5 rounded-xl border border-border bg-card/40 text-xs font-semibold hover:bg-muted"
        onClick={() => showPopup(true)}
      >
        <KeyRound className="h-4 w-4 text-muted-foreground" />
        Change Password
      </Button>

      <Button
        variant="outline"
        className="w-full justify-start gap-2.5 rounded-xl border border-border bg-card/40 text-xs font-semibold hover:bg-muted"
        onClick={remove}
      >
        <ImageMinus className="h-4 w-4 text-muted-foreground" />
        Remove Profile Picture
      </Button>

      <Button
        variant="outline"
        className="w-full justify-start gap-2.5 rounded-xl border border-border bg-card/40 text-xs font-semibold hover:bg-muted"
        onClick={() => showSessionsPopup(true)}
      >
        <Shield className="h-4 w-4 text-muted-foreground" />
        Manage Active Sessions
      </Button>

      <Button
        variant="outline"
        className="w-full justify-start gap-2.5 rounded-xl border border-destructive/20 text-xs font-semibold text-destructive hover:bg-destructive/10"
        onClick={logout}
      >
        <LogOut className="h-4 w-4 text-destructive" />
        Log Out
      </Button>

      <Button
        className="mt-2 w-full gap-2 rounded-xl bg-primary text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
        onClick={() => setPanel('createGroup')}
      >
        <PlusCircle className="h-4 w-4" />
        Create New Group
      </Button>

      {popup && (
        <Popup
          onClose={() => {
            showPopup(false);
          }}
        />
      )}
      {sessionsPopup && <SessionsPopup onClose={() => showSessionsPopup(false)} />}
    </div>
  );
}

export default Settings;
