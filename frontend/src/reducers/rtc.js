import moment from 'moment';
import Actions from '../constants/Actions';

const initialState = {
  producers: [],
  lastLeave: null,
  roomID: null,
  consumers: [],
  consumersTimestamp: null,
  peers: {},
  increment: 0,
  callIncrement: 0,
  callData: null,
  answerIncrement: 0,
  answerData: 0,
  lastLeaveType: 'leave',
  counterpart: null,
  closingState: false,
  closed: true,
  // True while callManager.rejoin() is renegotiating mediasoup transports
  // after a socket reconnect mid-call — see callManager.js's rejoin(). Not
  // reset by RTC_LEAVE's initialState spread issue since RTC_LEAVE already
  // returns the whole initialState object fresh (reconnecting: false, as
  // declared here).
  reconnecting: false,
};

const reducer = (state = initialState, action) => {
  switch (action.type) {
    case Actions.RTC_CLOSE:
      return {
        ...state,
        closingState: !state.closed,
      };
    case Actions.RTC_PRODUCER:
      return {
        ...state,
        producers: [...state.producers, action.data],
        closed: false,
      };
    case Actions.RTC_PRODUCERS:
      return {
        ...state,
        // replace: true — used by callManager.rejoin() after a reconnect,
        // where state.producers still holds stale entries from the
        // connection the server already discarded (their producer IDs no
        // longer exist server-side); appending the fresh list onto those
        // would leave dead entries onProducersChanged() would try and fail
        // to consume. join()'s normal call site never needs this: RTC_LEAVE
        // already reset producers to [] before any new join() runs.
        producers: action.replace ? [...action.producers] : [...state.producers, ...action.producers],
        closed: false,
      };
    case Actions.RTC_RESET_PRODUCERS:
      return {
        ...state,
        producers: [...action.producers],
        lastLeave: action.producerID || action.socketID,
        lastLeaveType: action.lastLeaveType || 'leave',
        increment: state.increment + 1,
      };
    case Actions.RTC_ROOM_ID:
      return {
        ...state,
        roomID: action.roomID,
        closed: false,
      };
    case Actions.RTC_CONSUMERS:
      if (state.consumersTimestamp && moment(state.consumersTimestamp).isAfter(moment(action.consumers.timestamp))) return state;
      return {
        ...state,
        consumers: action.consumers.content,
        peers: action.peers || state.peers,
        consumersTimestamp: action.consumers.timestamp,
        closed: false,
      };
    case Actions.RTC_NEW_PEER:
      return {
        ...state,
        peers: {
          ...state.peers,
          [action.data.socketID]: action.data,
        },
        closed: false,
      };
    case Actions.RTC_CALL:
      return {
        ...state,
        callIncrement: state.callIncrement + 1,
        callData: action.data,
        closed: false,
        closingState: false,
      };
    case Actions.RTC_ANSWER:
      return {
        ...state,
        answerIncrement: state.answerIncrement + 1,
        answerData: action.data,
        closed: false,
        closingState: false,
      };
    case Actions.RTC_SET_COUNTERPART:
      return {
        ...state,
        counterpart: action.counterpart,
        closed: false,
      };
    case Actions.RTC_RECONNECTING:
      return {
        ...state,
        reconnecting: action.reconnecting,
      };
    case Actions.RTC_LEAVE:
      return initialState;
    default:
      return state;
  }
};

export default reducer;
