import { useState } from 'react';
import { useGlobal } from 'reactn';
import { toast } from 'react-toastify';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import changeUsername from '../../../actions/changeUsername';

function ChangeUsernamePopup({ onClose }) {
  const [user, setUser] = useGlobal('user');
  const [username, setUsername] = useState(user.username || '');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await changeUsername(username);
      const newUser = { ...user, username: res.data.user.username };
      localStorage.setItem('user', JSON.stringify(newUser));
      await setUser(newUser);
      toast.success('Username updated!');
      onClose();
    } catch (err) {
      const reason = err.response?.data?.reason;
      if (reason === 'username_taken') setError('That username is already taken.');
      else if (reason === 'invalid_format') setError('Use 3-20 letters, numbers, or underscores.');
      else setError('Could not update username. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change username</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={onSubmit}>
          <div className="grid gap-1.5">
            <Label htmlFor="username">Username</Label>
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-muted-foreground">@</span>
              <Input
                id="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                maxLength={20}
              />
            </div>
            {error && <div className="text-[13px] text-destructive">{error}</div>}
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save Username'}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default ChangeUsernamePopup;
