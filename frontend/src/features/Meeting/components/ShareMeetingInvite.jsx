import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import moment from 'moment';
import { Copy, Share2, QrCode, Ban } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createMeetingInvite, listMeetingInvites, revokeMeetingInvite } from '../../../actions/meetingInvites';

// Spec §3 — server-authoritative expiration options, keyed the same way the
// backend's EXPIRY_OPTIONS_MS map is (routes/meetings/invites/create.js).
// The client only ever sends the KEY, never a computed timestamp.
const EXPIRY_OPTIONS = [
  { key: '15m', label: '15 minutes' },
  { key: '30m', label: '30 minutes' },
  { key: '1h', label: '1 hour' },
  { key: '6h', label: '6 hours' },
  { key: '12h', label: '12 hours' },
  { key: '24h', label: '24 hours' },
  { key: '3d', label: '3 days' },
  { key: '7d', label: '7 days' },
];

function ExpiresLabel({ expiresAt }) {
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);
  // Cosmetic only — the server independently re-validates expiresAt on
  // every preview/accept call (spec §20), this is never the real check.
  return <span>{`Expires ${moment(expiresAt).fromNow()}`}</span>;
}

function ShareMeetingInvite({ meetingId, onClose }) {
  const [expiryKey, setExpiryKey] = useState('1h');
  const [url, setUrl] = useState(null);
  const [expiresAt, setExpiresAt] = useState(null);
  const [inviteId, setInviteId] = useState(null);
  const [showQr, setShowQr] = useState(false);
  const [creating, setCreating] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [invites, setInvites] = useState([]);

  const refreshList = () => {
    listMeetingInvites(meetingId)
      .then((res) => setInvites(res.data.invites || []))
      .catch(() => {});
  };

  useEffect(() => {
    refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  const onCreate = async () => {
    setCreating(true);
    setRevoked(false);
    try {
      const res = await createMeetingInvite(meetingId, { expiresIn: expiryKey });
      setUrl(`${window.location.origin}${res.data.url}`);
      setExpiresAt(res.data.expiresAt);
      setInviteId(res.data.inviteId);
      refreshList();
    } catch (err) {
      toast.error('Could not create invite link.');
    } finally {
      setCreating(false);
    }
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Invite link copied.');
    } catch (err) {
      toast.error('Could not copy link.');
    }
  };

  const onShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Join my Zeph meeting', url });
      } catch (err) {
        // User cancelled the native share sheet — not an error.
      }
    } else {
      onCopy();
    }
  };

  const onRevoke = async () => {
    try {
      await revokeMeetingInvite(inviteId);
      setRevoked(true);
      toast.success('Invite revoked.');
      refreshList();
    } catch (err) {
      toast.error('Could not revoke invite.');
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Share meeting</DialogTitle>
        </DialogHeader>

        {!url && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Invite expires in</span>
              <Select value={expiryKey} onValueChange={setExpiryKey}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.key} value={opt.key}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={onCreate} disabled={creating}>
              {creating ? 'Creating…' : 'Create invite link'}
            </Button>
          </div>
        )}

        {url && (
          <div className="flex flex-col gap-3">
            <p className="break-all rounded-xl border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
              {url}
            </p>
            {!revoked && expiresAt && (
              <p className="text-[11px] text-muted-foreground">
                <ExpiresLabel expiresAt={expiresAt} />
              </p>
            )}
            {revoked && <p className="text-[11px] font-medium text-destructive">This invite has been revoked.</p>}

            {showQr && !revoked && (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-white p-6">
                <QRCodeSVG value={url} size={220} marginSize={2} />
                <p className="text-[11px] text-muted-foreground">Scan to join this Zeph meeting</p>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Button onClick={onCopy} disabled={revoked} variant="secondary" className="justify-start gap-2">
                <Copy className="h-4 w-4" />
                Copy link
              </Button>
              <Button onClick={onShare} disabled={revoked} variant="secondary" className="justify-start gap-2">
                <Share2 className="h-4 w-4" />
                Share
              </Button>
              <Button
                onClick={() => setShowQr((v) => !v)}
                disabled={revoked}
                variant="secondary"
                className="justify-start gap-2"
              >
                <QrCode className="h-4 w-4" />
                {showQr ? 'Hide QR' : 'Show QR'}
              </Button>
              {!revoked && (
                <Button onClick={onRevoke} variant="destructive" className="justify-start gap-2">
                  <Ban className="h-4 w-4" />
                  Revoke invite
                </Button>
              )}
            </div>
          </div>
        )}

        {invites.length > 0 && (
          <div className="flex flex-col gap-1.5 border-t border-border/60 pt-3">
            <p className="text-[11px] font-semibold text-muted-foreground">Active invites</p>
            <div className="flex max-h-[140px] flex-col gap-1 overflow-y-auto">
              {invites.map((invite) => (
                <div
                  key={invite.inviteId}
                  className="flex items-center justify-between rounded-lg bg-muted/40 px-2.5 py-1.5 text-[11px]"
                >
                  <span className="text-muted-foreground">
                    {invite.status === 'ACTIVE'
                      ? `Expires ${moment(invite.expiresAt).fromNow()}`
                      : invite.status.charAt(0) + invite.status.slice(1).toLowerCase()}
                  </span>
                  <span className="font-medium text-foreground">{invite.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default ShareMeetingInvite;
