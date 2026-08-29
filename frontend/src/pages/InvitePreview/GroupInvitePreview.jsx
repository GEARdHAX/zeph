import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGlobal } from 'reactn';
import { toast } from 'react-toastify';
import { Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
} from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { previewGroupInvite, joinGroupInvite } from '../../actions/invites';
import Config from '../../config';

function GroupInvitePreview() {
  const { token } = useParams();
  const navigate = useNavigate();
  const authToken = useGlobal('token')[0];

  const [state, setState] = useState('loading'); // loading | ready | error | joining
  const [group, setGroup] = useState(null);
  const [errorReason, setErrorReason] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    previewGroupInvite(token, controller.signal)
      .then((res) => {
        setGroup(res.data.group);
        setState('ready');
      })
      .catch((err) => {
        setErrorReason(err.response?.data?.reason || 'INVITE_NOT_FOUND');
        setState('error');
      });
    return () => controller.abort();
  }, [token]);

  const onJoin = async () => {
    setState('joining');
    try {
      const res = await joinGroupInvite(token);
      toast.success(`You joined ${res.data.group.name}!`);
      navigate(`/room/${res.data.group._id}`);
    } catch (err) {
      const reason = err.response?.data?.reason;
      toast.error(reason === 'ALREADY_MEMBER' ? 'You are already a member.' : 'Could not join group.');
      setState('ready');
    }
  };

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
                {errorReason === 'INVITE_LIMIT_REACHED' ? 'This invite link has reached its usage limit.' : 'This invite link is invalid or has expired.'}
              </CardDescription>
            </CardHeader>
            <CardFooter className="justify-center">
              <Button variant="outline" onClick={() => navigate('/')}>Go to zeph.</Button>
            </CardFooter>
          </>
        )}

        {group && state !== 'loading' && state !== 'error' && (
          <>
            <CardHeader className="items-center">
              <Avatar className="h-16 w-16 border border-border bg-gradient-to-br from-primary/80 to-rose-700 text-white" size="lg">
                {group.avatar && (
                  <img
                    src={`${Config.url || ''}/api/images/${group.avatar.shieldedID}/256`}
                    alt=""
                    className="aspect-square size-full object-cover"
                  />
                )}
                <AvatarFallback className="bg-transparent text-lg font-bold text-white">
                  <Users className="h-6 w-6" />
                </AvatarFallback>
              </Avatar>
              <CardTitle className="mt-2">{group.name}</CardTitle>
              <CardDescription>
                {`${group.memberCount} member${group.memberCount === 1 ? '' : 's'}`}
              </CardDescription>
            </CardHeader>
            <CardFooter className="justify-center">
              <Button
                onClick={authToken ? onJoin : () => navigate('/login')}
                disabled={state === 'joining'}
                className="gap-1.5"
              >
                <Users className="h-4 w-4" />
                {authToken ? (state === 'joining' ? 'Joining…' : 'Join Group') : 'Log in to join'}
              </Button>
            </CardFooter>
          </>
        )}
      </Card>
    </div>
  );
}

export default GroupInvitePreview;
