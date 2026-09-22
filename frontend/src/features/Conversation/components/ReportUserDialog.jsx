import { useState } from 'react';
import { toast } from 'react-toastify';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import createReport from '../../../actions/reports';

const REASONS = [
  { value: 'SPAM', label: 'Spam' },
  { value: 'HARASSMENT', label: 'Harassment or bullying' },
  { value: 'HATE_SPEECH', label: 'Hate speech' },
  { value: 'INAPPROPRIATE_CONTENT', label: 'Inappropriate content' },
  { value: 'SCAM', label: 'Scam or fraud' },
  { value: 'OTHER', label: 'Something else' },
];

const MAX_DETAILS_LENGTH = 1000;

// TopBar.jsx's "Report" action — reports the OTHER participant in this
// conversation to Zeph's admin queue (backend/src/routes/reports/create.js).
// Deliberately does not block/mute the reporter's own view of the
// conversation as a side effect — reporting and blocking are independent
// actions the user can each take separately (Block already exists in this
// same menu).
function ReportUserDialog({ roomID, reportedUserId, reportedUserName, onClose }) {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    if (!reason) {
      toast.error('Choose a reason for this report.');
      return;
    }
    setSubmitting(true);
    try {
      await createReport({ roomID, reportedUserId, reason, details });
      toast.success('Report submitted. Our team will review it.');
      onClose();
    } catch (err) {
      toast.error('Could not submit the report. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="rounded-2xl border border-border bg-card sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{`Report ${reportedUserName || 'this person'}`}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a reason" />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="report-details">Additional details (optional)</Label>
            <Textarea
              id="report-details"
              placeholder="What happened?"
              value={details}
              maxLength={MAX_DETAILS_LENGTH}
              onChange={(e) => setDetails(e.target.value)}
            />
          </div>

          <p className="text-[11px] text-muted-foreground">
            This report is sent to the Zeph team for review. {reportedUserName || 'This person'} won&rsquo;t be
            notified that you reported them.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={onSubmit} disabled={submitting || !reason}>
            {submitting ? 'Submitting…' : 'Submit report'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ReportUserDialog;
