import { useEffect, useState, useCallback } from 'react';
import { toast } from 'react-toastify';
import {
  Shield, UserX, Ban, Crown, Clock, Check, X, UserPlus2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import Config from '../../../config';
import {
  listGroupMembers, listJoinRequests, approveJoinRequest, denyJoinRequest,
  removeMember, banMember, changeMemberRole, transferOwnership, updateGroupSettings,
} from '../../../actions/groupAdmin';

const SLOW_MODE_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 5, label: '5 seconds' },
  { value: 10, label: '10 seconds' },
  { value: 30, label: '30 seconds' },
  { value: 60, label: '1 minute' },
  { value: 300, label: '5 minutes' },
];

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
  const [confirmAction, setConfirmAction] = useState(null); // { type: 'ban'|'remove'|'transfer', person }

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
    toast.success('Request approved.');
    loadRequests();
    loadMembers();
  });

  const onDeny = (userId) => withBusy(userId, async () => {
    await denyJoinRequest(groupId, userId);
    toast.success('Request denied.');
    loadRequests();
  });

  const onRoleChange = (userId, role) => withBusy(userId, async () => {
    await changeMemberRole(groupId, userId, role);
    toast.success('Role updated.');
    loadMembers();
  });

  const onConfirmedAction = async () => {
    const { type, person } = confirmAction;
    setConfirmAction(null);
    await withBusy(person.user._id, async () => {
      if (type === 'ban') {
        await banMember(groupId, person.user._id);
        toast.success(`${person.user.firstName} was banned.`);
      } else if (type === 'remove') {
        await removeMember(groupId, person.user._id);
        toast.success(`${person.user.firstName} was removed.`);
      } else if (type === 'transfer') {
        await transferOwnership(groupId, person.user._id);
        toast.success(`Ownership transferred to ${person.user.firstName}.`);
      }
      loadMembers();
    });
  };

  const onSlowModeChange = async (value) => {
    try {
      await updateGroupSettings(groupId, { slowModeSeconds: Number(value) });
      toast.success('Slow mode updated.');
      onSettingsChanged?.({ slowModeSeconds: Number(value) });
    } catch (err) {
      toast.error('Could not update slow mode.');
    }
  };

  const currentSlowMode = currentSettings?.slowModeSeconds ?? 0;

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
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary" size="sm" className="w-full justify-between text-xs">
                      {SLOW_MODE_OPTIONS.find((o) => o.value === currentSlowMode)?.label || 'Off'}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                    <DropdownMenuRadioGroup value={String(currentSlowMode)} onValueChange={onSlowModeChange}>
                      {SLOW_MODE_OPTIONS.map((opt) => (
                        <DropdownMenuRadioItem key={opt.value} value={String(opt.value)}>
                          {opt.label}
                        </DropdownMenuRadioItem>
                      ))}
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
                      <div className="flex min-w-0 items-center gap-2.5">
                        <MemberAvatar person={r.user} className="h-8 w-8" />
                        <div className="min-w-0">
                          <div className="truncate text-xs font-semibold text-foreground">
                            {r.user.firstName}
                            {' '}
                            {r.user.lastName}
                          </div>
                          <div className="truncate text-[10px] text-muted-foreground">{`@${r.user.username}`}</div>
                        </div>
                      </div>
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
                      <div className="flex min-w-0 items-center gap-2.5">
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
                      </div>

                      {canActOnTarget && (
                        <DropdownMenu>
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
                          <DropdownMenuContent align="end">
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
          </div>
        </SheetContent>
      </Sheet>

      {confirmAction && (
        <Dialog open onOpenChange={(next) => !next && setConfirmAction(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>
                {confirmAction.type === 'ban' && 'Ban this member?'}
                {confirmAction.type === 'remove' && 'Remove this member?'}
                {confirmAction.type === 'transfer' && 'Transfer ownership?'}
              </DialogTitle>
              <DialogDescription>
                {confirmAction.type === 'ban' && `${confirmAction.person.user.firstName} will be removed and unable to rejoin via invite link or join request.`}
                {confirmAction.type === 'remove' && `${confirmAction.person.user.firstName} will be removed from the group. They can rejoin with a new invite.`}
                {confirmAction.type === 'transfer' && `${confirmAction.person.user.firstName} becomes the new OWNER. You become an ADMIN. This can't be undone by you alone.`}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setConfirmAction(null)}>Cancel</Button>
              <Button variant={confirmAction.type === 'transfer' ? 'default' : 'destructive'} onClick={onConfirmedAction}>
                Confirm
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

export default GroupAdminPanel;
