import {
  useEffect, useState, useCallback, useMemo,
} from 'react';
import { toast } from 'react-toastify';
import {
  Shield, UserX, Ban, Crown, Clock, Check, X, UserPlus2, LogOut, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import Config from '../../../config';
import ProfileView from '../../Panel/components/ProfileView';
import createRoom from '../../../actions/createRoom';
import Actions from '../../../constants/Actions';
import {
  listGroupMembers, listJoinRequests, approveJoinRequest, denyJoinRequest,
  removeMember, banMember, changeMemberRole, transferOwnership, updateGroupSettings,
  leaveGroup, deleteGroup,
} from '../../../actions/groupAdmin';

const SLOW_MODE_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 5, label: '5 seconds' },
  { value: 10, label: '10 seconds' },
  { value: 30, label: '30 seconds' },
  { value: 60, label: '1 minute' },
  { value: 300, label: '5 minutes' },
];
const PRESET_SLOW_MODE_VALUES = new Set(SLOW_MODE_OPTIONS.map((o) => o.value));

const ROLE_RANK = { OWNER: 3, ADMIN: 2, MEMBER: 1 };

function MemberAvatar({ person, className = 'h-9 w-9' }) {
  const initials = `${(person.firstName || 'U').charAt(0)}${(person.lastName || '').charAt(0)}`.toUpperCase();
  return (
    <Avatar className={`${className} border border-border bg-gradient-to-br from-primary/80 to-rose-700 text-white font-bold`}>
      {person.picture && (
        <img
          src={`${Config.url || ''}/api/images/${person.picture.shieldedID}/256`}
          alt=""
          className="aspect-square size-full object-cover"
        />
      )}
      <AvatarFallback className="bg-transparent text-xs font-bold text-white">{initials}</AvatarFallback>
    </Avatar>
  );
}

