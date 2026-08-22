import Actions from '../constants/Actions';

const initialState = {
  io: null,
  room: null,
  messages: [],
  rooms: [],
  id: null,
  onlineUsers: [],
  refreshMeetings: null,
};

const reducer = (state = initialState, action) => {
  switch (action.type) {
    case Actions.IO_INIT:
      return {
        ...state,
        io: action.io,
        id: action.io.id,
      };
    case Actions.SET_ROOMS:
      return {
        ...state,
        rooms: action.rooms,
      };
    case Actions.SET_ROOM:
      return {
        ...state,
        room: action.room,
      };
    case Actions.SET_MESSAGES:
      return {
        ...state,
        messages: action.messages,
      };
    case Actions.MORE_MESSAGES:
      return {
        ...state,
        messages: [...action.messages, ...state.messages],
      };
    case Actions.SYNC_MESSAGES: {
      const existingIDs = new Set(state.messages.map((m) => m._id));
      const newOnes = action.messages.filter((m) => !existingIDs.has(m._id));
      return {
        ...state,
        messages: [...state.messages, ...newOnes],
      };
    }
    case Actions.MESSAGE:
      return {
        ...state,
        messages: [...state.messages, action.message],
      };
    // Patches an in-place optimistic message by its temporary clientID (swap in the
    // real server _id on success, or mark it failed/retrying without losing its position).
    case Actions.MESSAGE_UPDATE:
      return {
        ...state,
        messages: state.messages.map((m) => (m.clientID === action.clientID ? { ...m, ...action.patch } : m)),
      };
    // "Delete for everyone" patches content in place (same row stays at the same
    // position — ordering/pagination/reply anchoring untouched, matching how the
    // server tombstones rather than removes the document). "Delete for me" removes
    // the row from this client's own view entirely — it was never a shared record
    // to begin with, just this user's visibility of it.
    case Actions.MESSAGE_DELETE:
      if (action.forEveryone) {
        return {
          ...state,
          messages: state.messages.map((m) => (m._id === action.messageID
            ? {
              ...m, deletedForEveryone: true, deletedAt: action.deletedAt || new Date().toISOString(), content: null, file: null,
            }
            : m)),
        };
      }
      return {
        ...state,
        messages: state.messages.filter((m) => m._id !== action.messageID),
      };
    // Delivery/read receipts patch deliveredTo/readBy in place on the
    // affected message(s) — same $addToSet-idempotent shape the server
    // already uses, so a duplicate/replayed event is a harmless no-op here
    // too (Set dedupes, spreading it back to an array is stable).
    case Actions.MESSAGE_DELIVERED:
      return {
        ...state,
        messages: state.messages.map((m) => (m._id === action.messageID
          ? { ...m, deliveredTo: [...new Set([...(m.deliveredTo || []), action.readerID])] }
          : m)),
      };
    case Actions.MESSAGE_READ: {
      const ids = new Set(action.messageIDs);
      return {
        ...state,
        messages: state.messages.map((m) => (ids.has(m._id)
          ? { ...m, readBy: [...new Set([...(m.readBy || []), action.readerID])] }
          : m)),
      };
    }
    // Hidden/deleted conversations disappear from the normal inbox the same
    // way a delete-for-me message disappears from its room — filtered out of
    // the array this client already has, no server round trip needed since
    // we already know which id to remove. Unhide is handled separately (via
    // a getRooms() refetch in initIO.js) since restoring a room needs the
    // full populated object, which the socket event alone doesn't carry.
    case Actions.CONVERSATION_HIDDEN:
    case Actions.CONVERSATION_DELETED:
      return {
        ...state,
        rooms: state.rooms.filter((r) => r._id !== action.conversationId),
      };
    // A conversation partner changed/removed their own profile picture —
    // patch every room's `people` entry for that user in place (sidebar
    // list + the currently-open room, if any) instead of refetching
    // everything. Previously nothing listened for this at all, so a
    // partner's picture change/removal never reflected on this client
    // until the conversation was manually reopened.
    case Actions.USER_PROFILE_UPDATED: {
      const patchPeople = (people) => (people || []).map((person) => (
        person._id === action.userId ? { ...person, picture: action.picture } : person
      ));
      return {
        ...state,
        rooms: state.rooms.map((room) => ({ ...room, people: patchPeople(room.people) })),
        room: state.room ? { ...state.room, people: patchPeople(state.room.people) } : state.room,
      };
    }
    case Actions.ONLINE_USERS:
      return {
        ...state,
        onlineUsers: action.data,
      };
    case Actions.REFRESH_MEETINGS:
      return {
        ...state,
        refreshMeetings: action.timestamp,
      };
    default:
      return state;
  }
};

export default reducer;
