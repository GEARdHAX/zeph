import { useEffect, useState, useRef } from 'react';
import {
  Phone, Video, ArrowLeft, MoreHorizontal, Star, Info, Sparkles,
} from 'lucide-react';
import { useGlobal } from 'reactn';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import moment from 'moment';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import Picture from '../../../components/Picture';
import toggleFavorite from '../../../actions/toggleFavorite';
import getMeetingRoom from '../../../actions/getMeetingRoom';
import postCall from '../../../actions/postCall';
import summarizeConversation from '../../../actions/summarizeConversation';
import Actions from '../../../constants/Actions';

const STATUS_COLOR = {
  online: 'bg-emerald-500',
  away: 'bg-orange-500',
  busy: 'bg-destructive',
};

function TopBar({ back, loading, aiEnabled }) {
  const onlineUsers = useSelector((state) => state.io.onlineUsers);
  const room = useSelector((state) => state.io.room) || {};
  const user = useGlobal('user')[0];
  const [summary, setSummary] = useState(null);
  const [summarizing, setSummarizing] = useState(false);
  const [favorites, setFavorites] = useGlobal('favorites');
  const setNav = useGlobal('nav')[1];
  const setAudio = useGlobal('audio')[1];
  const setVideo = useGlobal('video')[1];
  const setCallDirection = useGlobal('callDirection')[1];
  const setMeeting = useGlobal('meeting')[1];

  const dispatch = useDispatch();
  const navigate = useNavigate();

  let other = {};

  if (room.people) {
    room.people.forEach((person) => {
      if (user.id !== person._id) other = person;
    });
  }

  if (!other.firstName) {
    other = { ...other, firstName: 'Deleted', lastName: 'User' };
  }

  const title = (room.isGroup ? room.title : `${other.firstName} ${other.lastName}`).substr(0, 22);

  const warningToast = (content) => toast.warn(content);
  const errorToast = (content) => toast.error(content);

  const call = async (isVideo) => {
    if (onlineUsers.filter((u) => u.id === other._id).length === 0 && !room.isGroup) {
      warningToast("Can't call user because user is offline");
      return;
    }
    await setAudio(true);
    await setVideo(isVideo);
    await setCallDirection('outgoing');
    dispatch({ type: Actions.RTC_SET_COUNTERPART, counterpart: other });
    try {
      const res = await getMeetingRoom({
        startedAsCall: true,
        caller: user.id,
        callee: other._id,
        callToGroup: room.isGroup,
        group: room._id,
      });
      await setMeeting(res.data);
      navigate(`/meeting/${res.data._id}`, { replace: true });
      await postCall({ roomID: room._id, meetingID: res.data._id });
    } catch (e) {
      errorToast('Server error. Unable to initiate call.');
    }
  };

  const favorite = async () => {
    const res = await toggleFavorite(room._id);
    setNav('favorites');
    setFavorites(res.data.favorites);
  };

  const isFavorite = () => favorites.some((fav) => fav._id === room._id);

  const roomInfo = () => {
    navigate(`/room/${room._id}/info`, { replace: true });
  };

  const summarize = async () => {
    setSummarizing(true);
    try {
      const res = await summarizeConversation(room._id);
      setSummary(res.data.summary);
    } catch (e) {
      errorToast('Could not summarize this conversation.');
    } finally {
      setSummarizing(false);
    }
  };

  function Online({ other: peer }) {
    const statusUsers = useSelector((state) => state.io.onlineUsers);
    const prevStatusRef = useRef(false);
    const [lastOnline, setLastOnline] = useState(null);

    useEffect(() => {
      if (prevStatusRef.current && statusUsers.filter((u) => u.id === peer._id).length === 0) {
        setLastOnline(moment().valueOf());
      }
      prevStatusRef.current = statusUsers.filter((u) => u.id === peer._id).length > 0;
    }, [statusUsers, peer]);

    if (statusUsers.filter((u) => u.id === peer._id && u.status === 'busy').length > 0) return 'busy';
    if (statusUsers.filter((u) => u.id === peer._id && u.status === 'online').length > 0) return 'online';
    if (statusUsers.filter((u) => u.id === peer._id && u.status === 'away').length > 0) return 'away';
    if (lastOnline) return `Last online: ${moment(lastOnline).fromNow()}`;
    return `Last online: ${peer.lastOnline ? moment(peer.lastOnline).fromNow() : 'Never'}`;
  }

  const getStatus = () => {
    if (room.isGroup) return null;
    if (onlineUsers.filter((u) => u.id === other._id && u.status === 'busy').length > 0) return 'busy';
    if (onlineUsers.filter((u) => u.id === other._id && u.status === 'online').length > 0) return 'online';
    if (onlineUsers.filter((u) => u.id === other._id && u.status === 'away').length > 0) return 'away';
    return null;
  };

  return (
    <div className="flex min-h-[54px] max-h-[54px] w-full items-center justify-between border-b bg-card">
      <div className="flex items-center">
        <Button variant="ghost" size="icon" className="sm:hidden" onClick={back}>
          <ArrowLeft />
        </Button>
        {!loading && (
          <div className="flex items-center">
            <div className="relative ml-1 mr-3 h-10 w-10 shrink-0 overflow-hidden rounded-full [&_.img]:flex [&_.img]:h-10 [&_.img]:w-10 [&_.img]:items-center [&_.img]:justify-center [&_.img]:bg-secondary [&_.img]:text-lg [&_.img]:text-secondary-foreground">
              <Picture user={other} group={room.isGroup} picture={room.picture} title={room.title} />
            </div>
            {getStatus() && (
              <span
                className={cn(
                  '-ml-8 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-card',
                  STATUS_COLOR[getStatus()],
                )}
              />
            )}
          </div>
        )}
        {!loading && (
          <div className="flex flex-col justify-center">
            <div className="text-[13px] font-bold">
              {title}
              {title.length > 22 && '...'}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {room.isGroup ? `Group: ${room.people.length} members` : <Online other={other} />}
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center px-2">
        <Button variant="ghost" size="icon" onClick={() => call(true)}>
          <Video />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => call(false)}>
          <Phone />
        </Button>
        <Button variant="ghost" size="icon" className={isFavorite() ? 'text-blue-700' : ''} onClick={favorite}>
          <Star />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {aiEnabled && (
              <DropdownMenuItem onClick={summarize} disabled={summarizing}>
                {summarizing ? 'Summarizing…' : 'Summarize conversation'}
                <Sparkles className="ml-auto h-4 w-4" />
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={roomInfo}>
              Room Info
              <Info className="ml-auto h-4 w-4" />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Dialog open={!!summary} onOpenChange={(next) => !next && setSummary(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conversation summary</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{summary}</p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default TopBar;
