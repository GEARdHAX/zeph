import IO from 'socket.io-client';
import { setGlobal, getGlobal } from 'reactn';
import { toast } from 'react-toastify';
import { PhoneIncoming } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import Config from '../config';
import Actions from '../constants/Actions';
import store from '../store';
import getRooms from './getRooms';
import syncMessages from './syncMessages';
import markMessageRead from './markMessageRead';
import messageSound from '../assets/message.mp3';
import socketPromise from '../lib/socket.io-promise';
import getMediaCategory from '../lib/mediaType';
import { navigateTo } from '../lib/navigation';

// Every category getMediaCategory() can actually return (see
// mediaType.js/mediaPolicy.js) needs an entry here — document/archive/text
// were previously missing, so any non-image/video/audio/pdf attachment
// (docx, zip, csv, plain text, code files — a huge share of real uploads)
// silently fell through to the generic 'Sent a file' default below.
const MEDIA_LABEL = {
  image: 'Sent a photo',
  video: 'Sent a video',
  audio: 'Sent an audio message',
  pdf: 'Sent a document',
  document: 'Sent a document',
  archive: 'Sent an archive',
  text: 'Sent a text file',
};

const PREVIEW_MAX_LENGTH = 80;

const truncate = (text) => (text.length > PREVIEW_MAX_LENGTH ? `${text.slice(0, PREVIEW_MAX_LENGTH).trimEnd()}…` : text);

// Exported for unit testing — pure function, no socket/store coupling.
export const previewText = (message) => {
  // A message with no media/file attachment AND not the legacy image
  // format (content: shieldedID, no .media/.file object either) is text,
  // regardless of message.type — historically some text messages were
  // persisted with type: undefined (a since-fixed field-name mismatch
  // between the send action and the backend route: BottomBar.jsx sent
  // "contentType" instead of "type"), so relying on type === 'text' alone
  // missed every pre-existing text message and showed the generic media
  // fallback instead of the real content.
  if (message.type !== 'image' && !message.media && !message.file) return truncate(message.content || '');
  const category = getMediaCategory(message);
  return MEDIA_LABEL[category] || 'Sent a file';
};

// Exported for unit testing (rendered directly, without going through a
// live socket event).
export function NewMessageToast({ room, message }) {
  const author = message.author || {};
  const initials = `${(author.firstName || 'U').charAt(0)}${(author.lastName || '').charAt(0)}`.toUpperCase();
  return (
    <button
      type="button"
      onClick={() => navigateTo(`/room/${room._id}`)}
      className="flex w-full cursor-pointer items-center gap-2.5 text-left"
    >
      <Avatar className="h-9 w-9 shrink-0 border border-border bg-gradient-to-br from-primary/80 to-rose-700 text-white font-bold">
        <AvatarFallback className="bg-transparent text-xs font-bold text-white">{initials}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <div className="truncate text-xs font-semibold text-foreground">
          {room.isGroup ? (room.title || 'Group') : `${author.firstName || ''} ${author.lastName || ''}`.trim()}
        </div>
        <div className="truncate text-xs text-muted-foreground">{previewText(message)}</div>
      </div>
    </button>
  );
}

// Full-screen Ringing/Meeting UI already plays the ring sound and shows a
// complete incoming-call card — but ONLY once Home's own effect force-
// navigates to /meeting/:id (see pages/Home/index.jsx). That's the same
// code path this toast fires alongside, not a replacement for it: a toast
// is a lighter-weight, always-visible signal that doesn't depend on the
// forced navigation actually registering as a clear visual change (e.g. a
// backgrounded tab, a momentarily-obscured full-screen takeover). Clicking
// it goes straight to the same /meeting/:id route Home's effect already
// navigates to, so clicking is a no-op if you're already there.
export function IncomingCallToast({ meetingID, caller, added }) {
  const name = `${caller?.firstName || 'Someone'} ${caller?.lastName || ''}`.trim();
  return (
    <button
      type="button"
      onClick={() => navigateTo(`/meeting/${meetingID}`)}
      className="flex w-full cursor-pointer items-center gap-2.5 text-left"
    >
      <Avatar className="h-9 w-9 shrink-0 border border-border bg-primary/15 text-primary">
        <AvatarFallback className="bg-transparent text-primary">
          <PhoneIncoming className="h-4 w-4" />
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <div className="truncate text-xs font-semibold text-foreground">{name || 'Incoming call'}</div>
        <div className="truncate text-xs text-muted-foreground">{added ? 'Adding you to a meeting…' : 'Incoming call…'}</div>
      </div>
    </button>
  );
}

