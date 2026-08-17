import { useState } from 'react';
import { useGlobal } from 'reactn';
import moment from 'moment';
import { useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useSelector } from 'react-redux';
import { Unlock, Trash2 } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import unhideConversation from '../../../actions/unhideConversation';
import deleteConversation from '../../../actions/deleteConversation';
import Config from '../../../config';

// inVault + vaultToken: renders Unhide/Delete row actions instead of the
// normal click-through, used only when this row is rendered inside
// VaultUnlock.jsx's unlocked hidden-conversations list.
function Room({ room, inVault, vaultToken }) {
  const roomsWithNewMessages = useSelector((state) => state.messages.roomsWithNewMessages) || [];
  const user = useGlobal('user')[0] || {};
  const setOver = useGlobal('over')[1];
  const [vaultRooms, setVaultRooms] = useGlobal('vaultRooms');
  const [busy, setBusy] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();

  let other = {};

  room.people.forEach((person) => {
    if (user.id !== person._id) other = person;
  });

  if (!other.firstName) {
    other = { ...other, firstName: 'Deleted', lastName: 'User' };
  }

  const title = (room.isGroup ? room.title : `${other.firstName} ${other.lastName}`).substr(0, 22);

  let { lastMessage } = room;
  let text = '';

  if (!lastMessage && room.isGroup) text = 'New group created.';
  if (!lastMessage && !room.isGroup) text = `No messages with ${other.firstName} yet.`;

  if (!lastMessage) lastMessage = {};

  if (lastMessage.author === user.id && !room.isGroup) text += 'You: ';

  if (lastMessage.deletedForEveryone) {
    text += 'This message was deleted';
  } else {
    switch (lastMessage.type) {
      case 'file':
        text += 'Sent a file.';
        break;
      case 'image':
        text += 'Sent a picture.';
        break;
      default:
        text += lastMessage.content || '';
    }
  }

  const date = lastMessage?.date ? moment(lastMessage.date).format('MMM D') : '';
  const time = lastMessage?.date ? moment(lastMessage.date).format('h:mm A') : '';
  const isSelected = location.pathname.startsWith(`/room/${room._id}`);
  const hasUnread = roomsWithNewMessages.includes(room._id);

  const initials = (room.isGroup
    ? (room.title || 'G').charAt(0)
    : `${(other.firstName || 'U').charAt(0)}${(other.lastName || '').charAt(0)}`
  ).toUpperCase();

  const onSelect = () => {
    setOver(true);
    navigate(`/room/${room._id}`);
  };

  const onUnhide = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    try {
      await unhideConversation(room._id, vaultToken);
      setVaultRooms((vaultRooms || []).filter((r) => r._id !== room._id));
      toast.success('Conversation restored to your inbox.');
    } catch (err) {
      toast.error('Could not unhide this conversation.');
    } finally {
      setBusy(false);
    }
  };

  const onVaultDelete = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    try {
      await deleteConversation(room._id, vaultToken);
      setVaultRooms((vaultRooms || []).filter((r) => r._id !== room._id));
      toast.success('Conversation deleted.');
    } catch (err) {
      toast.error('Could not delete this conversation.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-3 py-1">
      <button
        type="button"
        onClick={inVault ? undefined : onSelect}
        className={cn(
          'group relative flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-all duration-200 hover:bg-accent/60',
          isSelected ? 'bg-accent shadow-xs border border-border text-foreground' : 'bg-transparent text-foreground',
        )}
      >
        {/* Avatar */}
        <div className="relative shrink-0">
          <Avatar className="h-10 w-10 border border-border bg-gradient-to-br from-rose-600 to-primary text-white font-bold">
            {other.picture && (
              <img
                src={`${Config.url || ''}/api/images/${other.picture.shieldedID}/256`}
                alt=""
                className="aspect-square size-full object-cover"
              />
            )}
            <AvatarFallback className="bg-transparent text-xs font-bold text-white">
              {initials}
            </AvatarFallback>
          </Avatar>
        </div>

        {/* Middle Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <span className="truncate text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
              {title}
            </span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {date || 'Today'}
            </span>
          </div>

          <div className="mt-0.5 flex items-center justify-between gap-1">
            <span className="truncate text-[11px] text-muted-foreground">
              {text}
            </span>
            <span className="shrink-0 text-[10px] text-muted-foreground/80">
              {time}
            </span>
          </div>
        </div>

        {/* Unread dot */}
        {!inVault && hasUnread && (
          <span className="absolute right-2.5 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-card" />
        )}
      </button>

      {inVault && (
        <div className="flex items-center justify-end gap-1.5 px-3 pb-1 pt-1.5">
          <Button type="button" variant="outline" size="sm" className="h-7 px-2.5 text-[11px]" onClick={onUnhide} disabled={busy}>
            <Unlock className="h-3 w-3" />
            Unhide
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-[11px] text-destructive hover:text-destructive"
            onClick={onVaultDelete}
            disabled={busy}
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </Button>
        </div>
      )}
    </div>
  );
}

export default Room;
