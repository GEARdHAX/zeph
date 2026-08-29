import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGlobal } from 'reactn';
import { toast } from 'react-toastify';
import { UserPlus2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
} from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { previewFriendInvite, acceptFriendInvite } from '../../actions/invites';
import Config from '../../config';

function FriendInvitePreview() {
  const { token } = useParams();
  const navigate = useNavigate();
  const authToken = useGlobal('token')[0];

  const [state, setState] = useState('loading'); // loading | ready | error | accepting | accepted
  const [inviter, setInviter] = useState(null);
  const [errorReason, setErrorReason] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    previewFriendInvite(token, controller.signal)
      .then((res) => {
        setInviter(res.data.inviter);
        setState('ready');
      })
      .catch((err) => {
        setErrorReason(err.response?.data?.reason || 'INVITE_NOT_FOUND');
        setState('error');
      });
    return () => controller.abort();
  }, [token]);

  const onAccept = async () => {
    setState('accepting');
    try {
      await acceptFriendInvite(token);
      toast.success(`You're now friends with ${inviter.firstName || inviter.username}!`);
      navigate('/');
    } catch (err) {
      toast.error(err.response?.data?.reason === 'ALREADY_FRIENDS' ? 'You are already friends.' : 'Could not accept invite.');
      setState('ready');
    }
  };

  const fullName = inviter ? `${inviter.firstName || ''} ${inviter.lastName || ''}`.trim() || inviter.username : '';
  const initials = inviter ? `${(inviter.firstName || 'U').charAt(0)}${(inviter.lastName || '').charAt(0)}`.toUpperCase() : '';

  return (
    <div className="flex h-full w-full items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm text-center">
        {state === 'loading' && (
          <CardContent className="py-10 text-sm text-muted-foreground">Loading invite…</CardContent>
        )}

        {state === 'error' && (
          <>
            <CardHeader>
              <CardTitle>Invite unavailable</CardTitle>
              <CardDescription>
                {errorReason === 'INVITE_NOT_FOUND' && 'This invite link is invalid or has expired.'}
              </CardDescription>
            </CardHeader>
            <CardFooter className="justify-center">
              <Button variant="outline" onClick={() => navigate('/')}>Go to zeph.</Button>
            </CardFooter>
          </>
        )}

        {inviter && state !== 'loading' && state !== 'error' && (
          <>
            <CardHeader className="items-center">
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
              <CardTitle className="mt-2">{fullName}</CardTitle>
              <CardDescription>{`@${inviter.username} invited you to connect on zeph.`}</CardDescription>
            </CardHeader>
            <CardFooter className="justify-center">
              <Button
                onClick={authToken ? onAccept : () => navigate('/login')}
                disabled={state === 'accepting'}
                className="gap-1.5"
              >
                <UserPlus2 className="h-4 w-4" />
                {authToken ? (state === 'accepting' ? 'Adding…' : 'Add Friend') : 'Log in to accept'}
              </Button>
            </CardFooter>
          </>
        )}
      </Card>
    </div>
  );
}

export default FriendInvitePreview;
