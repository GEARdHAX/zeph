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
    setLoading(true);
    getRoom(id, vaultToken)
      .then((res) => {
        dispatch({ type: Actions.SET_ROOM, room: res.data.room });
        dispatch({ type: Actions.SET_MESSAGES, messages: res.data.room.messages });
        setLoading(false);
        setError(false);
        dispatch({ type: Actions.MESSAGES_REMOVE_ROOM_UNREAD, roomID: id });

        const { messages } = res.data.room;
        if (messages?.length) {
          const lastMessage = messages[messages.length - 1];
          markMessageRead({ roomID: id, messageID: lastMessage._id }).catch((err) => console.log(err));
        }
      })
      .catch((err) => {
        dispatch({ type: Actions.SET_ROOM, room: null });
        dispatch({ type: Actions.SET_MESSAGES, messages: [] });
        setLoading(false);
        if (!err.response || err.response.status !== 404) setError(true);
      });
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

      {room && !loading && <Messages />}

      <BottomBar aiEnabled={aiEnabled} />
    </div>
  );
}

export default Conversation;
