import {
  useState, useRef, useEffect, useMemo, lazy, Suspense,
} from 'react';
import { useGlobal } from 'reactn';
import { useDispatch, useSelector } from 'react-redux';
import moment from 'moment';
import { Loader2 } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import Message from './Message';
import getMoreMessages from '../../../actions/getMoreMessages';
import Actions from '../../../constants/Actions';
import Picture from '../../../components/Picture';
import Config from '../../../config';
import LazyFallback from '../../../components/LazyFallback';

// Lazy-loaded so the media viewer (and its five sub-viewers) never ship in
// the initial chat bundle — only fetched the first time a user actually
// opens an image/file attachment. Mirrors ImageEditorModal's lazy pattern.
const MediaViewerShell = lazy(() => import('./MediaViewerShell'));

const dayLabel = (date) => {
  const m = moment(date);
  if (m.isSame(moment(), 'day')) return 'Today';
  if (m.isSame(moment().subtract(1, 'day'), 'day')) return 'Yesterday';
  return m.format('MMMM D, YYYY');
};

// Maps GroupMember.joinedVia (backend enum, see models/GroupMember.js) to
// the empty-state copy shown when this member's own history is empty —
// their real join system-message can fall before their own
// ConversationUserState.deletedBefore cutoff after a delete-then-rejoin
// cycle (see unhideConversationForUser.js), hiding it along with
// everything else, so a generic "No messages here yet" is misleading right
// after joining. 'CREATED' (the group creator) never hits this — they have
// no one else's history to be missing in the first place.
const JOIN_METHOD_LABEL = {
  ADDED: 'You were added to this group',
  INVITE_LINK: 'You joined via invite link',
  JOIN_REQUEST: 'Your request to join was approved',
};

function JoinedEmptyState({ joinInfo }) {
  const label = JOIN_METHOD_LABEL[joinInfo.method] || 'You joined this group';
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
      <div className="text-sm font-semibold text-foreground">{label}</div>
      <div className="text-xs text-muted-foreground mt-1">
        {joinInfo.inviterName ? `Invited by ${joinInfo.inviterName}. ` : ''}
        Send a message to start the conversation!
      </div>
    </div>
  );
}

function DaySeparator({ date }) {
  return (
    <div className="flex items-center gap-3 px-1 py-1.5 sm:px-2">
      <div className="h-px flex-1 bg-border/60" />
      <span className="shrink-0 rounded-full bg-muted/80 px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground shadow-xs">
        {dayLabel(date)}
      </span>
      <div className="h-px flex-1 bg-border/60" />
    </div>
  );
}

