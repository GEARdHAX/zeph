import { useEffect, useRef, useState } from 'react';
import {
  Search, MessageSquare, UserPlus, Check, Clock, ShieldOff, UserCheck,
} from 'lucide-react';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import search from '../../../actions/search';
import resolveUser from '../../../actions/resolveUser';
import sendFriendRequest from '../../../actions/sendFriendRequest';
import respondFriendRequest from '../../../actions/respondFriendRequest';
import blockUser from '../../../actions/blockUser';
import createRoom from '../../../actions/createRoom';
import Actions from '../../../constants/Actions';
import Config from '../../../config';

const MIN_QUERY_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 300;

function ResultRow({ user, onOpen, onOpenChat }) {
  const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username;
  const initials = `${(user.firstName || 'U').charAt(0)}${(user.lastName || '').charAt(0)}`.toUpperCase() || 'U';
  const isFriend = user.relationshipStatus === 'accepted';

  // Already-mutual friends skip the profile-preview step and open the DM
  // directly on click — everyone else still opens the preview first.
  const onClick = () => (isFriend ? onOpenChat(user._id) : onOpen(user.username));

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-muted/60"
    >
      <Avatar className="h-10 w-10 border border-border bg-gradient-to-br from-primary/80 to-rose-700 text-white font-bold">
        {user.picture && (
          <img
            src={`${Config.url || ''}/api/images/${user.picture.shieldedID}/256`}
            alt=""
            className="aspect-square size-full object-cover"
          />
        )}
        <AvatarFallback className="bg-transparent text-xs font-bold text-white">{initials}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-semibold text-foreground">{fullName}</span>
          {isFriend && (
            <Badge variant="secondary" className="shrink-0 gap-1 px-1.5 py-0 text-[10px]">
              <UserCheck className="h-2.5 w-2.5" />
              Friends
            </Badge>
          )}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">{`@${user.username}`}</div>
      </div>
    </button>
  );
}

