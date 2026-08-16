import { useRef, useState } from 'react';
import { useGlobal } from 'reactn';
import { toast } from 'react-toastify';
import { Pencil } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import upload from '../../../actions/uploadImage';
import Config from '../../../config';
import changePicture from '../../../actions/changePicture';
import logoutAction from '../../../actions/logout';
import Popup from './Popup';
import SessionsPopup from './SessionsPopup';

function Settings() {
  const navigate = useNavigate();

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

  function Picture() {
    if (user.picture) {
      return (
        <img
          src={`${Config.url || ''}/api/images/${user.picture.shieldedID}/256`}
          alt="Picture"
          className="h-[150px] w-[150px] rounded-full object-cover"
        />
      );
    }
    return (
      <div className="flex h-[150px] w-[150px] items-center justify-center rounded-full bg-secondary text-5xl text-secondary-foreground">
        {user.firstName.substr(0, 1)}
        {user.lastName.substr(0, 1)}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      <input
        className="hidden"
        type="file"
        ref={fileInput}
        accept="image/*"
        onChange={(e) => change(e.target.files[0])}
      />
      <div
        className="group relative left-1/2 mb-2 w-[150px] -translate-x-1/2 cursor-pointer"
        onClick={() => fileInput && fileInput.current && fileInput.current.click()}
      >
        <Picture />
        <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/0 text-white opacity-0 transition-opacity group-hover:bg-black/70 group-hover:opacity-100">
          <Pencil className="h-8 w-8" />
        </div>
      </div>
      <Button variant="secondary" onClick={() => showPopup(true)}>
        Change Password
      </Button>
      <Button variant="secondary" onClick={remove}>
        Remove Picture
      </Button>
      <Button variant="secondary" onClick={() => showSessionsPopup(true)}>
        Manage Sessions
      </Button>
      <Button variant="secondary" onClick={logout}>
        Logout
      </Button>
      <Button size="lg" className="mt-2" onClick={() => setPanel('createGroup')}>
        Create Group
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