function Messages() {
  const user = useGlobal('user')[0] || {};
  const messages = useSelector((state) => state.io.messages) || [];
  const room = useSelector((state) => state.io.room) || {};
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const typing = useSelector((state) => state.messages.typing);

  const dispatch = useDispatch();
  const chat = useRef(null);
  const [open, setOpen] = useState(null);
  // Set right before an older-history prepend changes messages.length, so
  // the auto-scroll effect below can tell "history loaded" apart from "new
  // message arrived" and skip the scroll-to-bottom for the former — without
  // this both cases looked identical to that effect and loading history
  // yanked the view down to the bottom instead of preserving position.
  const restoreScrollRef = useRef(null);

  let other = {
    firstName: 'A',
    lastName: 'A',
  };

  if (!room.isGroup && room.people) {
    room.people.forEach((person) => {
      if (person._id !== user.id) other = person;
    });
  }

  // Derived from the live messages array (not room.images, which is a
  // join-room-time snapshot capped at 50 images and excludes files) so
  // Previous/Next in the viewer reflects newly-arrived attachments too.
  const mediaMessages = useMemo(
    () => messages.filter((m) => m.type === 'image' || m.type === 'file'),
    [messages],
  );

  const messagesList = messages.map((message, index) => {
    const previous = messages[index - 1];
    const showDaySeparator = !previous || !moment(message.date).isSame(moment(previous.date), 'day');

    return (
      <div key={message._id || message.clientID}>
        {showDaySeparator && <DaySeparator date={message.date} />}
        <Message
          message={message}
          previous={previous}
          next={messages[index + 1]}
          onOpen={setOpen}
          roomID={room._id}
        />
      </div>
    );
  });

  // Trigger a bit before the physical top, not exactly at it — gives the
  // request time to land before the user actually hits the edge.
  const HISTORY_TRIGGER_DISTANCE = 200;

  const onScroll = () => {
    const el = chat.current;
    if (!el) return;
    if (el.scrollTop > HISTORY_TRIGGER_DISTANCE) return;
    if (loading || !hasMore || !messages.length) return;

    setLoading(true);
    // Captured before the fetch resolves and prepends messages — the
    // restore effect below diffs against the post-render scrollHeight to
    // keep whatever the user was looking at in the same visual spot.
    restoreScrollRef.current = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop };
    getMoreMessages({ roomID: room._id, firstMessageID: messages[0]._id })
      .then((res) => {
        setHasMore(res.data.hasMore !== false);
        dispatch({ type: Actions.MORE_MESSAGES, messages: res.data.messages });
        setLoading(false);
      })
      .catch(() => {
        restoreScrollRef.current = null;
        setLoading(false);
      });
  };

  useEffect(() => {
    if (!chat.current) return;
    if (restoreScrollRef.current) {
      // History was prepended — hold the same content in view instead of
      // jumping to the bottom (or leaving scrollTop at 0, which is what a
      // naive "do nothing" would produce here since the prepended content
      // pushes everything down).
      const { scrollHeight: oldHeight, scrollTop: oldTop } = restoreScrollRef.current;
      chat.current.scrollTop = oldTop + (chat.current.scrollHeight - oldHeight);
      restoreScrollRef.current = null;
      return;
    }
    // A genuinely new message (or the very first load of this room) —
    // scroll-to-bottom is the correct behavior here, unchanged from before.
    chat.current.scrollTop = chat.current.scrollHeight;
  }, [messages.length]);

  // A different room was opened — its own initial page always starts fresh
  // with more history assumed available, and any pending restore from the
  // previous room's unmounted scroll position must not leak into this one.
  useEffect(() => {
    setHasMore(true);
    restoreScrollRef.current = null;
  }, [room._id]);

  useEffect(() => {
    if (typing && chat.current) {
      chat.current.scrollTop = chat.current.scrollHeight;
    }
  }, [typing]);

  return (
    <div
      data-tour="message-area"
      className="relative z-0 flex-1 w-full overflow-y-auto overflow-x-hidden flex justify-center py-2 bg-transparent"
      ref={chat}
      onScroll={onScroll}
    >
      <div className="flex flex-col w-full mx-auto px-4 sm:px-6 md:max-w-3xl lg:max-w-4xl xl:max-w-5xl">
        {open && (
          <Suspense fallback={<LazyFallback />}>
            <MediaViewerShell
              messages={mediaMessages}
              initialMessage={open}
              onClose={() => setOpen(null)}
            />
          </Suspense>
        )}

        {/* Pagination spinner — loading is also true on this room's very
            first history fetch, but messages.length is 0 then, so this only
            ever shows for a scroll-triggered "load older" fetch, not the
            initial load (which already has its own full-pane spinner one
            level up in Conversation/index.jsx). Without this, scrolling to
            the top on a slow connection looked like nothing was happening
            until older messages suddenly appeared. */}
        {loading && messages.length > 0 && (
          <div className="flex justify-center py-3">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" role="status" aria-label="Loading older messages" />
          </div>
        )}

        {messagesList}

        {messages.length === 0 && !loading && (
          room.myJoinInfo ? (
            <JoinedEmptyState joinInfo={room.myJoinInfo} />
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
              <div className="text-sm font-semibold text-foreground">No messages here yet</div>
              <div className="text-xs text-muted-foreground mt-1">Send a message to start the conversation!</div>
            </div>
          )
        )}

        {typing && (
          <div className="flex w-full items-end gap-2 px-1 sm:px-2 pt-2 pb-1 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="shrink-0 pt-0.5">
              <Avatar className="h-7 w-7 border border-border bg-gradient-to-br from-rose-600 to-primary text-white font-bold">
                {other.picture && (
                  <img
                    src={`${Config.url || ''}/api/images/${other.picture.shieldedID}/256`}
                    alt=""
                    className="aspect-square size-full object-cover"
                  />
                )}
                <AvatarFallback className="bg-transparent text-[10px] font-bold text-white">
                  {`${(other.firstName || 'U').charAt(0)}${(other.lastName || '').charAt(0)}`.toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </div>
            <div className="flex flex-col items-start">
              <div className="relative rounded-2xl rounded-bl-xs bg-muted px-4 py-3 border border-border/40 shadow-xs flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-muted-foreground/70 typing-dot" />
                <span className="h-2 w-2 rounded-full bg-muted-foreground/70 typing-dot" />
                <span className="h-2 w-2 rounded-full bg-muted-foreground/70 typing-dot" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Messages;
