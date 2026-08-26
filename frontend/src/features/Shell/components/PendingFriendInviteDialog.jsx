import { useEffect, useState } from 'react';
import { useGlobal } from 'reactn';
import { toast } from 'react-toastify';
import { UserPlus2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { previewFriendInvite, acceptFriendInvite } from '../../../actions/invites';
import Config from '../../../config';

// Shown once, right after a visitor registers via a /invite/f/:token link —
// Login/index.jsx stashes the token in pendingFriendInviteToken instead of
// navigating to the full-page invite preview, so a brand-new user lands in
// the app (Home) with this dialog on top, rather than on another
// interstitial page. Mirrors FriendInvitePreview.jsx's same preview/accept
// logic, just as a dialog instead of a route.
function PendingFriendInviteDialog() {
  const [token, setToken] = useGlobal('pendingFriendInviteToken');
  const [state, setState] = useState('loading'); // loading | ready | error | accepting
  const [inviter, setInviter] = useState(null);

  useEffect(() => {
    if (!token) return undefined;
    const controller = new AbortController();
    previewFriendInvite(token, controller.signal)
      .then((res) => {
        setInviter(res.data.inviter);
        setState('ready');
      })
      .catch(() => setState('error'));
    return () => controller.abort();
  }, [token]);

  if (!token) return null;

  const close = () => {
    setToken(null);
    setState('loading');
    setInviter(null);
  };

  const onAccept = async () => {
    setState('accepting');
    try {
      await acceptFriendInvite(token);
      toast.success(`You're now friends with ${inviter.firstName || inviter.username}!`);
      close();
    } catch (err) {
      toast.error(err.response?.data?.reason === 'ALREADY_FRIENDS' ? 'You are already friends.' : 'Could not accept invite.');
      close();
    }
  };

  const fullName = inviter ? `${inviter.firstName || ''} ${inviter.lastName || ''}`.trim() || inviter.username : '';
  const initials = inviter ? `${(inviter.firstName || 'U').charAt(0)}${(inviter.lastName || '').charAt(0)}`.toUpperCase() : '';

  return (
    <Dialog open onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-sm text-center">
        {state === 'loading' && (
          <div className="py-6 text-sm text-muted-foreground">Loading invite…</div>
        )}

        {state === 'error' && (
          <>
            <DialogHeader>
              <DialogTitle>Invite unavailable</DialogTitle>
              <DialogDescription>This invite link is invalid or has expired.</DialogDescription>
            </DialogHeader>
            <DialogFooter className="justify-center">
              <Button variant="outline" onClick={close}>Dismiss</Button>
            </DialogFooter>
          </>
        )}

        {inviter && (state === 'ready' || state === 'accepting') && (
          <>
            <DialogHeader className="items-center">
              <Avatar className="h-16 w-16 border border-border bg-gradient-to-br from-primary/80 to-rose-700 text-white">
                {inviter.picture && (
                  <img
                    src={`${Config.url || ''}/api/images/${inviter.picture.shieldedID}/256`}
                    alt=""
                    className="aspect-square size-full object-cover"
                  />
                )}
                <AvatarFallback className="bg-transparent text-lg font-bold text-white">{initials}</AvatarFallback>
              </Avatar>
              <DialogTitle className="mt-2">{fullName}</DialogTitle>
              <DialogDescription>{`@${inviter.username} invited you to connect on Chitcx`}</DialogDescription>
            </DialogHeader>
            <DialogFooter className="justify-center gap-2">
              <Button variant="ghost" onClick={close} disabled={state === 'accepting'}>Not now</Button>
              <Button onClick={onAccept} disabled={state === 'accepting'} className="gap-1.5">
                <UserPlus2 className="h-4 w-4" />
                {state === 'accepting' ? 'Adding…' : 'Add Friend'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default PendingFriendInviteDialog;
