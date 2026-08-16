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
    getRoom(id)
      .then((res) => {
        dispatch({ type: Actions.SET_ROOM, room: res.data.room });
        dispatch({ type: Actions.SET_MESSAGES, messages: res.data.room.messages });
        setLoading(false);
        setError(false);
        dispatch({ type: Actions.MESSAGES_REMOVE_ROOM_UNREAD, roomID: id });

        const { messages } = res.data.room;
        if (messages.length) {
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
  }, [setLoading, id]);

  return (
    <div className="flex h-full flex-col justify-between">
      <TopBar back={back} loading={loading} aiEnabled={aiEnabled} />
      {loading && (
        <div className="flex flex-1 flex-col items-center justify-center">
          <ClipLoader size={60} color="#666" loading={loading} />
        </div>
      )}
      {error && (
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="text-center text-6xl font-bold">Network Error</div>
          <div className="text-center text-sm">Could not reach server.</div>
        </div>
      )}
      {!room && !loading && !error && (
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="text-center text-6xl font-bold">Room Not Found</div>
          <div className="text-center text-sm">
            This room does not exist.
            <br />
            This is probably a broken URL.
          </div>
        </div>
      )}
      {room && !loading && <Messages />}
      <BottomBar aiEnabled={aiEnabled} />
    </div>
  );
}

export default Conversation;
