import { useEffect, useState, useRef } from 'react';
import {
  Phone, Video, ArrowLeft, MoreHorizontal, Star, Info, Sparkles,
  Search, BellOff, Lock, Trash2, Ban, Flag, UserCheck,
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
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import toggleFavorite from '../../../actions/toggleFavorite';
import getMeetingRoom from '../../../actions/getMeetingRoom';
import postCall from '../../../actions/postCall';
import summarizeConversation from '../../../actions/summarizeConversation';
import hideConversation from '../../../actions/hideConversation';
import deleteConversation from '../../../actions/deleteConversation';
import setupVaultPin from '../../../actions/setupVaultPin';
import getVaultStatus from '../../../actions/getVaultStatus';
import blockUser from '../../../actions/blockUser';
import unblockUser from '../../../actions/unblockUser';
import Actions from '../../../constants/Actions';
import Config from '../../../config';

const STATUS_COLOR = {
  online: 'bg-emerald-500',
  away: 'bg-orange-500',
  busy: 'bg-destructive',
};

function TopBar({ back, loading, aiEnabled }) {
  const onlineUsers = useSelector((state) => state.io.onlineUsers) || [];
  const room = useSelector((state) => state.io.room) || {};
  const user = useGlobal('user')[0] || {};
  const [summary, setSummary] = useState(null);
  const [summarizing, setSummarizing] = useState(false);
  const [favorites, setFavorites] = useGlobal('favorites');
  const [showDetails, setShowDetails] = useGlobal('showDetails');
  const setNav = useGlobal('nav')[1];
  const setAudio = useGlobal('audio')[1];
  const setVideo = useGlobal('video')[1];
  const setCallDirection = useGlobal('callDirection')[1];
  const setMeeting = useGlobal('meeting')[1];
  const [confirmDeleteDM, setConfirmDeleteDM] = useState(false);
  const [confirmHideDM, setConfirmHideDM] = useState(false);
  const [needsVaultSetup, setNeedsVaultSetup] = useState(false);
  const [setupPin, setSetupPin] = useState('');
  const [vaultBusy, setVaultBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [menuOpen]);

  const dispatch = useDispatch();
  const navigate = useNavigate();

  let other = {};

  if (room.people) {
    room.people.forEach((person) => {
      if (user.id !== person._id) other = person;
    });
  }

  // "Deleted User" only when the other participant genuinely couldn't be
  // resolved at all (see Panel/Room.jsx for the same fix/reasoning) — a
  // real account with no firstName/lastName set falls back to @username
  // instead of being mislabeled as deleted.
  if (!other._id) {
    other = { ...other, firstName: 'Deleted', lastName: 'User' };
  } else if (!other.firstName && !other.lastName) {
    other = { ...other, firstName: `@${other.username || 'user'}`, lastName: '' };
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
      // The pre-flight onlineUsers check above is UX-only ("their app isn't
      // connected right now") — this is the REAL, server-enforced
      // authorization gate (meeting/call.js), so a rejection here means the
      // account is genuinely unavailable/blocked, not just offline.
      const reason = e.response?.data?.reason;
      if (reason === 'recipient_unavailable') errorToast("This person's account is no longer available.");
      else if (reason === 'blocked') errorToast("You can't call this person.");
      else errorToast('Server error. Unable to initiate call.');
    }
  };

  const favorite = async () => {
    const res = await toggleFavorite(room._id);
    setNav('favorites');
    setFavorites(res.data.favorites);
  };

  const isFavorite = () => (favorites || []).some((fav) => fav._id === room._id);

  const toggleDetails = () => {
    setShowDetails(!showDetails);
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

  const doHide = async () => {
    setVaultBusy(true);
    try {
      await hideConversation(room._id);
      setConfirmHideDM(false);
      toast.success('Conversation moved to your Private Vault.');
      navigate('/', { replace: true });
    } catch (e) {
      errorToast('Could not hide this conversation. Please try again.');
    } finally {
      setVaultBusy(false);
    }
  };

  // "Hide / Lock DM" first checks whether this account has a vault secret
  // configured at all — if not, the user sets one up right here (lazy,
  // first-use setup, per the product decision) before the hide itself runs.
  const startHideFlow = async () => {
    try {
      const status = await getVaultStatus();
      if (!status.data.configured) {
        setNeedsVaultSetup(true);
        setConfirmHideDM(true);
        return;
      }
    } catch (e) {
      // fall through to the normal confirm dialog — worst case the hide
      // call itself fails and surfaces its own error
    }
    setNeedsVaultSetup(false);
    setConfirmHideDM(true);
  };

  const confirmSetupThenHide = async () => {
    if (setupPin.length < 4) {
      errorToast('Choose a PIN with at least 4 digits.');
      return;
    }
    setVaultBusy(true);
    try {
      await setupVaultPin(setupPin);
      setSetupPin('');
      await doHide();
    } catch (e) {
      errorToast('Could not set up your vault PIN. Please try again.');
    } finally {
      setVaultBusy(false);
    }
  };

  const handleDeleteDM = async () => {
    setVaultBusy(true);
    try {
      await deleteConversation(room._id);
      setConfirmDeleteDM(false);
      toast.success('Conversation deleted.');
      navigate('/', { replace: true });
    } catch (e) {
      errorToast('Could not delete this conversation. Please try again.');
    } finally {
      setVaultBusy(false);
    }
  };

  const handleBlock = async () => {
    if (!other.username) return;
    try {
      await blockUser(other.username);
      toast.success(`Blocked ${other.firstName}.`);
      navigate('/', { replace: true });
    } catch (e) {
      errorToast('Could not block this user. Please try again.');
    }
  };

  const handleUnblock = async () => {
    if (!other.username) return;
    try {
      await unblockUser(other.username);
      toast.success(`Unblocked ${other.firstName}.`);
      dispatch({
        type: Actions.SET_ROOM,
        room: {
          ...room,
          people: room.people.map((person) => (person._id === other._id
            ? { ...person, blockedByMe: false, blockedMe: false }
            : person)),
        },
      });
    } catch (e) {
      errorToast('Could not unblock this user. Please try again.');
    }
  };

  function Online({ other: peer }) {
    const statusUsers = useSelector((state) => state.io.onlineUsers) || [];
    const typing = useSelector((state) => state.messages.typing);
    const prevStatusRef = useRef(false);
    const [lastOnline, setLastOnline] = useState(null);

    useEffect(() => {
      if (prevStatusRef.current && statusUsers.filter((u) => u.id === peer._id).length === 0) {
        setLastOnline(moment().valueOf());
      }
      prevStatusRef.current = statusUsers.filter((u) => u.id === peer._id).length > 0;
    }, [statusUsers, peer]);

    if (typing) {
      return (
        <span className="inline-flex items-center gap-1 font-medium text-primary animate-pulse">
          typing...
        </span>
      );
    }

    // A blocked relationship (either direction) means presence.js already
    // withholds real presence for this pair server-side — showing "Last
    // online: ..." here would just be stale/misleading, not actually hidden.
    if (peer.blockedByMe) return 'Blocked';
    if (peer.blockedMe) return "Can't see activity";

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

  const initials = (room.isGroup
    ? (room.title || 'G').charAt(0)
    : `${(other.firstName || 'U').charAt(0)}${(other.lastName || '').charAt(0)}`
  ).toUpperCase();

  return (
    <div className="relative z-50 flex min-h-[60px] max-h-[60px] w-full items-center justify-between border-b border-border/60 bg-card px-4 text-card-foreground">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="sm:hidden h-8 w-8 text-muted-foreground" onClick={back}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        {!loading && (
          <button
            type="button"
            onClick={toggleDetails}
            className="flex items-center gap-3 text-left rounded-xl p-1 -m-1 hover:bg-muted/50 transition-colors cursor-pointer group"
            title="Click to view contact info"
          >
            <div className="relative shrink-0">
              <Avatar className="h-10 w-10 border border-border bg-gradient-to-br from-rose-600 to-primary text-white font-bold group-hover:scale-105 transition-transform">
                {other.picture && (
                  <img
                    src={`${Config.url || ''}/api/images/${other.picture.shieldedID}/256`}
                    alt=""
                    className="aspect-square size-full object-cover"
                  />
                )}
                <AvatarFallback className="bg-transparent text-xs font-bold text-white">
                  {initials}
                </AvatarFallback>
              </Avatar>
              {getStatus() && (
                <span
                  className={cn(
                    'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-card',
                    STATUS_COLOR[getStatus()],
                  )}
                />
              )}
            </div>
            <div className="flex flex-col justify-center">
              <div className="text-xs font-bold text-foreground truncate max-w-[200px] sm:max-w-[300px] group-hover:text-primary transition-colors">
                {title}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {room.isGroup ? `Group · ${room.people?.length || 0} members` : <Online other={other} />}
              </div>
            </div>
          </button>
        )}
      </div>

      <div className="flex items-center gap-1 text-muted-foreground">
        <Button variant="ghost" size="icon" className="h-8 w-8 hover:text-foreground" onClick={() => call(true)} title="Video Call">
          <Video className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 hover:text-foreground" onClick={() => call(false)} title="Audio Call">
          <Phone className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-8 w-8 hover:text-foreground', isFavorite() && 'text-primary fill-primary hover:text-primary')}
          onClick={favorite}
          title="Toggle Favorite"
        >
          <Star className={cn('h-4 w-4', isFavorite() && 'fill-current')} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-8 w-8 hover:text-foreground', showDetails && 'bg-muted text-primary')}
          onClick={toggleDetails}
          title="Contact Info"
        >
          <Info className="h-4 w-4" />
        </Button>

        <div className="relative" ref={menuRef}>
          <Button
            variant="ghost"
            size="icon"
            className={cn('h-8 w-8 hover:text-foreground cursor-pointer', menuOpen && 'bg-muted text-primary')}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenuOpen(!menuOpen);
            }}
            title="More options"
            aria-label="More options"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>

          {menuOpen && (
            <div className="absolute right-0 top-10 z-50 min-w-[180px] rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl animate-in fade-in-0 zoom-in-95">
              <button
                type="button"
                disabled
                data-disabled
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-muted-foreground opacity-50 cursor-not-allowed"
              >
                <Search className="h-3.5 w-3.5" />
                <span data-disabled>Search</span>
              </button>

              <button
                type="button"
                disabled
                data-disabled
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-muted-foreground opacity-50 cursor-not-allowed"
              >
                <BellOff className="h-3.5 w-3.5" />
                <span data-disabled>Mute</span>
              </button>

              <div className="my-1 h-px bg-border/60" />

              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenuOpen(false);
                  startHideFlow();
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-foreground hover:bg-muted transition-colors cursor-pointer"
              >
                <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                <span>Hide / Lock DM</span>
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenuOpen(false);
                  setConfirmDeleteDM(true);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                <span>Delete DM</span>
              </button>

              <div className="my-1 h-px bg-border/60" />

              {other.blockedByMe ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setMenuOpen(false);
                    handleUnblock();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-foreground hover:bg-muted transition-colors cursor-pointer"
                >
                  <UserCheck className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>Unblock</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={other.blockedMe}
                  data-disabled={other.blockedMe || undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (other.blockedMe) return;
                    setMenuOpen(false);
                    handleBlock();
                  }}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors',
                    other.blockedMe
                      ? 'text-muted-foreground opacity-50 cursor-not-allowed'
                      : 'text-destructive hover:bg-destructive/10 cursor-pointer',
                  )}
                >
                  <Ban className={cn('h-3.5 w-3.5', other.blockedMe ? '' : 'text-destructive')} />
                  <span data-disabled={other.blockedMe || undefined}>Block</span>
                </button>
              )}

              <button
                type="button"
                disabled
                data-disabled
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-muted-foreground opacity-50 cursor-not-allowed"
              >
                <Flag className="h-3.5 w-3.5" />
                <span data-disabled>Report</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <Dialog open={!!summary} onOpenChange={(next) => !next && setSummary(null)}>
        <DialogContent className="rounded-2xl border border-border bg-card">
          <DialogHeader>
            <DialogTitle>Conversation Summary</DialogTitle>
          </DialogHeader>
          <p className="text-xs leading-relaxed text-muted-foreground">{summary}</p>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmHideDM} onOpenChange={(next) => !next && setConfirmHideDM(false)}>
        <DialogContent className="rounded-2xl border border-border bg-card">
          <DialogHeader>
            <DialogTitle>{needsVaultSetup ? 'Set up your Private Vault' : 'Hide this conversation?'}</DialogTitle>
            <DialogDescription>
              {needsVaultSetup
                ? "Choose a PIN to protect your Private Vault. You'll need it to view hidden conversations later."
                : 'This conversation will move to your Private Vault. It stays out of your normal inbox until you unlock the vault to view it.'}
            </DialogDescription>
          </DialogHeader>
          {needsVaultSetup && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vault-setup-pin">Vault PIN</Label>
              <Input
                id="vault-setup-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                placeholder="4-12 digits"
                value={setupPin}
                onChange={(e) => setSetupPin(e.target.value.replace(/\D/g, ''))}
              />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirmHideDM(false)} disabled={vaultBusy}>
              Cancel
            </Button>
            <Button type="button" onClick={needsVaultSetup ? confirmSetupThenHide : doHide} disabled={vaultBusy}>
              {needsVaultSetup ? 'Set PIN & Hide' : 'Hide / Lock DM'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDeleteDM} onOpenChange={(next) => !next && setConfirmDeleteDM(false)}>
        <DialogContent className="rounded-2xl border border-border bg-card">
          <DialogHeader>
            <DialogTitle>Delete this conversation?</DialogTitle>
            <DialogDescription>
              This removes the conversation from your own view —
              {' '}
              {other.firstName || 'the other participant'}
              {' '}
              will still see their full history. If either of you sends a new
              message later, this conversation reappears in your inbox — but
              only with new messages from that point forward, not what came
              before.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirmDeleteDM(false)} disabled={vaultBusy}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={handleDeleteDM} disabled={vaultBusy}>
              Delete DM
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default TopBar;
