import {
  useState, useEffect, useRef, lazy, Suspense,
} from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { useGlobal } from 'reactn';
import {
  Users, Image as ImageIcon, Link2, Shield, LogOut,
} from 'lucide-react';
import { toast } from 'react-toastify';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import Config from '../../../config';
import ProfileView from '../../Panel/components/ProfileView';
import InviteGroup from '../../Group/components/InviteGroup';
import GroupAdminPanel from '../../Group/components/GroupAdminPanel';
import createRoom from '../../../actions/createRoom';
import getRoom from '../../../actions/getRoom';
import { getGroup, leaveGroup } from '../../../actions/groupAdmin';
import Actions from '../../../constants/Actions';
import getMediaCategory from '../../../lib/mediaType';
import getFileIcon from '../../../lib/fileIcon';
import useAuthorizedMediaUrl from '../../../lib/useAuthorizedMediaUrl';

// Lazy-loaded — same viewer used by the chat message list (Messages.jsx),
// consolidating what used to be a separate react-modal-image lightbox here.
const MediaViewerShell = lazy(() => import('../../Conversation/components/MediaViewerShell'));

// One grid cell in the Media tab. New-format messages (message.media) are
// served through the authenticated /api/media/:id route — same
// blob-resolve pattern as MediaViewerShell, since a plain <img src> can't
// carry the Authorization header that route requires. Old-format
// type:'image' messages keep the legacy unauthenticated
// /api/images/:id/256 URL unchanged. Non-image categories (video/pdf/
// document/audio/etc.) render an icon card instead of a broken <img> —
// there's no universal image thumbnail for those, matching FileViewer's
// existing icon-card convention rather than inventing a new one.
function MediaGridItem({ message, onOpen }) {
  const category = getMediaCategory(message);
  const isNewFormat = !!message.media;
  const filename = isNewFormat ? message.media.originalName : undefined;
  const rawUrl = isNewFormat
    ? `${Config.url || ''}/api/media/${message.media._id}`
    : `${Config.url || ''}/api/images/${message.content}/256`;
  const { url: resolvedUrl } = useAuthorizedMediaUrl(rawUrl, { authorized: isNewFormat && category === 'image' });

  if (category !== 'image') {
    const Icon = getFileIcon(filename);
    return (
      <button
        type="button"
        onClick={() => onOpen(message)}
        className="relative flex aspect-square flex-1 flex-col items-center justify-center gap-1 overflow-hidden rounded-xl bg-muted p-2 text-center transition-transform hover:scale-[1.02] cursor-pointer"
      >
        <Icon className="h-6 w-6 text-muted-foreground" />
        {filename && <span className="w-full truncate text-[9px] text-muted-foreground">{filename}</span>}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(message)}
      className="relative aspect-square flex-1 overflow-hidden rounded-xl bg-muted transition-transform hover:scale-[1.02] cursor-pointer"
    >
      {resolvedUrl && <img src={resolvedUrl} alt="" className="h-full w-full object-cover" />}
    </button>
  );
}

const STATUS_COLOR = {
  online: 'bg-emerald-500',
  away: 'bg-orange-500',
  busy: 'bg-destructive',
  offline: 'bg-zinc-400',
};