// Module-level, not component state — initIO is called from plain action
// code (init.js on boot, App.jsx for magic-link login, Login/index.jsx for
// manual login), never from a component with its own mount/unmount to hang
// a cleanup off of. The three call sites are mutually exclusive in normal
// use today (see each site's own guard), but none of that is enforced HERE
// — without this, a future refactor that calls initIO twice in one tab
// would leave two live sockets both authenticated as the same user, each
// with its own full set of listeners: doubled getRooms()/sync calls,
// doubled ring/message sounds, doubled RTC_CALL dispatches. Disconnecting
// any prior socket before creating a new one makes initIO itself safe to
// call more than once, instead of relying on every call site never doing so.
let activeSocket = null;

const initIO = (token) => (dispatch) => {
  if (activeSocket) activeSocket.disconnect();

  const io = IO(`${Config.url || ''}/`);
  activeSocket = io;
  io.request = socketPromise(io);

  let wasConnected = false;

  io.on('connect', () => {
    io.emit('authenticate', { token });
    console.log('IO connected');
  });

  io.on('authenticated', () => {
    console.log('IO authenticated');
    dispatch({ type: Actions.IO_INIT, io });

    // Only resync on a *re*-authenticate (i.e. after a drop) — the first authenticate
    // on initial load has nothing to fill a gap for, and the room's initial message
    // list already comes from getRoom()'s own fetch.
    if (wasConnected) {
      const currentRoom = store.getState().io.room;
      if (currentRoom) {
        const roomMessages = store.getState().io.messages;
        const lastMessageID = roomMessages.length ? roomMessages[roomMessages.length - 1]._id : undefined;
        syncMessages({ roomID: currentRoom._id, lastMessageID })
          .then((res) => store.dispatch({ type: Actions.SYNC_MESSAGES, messages: res.data.messages }))
          .catch((err) => console.log(err));
      }
      getRooms()
        .then((res) => store.dispatch({ type: Actions.SET_ROOMS, rooms: res.data.rooms }))
        .catch((err) => console.log(err));
    }
    wasConnected = true;
  });

  io.on('message-in', (data) => {
    const { room, message } = data;

    const currentRoom = store.getState().io.room;
    const roomIsOpen = !!currentRoom && currentRoom._id === room._id;

    const audio = document.createElement('audio');
    audio.style.display = 'none';
    audio.src = messageSound;
    audio.autoplay = true;
    audio.onended = () => audio.remove();
    document.body.appendChild(audio);

    if (!roomIsOpen) {
      store.dispatch({ type: Actions.MESSAGES_ADD_ROOM_UNREAD, roomID: room._id });
      // Only toast for a conversation the user isn't already looking at —
      // a toast for the open room would just duplicate what's already on
      // screen. Suppressed while a call is active so an incoming toast
      // doesn't cover the call UI.
      if (!getGlobal().inCall) {
        toast(<NewMessageToast room={room} message={message} />, { toastId: message._id });
      }
    }

    // Delivery ack fires regardless of whether the room is currently open —
    // "delivered" means this client received it, not that the user is
    // looking at it (that's the separate read receipt below).
    io.emit('message-delivered', { roomID: room._id, messageID: message._id });

    if (roomIsOpen) {
      store.dispatch({ type: Actions.MESSAGE, message });
      markMessageRead({ roomID: room._id, messageID: message._id }).catch((err) => console.log(err));
    }

    // Runs regardless of whether a room is open — previously this refetch
    // was skipped entirely when no conversation was open (early return
    // above), so the sidebar's unread badge/last-message preview never
    // updated until the user navigated away and back or refreshed.
    getRooms()
      .then((res) => store.dispatch({ type: Actions.SET_ROOMS, rooms: res.data.rooms }))
      .catch((err) => console.log(err));
  });

  // Recipient's client acked receipt (message-delivered emit above) —
  // server relayed it back to the sender's personal room so this fires on
  // the ORIGINAL SENDER's client, not the recipient's own.
  io.on('message-delivered', (data) => {
    store.dispatch({ type: Actions.MESSAGE_DELIVERED, messageID: data.messageID, readerID: data.readerID });
  });

  // Recipient opened the conversation and marked messages read (single or
  // batched — see message-read.js) — relayed back to every OTHER room
  // member, i.e. this fires on the sender's client to flip ✓✓ to blue.
  io.on('message-read', (data) => {
    const messageIDs = data.messageIDs || (data.messageID ? [data.messageID] : []);
    if (!messageIDs.length) return;
    store.dispatch({ type: Actions.MESSAGE_READ, messageIDs, readerID: data.readerID });
  });

  // "Delete for everyone" is emitted to every OTHER room member (see
  // message-delete.js); "delete for me" is emitted to the deleting user's own
  // personal room, so every other device/tab of that same user updates too —
  // both land on this one listener regardless of which case it was.
  io.on('message-deleted', (data) => {
    const {
      roomID, messageID, forEveryone, deletedAt,
    } = data;
    const currentRoom = store.getState().io.room;
    if (currentRoom && currentRoom._id === roomID) {
      store.dispatch({
        type: Actions.MESSAGE_DELETE, messageID, forEveryone, deletedAt,
      });
    }
  });

  // Hide/delete are always emitted to the ACTING user's own personal room
  // only (never the other participant) — every device/tab of this same user
  // needs to reflect the change, and the room is already excluded from the
  // next getRooms() response either way, so a direct array patch here is
  // just a faster UI update, not the actual enforcement (that's server-side).
  io.on('conversation-hidden', (data) => {
    store.dispatch({ type: Actions.CONVERSATION_HIDDEN, conversationId: data.conversationId });
  });

  // A conversation partner changed/removed their profile picture (see
  // change-picture.js) — previously nothing notified the other side at
  // all, so their picture only updated for you after you happened to
  // reopen the conversation. Patches every room this affects in place.
  io.on('user-profile-updated', (data) => {
    store.dispatch({ type: Actions.USER_PROFILE_UPDATED, userId: data.userId, picture: data.picture });
  });

  io.on('conversation-deleted', (data) => {
    store.dispatch({ type: Actions.CONVERSATION_DELETED, conversationId: data.conversationId });

    // If this exact conversation is the one currently open (e.g. the other
    // participant's account was just deleted by an admin while this user
    // was actively viewing the chat — see user-delete.js), clearing the
    // room here reuses Conversation.jsx's existing null-room "Room Not
    // Found" fallback instead of leaving a stale, now-inaccessible
    // conversation on screen. The Delete-DM button already navigates away
    // itself before this event even arrives, so this only fires for the
    // server-initiated case where no local navigation has happened yet.
    const currentRoom = store.getState().io.room;
    if (currentRoom && currentRoom._id === data.conversationId) {
      store.dispatch({ type: Actions.SET_ROOM, room: null });
      store.dispatch({ type: Actions.SET_MESSAGES, messages: [] });
    }
  });

  // Unhide needs the full populated room object to reinsert into the normal
  // inbox list, which this event alone doesn't carry — refetch instead of
  // trying to reconstruct it, same as message-in's existing getRooms() call.
  io.on('conversation-unhidden', () => {
    getRooms()
      .then((res) => store.dispatch({ type: Actions.SET_ROOMS, rooms: res.data.rooms }))
      .catch((err) => console.log(err));
  });

  io.on('newProducer', (data) => {
    console.log('newProducer', data);
    if (data.socketID !== io.id) store.dispatch({ type: Actions.RTC_PRODUCER, data });
  });

  io.on('leave', (data) => {
    console.log('leave', data);
    let { producers } = store.getState().rtc;
    producers = producers.filter((producer) => producer.socketID !== data.socketID);
    console.log('producers after leave', producers);
    store.dispatch({ type: Actions.RTC_RESET_PRODUCERS, producers, socketID: data.socketID });
  });

  io.on('consumers', (data) => {
    console.log('consumers', data);
    store.dispatch({ type: Actions.RTC_CONSUMERS, consumers: data });
  });

  io.on('newPeer', (data) => {
    console.log('newPeer', data);
    store.dispatch({ type: Actions.RTC_NEW_PEER, data });
  });

  io.on('call', (data) => {
    console.log('call', data);
    store.dispatch({ type: Actions.RTC_SET_COUNTERPART, counterpart: data.counterpart });
    store.dispatch({ type: Actions.RTC_CALL, data });

    // Malformed/incomplete payload (missing the id the toast would navigate
    // to) — nothing safe to show or click through to.
    if (!data?.meetingID) return;

    // Skip the toast only when the user is already looking at THIS exact
    // meeting (Home's own effect will have already navigated them to
    // /meeting/:meetingID and mounted the full Ringing UI, which already
    // plays the sound and shows the answer/decline controls) — a toast on
    // top of that would be pure redundant noise. Any other meeting/route
    // still gets the toast, same as message-in's "not looking at that
    // room" rule.
    const currentMeetingID = getGlobal().meeting?._id;
    if (currentMeetingID === data.meetingID) return;

    toast(
      <IncomingCallToast meetingID={data.meetingID} caller={data.counterpart} added={data.added} />,
      { toastId: `call-${data.meetingID}` },
    );
  });

  io.on('close', (data) => {
    console.log('close', data);
    store.dispatch({ type: Actions.RTC_CLOSE, data });
    // Caller hung up / call ended before this client acted on the toast —
    // dismiss it rather than leaving a stale, dead-end notification behind
    // that would navigate to a meeting that no longer has anyone in it.
    // No-op if the toast already closed itself (answered, clicked, or
    // auto-dismissed) — react-toastify ignores a dismiss() for an id that
    // isn't currently showing.
    if (data?.meetingID) toast.dismiss(`call-${data.meetingID}`);
  });

  io.on('answer', (data) => {
    console.log('answer', data);
    store.dispatch({ type: Actions.RTC_ANSWER, data });
  });

  io.on('remove', (data) => {
    console.log('remove', data.producerID);
    let { producers } = store.getState().rtc;
    producers = producers.filter((producer) => producer.producerID !== data.producerID);
    console.log('producers after remove', producers);
    store.dispatch({
      type: Actions.RTC_RESET_PRODUCERS,
      producers,
      socketID: data.socketID,
      lastLeaveType: 'remove',
      producerID: data.producerID,
    });
  });

  io.on('onlineUsers', (data) => {
    store.dispatch({ type: Actions.ONLINE_USERS, data });
  });

  io.on('refresh-meetings', (data) => {
    store.dispatch({ type: Actions.REFRESH_MEETINGS, timestamp: data.timestamp });
  });

  io.on('user-deleted', async () => {
    localStorage.removeItem('token');
    await setGlobal({
      token: null,
      user: {},
    });
  });

  io.on('typing', (data) => {
    if (store.getState().io.room && data.roomID === store.getState().io.room._id) {
      if (data.isTyping) {
        clearTimeout(window.typingTimeout);
        window.typingTimeout = setTimeout(() => {
          dispatch({ type: Actions.SET_TYPING, typing: false });
        }, 10000);
      } else {
        clearTimeout(window.typingTimeout);
      }
      dispatch({ type: Actions.SET_TYPING, typing: data.isTyping });
    }
  });

  io.on('disconnect', (reason) => {
    console.log('IO disconnected:', reason);
    // Per Socket.IO's own semantics, "io server disconnect" (the server called
    // socket.disconnect()) is the ONE disconnect reason the client does NOT
    // auto-reconnect from — every other reason (transport close, ping
    // timeout, transport error) reconnects on its own. Without this, a
    // 15s-auth-timeout race, an invalid/expired token, or a revoked session
    // permanently kills real-time updates with no error shown and no
    // recovery — the tab looks normal but nothing ever arrives again.
    if (reason === 'io server disconnect') {
      io.connect();
    }
  });

  // Re-authenticate failed (invalid/expired token, revoked session) — the
  // server has already called socket.disconnect() by the time this fires,
  // so the 'disconnect' handler above will also run and reconnect the
  // transport; this just surfaces it instead of failing silently forever.
  io.on('unauthorized', (err) => {
    console.log('IO unauthorized:', err);
  });

  window.onbeforeunload = () => {
    io.emit('leave', { socketID: io.id, roomID: store.getState().rtc.roomID });
  };
};

export default initIO;