function ProfilePreview({ username, onClose, onOpenChat }) {
  const [profile, setProfile] = useState(null);
  const [relationship, setRelationship] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    resolveUser(username)
      .then((res) => {
        setProfile(res.data.user);
        setRelationship(res.data.relationship);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [username]);

  const fullName = profile ? `${profile.firstName || ''} ${profile.lastName || ''}`.trim() || profile.username : '';
  const initials = profile
    ? `${(profile.firstName || 'U').charAt(0)}${(profile.lastName || '').charAt(0)}`.toUpperCase() || 'U'
    : '';

  // Dynamic secondary-action states per the relationship: NONE, PENDING_SENT,
  // PENDING_RECEIVED, ACCEPTED, BLOCKED. Start Chat stays primary and always
  // available (messaging-first) except when blocked.
  const status = relationship?.status;
  const isBlocked = status === 'blocked';
  const isAccepted = status === 'accepted';
  const isPendingSent = status === 'pending' && relationship?.direction === 'outgoing';
  const isPendingReceived = status === 'pending' && relationship?.direction === 'incoming';

  const sendRequest = async () => {
    // Optimistic: flip to "Requested" the instant the click happens, not
    // after the round-trip — this is what actually stops a rapid second
    // click, since the button re-renders disabled before the network call
    // even resolves. Server-side, the unique index + policy check are the
    // real enforcement (see D-028/D-029); this is UX responsiveness only.
    const previousRelationship = relationship;
    setRelationship({ status: 'pending', direction: 'outgoing' });
    setBusy(true);
    try {
      await sendFriendRequest(username);
      toast.success('Request sent.');
    } catch (err) {
      if (err.response?.status === 409) {
        // Already pending/accepted/blocked server-side — keep the optimistic
        // pending state rather than reverting, since "Requested" is still
        // an accurate reflection of reality for pending/accepted; a blocked
        // 403 is handled by the branch below instead.
        if (err.response?.data?.reason === 'blocked') {
          setRelationship({ status: 'blocked', direction: null });
        }
      } else {
        setRelationship(previousRelationship);
        toast.error('Could not send request.');
      }
    } finally {
      setBusy(false);
    }
  };

  const acceptRequest = async () => {
    setBusy(true);
    try {
      await respondFriendRequest(relationship._id, 'accept');
      setRelationship({ status: 'accepted', direction: null });
      toast.success('Request accepted.');
    } catch (err) {
      toast.error('Could not accept request.');
    } finally {
      setBusy(false);
    }
  };

  const block = async () => {
    setBusy(true);
    try {
      await blockUser(username);
      setRelationship({ status: 'blocked', direction: null });
      toast.success(`Blocked @${username}.`);
    } catch (err) {
      toast.error('Could not block this user.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Profile</DialogTitle>
        </DialogHeader>

        {loading && <div className="py-6 text-center text-xs text-muted-foreground">Loading…</div>}
        {error && <div className="py-6 text-center text-xs text-muted-foreground">Couldn&apos;t find that user.</div>}

        {profile && (
          <div className="flex flex-col items-center gap-3 py-2">
            <Avatar className="h-20 w-20 border-2 border-border bg-gradient-to-br from-primary/80 to-rose-700 text-2xl font-extrabold text-white shadow-md">
              {profile.picture && (
                <img
                  src={`${Config.url || ''}/api/images/${profile.picture.shieldedID}/256`}
                  alt=""
                  className="aspect-square size-full object-cover"
                />
              )}
              <AvatarFallback className="bg-transparent text-2xl font-bold text-white">{initials}</AvatarFallback>
            </Avatar>
            <div className="text-center">
              <div className="text-sm font-bold text-foreground">{fullName}</div>
              <div className="text-xs text-muted-foreground">{`@${profile.username}`}</div>
              {profile.tagLine && !isBlocked && <div className="mt-1 text-xs text-muted-foreground">{profile.tagLine}</div>}
            </div>

            {isBlocked ? (
              <div className="mt-2 w-full rounded-lg bg-muted py-2.5 text-center text-xs font-medium text-muted-foreground">
                User unavailable
              </div>
            ) : (
              <div className="mt-2 flex w-full flex-col gap-2">
                <Button className="w-full gap-2" onClick={() => onOpenChat(profile._id)}>
                  <MessageSquare className="h-4 w-4" />
                  {isAccepted ? 'Open Chat' : 'Start Chat'}
                </Button>

                {isAccepted && (
                  <div className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-xs font-medium text-muted-foreground">
                    <UserCheck className="h-3.5 w-3.5" />
                    Contact
                  </div>
                )}

                {isPendingReceived && (
                  <Button variant="outline" className="w-full gap-2" disabled={busy} onClick={acceptRequest}>
                    <UserCheck className="h-4 w-4" />
                    Accept Request
                  </Button>
                )}

                {!isAccepted && !isPendingReceived && (
                  <Button
                    variant="outline"
                    className="w-full gap-2"
                    disabled={isPendingSent || busy}
                    onClick={sendRequest}
                  >
                    {isPendingSent ? <Check className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                    {isPendingSent ? 'Requested' : 'Add Friend'}
                  </Button>
                )}

                <Button
                  variant="ghost"
                  className="w-full gap-2 text-muted-foreground hover:text-destructive"
                  disabled={busy}
                  onClick={block}
                >
                  <ShieldOff className="h-4 w-4" />
                  Block
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddPeople({ onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [previewUsername, setPreviewUsername] = useState(null);

  const searchTimeout = useRef(null);
  const abortController = useRef(null);
  const inputRef = useRef(null);
  const navigate = useNavigate();
  const dispatch = useDispatch();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const onChange = (e) => {
    const { value } = e.target;
    setQuery(value);

    clearTimeout(searchTimeout.current);
    if (abortController.current) abortController.current.abort();

    if (value.trim().length < MIN_QUERY_LENGTH) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    searchTimeout.current = setTimeout(() => {
      const controller = new AbortController();
      abortController.current = controller;
      search(value, undefined, controller.signal)
        .then((res) => setResults(res.data.users || []))
        .catch(() => {})
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
  };

  const openChat = async (userId) => {
    try {
      const res = await createRoom(userId);
      dispatch({ type: Actions.SET_ROOM, room: res.data.room });
      dispatch({ type: Actions.SET_MESSAGES, messages: res.data.room.messages });
      setPreviewUsername(null);
      onClose();
      navigate(`/room/${res.data.room._id}`);
    } catch (err) {
      toast.error('Could not start chat.');
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add People</DialogTitle>
        </DialogHeader>

        <div className="relative flex h-10 w-full items-center rounded-xl border border-input bg-muted/40 px-3.5 focus-within:border-primary/50 focus-within:bg-background focus-within:ring-2 focus-within:ring-primary/20">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            className="w-full bg-transparent px-2.5 text-xs text-foreground placeholder:text-muted-foreground outline-none"
            placeholder="Search @username..."
            value={query}
            onChange={onChange}
          />
        </div>

        <div className="flex max-h-[320px] flex-col gap-0.5 overflow-y-auto">
          {query.trim().length > 0 && query.trim().length < MIN_QUERY_LENGTH && (
            <div className="py-6 text-center text-xs text-muted-foreground">Keep typing to search…</div>
          )}
          {searching && (
            <div className="flex items-center justify-center gap-1.5 py-6 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              Searching…
            </div>
          )}
          {!searching && query.trim().length >= MIN_QUERY_LENGTH && results.length === 0 && (
            <div className="py-6 text-center text-xs text-muted-foreground">
              No one found for &quot;
              {query}
              &quot;
            </div>
          )}
          {!searching && results.map((user) => (
            <ResultRow key={user._id} user={user} onOpen={setPreviewUsername} onOpenChat={openChat} />
          ))}
        </div>
      </DialogContent>

      {previewUsername && (
        <ProfilePreview
          username={previewUsername}
          onClose={() => setPreviewUsername(null)}
          onOpenChat={openChat}
        />
      )}
    </Dialog>
  );
}

export default AddPeople;
