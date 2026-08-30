import {
  useEffect, useMemo, useState,
} from 'react';
import { useGlobal } from 'reactn';
import { useDispatch, useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';
import { Clock } from 'lucide-react';
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
import RemovedConversations from './components/RemovedConversations';

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
  const [searchLoading] = useGlobal('searchLoading');
  const [favorites, setFavorites] = useGlobal('favorites');
  const [meetings, setMeetings] = useGlobal('meetings');
  const [callStatus] = useGlobal('callStatus');
  const [over] = useGlobal('over');
  const refreshMeetings = useSelector((state) => state.io.refreshMeetings);

  const [activeFilter, setActiveFilter] = useState('All');

  // Loading flags, local — rooms/favorites/meetings themselves live in
  // Redux/reactn globals seeded as [] (see init.js), so an empty array is
  // indistinguishable from "not fetched yet" on a slow connection: without
  // this, "No conversations yet. Start a chat!" flashes for every user on
  // every load, not just genuinely-empty accounts. Same rooms===null
  // sentinel convention already used by VaultUnlock.jsx/RemovedConversations.jsx.
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [favoritesLoading, setFavoritesLoading] = useState(true);
  const [meetingsLoading, setMeetingsLoading] = useState(true);

  const dispatch = useDispatch();
  const location = useLocation();

  // Conversation list is fetched once on mount and otherwise kept live by
  // socket events (message-in, conversation-hidden/deleted/unhidden — see
  // initIO.js), so it's already the cached index the search box below
  // filters locally — no separate fetch-on-search needed.
  useEffect(() => {
    getRooms()
      .then((res) => dispatch({ type: Actions.SET_ROOMS, rooms: res.data.rooms }))
      .catch((err) => console.log(err))
      .finally(() => setRoomsLoading(false));
    getFavorites()
      .then((res) => setFavorites(res.data.favorites))
      .catch((err) => console.log(err))
      .finally(() => setFavoritesLoading(false));
  }, [setFavorites]);

  // Meetings: one effect covers both the initial mount fetch and every
  // subsequent refresh (refreshMeetings starts at null and only changes on
  // a real refresh signal — a separate mount-only effect calling the same
  // endpoint duplicated this request on every load).
  useEffect(() => {
    getMeetings()
      .then((res) => setMeetings(res.data.meetings))
      .catch((err) => console.log(err))
      .finally(() => setMeetingsLoading(false));
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

  function Loading() {
    return <div className="flex flex-1 items-center justify-center p-8 text-xs text-muted-foreground">Loading…</div>;
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

      <div data-tour="conversation-list" className="flex-1 overflow-y-auto pt-1">
        {nav === 'rooms' && roomsLoading && <Loading />}
        {nav === 'rooms' && !roomsLoading && roomsList}
        {nav === 'rooms' && !roomsLoading && filteredRooms.length === 0 && (
          <Notice text={activeFilter === 'All' ? 'No conversations yet. Start a chat!' : `No ${activeFilter.toLowerCase()} conversations.`} />
        )}
        {/* People to start a NEW conversation with — only while actively
            searching, shown below your (locally-filtered) existing chats.
            Same "Searching…" treatment AddPeople.jsx already uses for the
            identical useExplicitSearch hook — without it, submitting a
            people search on a slow connection showed nothing at all between
            pressing Enter and results (or "no results") appearing. */}
        {nav === 'rooms' && searchText && searchLoading && (
          <div className="flex items-center justify-center gap-1.5 py-6 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Searching…
          </div>
        )}
        {nav === 'rooms' && searchText && !searchLoading && searchResults && searchResults.length > 0 && (
          <>
            <div className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              People
            </div>
            {searchResultsList}
          </>
        )}
        {nav === 'favorites' && favoritesLoading && <Loading />}
        {nav === 'favorites' && !favoritesLoading && favoritesList}
        {nav === 'favorites' && !favoritesLoading && (!favorites || favorites.length === 0) && (
          <Notice text="No favorites yet. Star a conversation to reach them faster!" />
        )}
        {nav === 'meetings' && meetingsLoading && <Loading />}
        {nav === 'meetings' && !meetingsLoading && meetingsList}
        {nav === 'meetings' && !meetingsLoading && (!meetings || meetings.length === 0) && (
          <Notice text="No meetings yet. Create or schedule a meeting!" />
        )}
        {nav === 'settings' && <Settings />}
        {nav === 'vault' && <VaultUnlock />}
        {nav === 'removed' && <RemovedConversations />}
      </div>
    </div>
  );
}

export default Panel;
