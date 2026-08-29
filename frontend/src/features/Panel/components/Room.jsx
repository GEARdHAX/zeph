import { useState } from 'react';
import { useGlobal } from 'reactn';
import moment from 'moment';
import { useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useSelector, useDispatch } from 'react-redux';
import { Unlock, Trash2, ArchiveRestore } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import unhideConversation from '../../../actions/unhideConversation';
import deleteConversation from '../../../actions/deleteConversation';
import restoreConversation from '../../../actions/restoreConversation';
import Actions from '../../../constants/Actions';
import Config from '../../../config';

// inVault + vaultToken: renders Unhide/Delete row actions instead of the
// normal click-through, used only when this row is rendered inside
// VaultUnlock.jsx's unlocked hidden-conversations list.
//
// removed + onRestored: renders a single Restore action instead of the
// normal click-through, used only inside RemovedConversations.jsx's list
// of conversations THIS user has deleted from their own inbox (a plain
// per-user tombstone, unrelated to the Private Vault's isHidden/vault-auth
// concept above — the two are independent conversation states with their
// own list/restore routes).
function Room({
  room, inVault, vaultToken, removed, onRestored,
}) {
  const roomsWithNewMessages = useSelector((state) => state.messages.roomsWithNewMessages) || [];
  const user = useGlobal('user')[0] || {};
  const setOver = useGlobal('over')[1];
  const [vaultRooms, setVaultRooms] = useGlobal('vaultRooms');
  const [busy, setBusy] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();

  let other = {};

  room.people.forEach((person) => {
    if (user.id !== person._id) other = person;
  });

  // "Deleted User" only when the other participant genuinely couldn't be
  // resolved at all (their account was removed — Mongoose leaves a dangling
  // unpopulated ObjectId with no _id property in that case). A real,
  // existing account with no firstName/lastName set is a different,
  // unrelated situation — fall back to their @username instead of
  // mislabeling a live account as deleted.
  if (!other._id) {
    other = { ...other, firstName: 'Deleted', lastName: 'User' };
  } else if (!other.firstName && !other.lastName) {
    other = { ...other, firstName: `@${other.username || 'user'}`, lastName: '' };
  }

  const title = (room.isGroup ? room.title : `${other.firstName} ${other.lastName}`).substr(0, 22);

  let { lastMessage } = room;
  let text = '';

  // "New group created." only fits a genuinely brand-new group — a rejoined
  // member with no visible lastMessage (list-rooms.js nulls it out past
  // their own deletedBefore cutoff, see DECISIONS.md) would see the same
  // stale/wrong line otherwise.
  if (!lastMessage && room.isGroup) text = 'No messages here yet.';
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

  const onRestore = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    try {
      await restoreConversation(room._id);
      onRestored?.(room._id);
      toast.success('Conversation restored to your inbox.');
    } catch (err) {
      toast.error('Could not restore this conversation.');
    } finally {
      setBusy(false);
    }
  };

  // Normal (non-vault) inbox row — the only other delete entry point is
  // BottomBar's "Delete Group DM" button, which only renders once a room is
  // actually open. A group the owner already deleted (Room.disabledAt) 404s
  // on open ("Room Not Found"), so a remaining member/the owner themselves
  // had no way at all to clear it from their own sidebar — conversation/
  // delete.js itself doesn't gate on disabledAt (a per-user tombstone, not a
  // room mutation), only the open-room read routes do. Dispatches the same
  // CONVERSATION_DELETED action the live socket event uses, so this row
  // disappears immediately without waiting for a round trip.
  const onDelete = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    try {
      await deleteConversation(room._id);
      dispatch({ type: Actions.CONVERSATION_DELETED, conversationId: room._id });
      toast.success('Conversation removed from your inbox.');
      // Only redirect if the deleted row is the one currently open — deleting
      // a DIFFERENT row from the sidebar must not yank the user away from
      // whatever conversation they're actively looking at.
      if (isSelected) navigate('/', { replace: true });
    } catch (err) {
      toast.error('Could not remove this conversation.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="group/row relative px-3 py-1">
      <button
        type="button"
        onClick={(inVault || removed) ? undefined : onSelect}
        className={cn(
          'group relative flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-all duration-200 hover:bg-accent/60',
          isSelected ? 'bg-accent shadow-xs border border-border text-foreground' : 'bg-transparent text-foreground',
        )}
      >
        {/* Avatar */}
        <div className="relative shrink-0">
          <Avatar className="h-10 w-10 border border-border bg-gradient-to-br from-rose-600 to-primary text-white font-bold">
            {(room.isGroup ? room.picture : other.picture) && (
              <img
                src={`${Config.url || ''}/api/images/${(room.isGroup ? room.picture : other.picture).shieldedID}/256`}
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
            {/* Hidden on row hover for plain (non-vault, non-removed) rows,
                same as the unread dot below — the delete button (a sibling,
                absolutely positioned to land in this exact spot) swaps in
                instead of overlapping it. Vault/removed rows have no delete
                button here (their own action row sits below instead), so
                their date never needs to hide. */}
            <span
              className={cn(
                'shrink-0 text-[10px] text-muted-foreground transition-opacity',
                !inVault && !removed && 'group-hover/row:opacity-0',
              )}
            >
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

        {/* Unread dot — hidden on row hover so it never overlaps the
            hover-revealed delete button below, which sits in the same
            top-right corner. */}
        {!inVault && !removed && hasUnread && (
          <span className="absolute right-2.5 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-card transition-opacity group-hover/row:opacity-0" />
        )}
      </button>

      {/* Remove-from-inbox — hover-revealed so it doesn't compete with the
          unread dot/timestamp for space on every row at rest. The only
          other delete entry point (BottomBar's "Delete Group DM") requires
          the room to open successfully first, which a group the owner
          already deleted never does (404s as "Room Not Found") — leaving no
          way to clear it from the sidebar without this.

          Positioned to land exactly where the date span above sits (which
          fades out on hover), not at the row's vertical center — the two
          were previously measured against different reference boxes (this
          button against the outer px-3 wrapper, the date text against the
          inner p-3 button's own content box), so on hover the icon visibly
          overlapped "Aug 29" / "7:24 PM" instead of cleanly replacing it.
          right-6 = outer px-3 (12px) + inner p-3 (12px) so its right edge
          lines up with the date text's right edge; top-3 matches the inner
          button's own top padding, landing on the same line as the date. */}
      {!inVault && !removed && (
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          aria-label="Remove conversation"
          title="Remove from inbox"
          className="absolute right-6 top-3 rounded-full p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover/row:opacity-100 disabled:opacity-50 cursor-pointer"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}

      {removed && (
        <div className="flex items-center justify-end px-3 pb-1 pt-1.5">
          <Button type="button" variant="outline" size="sm" className="h-7 px-2.5 text-[11px]" onClick={onRestore} disabled={busy}>
            <ArchiveRestore className="h-3 w-3" />
            Restore
          </Button>
        </div>
      )}

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
