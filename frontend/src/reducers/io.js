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