function Room() {
  const room = useSelector((state) => state.io.room) || {};
  const io = useSelector((state) => state.io.io);
  const onlineUsers = useSelector((state) => state.io.onlineUsers) || [];
  const imagesNumber = useSelector((state) => state.io.room?.images?.length || 0);
  const user = useGlobal('user')[0] || {};

  const scrollContainer = useRef(null);
  const [scrollHeight, setScrollHeight] = useState(0);
  const [open, setOpen] = useState(null);
  const [tab, setTab] = useState('members'); // 'members' | 'media'
  const [previewUsername, setPreviewUsername] = useState(null);
  const [showInviteGroup, setShowInviteGroup] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [groupInfo, setGroupInfo] = useState(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const navigate = useNavigate();
  const dispatch = useDispatch();

  const openChat = async (targetUserID) => {
    setPreviewUsername(null);
    try {
      const res = await createRoom(targetUserID);
      dispatch({ type: Actions.SET_ROOM, room: res.data.room });
      navigate(`/room/${res.data.room._id}`);
    } catch (err) {
      console.error('Could not start chat:', err);
    }
  };

  // myRole/settings aren't part of the Redux room state (join-room.js/
  // get-room.js don't return them) — fetched separately, only for groups,
  // only to decide whether to show the Manage Group entry point. The
  // GroupAdminPanel itself re-fetches its own member/request data when opened.
  useEffect(() => {
    if (!room.isGroup || !room._id) {
      setGroupInfo(null);
      return;
    }
    getGroup(room._id).then((res) => setGroupInfo(res.data.group)).catch(() => setGroupInfo(null));
  }, [room.isGroup, room._id]);

  // The member list rendered below reads straight from Redux room.people,
  // which only gets set on navigation/initial fetch — a direct add
  // (InviteGroup's "Add from friends") or an invite-link join updates the
  // DB and notifies the newly-added person, but every OTHER member with
  // this panel already open (including the one who just clicked "Add")
  // never saw their own room.people grow, making a successful add look
  // like it silently failed. GroupAdminPanel already re-fetches its own
  // (separate) member list the same way for the same events — this mirrors
  // that for the plain Details panel, which anyone (not just admins) can
  // have open. A full room re-fetch, not a targeted patch, since people
  // need to arrive fully populated (avatar, name) for the row to render.
  useEffect(() => {
    if (!io || !room.isGroup || !room._id) return undefined;
    const groupId = room._id;

    const refetchRoom = (payload) => {
      if (payload?.groupId !== groupId) return;
      getRoom(groupId).then((res) => dispatch({ type: Actions.SET_ROOM, room: res.data.room })).catch(() => {});
    };

    io.on('group:member:added', refetchRoom);
    io.on('group:member:removed', refetchRoom);
    io.on('group:member:banned', refetchRoom);

    return () => {
      io.off('group:member:added', refetchRoom);
      io.off('group:member:removed', refetchRoom);
      io.off('group:member:banned', refetchRoom);
    };
  }, [io, room.isGroup, room._id, dispatch]);

  const canManageGroup = groupInfo && (groupInfo.myRole === 'OWNER' || groupInfo.myRole === 'ADMIN');
  // A plain MEMBER has no way to reach GroupAdminPanel (canManageGroup-gated
  // above), so they previously had no leave-group entry point at all — this
  // is that entry point. The OWNER's own leave/transfer flow already exists
  // inside GroupAdminPanel (reachable since an owner always has
  // canManageGroup) and isn't duplicated here.
  const canLeaveGroup = groupInfo && groupInfo.myRole !== 'OWNER';

  const onLeaveGroup = async () => {
    setLeaving(true);
    try {
      await leaveGroup(room._id);
      toast.success('You left the group.');
      setConfirmLeave(false);
      navigate('/', { replace: true });
    } catch (err) {
      toast.error('Could not leave group.');
    } finally {
      setLeaving(false);
    }
  };

  useEffect(() => {
    if (scrollContainer.current && scrollContainer.current.scrollTop === 0) {
      scrollContainer.current.scrollTop = scrollHeight;
    }
  }, [imagesNumber]);

  let other = {
    firstName: 'A',
    lastName: 'A',
  };

  if (!room.isGroup && room.people) {
    room.people.forEach((person) => {
      if (person._id !== user.id) other = person;
    });
  }

  const initials = (room.isGroup
    ? (room.title || 'G').charAt(0)
    : `${(other.firstName || 'U').charAt(0)}${(other.lastName || '').charAt(0)}`
  ).toUpperCase();

  const title = room.isGroup ? room.title : `${other.firstName} ${other.lastName}`;

  const rows = [];
  let row = [];

  const roomImages = room.images || [];

  roomImages.forEach((message) => {
    row.push(message);
    if (row.length === 3) {
      rows.push(row);
      row = [];
    }
  });
  if (row.length > 0) rows.push(row);

  const images = rows.map((r, i) => (
    <div key={i} className="flex gap-2 mb-2">
      {r.map((message) => (
        <MediaGridItem key={message._id} message={message} onOpen={setOpen} />
      ))}
    </div>
  ));

  const onScroll = () => {
    if (scrollContainer.current) {
      setScrollHeight(scrollContainer.current.scrollTop);
    }
  };

  const { people = [] } = room;

  const getStatus = (id) => {
    if (onlineUsers.filter((u) => u.id === id && u.status === 'busy').length > 0) return 'busy';
    if (onlineUsers.filter((u) => u.id === id && u.status === 'online').length > 0) return 'online';
    if (onlineUsers.filter((u) => u.id === id && u.status === 'away').length > 0) return 'away';
    return 'offline';
  };

  const members = people.map((person) => {
    const pInitials = `${(person.firstName || 'U').charAt(0)}${(person.lastName || '').charAt(0)}`.toUpperCase();

    return (
      <button
        type="button"
        key={person._id}
        onClick={() => setPreviewUsername(person.username)}
        className="flex w-full items-center justify-between gap-3 p-2.5 rounded-xl text-left hover:bg-muted/60 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative shrink-0">
            <Avatar className="h-9 w-9 border border-border bg-gradient-to-br from-primary/80 to-rose-700 text-white font-bold">
              {person.picture && (
                <img
                  src={`${Config.url || ''}/api/images/${person.picture.shieldedID}/256`}
                  alt=""
                  className="aspect-square size-full object-cover"
                />
              )}
              <AvatarFallback className="bg-transparent text-xs font-bold text-white">
                {pInitials}
              </AvatarFallback>
            </Avatar>
            <span className={cn('absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-card', STATUS_COLOR[getStatus(person._id)])} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-foreground">
              {person.firstName}
              {' '}
              {person.lastName}
            </div>
            <div className="truncate text-[10px] text-muted-foreground">{`@${person.username}`}</div>
          </div>
        </div>
      </button>
    );
  });

  return (
    <div className="flex h-full w-full flex-col bg-card text-card-foreground overflow-y-auto">
      {/* Top Banner / Avatar Header */}
      <div className="flex flex-col items-center p-6 border-b border-border/60 text-center">
        <button
          type="button"
          disabled={room.isGroup || !other.username}
          onClick={() => other.username && setPreviewUsername(other.username)}
          className={cn(
            'relative mb-3 group',
            !room.isGroup && other.username && 'cursor-pointer hover:opacity-95 transition-opacity',
          )}
          title={!room.isGroup ? 'View Profile' : undefined}
        >
          <Avatar className="h-20 w-20 border-2 border-border bg-gradient-to-br from-primary/80 to-rose-700 text-white font-extrabold text-2xl shadow-md group-hover:scale-105 transition-transform">
            {(room.isGroup ? room.picture : other.picture) && (
              <img
                src={`${Config.url || ''}/api/images/${(room.isGroup ? room.picture : other.picture).shieldedID}/256`}
                alt=""
                className="aspect-square size-full object-cover"
              />
            )}
            <AvatarFallback className="bg-transparent text-2xl font-bold text-white">
              {initials}
            </AvatarFallback>
          </Avatar>
        </button>

        <h3 className="text-sm font-bold text-foreground truncate max-w-[220px]">
          {title}
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {room.isGroup ? `${people.length} members in this group` : `@${other.username || 'user'}`}
        </p>
      </div>

      {/* Segmented Switcher (Members / Media) */}
      <div className="p-4">
        <div className="flex rounded-xl bg-muted/60 p-1">
          <button
            type="button"
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all',
              tab === 'members' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setTab('members')}
          >
            <Users className="h-3.5 w-3.5" />
            <span>Members</span>
          </button>
          <button
            type="button"
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all',
              tab === 'media' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setTab('media')}
          >
            <ImageIcon className="h-3.5 w-3.5" />
            <span>Media</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="mt-3">
          {tab === 'members' && (
            <div className="flex flex-col gap-0.5">
              {room.isGroup && (
                <Button
                  variant="secondary"
                  className="mb-1.5 justify-start gap-2 text-xs"
                  onClick={() => setShowInviteGroup(true)}
                >
                  <Link2 className="h-3.5 w-3.5" />
                  Invite Members
                </Button>
              )}
              {canManageGroup && (
                <Button
                  variant="secondary"
                  className="mb-1.5 justify-start gap-2 text-xs"
                  onClick={() => setShowAdminPanel(true)}
                >
                  <Shield className="h-3.5 w-3.5" />
                  Manage Group
                </Button>
              )}
              {canLeaveGroup && (
                <Button
                  variant="secondary"
                  className="mb-1.5 justify-start gap-2 text-xs text-destructive hover:text-destructive"
                  onClick={() => setConfirmLeave(true)}
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Leave Group
                </Button>
              )}
              {members}
            </div>
          )}

          {tab === 'media' && (
            <div
              className="flex flex-col overflow-y-auto"
              ref={scrollContainer}
              onScroll={onScroll}
            >
              {open && (
                <Suspense fallback={null}>
                  <MediaViewerShell
                    messages={roomImages}
                    initialMessage={open}
                    onClose={() => setOpen(null)}
                  />
                </Suspense>
              )}
              {images}
              {roomImages.length === 0 && (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  No images shared in this conversation yet.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {previewUsername && (
        <ProfileView
          username={previewUsername}
          onClose={() => setPreviewUsername(null)}
          onOpenChat={openChat}
        />
      )}

      {showInviteGroup && (
        <InviteGroup
          groupId={room._id}
          groupName={room.title}
          existingMemberIds={(room.people || []).map((p) => p._id || p)}
          onClose={() => setShowInviteGroup(false)}
        />
      )}

      {showAdminPanel && groupInfo && (
        <GroupAdminPanel
          groupId={room._id}
          myRole={groupInfo.myRole}
          currentSettings={groupInfo.settings}
          onClose={() => setShowAdminPanel(false)}
          onSettingsChanged={(patch) => setGroupInfo((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }))}
        />
      )}

      <Dialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <DialogContent className="rounded-2xl border border-border bg-card">
          <DialogHeader>
            <DialogTitle>Leave this group?</DialogTitle>
            <DialogDescription>
              You will lose access to this group. You can rejoin later if invited.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="rounded-xl" onClick={() => setConfirmLeave(false)} disabled={leaving}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" className="rounded-xl shadow-xs" onClick={onLeaveGroup} disabled={leaving}>
              Leave Group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default Room;
