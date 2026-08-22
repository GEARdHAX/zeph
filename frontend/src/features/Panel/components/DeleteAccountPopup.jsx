import { useState } from 'react';
import { useGlobal } from 'reactn';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import deleteAccount from '../../../actions/deleteAccount';

function DeleteAccountPopup({ onClose }) {
  const navigate = useNavigate();
  const setToken = useGlobal('token')[1];
  const setUser = useGlobal('user')[1];
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(password);
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      await setToken(null);
      await setUser({});
      toast.success('Your account has been deleted.');
      navigate('/login', { replace: true });
    } catch (err) {
      const reason = err.response?.data?.reason;
      if (reason === 'incorrect_password') setError('Incorrect password.');
      else setError('Could not delete your account. Please try again.');
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete your account?</DialogTitle>
          <DialogDescription>
            This permanently deletes your account. Your conversations are
            removed from your contacts&apos; inboxes, but message history is
            preserved for them, matching how deleting a single conversation
            already works. This can&apos;t be undone. Enter your password to confirm.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={onSubmit}>
          <div className="grid gap-1.5">
            <Label htmlFor="delete-account-password">Password</Label>
            <Input
              id="delete-account-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error && <div className="text-[13px] text-destructive">{error}</div>}
          </div>
          <Button type="submit" variant="destructive" disabled={busy || !password}>
            {busy ? 'Deleting…' : 'Permanently Delete My Account'}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default DeleteAccountPopup;
