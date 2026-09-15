import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import getMeetingSummary from '../../../actions/getMeetingSummary';
import { getAiErrorMessage } from '../../../lib/aiErrorMessage';

// Meeting-summary-persistence pass. Shown when a meetings-list card's
// Summary button is clicked (Meeting.jsx) — fetches the ALREADY-GENERATED,
// meeting-scoped canonical summary via the existing GET /meeting/:id/summary
// (backend/src/routes/meeting/get-summary.js). Never triggers generation:
// this only reads whatever the meeting card already knew existed from
// /meeting/list's lightweight `summary` metadata (spec section 5 — the
// list endpoint intentionally omits the summary TEXT, so this is the one
// place that content is actually fetched, and only on demand).
function MeetingSummaryPopup({ meetingId, onClose }) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getMeetingSummary(meetingId)
      .then((res) => {
        if (res.data.status === 'SUMMARIZED' && res.data.summary) {
          setSummary(res.data.summary);
        } else {
          // The list card only shows Summary for SUMMARIZED meetings, so
          // reaching any other status here means it changed between the
          // list load and this click (e.g. a retry just failed) — same
          // generic fallback copy either way.
          setError('This summary is not available right now.');
        }
      })
      .catch((err) => setError(getAiErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [meetingId]);

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="rounded-2xl border border-border bg-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Meeting Summary
          </DialogTitle>
          {summary && <DialogDescription>AI-generated — may be inaccurate.</DialogDescription>}
        </DialogHeader>
        {loading ? (
          <div className="py-6 text-center text-xs text-muted-foreground">Loading…</div>
        ) : error ? (
          <p className="text-xs leading-relaxed text-destructive">{error}</p>
        ) : (
          <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">{summary}</p>
        )}
        <Button
          type="button"
          variant="secondary"
          onClick={(e) => {
            // This popup is rendered inside Meeting.jsx's card, which has
            // its own onClick={handleClick} (join/initialize the meeting).
            // React's synthetic event system bubbles clicks from portaled
            // content (Radix Dialog renders to document.body) through the
            // REACT component tree, not the real DOM tree — so without this,
            // closing the popup also fired the card's handleClick.
            e.stopPropagation();
            onClose();
          }}
        >
          Close
        </Button>
      </DialogContent>
    </Dialog>
  );
}

export default MeetingSummaryPopup;
