import { useEffect, useState } from 'react';
import moment from 'moment';
import { toast } from 'react-toastify';
import { Fingerprint, Trash2, Plus } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  listPasskeys, registerPasskey, deletePasskey, passkeySupported,
} from '../../../actions/passkey';

function PasskeysPopup({ onClose }) {
  const [passkeys, setPasskeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('');

  const load = () => {
    listPasskeys()
      .then((res) => setPasskeys(res.data.passkeys))
      .catch(() => toast.error('Could not load your passkeys.'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const add = async () => {
    setBusy(true);
    try {
      await registerPasskey(label.trim());
      setLabel('');
      toast.success('Passkey added. You can now sign in with it.');
      load();
    } catch (err) {
      if (err && err.name === 'NotAllowedError') { /* user cancelled the OS prompt */ } else if (err?.response?.data?.reason === 'already_registered') {
        toast.error('That device is already registered.');
      } else {
        toast.error('Could not add a passkey. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    try {
      await deletePasskey(id);
      setPasskeys((prev) => prev.filter((p) => p._id !== id));
    } catch (e) {
      toast.error('Could not remove that passkey.');
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Passkeys</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Sign in with your fingerprint, face, or device passcode instead of a password.
        </p>

        {!passkeySupported() && (
          <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-3 text-xs text-muted-foreground">
            This browser does not support passkeys.
          </div>
        )}

        {passkeySupported() && (
          <>
            <div className="flex max-h-[300px] flex-col gap-2 overflow-y-auto">
              {loading && <div className="text-center text-sm text-muted-foreground">Loading…</div>}
              {!loading && passkeys.length === 0 && (
                <div className="text-center text-sm text-muted-foreground">No passkeys yet.</div>
              )}
              {passkeys.map((p) => (
                <div key={p._id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-card/50 p-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Fingerprint className="h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{p.label || 'Passkey'}</div>
                      <div className="text-xs text-muted-foreground">
                        {`Added ${moment(p.createdAt).fromNow()}`}
                        {p.lastUsedAt ? ` · last used ${moment(p.lastUsedAt).fromNow()}` : ''}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 shrink-0 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => remove(p._id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Input
                placeholder="Name this device (optional)"
                value={label}
                maxLength={60}
                onChange={(e) => setLabel(e.target.value)}
                className="h-10 rounded-xl"
              />
              <Button type="button" disabled={busy} onClick={add} className="h-10 shrink-0 gap-1.5 rounded-xl">
                <Plus className="h-4 w-4" />
                {busy ? 'Waiting…' : 'Add'}
              </Button>
            </div>
          </>
        )}

        <Button type="button" variant="secondary" onClick={() => onClose()}>Close</Button>
      </DialogContent>
    </Dialog>
  );
}

export default PasskeysPopup;
