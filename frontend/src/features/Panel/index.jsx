import {
  useEffect, useMemo, useState,
} from 'react';
import { useGlobal } from 'reactn';
import { useDispatch, useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';
import TopBar from './components/TopBar';
import SearchBar from './components/SearchBar';
import MeetingBar from './components/MeetingBar';
import Room from './components/Room';
import Meeting from './components/Meeting';
import User from './components/User';
import getRooms from '../../actions/getRooms';
import getFavorites from '../../actions/getFavorites';
import getMeetings from '../../actions/getMeetings';
import Actions from '../../constants/Actions';
import Settings from './components/Settings';
import VaultUnlock from './components/VaultUnlock';

const FILTER_PILLS = ['All', 'Unread', 'Favorites', 'Groups'];

// Same fields Room.jsx already renders/matches a title from — group title,
// or the other DM participant's name — so the search box matches exactly
// what's visible in each row, nothing more.
const roomMatchesQuery = (room, query, myUserID) => {
  if (room.isGroup) return (room.title || '').toLowerCase().includes(query);
  const other = room.people.find((person) => person._id !== myUserID) || {};
  const name = `${other.firstName || ''} ${other.lastName || ''}`.toLowerCase();
  return name.includes(query);
};

function Panel() {
  const [nav] = useGlobal('nav');
  const searchText = useGlobal('search')[0];
  const user = useGlobal('user')[0] || {};
  const rooms = useSelector((state) => state.io.rooms) || [];
  const roomsWithNewMessages = useSelector((state) => state.messages.roomsWithNewMessages) || [];
  const [searchResults] = useGlobal('searchResults');
  const [favorites, setFavorites] = useGlobal('favorites');
  const [meetings, setMeetings] = useGlobal('meetings');
  const [callStatus] = useGlobal('callStatus');
  const [over] = useGlobal('over');
  const refreshMeetings = useSelector((state) => state.io.refreshMeetings);

  const [activeFilter, setActiveFilter] = useState('All');

  const dispatch = useDispatch();
  const location = useLocation();

  // Conversation list is fetched once on mount and otherwise kept live by
  // socket events (message-in, conversation-hidden/deleted/unhidden — see
  // initIO.js), so it's already the cached index the search box below
  // filters locally — no separate fetch-on-search needed.
  useEffect(() => {
    getRooms()
      .then((res) => dispatch({ type: Actions.SET_ROOMS, rooms: res.data.rooms }))
      .catch((err) => console.log(err));
    getFavorites()
      .then((res) => setFavorites(res.data.favorites))
      .catch((err) => console.log(err));
  }, [setFavorites]);

  // Meetings: one effect covers both the initial mount fetch and every
  // subsequent refresh (refreshMeetings starts at null and only changes on
  // a real refresh signal — a separate mount-only effect calling the same
  // endpoint duplicated this request on every load).
  useEffect(() => {
    getMeetings()
      .then((res) => setMeetings(res.data.meetings))
      .catch((err) => console.log(err));
  }, [refreshMeetings, setMeetings]);

  const filteredRooms = useMemo(() => {
    const query = (searchText || '').trim().toLowerCase();
    return rooms.filter((r) => {
      if (query && !roomMatchesQuery(r, query, user.id)) return false;
      if (activeFilter === 'Unread') return roomsWithNewMessages.includes(r._id);
      if (activeFilter === 'Favorites') return favorites.some((fav) => fav._id === r._id);
      if (activeFilter === 'Groups') return r.isGroup;
      return true;
    });
  }, [rooms, searchText, user.id, activeFilter, roomsWithNewMessages, favorites]);

  const roomsList = filteredRooms.map((room) => <Room key={room._id} room={room} />);
  // People you can start a NEW conversation with — a directory search, not
  // your conversation list, so it stays server-side (debounced in
  // SearchBar.jsx) rather than client-cached; only shown while actively
  // searching, not as a default "browse everyone" listing.
  const searchResultsList = (searchResults || []).map((user_) => <User key={user_._id} user={user_} />);
  const favoritesList = (favorites || []).map((room) => <Room key={room._id} room={room} />);
  const onMeetingDeleted = (meetingId) => setMeetings((meetings || []).filter((m) => m._id !== meetingId));

  const meetingsList = (meetings || []).map((meeting) => (
    <Meeting key={meeting._id} meeting={meeting} onDeleted={onMeetingDeleted} />
  ));

  function Notice({ text }) {
    return <div className="p-8 text-center text-xs text-muted-foreground">{text}</div>;
  }

  return (
    <div className="flex h-full flex-1 flex-col border-r border-border bg-card text-card-foreground sm:w-full md:max-w-[320px] md:min-w-[320px] lg:max-w-[360px] lg:min-w-[360px]">
      <TopBar />

      {/* Search & Filter Tabs visible in the chat rooms tab */}
      {nav === 'rooms' && (
        <>
          <SearchBar />
          <div className="flex items-center gap-2 px-4 py-2 overflow-x-auto no-scrollbar">
            {FILTER_PILLS.map((pill) => (
              <button
                key={pill}
                type="button"
                onClick={() => setActiveFilter(pill)}
                className={`rounded-full px-3.5 py-1 text-xs font-semibold transition-all duration-200 ${
                  activeFilter === pill
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {pill}
              </button>
            ))}
          </div>
        </>
      )}

      {callStatus === 'in-call' && (!location.pathname.startsWith('/meeting') || over === false) && <MeetingBar />}

      <div className="flex-1 overflow-y-auto pt-1">
        {nav === 'rooms' && roomsList}
        {nav === 'rooms' && filteredRooms.length === 0 && (
          <Notice text={activeFilter === 'All' ? 'No conversations yet. Start a chat!' : `No ${activeFilter.toLowerCase()} conversations.`} />
        )}
        {/* People to start a NEW conversation with — only while actively
            searching, shown below your (locally-filtered) existing chats. */}
        {nav === 'rooms' && searchText && searchResults && searchResults.length > 0 && (
          <>
            <div className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              People
            </div>
            {searchResultsList}
          </>
        )}
        {nav === 'favorites' && favoritesList}
        {nav === 'favorites' && (!favorites || favorites.length === 0) && (
          <Notice text="No favorites yet. Star a conversation to reach them faster!" />
        )}
        {nav === 'meetings' && meetingsList}
        {nav === 'meetings' && (!meetings || meetings.length === 0) && (
          <Notice text="No meetings yet. Create or schedule a meeting!" />
        )}
        {nav === 'settings' && <Settings />}
        {nav === 'vault' && <VaultUnlock />}
      </div>
    </div>
  );
}

export default Panel;
