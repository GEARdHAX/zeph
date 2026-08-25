import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Copy, Share2, QrCode } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { createGroupInvite } from '../../../actions/invites';

function InviteGroup({ groupId, groupName, onClose }) {
  const [url, setUrl] = useState(null);
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    createGroupInvite(groupId)
      .then((res) => setUrl(`${window.location.origin}${res.data.url}`))
      .catch(() => toast.error('Could not create invite link.'));
  }, [groupId]);

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
        await navigator.share({ title: `Join ${groupName} on Chitcx`, url });
      } catch (err) {
        // User cancelled the native share sheet — not an error.
      }
    } else {
      onCopy();
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Invite Members</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">{`Share this link to invite people to ${groupName || 'the group'}.`}</p>

        {showQr && url && (
          <div className="flex items-center justify-center rounded-xl border border-border bg-white p-6">
            <QRCodeSVG value={url} size={220} marginSize={2} />
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Button onClick={onCopy} disabled={!url} variant="secondary" className="justify-start gap-2">
            <Copy className="h-4 w-4" />
            Copy Link
          </Button>
          <Button onClick={onShare} disabled={!url} variant="secondary" className="justify-start gap-2">
            <Share2 className="h-4 w-4" />
            Share
          </Button>
          <Button onClick={() => setShowQr((v) => !v)} disabled={!url} variant="secondary" className="justify-start gap-2">
            <QrCode className="h-4 w-4" />
            {showQr ? 'Hide QR' : 'Show QR'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default InviteGroup;
