import { useEffect, useState } from 'react';
import moment from 'moment';
import { Radio, PhoneOff, RefreshCw } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import getCallHistory from '../../../actions/getCallHistory';

// Call Timeline / Call History (spec §18). Shown on demand from the
// meetings list card's "Joined N times · Xm" line — fetches the CURRENT
// user's own timeline for ONE meeting via GET /api/calls/history?meetingId=
// (backend/src/routes/calls/history.js). Deliberately lightweight: only
// the core CONNECTED/DISCONNECTED/RECONNECTED events this pass produces
// (see CallTimelineEvent.js's model comment for why MIC_MUTED/CAMERA_ON/
// etc. aren't wired up yet), no raw WebRTC diagnostics (spec §18: "do not
// expose technical WebRTC diagnostics by default").
const EVENT_LABEL = {
  CONNECTED: 'Connected',
  DISCONNECTED: 'Disconnected',
  RECONNECTED: 'Reconnected',
};

const EVENT_ICON = {
  CONNECTED: Radio,
  DISCONNECTED: PhoneOff,
  RECONNECTED: RefreshCw,
};

const formatDuration = (seconds) => {
  if (seconds === null || seconds === undefined) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return '<1 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
};

function CallTimelinePopup({ meetingId, onClose }) {
  const [loading, setLoading] = useState(true);
  const [entry, setEntry] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getCallHistory({ meetingId })
      .then((res) => setEntry(res.data.history?.[0] || null))
      .catch(() => setError('Could not load your call timeline.'))
      .finally(() => setLoading(false));
  }, [meetingId]);

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="rounded-2xl border border-border bg-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Call Timeline</DialogTitle>
          {entry && <DialogDescription>Your own participation in this meeting.</DialogDescription>}
        </DialogHeader>

        {loading ? (
          <div className="py-6 text-center text-xs text-muted-foreground">Loading…</div>
        ) : error ? (
          <p className="text-xs leading-relaxed text-destructive">{error}</p>
        ) : !entry || entry.timeline.length === 0 ? (
          <p className="text-xs leading-relaxed text-muted-foreground">No call activity recorded for this meeting.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {entry.timeline.map((event, i) => {
              const Icon = EVENT_ICON[event.eventType] || Radio;
              // A DISCONNECTED event's session (the one it just closed) —
              // shown as "Duration: Xm" underneath, matching spec §18's
              // worked example, computed from the ALREADY-fetched sessions
              // list rather than trusting anything client-side.
              const matchingSession =
                event.eventType === 'DISCONNECTED'
                  ? entry.sessions.find((s) => s.disconnectedAt === event.timestamp)
                  : null;

              return (
                <div key={`${event.eventType}-${event.timestamp}-${i}`} className="flex items-start gap-3 py-2">
                  <div className="flex flex-col items-center pt-0.5">
                    <Icon
                      className={
                        event.eventType === 'DISCONNECTED'
                          ? 'h-3.5 w-3.5 text-muted-foreground'
                          : 'h-3.5 w-3.5 text-primary'
                      }
                    />
                    {i < entry.timeline.length - 1 && <div className="mt-1 h-full w-px flex-1 bg-border" />}
                  </div>
                  <div className="min-w-0 pb-2">
                    <div className="text-[11px] font-mono text-muted-foreground">
                      {moment(event.timestamp).format('h:mm A')}
                    </div>
                    <div className="text-xs font-semibold text-foreground">
                      {EVENT_LABEL[event.eventType] || event.eventType}
                    </div>
                    {matchingSession?.disconnectReason && (
                      <div className="text-[11px] text-muted-foreground capitalize">
                        {matchingSession.disconnectReason.replace('_', ' ')}
                      </div>
                    )}
                    {matchingSession?.durationSeconds != null && (
                      <div className="text-[11px] text-muted-foreground">
                        Duration: {formatDuration(matchingSession.durationSeconds)}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <Button
          type="button"
          variant="secondary"
          onClick={(e) => {
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

export default CallTimelinePopup;
