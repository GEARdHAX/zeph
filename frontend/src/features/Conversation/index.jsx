import { useEffect, useState } from 'react';
import { useGlobal } from 'reactn';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate, useParams } from 'react-router-dom';
import ClipLoader from 'react-spinners/ClipLoader';
import TopBar from './components/TopBar';
import BottomBar from './components/BottomBar';
import getRoom from '../../actions/getRoom';
import getInfo from '../../actions/getInfo';
import markMessageRead from '../../actions/markMessageRead';
import Messages from './components/Messages';
import Actions from '../../constants/Actions';

function Conversation() {
  const room = useSelector((state) => state.io.room);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [aiEnabled, setAiEnabled] = useState(false);
  const setOver = useGlobal('over')[1];
  const vaultToken = useGlobal('vaultToken')[0];
  const user = useGlobal('user')[0] || {};
  const { id } = useParams();

  const navigate = useNavigate();
  const dispatch = useDispatch();

  const back = () => {
    setOver(false);
    navigate('/', { replace: true });
  };

  useEffect(() => {
    getInfo().then((res) => setAiEnabled(!!res.data.aiEnabled)).catch(() => {});
  }, []);

  useEffect(() => {
    // Guards against two real bugs, both invisible until you navigate
    // quickly between rooms/routes:
    // (1) Stale-response race — if room A's fetch is still in flight when
    //     you navigate to room B, A's effect hasn't unmounted yet (its
    //     .then() is still queued) and can resolve AFTER B's own effect
    //     already set the correct room, silently overwriting B's fresh
    //     data with A's stale response. `cancelled` makes every dispatch
    //     in this effect a no-op once a newer run (or unmount) has started.
    // (2) Stale state after leaving the page entirely — nothing else in
    //     the app ever reset state.io.room/messages on navigating away
    //     from a room, so going room -> "/" (or any other route) left the
    //     previous room's data sitting in Redux indefinitely; anything
    //     that reads it later (Details panel, this same effect's own
    //     "not looking at that room" checks elsewhere) saw leftover data
    //     from a page you're no longer on instead of a clean slate.
    let cancelled = false;

    setLoading(true);
    getRoom(id, vaultToken)
      .then((res) => {
        if (cancelled) return;
        dispatch({ type: Actions.SET_ROOM, room: res.data.room });
        dispatch({ type: Actions.SET_MESSAGES, messages: res.data.room.messages });
        setLoading(false);
        setError(false);
        dispatch({ type: Actions.MESSAGES_REMOVE_ROOM_UNREAD, roomID: id });

        // Mark the whole unread backlog read, not just the newest message —
        // otherwise opening a room with several unread messages left #1
        // through #(n-1) permanently unread (readBy never touched), even
        // though the user just saw all of them.
        const { messages } = res.data.room;
        const myId = String(user?.id || user?._id || '');
        const unreadIDs = (messages || [])
          .filter((m) => {
            const authorId = String(m.author?._id || m.author?.id || '');
            const readBy = (m.readBy || []).map((r) => String(r?._id || r));
            return authorId !== myId && !readBy.includes(myId);
          })
          .map((m) => m._id);
        if (unreadIDs.length) {
          markMessageRead({ roomID: id, messageIDs: unreadIDs }).catch((err) => console.log(err));
        }
      })
      .catch((err) => {
        if (cancelled) return;
        dispatch({ type: Actions.SET_ROOM, room: null });
        dispatch({ type: Actions.SET_MESSAGES, messages: [] });
        setLoading(false);
        if (!err.response || err.response.status !== 404) setError(true);
      });

    return () => {
      cancelled = true;
      dispatch({ type: Actions.SET_ROOM, room: null });
      dispatch({ type: Actions.SET_MESSAGES, messages: [] });
    };
  }, [setLoading, id, vaultToken]);

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground chat-canvas-bg">
      <TopBar back={back} loading={loading} aiEnabled={aiEnabled} />

      {loading && (
        <div className="flex flex-1 flex-col items-center justify-center">
          <ClipLoader size={48} color="var(--primary, #e11d48)" loading={loading} />
        </div>
      )}

      {error && (
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          <div className="text-4xl font-bold text-destructive">Network Error</div>
          <div className="mt-2 text-xs text-muted-foreground">Could not reach the server. Please check your connection.</div>
        </div>
      )}

      {!room && !loading && !error && (
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          <div className="text-3xl font-bold text-foreground">Room Not Found</div>
          <div className="mt-2 text-xs text-muted-foreground">This conversation does not exist or may have been deleted.</div>
        </div>
      )}

      {room && !loading && <Messages aiEnabled={aiEnabled} />}

      <BottomBar aiEnabled={aiEnabled} />
    </div>
  );
}

export default Conversation;
