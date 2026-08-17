import { useEffect, useState } from 'react';
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
import getFriends from '../../actions/getFriends';
import getFavorites from '../../actions/getFavorites';
import getMeetings from '../../actions/getMeetings';
import Actions from '../../constants/Actions';
import Settings from './components/Settings';
import VaultUnlock from './components/VaultUnlock';

const FILTER_PILLS = ['All', 'Unread', 'Favorites', 'Groups'];

function Panel() {
  const [nav, setNav] = useGlobal('nav');
  const searchText = useGlobal('search')[0];
  const rooms = useSelector((state) => state.io.rooms) || [];
  const roomsWithNewMessages = useSelector((state) => state.messages.roomsWithNewMessages) || [];
  const [searchResults, setSearchResults] = useGlobal('searchResults');
  const [favorites, setFavorites] = useGlobal('favorites');
  const [meetings, setMeetings] = useGlobal('meetings');
  const [callStatus] = useGlobal('callStatus');
  const [over] = useGlobal('over');
  const refreshMeetings = useSelector((state) => state.io.refreshMeetings);

  const [activeFilter, setActiveFilter] = useState('All');

  const dispatch = useDispatch();
  const location = useLocation();

  useEffect(() => {
    getRooms()
      .then((res) => dispatch({ type: Actions.SET_ROOMS, rooms: res.data.rooms }))
      .catch((err) => console.log(err));
    // Default "browse" listing on /search is mutual friends only, not the full
    // user directory — typing an actual @username query (SearchBar.jsx) still
    // searches everyone, since that's the whole point of discovering new people.
    getFriends()
      .then((res) => setSearchResults(res.data.users))
      .catch((err) => console.log(err));
    getFavorites()
      .then((res) => setFavorites(res.data.favorites))
      .catch((err) => console.log(err));
    getMeetings()
      .then((res) => setMeetings(res.data.meetings))
      .catch((err) => console.log(err));
  }, [setSearchResults, setFavorites]);

  useEffect(() => {
    getMeetings()
      .then((res) => setMeetings(res.data.meetings))
      .catch((err) => console.log(err));
  }, [refreshMeetings]);

  const filteredRooms = rooms.filter((r) => {
    if (activeFilter === 'Unread') return roomsWithNewMessages.includes(r._id);
    if (activeFilter === 'Favorites') return favorites.some((fav) => fav._id === r._id);
    if (activeFilter === 'Groups') return r.isGroup;
    return true;
  });

  const roomsList = filteredRooms.map((room) => <Room key={room._id} room={room} />);
  const searchResultsList = (searchResults || []).map((user) => <User key={user._id} user={user} />);
  const favoritesList = (favorites || []).map((room) => <Room key={room._id} room={room} />);
  const meetingsList = (meetings || []).map((meeting) => <Meeting key={meeting._id} meeting={meeting} />);

  function Notice({ text }) {
    return <div className="p-8 text-center text-xs text-muted-foreground">{text}</div>;
  }

  return (
    <div className="flex h-full flex-1 flex-col border-r border-border bg-card text-card-foreground sm:w-full md:max-w-[320px] md:min-w-[320px] lg:max-w-[360px] lg:min-w-[360px]">
      <TopBar />

      {/* Search & Filter Tabs visible in chat rooms & search tabs */}
      {(nav === 'rooms' || nav === 'search') && (
        <>
          <SearchBar />
          {nav === 'rooms' && (
            <div className="flex items-center gap-2 px-4 py-2 overflow-x-auto no-scrollbar">
              {FILTER_PILLS.map((pill) => (
                <button
                  key={pill}
                  type="button"
                  onClick={() => {
                    setActiveFilter(pill);
                    if (nav !== 'rooms') setNav('rooms');
                  }}
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
          )}
        </>
      )}

      {callStatus === 'in-call' && (!location.pathname.startsWith('/meeting') || over === false) && <MeetingBar />}

      <div className="flex-1 overflow-y-auto pt-1">
        {nav === 'rooms' && roomsList}
        {nav === 'rooms' && filteredRooms.length === 0 && (
          <Notice text={activeFilter === 'All' ? 'No conversations yet. Start a chat!' : `No ${activeFilter.toLowerCase()} conversations.`} />
        )}
        {nav === 'search' && searchResultsList}
        {nav === 'search' && (!searchResults || searchResults.length === 0) && (
          <Notice
            text={
              searchText
                ? `No search results for "${searchText}"`
                : 'No friends yet. Search a @username above to find and add people!'
            }
          />
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
