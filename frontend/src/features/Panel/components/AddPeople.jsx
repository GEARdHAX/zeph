import { useEffect, useRef, useState } from 'react';
import { Search, Clock, UserCheck } from 'lucide-react';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import search from '../../../actions/search';
import createRoom from '../../../actions/createRoom';
import Actions from '../../../constants/Actions';
import Config from '../../../config';
import useExplicitSearch from '../../../lib/useExplicitSearch';
import ProfileView from './ProfileView';

const MIN_QUERY_LENGTH = 3;

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

function AddPeople({ onClose }) {
  const [previewUsername, setPreviewUsername] = useState(null);

  const inputRef = useRef(null);
  const navigate = useNavigate();
  const dispatch = useDispatch();

  // Global user directory can't be preloaded/cached client-side like the
  // Home conversation list (unbounded dataset) — search only fires on an
  // explicit submit (Enter/button), never per keystroke. useExplicitSearch
  // also caches by query and aborts a stale in-flight request the moment a
  // newer one is submitted, so a slow earlier response can never overwrite
  // a later search's results.
  const {
    query, setQuery, results, loading: searching, hasSearched, search: runSearch,
  } = useExplicitSearch(
    (value, signal) => search(value, undefined, signal).then((res) => res.data.users || []),
    { minLength: MIN_QUERY_LENGTH },
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const onChange = (e) => setQuery(e.target.value);

  const onKeyDown = (e) => {
    if (e.key === 'Enter') runSearch();
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

        <div className="relative flex h-10 w-full items-center gap-1.5 rounded-xl border border-input bg-muted/40 px-3.5 focus-within:border-primary/50 focus-within:bg-background focus-within:ring-2 focus-within:ring-primary/20">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            className="w-full bg-transparent px-2.5 text-xs text-foreground placeholder:text-muted-foreground outline-none"
            placeholder="Search @username, then press Enter..."
            value={query}
            onChange={onChange}
            onKeyDown={onKeyDown}
          />
          <button
            type="button"
            onClick={() => runSearch()}
            disabled={query.trim().length < MIN_QUERY_LENGTH}
            className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/10 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            Search
          </button>
        </div>

        <div className="flex max-h-[320px] flex-col gap-0.5 overflow-y-auto">
          {query.trim().length > 0 && query.trim().length < MIN_QUERY_LENGTH && (
            <div className="py-6 text-center text-xs text-muted-foreground">
              {`Keep typing (min ${MIN_QUERY_LENGTH} characters)…`}
            </div>
          )}
          {searching && (
            <div className="flex items-center justify-center gap-1.5 py-6 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              Searching…
            </div>
          )}
          {!searching && hasSearched && query.trim().length >= MIN_QUERY_LENGTH && results.length === 0 && (
            <div className="py-6 text-center text-xs text-muted-foreground">
              No one found for &quot;
              {query}
              &quot;
            </div>
          )}
          {!searching && !hasSearched && query.trim().length >= MIN_QUERY_LENGTH && (
            <div className="py-6 text-center text-xs text-muted-foreground">Press Enter or Search to look them up.</div>
          )}
          {!searching && results.map((user) => (
            <ResultRow key={user._id} user={user} onOpen={setPreviewUsername} onOpenChat={openChat} />
          ))}
        </div>
      </DialogContent>

      {previewUsername && (
        <ProfileView
          username={previewUsername}
          onClose={() => setPreviewUsername(null)}
          onOpenChat={openChat}
        />
      )}
    </Dialog>
  );
}

export default AddPeople;
