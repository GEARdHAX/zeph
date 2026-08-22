import { useEffect, useState } from 'react';
import {
  MessageSquare, UserPlus, Check, UserCheck, ShieldOff, Flag, Users,
} from 'lucide-react';
import { toast } from 'react-toastify';
import { useGlobal } from 'reactn';
import moment from 'moment';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import resolveUser from '../../../actions/resolveUser';
import sendFriendRequest from '../../../actions/sendFriendRequest';
import respondFriendRequest from '../../../actions/respondFriendRequest';
import blockUser from '../../../actions/blockUser';
import Config from '../../../config';
import BioText from '../../../components/BioText';

// Universal profile viewer — replaces the old ProfilePreview (AddPeople.jsx)
// everywhere a user's identity is clickable: group member list (Room.jsx),
// search results (AddPeople.jsx), and a message author's avatar
// (Message.jsx). Same {username, onClose, onOpenChat} props ProfilePreview
// took, so every call site only needed an import swap.
function ProfileView({ username, onClose, onOpenChat }) {
  const loggedInUser = useGlobal('user')[0] || {};
  const [profile, setProfile] = useState(null);
  const [relationship, setRelationship] = useState(null);
  const [commonGroups, setCommonGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    resolveUser(username)
      .then((res) => {
        setProfile(res.data.user);
        setRelationship(res.data.relationship);
        setCommonGroups(res.data.commonGroups || []);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [username]);

  const fullName = profile ? `${profile.firstName || ''} ${profile.lastName || ''}`.trim() || profile.username : '';
  const initials = profile
    ? `${(profile.firstName || 'U').charAt(0)}${(profile.lastName || '').charAt(0)}`.toUpperCase() || 'U'
    : '';

  const isSelf = !!(profile && loggedInUser
    && (loggedInUser.id === profile._id || loggedInUser._id === profile._id));

  // Dynamic secondary-action states per the relationship: NONE, PENDING_SENT,
  // PENDING_RECEIVED, ACCEPTED, BLOCKED. Start Chat stays primary and always
  // available (messaging-first) except when blocked.
  const status = relationship?.status;
  const isBlocked = status === 'blocked';
  const isAccepted = status === 'accepted';
  const isPendingSent = status === 'pending' && relationship?.direction === 'outgoing';
  const isPendingReceived = status === 'pending' && relationship?.direction === 'incoming';

  const sendRequest = async () => {
    // Optimistic: flip to "Requested" the instant the click happens, not
    // after the round-trip — this is what actually stops a rapid second
    // click, since the button re-renders disabled before the network call
    // even resolves. Server-side, the unique index + policy check are the
    // real enforcement; this is UX responsiveness only.
    const previousRelationship = relationship;
    setRelationship({ status: 'pending', direction: 'outgoing' });
    setBusy(true);
    try {
      await sendFriendRequest(username);
      toast.success('Request sent.');
    } catch (err) {
      if (err.response?.status === 409) {
        if (err.response?.data?.reason === 'blocked') {
          setRelationship({ status: 'blocked', direction: null });
        }
      } else {
        setRelationship(previousRelationship);
        toast.error('Could not send request.');
      }
    } finally {
      setBusy(false);
    }
  };

  const acceptRequest = async () => {
    setBusy(true);
    try {
      await respondFriendRequest(relationship._id, 'accept');
      setRelationship({ status: 'accepted', direction: null, respondedAt: new Date().toISOString() });
      toast.success('Request accepted.');
    } catch (err) {
      toast.error('Could not accept request.');
    } finally {
      setBusy(false);
    }
  };

  const block = async () => {
    setBusy(true);
    try {
      await blockUser(username);
      setRelationship({ status: 'blocked', direction: null });
      setCommonGroups([]);
      toast.success(`Blocked @${username}.`);
    } catch (err) {
      toast.error('Could not block this user.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Profile</DialogTitle>
        </DialogHeader>

        {loading && <div className="py-6 text-center text-xs text-muted-foreground">Loading…</div>}
        {error && <div className="py-6 text-center text-xs text-muted-foreground">Couldn&apos;t find that user.</div>}

        {profile && (
          <div className="flex flex-col items-center gap-3 py-2">
            <Avatar className="h-20 w-20 border-2 border-border bg-gradient-to-br from-primary/80 to-rose-700 text-2xl font-extrabold text-white shadow-md">
              {profile.picture && (
                <img
                  src={`${Config.url || ''}/api/images/${profile.picture.shieldedID}/256`}
                  alt=""
                  className="aspect-square size-full object-cover"
                />
              )}
              <AvatarFallback className="bg-transparent text-2xl font-bold text-white">{initials}</AvatarFallback>
            </Avatar>
            <div className="text-center">
              <div className="text-sm font-bold text-foreground">{fullName}</div>
              <div className="text-xs text-muted-foreground">{`@${profile.username}`}</div>
              {profile.tagLine && !isBlocked && <div className="mt-1 text-xs text-muted-foreground">{profile.tagLine}</div>}
            </div>

            {profile.bio && !isBlocked && (
              <BioText text={profile.bio} className="block w-full text-center text-xs leading-relaxed text-foreground" />
            )}

            {isSelf && (
              <div className="mt-1 text-[11px] font-medium text-muted-foreground">This is you</div>
            )}

            {!isSelf && isBlocked && (
              <div className="mt-2 w-full rounded-lg bg-muted py-2.5 text-center text-xs font-medium text-muted-foreground">
                User unavailable
              </div>
            )}

            {!isSelf && !isBlocked && (
              <>
                {isAccepted && relationship?.respondedAt && (
                  <div className="text-[11px] text-muted-foreground">
                    Friends since
                    {' '}
                    {moment(relationship.respondedAt).format('MMM YYYY')}
                  </div>
                )}

                {commonGroups.length > 0 && (
                  <div className="w-full">
                    <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                      <Users className="h-3 w-3" />
                      {commonGroups.length === 1 ? '1 group in common' : `${commonGroups.length} groups in common`}
                    </div>
                    <div className="flex flex-col gap-1">
                      {commonGroups.map((group) => (
                        <div key={group._id} className="flex items-center gap-2 rounded-lg bg-muted/50 px-2.5 py-1.5">
                          <Avatar className="h-6 w-6 border border-border bg-gradient-to-br from-primary/80 to-rose-700">
                            {group.picture && (
                              <img
                                src={`${Config.url || ''}/api/images/${group.picture.shieldedID}/256`}
                                alt=""
                                className="aspect-square size-full object-cover"
                              />
                            )}
                            <AvatarFallback className="bg-transparent text-[9px] font-bold text-white">
                              {(group.title || 'G').charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="truncate text-xs text-foreground">{group.title}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-2 flex w-full flex-col gap-2">
                  <Button className="w-full gap-2" onClick={() => onOpenChat(profile._id)}>
                    <MessageSquare className="h-4 w-4" />
                    {isAccepted ? 'Open Chat' : 'Start Chat'}
                  </Button>

                  {isAccepted && (
                    <div className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-xs font-medium text-muted-foreground">
                      <UserCheck className="h-3.5 w-3.5" />
                      Contact
                    </div>
                  )}

                  {isPendingReceived && (
                    <Button variant="outline" className="w-full gap-2" disabled={busy} onClick={acceptRequest}>
                      <UserCheck className="h-4 w-4" />
                      Accept Request
                    </Button>
                  )}

                  {!isAccepted && !isPendingReceived && (
                    <Button
                      variant="outline"
                      className="w-full gap-2"
                      disabled={isPendingSent || busy}
                      onClick={sendRequest}
                    >
                      {isPendingSent ? <Check className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                      {isPendingSent ? 'Requested' : 'Add Friend'}
                    </Button>
                  )}

                  <Button
                    variant="ghost"
                    className="w-full gap-2 text-muted-foreground hover:text-destructive"
                    disabled={busy}
                    onClick={block}
                  >
                    <ShieldOff className="h-4 w-4" />
                    Block
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    disabled
                    data-disabled
                    className="w-full gap-2 text-muted-foreground opacity-50 cursor-not-allowed"
                  >
                    <Flag className="h-4 w-4" />
                    <span data-disabled>Report</span>
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default ProfileView;
