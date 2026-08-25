import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import {
  Copy, Share2, QrCode, UserPlus, Check,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { createGroupInvite, addGroupMember } from '../../../actions/invites';
import getFriends from '../../../actions/getFriends';
import Config from '../../../config';

function FriendRow({ friend, added, adding, onAdd }) {
  const fullName = `${friend.firstName || ''} ${friend.lastName || ''}`.trim() || friend.username;
  const initials = `${(friend.firstName || 'U').charAt(0)}${(friend.lastName || '').charAt(0)}`.toUpperCase() || 'U';

  return (
    <div className="flex w-full items-center gap-2.5 rounded-xl p-1.5">
      <Avatar className="h-8 w-8 border border-border bg-gradient-to-br from-primary/80 to-rose-700 text-white font-bold">
        {friend.picture && (
          <img
            src={`${Config.url || ''}/api/images/${friend.picture.shieldedID}/256`}
            alt=""
            className="aspect-square size-full object-cover"
          />
        )}
        <AvatarFallback className="bg-transparent text-[10px] font-bold text-white">{initials}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold text-foreground">{fullName}</div>
        <div className="truncate text-[11px] text-muted-foreground">{`@${friend.username}`}</div>
      </div>
      <Button
        type="button"
        size="sm"
        variant={added ? 'ghost' : 'secondary'}
        disabled={added || adding}
        onClick={() => onAdd(friend._id)}
        className="shrink-0 gap-1 text-[11px]"
      >
        {added ? <Check className="h-3.5 w-3.5 text-primary" /> : <UserPlus className="h-3.5 w-3.5" />}
        {added ? 'Added' : 'Add'}
      </Button>
    </div>
  );
}

function InviteGroup({
  groupId, groupName, existingMemberIds = [], onClose,
}) {
  const [url, setUrl] = useState(null);
  const [showQr, setShowQr] = useState(false);
  const [friends, setFriends] = useState([]);
  const [addedIds, setAddedIds] = useState([]);
  const [addingId, setAddingId] = useState(null);

  useEffect(() => {
    createGroupInvite(groupId)
      .then((res) => setUrl(`${window.location.origin}${res.data.url}`))
      .catch(() => toast.error('Could not create invite link.'));
  }, [groupId]);

  useEffect(() => {
    getFriends()
      .then((res) => setFriends(res.data.users || []))
      .catch(() => toast.error('Could not load your friends list.'));
  }, []);

  const existingIds = new Set(existingMemberIds.map((id) => id.toString()));
  const invitableFriends = friends.filter((f) => !existingIds.has(f._id.toString()));

  const onAddFriend = async (userId) => {
    setAddingId(userId);
    try {
      await addGroupMember(groupId, userId);
      setAddedIds((prev) => [...prev, userId]);
      toast.success('Added to the group.');
    } catch (err) {
      toast.error('Could not add this friend.');
    } finally {
      setAddingId(null);
    }
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Invite link copied.');
    } catch (err) {
      toast.error('Could not copy link.');
    }
  };

  const onShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: `Join ${groupName} on Chitcx`, url });
      } catch (err) {
        // User cancelled the native share sheet — not an error.
      }
    } else {
      onCopy();
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Invite Members</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">{`Share this link to invite people to ${groupName || 'the group'}.`}</p>

        {showQr && url && (
          <div className="flex items-center justify-center rounded-xl border border-border bg-white p-6">
            <QRCodeSVG value={url} size={220} marginSize={2} />
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Button onClick={onCopy} disabled={!url} variant="secondary" className="justify-start gap-2">
            <Copy className="h-4 w-4" />
            Copy Link
          </Button>
          <Button onClick={onShare} disabled={!url} variant="secondary" className="justify-start gap-2">
            <Share2 className="h-4 w-4" />
            Share
          </Button>
          <Button onClick={() => setShowQr((v) => !v)} disabled={!url} variant="secondary" className="justify-start gap-2">
            <QrCode className="h-4 w-4" />
            {showQr ? 'Hide QR' : 'Show QR'}
          </Button>
        </div>

        {invitableFriends.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-border/60 pt-3">
            <p className="mb-1 text-[11px] font-semibold text-muted-foreground">Add from your friends</p>
            <div className="flex max-h-[220px] flex-col gap-0.5 overflow-y-auto">
              {invitableFriends.map((friend) => (
                <FriendRow
                  key={friend._id}
                  friend={friend}
                  added={addedIds.includes(friend._id)}
                  adding={addingId === friend._id}
                  onAdd={onAddFriend}
                />
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default InviteGroup;
