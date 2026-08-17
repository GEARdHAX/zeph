import { useState, useEffect, useCallback } from 'react';
import { useGlobal } from 'reactn';
import { toast } from 'react-toastify';
import { Lock, Fingerprint, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import getVaultStatus from '../../../actions/getVaultStatus';
import getVaultList from '../../../actions/getVaultList';
import unlockVaultPin from '../../../actions/unlockVaultPin';
import setupVaultPin from '../../../actions/setupVaultPin';
import { registerVaultPasskey, unlockVaultWithPasskey } from '../../../actions/vaultWebauthn';
import Room from './Room';

// Vault flow: normal inbox -> hidden DM absent -> Private Vault -> unlock ->
// fetch only this authenticated user's hidden conversations -> open DM.
// A vault secret being unconfigured is treated as its own screen (first-time
// PIN setup) rather than folded into the unlock form, per the product
// decision to prompt setup lazily on first use.
function VaultUnlock() {
  const [vaultToken, setVaultToken] = useGlobal('vaultToken');
  const [vaultRooms, setVaultRooms] = useGlobal('vaultRooms');
  const [status, setStatus] = useState(null);
  const [pin, setPin] = useState('');
  const [setupPin, setSetupPin] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getVaultStatus().then((res) => setStatus(res.data)).catch(() => setStatus({ configured: false }));
  }, []);

  const loadVaultList = useCallback((token) => {
    getVaultList(token)
      .then((res) => setVaultRooms(res.data.rooms))
      .catch(() => toast.error('Could not load your Private Vault.'));
  }, [setVaultRooms]);

  useEffect(() => {
    if (vaultToken) loadVaultList(vaultToken);
  }, [vaultToken, loadVaultList]);

  const unlockWithPin = async () => {
    setBusy(true);
    try {
      const res = await unlockVaultPin(pin);
      setPin('');
      setVaultToken(res.data.vaultToken);
    } catch (e) {
      toast.error('Incorrect PIN.');
    } finally {
      setBusy(false);
    }
  };

  const unlockWithPasskey = async () => {
    setBusy(true);
    try {
      const res = await unlockVaultWithPasskey();
      setVaultToken(res.data.vaultToken);
    } catch (e) {
      toast.error('Passkey unlock failed or was cancelled.');
    } finally {
      setBusy(false);
    }
  };

  const completeSetup = async () => {
    if (setupPin.length < 4) {
      toast.error('Choose a PIN with at least 4 digits.');
      return;
    }
    setBusy(true);
    try {
      await setupVaultPin(setupPin);
      const unlockRes = await unlockVaultPin(setupPin);
      setSetupPin('');
      setVaultToken(unlockRes.data.vaultToken);
      toast.success('Private Vault set up.');
    } catch (e) {
      toast.error('Could not set up your vault. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const addPasskey = async () => {
    setBusy(true);
    try {
      await registerVaultPasskey(vaultToken);
      toast.success('Passkey added to your Private Vault.');
    } catch (e) {
      toast.error('Could not add a passkey. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (status === null) {
    return <div className="flex flex-1 items-center justify-center p-8 text-xs text-muted-foreground">Loading…</div>;
  }

  // Unlocked: show the hidden-conversations list.
  if (vaultToken) {
    return (
      <div className="flex flex-1 flex-col overflow-y-auto">
        <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          Private Vault unlocked
          {!status.hasPasskey && (
            <Button type="button" variant="ghost" size="sm" className="ml-auto h-7 px-2 text-[11px]" onClick={addPasskey} disabled={busy}>
              Add passkey
            </Button>
          )}
        </div>
        {(vaultRooms || []).length === 0 && (
          <div className="p-8 text-center text-xs text-muted-foreground">No hidden conversations.</div>
        )}
        {(vaultRooms || []).map((room) => (
          <Room key={room._id} room={room} vaultToken={vaultToken} inVault />
        ))}
      </div>
    );
  }

  // Locked, no vault configured yet: first-time setup.
  if (!status.configured) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <Lock className="h-8 w-8 text-muted-foreground" />
        <div>
          <div className="text-sm font-semibold text-foreground">Set up your Private Vault</div>
          <div className="mt-1 text-xs text-muted-foreground">Choose a PIN to protect hidden conversations.</div>
        </div>
        <div className="flex w-full max-w-[220px] flex-col gap-1.5">
          <Label htmlFor="vault-first-setup-pin">Vault PIN</Label>
          <Input
            id="vault-first-setup-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            placeholder="4-12 digits"
            value={setupPin}
            onChange={(e) => setSetupPin(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <Button type="button" onClick={completeSetup} disabled={busy} className="w-full max-w-[220px]">
          Set PIN
        </Button>
      </div>
    );
  }

  // Locked, vault already configured: unlock screen.
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <Lock className="h-8 w-8 text-muted-foreground" />
      <div>
        <div className="text-sm font-semibold text-foreground">Private Vault</div>
        <div className="mt-1 text-xs text-muted-foreground">Unlock to view hidden conversations.</div>
      </div>

      {status.hasPasskey && (
        <Button type="button" onClick={unlockWithPasskey} disabled={busy} className="w-full max-w-[220px]">
          <Fingerprint className="h-4 w-4" />
          Unlock with Passkey
        </Button>
      )}

      {status.hasPin && (
        <div className="flex w-full max-w-[220px] flex-col gap-1.5">
          <Label htmlFor="vault-unlock-pin">PIN</Label>
          <Input
            id="vault-unlock-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
          <Button type="button" variant="outline" onClick={unlockWithPin} disabled={busy || pin.length < 4}>
            Unlock with PIN
          </Button>
        </div>
      )}
    </div>
  );
}

export default VaultUnlock;
