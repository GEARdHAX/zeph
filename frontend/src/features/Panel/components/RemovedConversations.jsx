import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import { ArchiveRestore } from 'lucide-react';
import getRemovedConversations from '../../../actions/getRemovedConversations';
import Room from './Room';

// Lists conversations THIS user has removed from their own inbox (the
// trash-can button on a normal Room row — conversation/delete.js's
// per-user tombstone), with a Restore action on each. Closes a real gap: a
// removed conversation previously only reappeared passively, when someone
// else sent a new message into it (message.js's reappearance logic) — if
// every member removed it and nobody had a saved URL/invite link, there
// was no way for anyone to find their way back to a group they were still
// a real member of. No lock/PIN gate here (unlike VaultUnlock.jsx's
// isHidden flow) — removal was never a security boundary, just a per-user
// "don't show me this" preference.
function RemovedConversations() {
  const [rooms, setRooms] = useState(null);

  const load = useCallback(() => {
    getRemovedConversations()
      .then((res) => setRooms(res.data.rooms))
      .catch(() => toast.error('Could not load removed conversations.'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // A restored row should disappear from THIS list immediately, not wait
  // on a full refetch — same "patch local state, don't round-trip" idiom
  // VaultUnlock.jsx's onUnhide uses via setVaultRooms.
  const onRestored = (roomId) => {
    setRooms((prev) => (prev || []).filter((r) => r._id !== roomId));
  };

  if (rooms === null) {
    return <div className="flex flex-1 items-center justify-center p-8 text-xs text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
        <ArchiveRestore className="h-3.5 w-3.5" />
        Removed conversations
      </div>
      {rooms.length === 0 && (
        <div className="p-8 text-center text-xs text-muted-foreground">
          No removed conversations. Anything you remove from your inbox shows up here.
        </div>
      )}
      {rooms.map((room) => (
        <Room key={room._id} room={room} removed onRestored={onRestored} />
      ))}
    </div>
  );
}

export default RemovedConversations;
