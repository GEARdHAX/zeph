import { MessageSquare, UserCheck } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { useGlobal } from 'reactn';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import createRoom from '../../../actions/createRoom';
import Actions from '../../../constants/Actions';
import Config from '../../../config';

function User({ user }) {
  const setNav = useGlobal('nav')[1];

  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();

  const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username;
  const initials = `${(user.firstName || 'U').charAt(0)}${(user.lastName || '').charAt(0)}`.toUpperCase() || 'U';

  const chat = async () => {
    try {
      const res = await createRoom(user._id);
      setNav('rooms');
      const target = `/room/${res.data.room._id}`;
      dispatch({ type: Actions.SET_ROOM, room: res.data.room });
      dispatch({ type: Actions.SET_MESSAGES, messages: res.data.room.messages });
      if (location.pathname !== target) navigate(target, { replace: true });
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="px-3 py-1">
      <button
        type="button"
        className="group relative flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-all duration-200 hover:bg-white/[0.06] dark:hover:bg-white/[0.06] bg-transparent"
        onClick={chat}
      >
        {/* Avatar */}
        <div className="relative shrink-0">
          <Avatar className="h-10 w-10 border border-white/10 bg-gradient-to-br from-primary/80 to-rose-700 text-white font-bold">
            {user.picture && (
              <img
                src={`${Config.url || ''}/api/images/${user.picture.shieldedID}/256`}
                alt={fullName}
                className="aspect-square size-full object-cover"
              />
            )}
            <AvatarFallback className="bg-transparent text-xs font-bold text-white">
              {initials}
            </AvatarFallback>
          </Avatar>
        </div>

        {/* User Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
              {fullName}
            </span>
            {user.relationshipStatus === 'accepted' && (
              <Badge variant="secondary" className="shrink-0 gap-1 px-1.5 py-0 text-[10px]">
                <UserCheck className="h-2.5 w-2.5" />
                Friends
              </Badge>
            )}
          </div>

          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="truncate">{`@${user.username}`}</span>
            {user.email && (
              <>
                <span className="text-zinc-600">·</span>
                <span className="truncate">{user.email}</span>
              </>
            )}
          </div>
        </div>

        {/* Message Quick Action Button */}
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.04] text-muted-foreground transition-all group-hover:bg-primary group-hover:text-white">
          <MessageSquare className="h-4 w-4" />
        </div>
      </button>
    </div>
  );
}

export default User;
