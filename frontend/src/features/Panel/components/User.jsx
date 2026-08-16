import { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { useGlobal } from 'reactn';
import Picture from '../../../components/Picture';
import createRoom from '../../../actions/createRoom';
import Actions from '../../../constants/Actions';

function User({ user }) {
  const [hover, setHover] = useState(false);
  const setNav = useGlobal('nav')[1];

  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();

  const title = `${user.firstName} ${user.lastName}`.substr(0, 22);

  const chat = async () => {
    const res = await createRoom(user._id);
    setNav('rooms');
    const target = `/room/${res.data.room._id}`;
    dispatch({ type: Actions.SET_ROOM, room: res.data.room });
    dispatch({ type: Actions.SET_MESSAGES, messages: res.data.room.messages });
    if (location.pathname !== target) navigate(target, { replace: true });
  };

  return (
    <div
      className="flex h-[54px] cursor-pointer items-center border-b hover:bg-muted"
      onMouseOver={() => setHover(true)}
      onFocus={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onBlur={() => setHover(false)}
      onClick={chat}
    >
      <div className="mx-3 h-10 w-10 shrink-0 overflow-hidden rounded-full [&_.img]:flex [&_.img]:h-10 [&_.img]:w-10 [&_.img]:items-center [&_.img]:justify-center [&_.img]:bg-secondary [&_.img]:text-lg [&_.img]:text-secondary-foreground">
        <Picture user={user} />
      </div>
      <div className="flex flex-1 flex-col justify-center">
        <div className="text-[13px] font-bold">
          {title}
          {title.length > 22 && '...'}
        </div>
      </div>
      {!hover && (
        <div className="flex items-center pr-2">
          <div className="text-[10px] text-muted-foreground">{`@${user.username}`}</div>
        </div>
      )}
      {hover && (
        <div className="flex items-center pr-2">
          <div className="flex items-center p-1 text-muted-foreground">
            <MessageSquare className="h-4 w-4" />
          </div>
        </div>
      )}
    </div>
  );
}

export default User;