// Full moderation console: member list with role/ban/remove/transfer
// actions, pending join-request approval queue, slow-mode picker. Opened
// from Details/Room.jsx's member list for ADMIN/OWNER only — server
// re-checks every action authoritatively regardless of what this panel
// shows, so a stale/spoofed client state can't grant anything real.
function GroupAdminPanel({
  groupId, myRole, currentSettings, onClose, onSettingsChanged,
}) {
  const [members, setMembers] = useState(null);
  const [requests, setRequests] = useState(null);
  const [busyUserId, setBusyUserId] = useState(null);
  // { type: 'ban'|'remove'|'transfer'|'leave'|'delete', person? }
  const [confirmAction, setConfirmAction] = useState(null);
  const [previewUsername, setPreviewUsername] = useState(null);
  const [showLeaveChoice, setShowLeaveChoice] = useState(false);
  const [showCustomSlowMode, setShowCustomSlowMode] = useState(false);
  const [customSlowModeInput, setCustomSlowModeInput] = useState('');
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const io = useSelector((state) => state.io.io);

  const openChat = async (targetUserID) => {
    setPreviewUsername(null);
    onClose?.();
    try {
      const res = await createRoom(targetUserID);
      dispatch({ type: Actions.SET_ROOM, room: res.data.room });
      navigate(`/room/${res.data.room._id}`);
    } catch (err) {
      console.error('Could not start chat:', err);
    }
  };

  const isOwner = myRole === 'OWNER';
  const canManageAdmins = isOwner;
  const canModerate = myRole === 'OWNER' || myRole === 'ADMIN';

  const loadMembers = useCallback(() => {
    listGroupMembers(groupId).then((res) => setMembers(res.data.members)).catch(() => toast.error('Could not load members.'));
  }, [groupId]);

  const loadRequests = useCallback(() => {
    if (!canModerate) return;
    listJoinRequests(groupId).then((res) => setRequests(res.data.requests)).catch(() => toast.error('Could not load join requests.'));
  }, [groupId, canModerate]);

  useEffect(() => {
    loadMembers();
    loadRequests();
  }, [loadMembers, loadRequests]);

  // Live updates while the panel is open — other admins acting on this same
  // group (approve/deny/ban/remove/role-change/ownership-transfer) update
  // this view without a manual reopen. Every socket already listens on its
  // own personal room (auto-joined at connect, see backend init.js) — the
  // backend delivers every group:* event by iterating the member list and
  // emitting to each person directly (utils/broadcastToGroup.js), not via a
  // Socket.IO room, so no join/leave-room handshake is needed here. Targeted
  // local state updates, not a full refetch, per the "avoid full refetch
  // after mutations" guidance — the one exception is member-added, where the
  // panel doesn't have the new member's populated user object and a
  // single-member fetch would be more code than the list already refetches.
  useEffect(() => {
    if (!io || !groupId) return undefined;

    const onMemberAdded = () => loadMembers();
    const onMemberRemoved = (payload) => {
      if (payload.groupId !== groupId) return;
      setMembers((prev) => (prev ? prev.filter((m) => m.user._id !== payload.userId) : prev));
      if (payload.self) {
        toast.info('You are no longer a member of this group.');
        onClose?.();
      }
    };
    const onMemberBanned = (payload) => {
      if (payload.groupId !== groupId) return;
      setMembers((prev) => (prev ? prev.filter((m) => m.user._id !== payload.userId) : prev));
    };
    const onRoleUpdated = (payload) => {
      if (payload.groupId !== groupId) return;
      setMembers((prev) => (prev
        ? prev.map((m) => (m.user._id === payload.userId ? { ...m, role: payload.role } : m))
        : prev));
    };
    const onOwnershipTransferred = () => loadMembers();
    const onJoinRequestCreated = (payload) => {
      if (payload.groupId !== groupId || !canModerate) return;
      loadRequests();
    };
    const onJoinRequestDenied = (payload) => {
      if (payload.groupId !== groupId) return;
      setRequests((prev) => (prev ? prev.filter((r) => r.user._id !== payload.userId) : prev));
    };
    const onSettingsUpdated = (payload) => {
      if (payload.groupId !== groupId || payload['settings.slowModeSeconds'] === undefined) return;
      onSettingsChanged?.({ slowModeSeconds: payload['settings.slowModeSeconds'] });
    };

    io.on('group:member:added', onMemberAdded);
    io.on('group:member:removed', onMemberRemoved);
    io.on('group:member:banned', onMemberBanned);
    io.on('group:member:role-updated', onRoleUpdated);
    io.on('group:ownership:transferred', onOwnershipTransferred);
    io.on('group:join-request:created', onJoinRequestCreated);
    io.on('group:join-request:denied', onJoinRequestDenied);
    io.on('group:updated', onSettingsUpdated);

    return () => {
      io.off('group:member:added', onMemberAdded);
      io.off('group:member:removed', onMemberRemoved);
      io.off('group:member:banned', onMemberBanned);
      io.off('group:member:role-updated', onRoleUpdated);
      io.off('group:ownership:transferred', onOwnershipTransferred);
      io.off('group:join-request:created', onJoinRequestCreated);
      io.off('group:join-request:denied', onJoinRequestDenied);
      io.off('group:updated', onSettingsUpdated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [io, groupId, canModerate, loadMembers, loadRequests]);

  const withBusy = async (userId, fn) => {
    setBusyUserId(userId);
    try {
      await fn();
    } catch (err) {
      toast.error(err.response?.data?.reason || 'Action failed.');
    } finally {
      setBusyUserId(null);
    }
  };

  const onApprove = (userId) => withBusy(userId, async () => {
    await approveJoinRequest(groupId, userId);
    toast.success('Join request approved.');
    setRequests((prev) => (prev ? prev.filter((r) => r.user._id !== userId) : prev));
    loadMembers();
  });

  const onDeny = (userId) => withBusy(userId, async () => {
    await denyJoinRequest(groupId, userId);
    toast.success('Join request denied.');
    setRequests((prev) => (prev ? prev.filter((r) => r.user._id !== userId) : prev));
  });

  const onRoleChange = (userId, role) => withBusy(userId, async () => {
    await changeMemberRole(groupId, userId, role);
    toast.success(role === 'ADMIN' ? 'User was promoted to admin.' : 'User was demoted to member.');
    setMembers((prev) => (prev ? prev.map((m) => (m.user._id === userId ? { ...m, role } : m)) : prev));
  });

  const onConfirmedAction = async () => {
    const { type, person } = confirmAction;
    setConfirmAction(null);

    if (type === 'delete') {
      setBusyUserId('__group__');
      try {
        await deleteGroup(groupId);
        toast.success('Group deleted.');
        onClose?.();
        navigate('/');
      } catch (err) {
        toast.error('Could not delete group.');
      } finally {
        setBusyUserId(null);
      }
      return;
    }

    if (type === 'leave') {
      setBusyUserId('__group__');
      try {
        await leaveGroup(groupId);
        toast.success('You left the group.');
        onClose?.();
        navigate('/');
      } catch (err) {
        toast.error('Could not leave group.');
      } finally {
        setBusyUserId(null);
      }
      return;
    }

    await withBusy(person.user._id, async () => {
      if (type === 'ban') {
        await banMember(groupId, person.user._id);
        toast.success('User was banned from the group.');
        setMembers((prev) => (prev ? prev.filter((m) => m.user._id !== person.user._id) : prev));
      } else if (type === 'remove') {
        await removeMember(groupId, person.user._id);
        toast.success('User was removed from the group.');
        setMembers((prev) => (prev ? prev.filter((m) => m.user._id !== person.user._id) : prev));
      } else if (type === 'transfer') {
        await transferOwnership(groupId, person.user._id);
        toast.success('Ownership transferred successfully.');
        loadMembers();
      }
    });
  };

  const onLeaveClick = () => {
    if (isOwner) {
      setShowLeaveChoice(true);
    } else {
      setConfirmAction({ type: 'leave' });
    }
  };

  const applySlowMode = async (seconds) => {
    try {
      await updateGroupSettings(groupId, { slowModeSeconds: seconds });
      toast.success('Slow mode updated.');
      onSettingsChanged?.({ slowModeSeconds: seconds });
    } catch (err) {
      toast.error(err.response?.data?.reason === 'INVALID_SLOW_MODE' ? 'Invalid slow-mode value.' : 'Could not update slow mode.');
    }
  };

  const onSlowModeChange = (value) => {
    if (value === 'custom') {
      setCustomSlowModeInput(currentSettings?.slowModeSeconds ? String(currentSettings.slowModeSeconds) : '');
      setShowCustomSlowMode(true);
      return;
    }
    applySlowMode(Number(value));
  };

  const onCustomSlowModeSubmit = (e) => {
    e.preventDefault();
    const parsed = Number(customSlowModeInput);
    if (!Number.isInteger(parsed) || parsed < 0) {
      toast.error('Enter a whole number of seconds.');
      return;
    }
    setShowCustomSlowMode(false);
    applySlowMode(parsed);
  };

  const currentSlowMode = currentSettings?.slowModeSeconds ?? 0;
  const isCustomSlowMode = !PRESET_SLOW_MODE_VALUES.has(currentSlowMode);
  const slowModeLabel = useMemo(() => {
    if (isCustomSlowMode) return `Custom (${currentSlowMode}s)`;
    return SLOW_MODE_OPTIONS.find((o) => o.value === currentSlowMode)?.label || 'Off';
  }, [currentSlowMode, isCustomSlowMode]);

  return (
    <>
      <Sheet open onOpenChange={(next) => !next && onClose()}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Manage Group</SheetTitle>
            <SheetDescription>Members, join requests, and moderation settings.</SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-6 px-4 pb-4">
            {canModerate && (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  Slow Mode
                </div>
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary" size="sm" className="w-full justify-between text-xs">
                      {slowModeLabel}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="z-[99999] w-[--radix-dropdown-menu-trigger-width]">
                    <DropdownMenuRadioGroup value={isCustomSlowMode ? 'custom' : String(currentSlowMode)} onValueChange={onSlowModeChange}>
                      {SLOW_MODE_OPTIONS.map((opt) => (
                        <DropdownMenuRadioItem key={opt.value} value={String(opt.value)}>
                          {opt.label}
                        </DropdownMenuRadioItem>
                      ))}
                      <DropdownMenuRadioItem value="custom">Custom…</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}

            {canModerate && requests && requests.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <UserPlus2 className="h-3.5 w-3.5" />
                  {`Join Requests (${requests.length})`}
                </div>
                <div className="flex flex-col gap-1">
                  {requests.map((r) => (
                    <div key={r._id} className="flex items-center justify-between gap-2 rounded-xl p-2 hover:bg-muted/60">
                      <button type="button" onClick={() => setPreviewUsername(r.user.username)} className="flex min-w-0 items-center gap-2.5 text-left cursor-pointer hover:opacity-80 transition-opacity">
                        <MemberAvatar person={r.user} className="h-8 w-8" />
                        <div className="min-w-0">
                          <div className="truncate text-xs font-semibold text-foreground">
                            {r.user.firstName}
                            {' '}
                            {r.user.lastName}
                          </div>
                          <div className="truncate text-[10px] text-muted-foreground">{`@${r.user.username}`}</div>
                        </div>
                      </button>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-600"
                          disabled={busyUserId === r.user._id}
                          onClick={() => onApprove(r.user._id)}
                          title="Approve"
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          disabled={busyUserId === r.user._id}
                          onClick={() => onDeny(r.user._id)}
                          title="Deny"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="mb-2 text-xs font-semibold text-foreground">
                {`Members${members ? ` (${members.length})` : ''}`}
              </div>
              <div className="flex flex-col gap-0.5">
                {(members || []).map((m) => {
                  const canActOnTarget = canModerate && ROLE_RANK[myRole] > ROLE_RANK[m.role];
                  return (
                    <div key={m._id} className="flex items-center justify-between gap-2 rounded-xl p-2 hover:bg-muted/60">
                      <button type="button" onClick={() => setPreviewUsername(m.user.username)} className="flex min-w-0 items-center gap-2.5 text-left cursor-pointer hover:opacity-80 transition-opacity">
                        <MemberAvatar person={m.user} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-xs font-semibold text-foreground">
                              {m.user.firstName}
                              {' '}
                              {m.user.lastName}
                            </span>
                            {m.role !== 'MEMBER' && (
                              <Badge variant="secondary" className="shrink-0 gap-1 px-1.5 py-0 text-[10px]">
                                {m.role === 'OWNER' && <Crown className="h-2.5 w-2.5" />}
                                {m.role === 'ADMIN' && <Shield className="h-2.5 w-2.5" />}
                                {m.role}
                              </Badge>
                            )}
                          </div>
                          <div className="truncate text-[10px] text-muted-foreground">{`@${m.user.username}`}</div>
                        </div>
                      </button>

                      {canActOnTarget && (
                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 shrink-0 text-muted-foreground"
                              disabled={busyUserId === m.user._id}
                            >
                              <Shield className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="z-[99999]">
                            {canManageAdmins && m.role !== 'ADMIN' && (
                              <DropdownMenuItem onClick={() => onRoleChange(m.user._id, 'ADMIN')}>
                                <Shield className="h-4 w-4" />
                                Make Admin
                              </DropdownMenuItem>
                            )}
                            {canManageAdmins && m.role === 'ADMIN' && (
                              <DropdownMenuItem onClick={() => onRoleChange(m.user._id, 'MEMBER')}>
                                <Shield className="h-4 w-4" />
                                Remove Admin
                              </DropdownMenuItem>
                            )}
                            {isOwner && (
                              <DropdownMenuItem onClick={() => setConfirmAction({ type: 'transfer', person: m })}>
                                <Crown className="h-4 w-4" />
                                Transfer Ownership
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setConfirmAction({ type: 'remove', person: m })}>
                              <UserX className="h-4 w-4" />
                              Remove
                            </DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" onClick={() => setConfirmAction({ type: 'ban', person: m })}>
                              <Ban className="h-4 w-4" />
                              Ban
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  );
                })}
                {members && members.length === 0 && (
                  <div className="py-6 text-center text-xs text-muted-foreground">No members found.</div>
                )}
              </div>
            </div>

            <Button
              variant="outline"
              className="justify-start gap-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={busyUserId === '__group__'}
              onClick={onLeaveClick}
            >
              <LogOut className="h-3.5 w-3.5" />
              Leave Group
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={showLeaveChoice} onOpenChange={setShowLeaveChoice}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>You&apos;re the owner of this group</DialogTitle>
            <DialogDescription>
              A group can&apos;t be left ownerless. Transfer ownership to another member first, or delete the
              group entirely.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              variant="secondary"
              className="w-full justify-start gap-2"
              onClick={() => {
                setShowLeaveChoice(false);
                toast.info('Pick a member from the list and choose "Transfer Ownership".');
              }}
            >
              <Crown className="h-4 w-4" />
              Transfer Ownership
            </Button>
            <Button
              variant="destructive"
              className="w-full justify-start gap-2"
              onClick={() => {
                setShowLeaveChoice(false);
                setConfirmAction({ type: 'delete' });
              }}
            >
              <Trash2 className="h-4 w-4" />
              Delete Group
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => setShowLeaveChoice(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCustomSlowMode} onOpenChange={setShowCustomSlowMode}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>Custom slow mode</DialogTitle>
            <DialogDescription>Enter an interval in seconds between messages per member.</DialogDescription>
          </DialogHeader>
          <form className="flex flex-col gap-3" onSubmit={onCustomSlowModeSubmit}>
            <div className="grid gap-1.5">
              <Label htmlFor="custom-slow-mode-seconds">Seconds</Label>
              <Input
                id="custom-slow-mode-seconds"
                type="number"
                min="0"
                step="1"
                placeholder="e.g. 15"
                value={customSlowModeInput}
                onChange={(e) => setCustomSlowModeInput(e.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setShowCustomSlowMode(false)}>Cancel</Button>
              <Button type="submit">Apply</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {confirmAction && (
        <Dialog open onOpenChange={(next) => !next && setConfirmAction(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>
                {confirmAction.type === 'ban' && 'Ban this user from the group?'}
                {confirmAction.type === 'remove' && 'Remove this user from the group?'}
                {confirmAction.type === 'transfer' && 'Transfer ownership to this user?'}
                {confirmAction.type === 'leave' && 'Leave this group?'}
                {confirmAction.type === 'delete' && 'Delete this group permanently?'}
              </DialogTitle>
              <DialogDescription>
                {confirmAction.type === 'ban' && 'They will not be able to rejoin.'}
                {confirmAction.type === 'remove' && 'They can rejoin later with a new invite or join request.'}
                {confirmAction.type === 'transfer' && "They become the new OWNER. You become an ADMIN. This can't be undone by you alone."}
                {confirmAction.type === 'leave' && 'You will lose access to this group. You can rejoin later if invited.'}
                {confirmAction.type === 'delete' && 'This cannot be undone. All members will lose access.'}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setConfirmAction(null)} disabled={busyUserId !== null}>
                Cancel
              </Button>
              <Button
                variant={confirmAction.type === 'transfer' ? 'default' : 'destructive'}
                onClick={onConfirmedAction}
                disabled={busyUserId !== null}
              >
                Confirm
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {previewUsername && (
        <ProfileView
          username={previewUsername}
          onClose={() => setPreviewUsername(null)}
          onOpenChat={openChat}
        />
      )}
    </>
  );
}

export default GroupAdminPanel;
