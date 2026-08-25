import { useState } from 'react';
import { toast } from 'react-toastify';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { requestToJoinGroup } from '../../../actions/invites';

// Extracts a bare 24-hex Mongo id from either a raw id or a pasted URL
// (e.g. https://.../invite/g/<token> shares the same origin pattern people
// already copy — accepting a full URL is a courtesy, not a new concept:
// the group id itself, not the invite token, is what this route needs).
const extractGroupId = (input) => {
  const trimmed = input.trim();
  const match = trimmed.match(/[0-9a-f]{24}/i);
  return match ? match[0] : null;
};

function RequestToJoinGroup({ onClose }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const onSubmit = async (e) => {
    e.preventDefault();
    const groupId = extractGroupId(value);
    if (!groupId) {
      setError('Enter a valid group id.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await requestToJoinGroup(groupId);
      toast.success('Join request sent — an admin needs to approve it.');
      onClose();
    } catch (err) {
      const reason = err.response?.data?.reason;
      if (reason === 'ALREADY_MEMBER') setError('You are already a member of this group.');
      else if (reason === 'ALREADY_REQUESTED') setError('You already have a pending request for this group.');
      else setError('Could not send join request. Check the group id and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Request to Join a Group</DialogTitle>
          <DialogDescription>
            Enter a group id to send a join request. An admin will need to approve it.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={onSubmit}>
          <div className="grid gap-1.5">
            <Label htmlFor="join-request-group-id">Group ID</Label>
            <Input
              id="join-request-group-id"
              placeholder="e.g. 64f1a2b3c4d5e6f7a8b9c0d1"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
            />
            {error && <div className="text-[13px] text-destructive">{error}</div>}
          </div>
          <Button type="submit" disabled={busy || !value.trim()}>
            {busy ? 'Sending…' : 'Send Request'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default RequestToJoinGroup;
