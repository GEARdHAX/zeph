import {
  MoreHorizontal, Settings, Home, PlusCircle, Cpu,
} from 'lucide-react';
import { useGlobal } from 'reactn';
import { useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useSelector } from 'react-redux';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import getMeetingRoom from '../../../actions/getMeetingRoom';
import logout from '../../../actions/logout';
import Picture from '../../../components/Picture';

const STATUS_COLOR = {
  online: 'bg-emerald-500',
  away: 'bg-orange-500',
  busy: 'bg-destructive',
};

function TopBar() {
  const onlineUsers = useSelector((state) => state.io.onlineUsers);
  const io = useSelector((state) => state.io.io);
  const [nav, setNav] = useGlobal('nav');
  const setToken = useGlobal('token')[1];
  const setPanel = useGlobal('panel')[1];
  const setOver = useGlobal('over')[1];
  const [user, setUser] = useGlobal('user');
  const setAudio = useGlobal('audio')[1];
  const setVideo = useGlobal('video')[1];
  const setCallDirection = useGlobal('callDirection')[1];

  const navigate = useNavigate();
  const location = useLocation();

  const onLogout = async () => {
    const { username } = user;
    // Revoke the session server-side so the token can't be replayed after logout —
    // fire-and-forget: local state is cleared regardless of whether this succeeds.
    logout().catch(() => {});
    io.disconnect();
    localStorage.removeItem('token');
    await setToken(null);
    await setUser({});
    toast.success(`User ${username} logged out!`);
    navigate('/login', { replace: true });
  };

  const errorToast = (content) => toast.error(content);

  const newMeeting = async () => {
    await setAudio(true);
    await setVideo(true);
    await setCallDirection('meeting');
    try {
      const res = await getMeetingRoom();
      navigate(`/meeting/${res.data._id}`, { replace: true });
    } catch (e) {
      errorToast('Server error. Unable to initiate call.');
    }
  };

  const getStatus = () => {
    if (onlineUsers.filter((u) => u.id === user.id && u.status === 'busy').length > 0) return 'busy';
    if (onlineUsers.filter((u) => u.id === user.id && u.status === 'online').length > 0) return 'online';
    if (onlineUsers.filter((u) => u.id === user.id && u.status === 'away').length > 0) return 'away';
    return null;
  };

  const isAdmin = user.level === 'root' || user.level === 'admin';

  return (
    <div className="flex h-[54px] w-full items-center justify-between border-b bg-card">
      <div className="flex items-center">
        <button
          type="button"
          className="relative mx-3 h-10 w-10 shrink-0 cursor-pointer overflow-hidden rounded-full [&_.img]:flex [&_.img]:h-10 [&_.img]:w-10 [&_.img]:items-center [&_.img]:justify-center [&_.img]:bg-secondary [&_.img]:text-lg [&_.img]:text-secondary-foreground"
          onClick={() => {
            setOver(true);
            setNav('rooms');
            navigate('/', { replace: true });
          }}
        >
          <Picture user={user || {}} />
        </button>
        {getStatus() && (
          <span className={cn('-ml-8 h-2.5 w-2.5 rounded-full border-2 border-card', STATUS_COLOR[getStatus()])} />
        )}
      </div>
      <div className="flex items-center pr-2">
        {isAdmin && (
          <Button
            variant="ghost"
            size="icon"
            className={location.pathname.startsWith('/admin') ? 'text-blue-700' : ''}
            onClick={() => {
              setOver(true);
              navigate('/admin', { replace: true });
            }}
          >
            <Cpu />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="sm:hidden"
          onClick={() => {
            setOver(true);
            navigate('/', { replace: true });
          }}
        >
          <Home />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => setPanel('createGroup')}>
          <PlusCircle />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={nav === 'settings' ? 'text-blue-700' : ''}
          onClick={() => setNav('settings')}
        >
          <Settings />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={newMeeting}>New Meeting</DropdownMenuItem>
            {isAdmin && <DropdownMenuSeparator />}
            {isAdmin && (
              <DropdownMenuItem
                onClick={() => {
                  setOver(true);
                  navigate('/admin', { replace: true });
                }}
              >
                Admin Panel
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onLogout}>Logout</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export default TopBar;
