import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGlobal } from 'reactn';
import { toast } from 'react-toastify';
import moment from 'moment';
import { Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { previewMeetingInvite, acceptMeetingInvite } from '../../actions/meetingInvites';

// Spec §23 state machine: LOADING/INVALID/EXPIRED/REVOKED/AUTH_REQUIRED/
// READY_TO_ACCEPT/ACCEPTING/ACCEPTED/ERROR. Opening this page NEVER starts
// camera/mic permissions or joins the live call — it only accepts the
// invite (adds the user to Meeting.users) and hands off to the normal
// /meeting/:id route, which owns the actual join flow separately.
//
// Auth handoff: entryPath (set in init.js on first load, consumed by
// Login/index.jsx's applyToken) already carries this exact URL through
// login — "Log in to join" below just navigates to /login with no extra
// token-passing plumbing needed; the visitor lands back on this same
// /invite/m/:token afterward and this component re-fetches the preview
// from scratch (never trusting a cached pre-auth INVITE_VALID state, per
// spec §24).
function MeetingInvitePreview() {
  const { token } = useParams();
  const navigate = useNavigate();
  const authToken = useGlobal('token')[0];

  const [state, setState] = useState('loading');
  const [invite, setInvite] = useState(null);
  const [errorReason, setErrorReason] = useState(null);
  const [alreadyInMeetingId, setAlreadyInMeetingId] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    previewMeetingInvite(token, controller.signal)
      .then((res) => {
        setInvite(res.data);
        setState(authToken ? 'ready' : 'auth_required');
      })
      .catch((err) => {
        // Left undefined (not defaulted to INVITE_NOT_FOUND) when the
        // server sends no reason at all — errorCopy's own lookup below
        // falls back to the generic "no longer active" copy for that case,
        // reserving the more specific "invalid link" message for an actual
        // INVITE_NOT_FOUND response.
        setErrorReason(err.response?.data?.reason);
        setState('error');
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, authToken]);

  const onAccept = async () => {
    setState('accepting');
    try {
      const res = await acceptMeetingInvite(token);
      setState('accepted');
      toast.success('You joined the meeting invite.');
      navigate(`/meeting/${res.data.meeting.id}`, { replace: true });
    } catch (err) {
      // Real bug this guards against: the invite creator (or anyone
      // already on the call) opening their own link while still connected
      // used to accept-then-navigate straight into a SECOND join() call —
      // a genuine second mediasoup socket for the same user with no fresh
      // camera/mic grant, rendering as a media-less "ghost" tile in the
      // call grid. The backend now refuses acceptance outright
      // (ALREADY_IN_MEETING) when this user already has an active call
      // session for the meeting — surfaced here as its own state instead
      // of falling through to the generic error toast, since it's not a
      // failure, just "you don't need to accept, you're already there."
      if (err.response?.data?.reason === 'ALREADY_IN_MEETING') {
        setAlreadyInMeetingId(err.response.data.meeting?.id);
        setState('already_in_meeting');
        return;
      }
      toast.error('Could not accept this meeting invite.');
      setState('ready');
    }
  };

  const errorCopy = {
    INVITE_NOT_FOUND: 'This invite link is invalid.',
    INVITE_EXPIRED: 'This meeting invite has expired.',
    INVITE_EXHAUSTED: 'This meeting invite has reached its usage limit.',
    MEETING_NOT_FOUND: 'This meeting no longer exists.',
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
              <CardDescription>{errorCopy[errorReason] || 'This meeting invite is no longer active.'}</CardDescription>
            </CardHeader>
            <CardFooter className="justify-center">
              <Button variant="outline" onClick={() => navigate('/')}>
                Go to zeph.
              </Button>
            </CardFooter>
          </>
        )}

        {state === 'already_in_meeting' && (
          <>
            <CardHeader>
              <CardTitle>You&rsquo;re already in this meeting</CardTitle>
              <CardDescription>
                This invite doesn&rsquo;t need accepting again — you&rsquo;re already an active participant.
              </CardDescription>
            </CardHeader>
            <CardFooter className="justify-center">
              <Button onClick={() => navigate(`/meeting/${alreadyInMeetingId}`, { replace: true })} className="gap-1.5">
                <Video className="h-4 w-4" />
                Go to meeting
              </Button>
            </CardFooter>
          </>
        )}

        {invite && state !== 'loading' && state !== 'error' && state !== 'already_in_meeting' && (
          <>
            <CardHeader className="items-center">
              <Avatar
                className="h-16 w-16 border border-border bg-gradient-to-br from-primary/80 to-rose-700 text-white"
                size="lg"
              >
                <AvatarFallback className="bg-transparent text-lg font-bold text-white">
                  <Video className="h-6 w-6" />
                </AvatarFallback>
              </Avatar>
              <CardTitle className="mt-2">You&rsquo;re invited to a Zeph meeting</CardTitle>
              <CardDescription>{invite.meeting.title}</CardDescription>
              {invite.invitedBy && (
                <CardDescription className="text-[11px]">{`Invited by ${invite.invitedBy}`}</CardDescription>
              )}
              <CardDescription className="text-[11px]">
                {`Invite expires: ${moment(invite.expiresAt).calendar()}`}
              </CardDescription>
            </CardHeader>
            <CardFooter className="flex flex-col gap-2">
              {state === 'auth_required' ? (
                <>
                  <p className="text-xs text-muted-foreground">Sign in to Zeph to continue.</p>
                  <Button onClick={() => navigate('/login')} className="w-full gap-1.5">
                    Sign in to join
                  </Button>
                </>
              ) : (
                <Button onClick={onAccept} disabled={state === 'accepting'} className="w-full gap-1.5">
                  <Video className="h-4 w-4" />
                  {state === 'accepting' ? 'Joining…' : 'Join meeting'}
                </Button>
              )}
            </CardFooter>
          </>
        )}
      </Card>
    </div>
  );
}

export default MeetingInvitePreview;
