import { useState } from 'react';
import { useGlobal } from 'reactn';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import moment from 'moment';
import { toast } from 'react-toastify';
import { Video, Users, Trash2, Sparkles, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import Actions from '../../../constants/Actions';
import postCall from '../../../actions/postCall';
import deleteMeeting from '../../../actions/deleteMeeting';
import MeetingSummaryPopup from './MeetingSummaryPopup';
import CallTimelinePopup from './CallTimelinePopup';

// Meeting-summary-persistence pass (spec section 5/6) — meeting.summary
// comes from /meeting/list's lightweight metadata (never the summary text
// itself, see MeetingSummaryPopup.jsx). No `summary` field at all means no
// transcript doc exists yet for this meeting — the button is omitted
// entirely rather than shown disabled, since there's nothing to check on
// or generate from here (generation only ever starts from
// MeetingRecorder.jsx's record flow, never this list).
const IN_PROGRESS_STATUSES = new Set(['TRANSCRIBING', 'TRANSCRIBED', 'SUMMARIZING']);

function Meetings({ meeting, onDeleted }) {
  const setMeeting = useGlobal('meetingID')[1];
  const setOver = useGlobal('over')[1];
  const setShowPanel = useGlobal('showPanel')[1];
  const setAudio = useGlobal('audio')[1];
  const setVideo = useGlobal('video')[1];
  const setCallDirection = useGlobal('callDirection')[1];
  const user = useGlobal('user')[0] || {};
  const [deleting, setDeleting] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);

  const dispatch = useDispatch();
  const navigate = useNavigate();

  let text;
  if (meeting.peers?.length > 0) {
    text = `${meeting.peers.length} active participant${meeting.peers.length > 1 ? 's' : ''}`;
  } else if (meeting.lastLeave) {
    text = `Meeting ended ${moment(meeting.lastLeave).fromNow()}`;
  } else {
    text = `Created ${moment(meeting.date).fromNow()}`;
  }

  const incoming = meeting.callee && user.id === meeting.callee._id;
  const counterpart = incoming ? meeting.caller : meeting.callee;

  let title = 'Untitled Meeting';
  if (meeting.startedAsCall) {
    if (meeting.callToGroup) {
      title = `Group Call in ${meeting.group?.title || 'Group'}`;
    } else if (incoming) {
      title = `Call from ${meeting.caller ? meeting.caller.firstName : 'Deleted'} ${
        meeting.caller ? meeting.caller.lastName : 'User'
      }`;
    } else {
      title = `Call to ${meeting.callee ? meeting.callee.firstName : 'Deleted'} ${
        meeting.callee ? meeting.callee.lastName : 'User'
      }`;
    }
  }

  const hasActivePeers = (meeting.peers?.length || 0) > 0;

  const handleClick = async () => {
    // If meeting is active or ongoing call, set up caller/callee context
    if (counterpart) {
      dispatch({ type: Actions.RTC_SET_COUNTERPART, counterpart });
    }

    if (meeting.startedAsCall && !hasActivePeers) {
      // Re-initiate outgoing call to the recipient
      await setAudio(true);
      await setVideo(true);
      await setCallDirection('outgoing');
      if (meeting.group?._id) {
        postCall({ roomID: meeting.group._id, meetingID: meeting._id }).catch(() => {});
      }
    } else {
      // Direct join preview (e.g. join conference or group meeting)
      await setCallDirection(null);
    }

    await setMeeting(meeting._id);
    await setShowPanel(false);
    await setOver(true);
    navigate(`/meeting/${meeting._id}`, { replace: true });
  };

  // Never offered for an active meeting (someone currently in the call) —
  // the server also rejects this independently, this is just UX.
  const handleDelete = async (e) => {
    e.stopPropagation();
    setDeleting(true);
    try {
      await deleteMeeting(meeting._id);
      onDeleted?.(meeting._id);
    } catch (err) {
      toast.error('Could not delete this meeting from your history.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    // MeetingSummaryPopup renders OUTSIDE this clickable card (a sibling,
    // not a child) — Radix Dialog portals its actual DOM to document.body,
    // but React's synthetic events bubble through the REACT tree, not the
    // real DOM tree. A dialog nested INSIDE this div meant any click inside
    // it (the X button, clicking the overlay, Escape-triggered close) still
    // bubbled up to this div's onClick={handleClick} and re-triggered
    // joining/initializing the meeting — the Summary button itself already
    // needed e.stopPropagation() to open the popup safely, but every close
    // path inside the popup would need the same fix one at a time. Moving
    // it outside the clickable tree entirely removes the whole bug class.
    <>
      <div
        className="flex items-center gap-3.5 px-4 py-3.5 mx-2 my-1 rounded-2xl cursor-pointer border border-transparent hover:border-border/60 hover:bg-muted/50 transition-all duration-200"
        onClick={handleClick}
      >
      <div className="relative shrink-0">
        <div
          className={cn(
            'flex h-11 w-11 items-center justify-center rounded-2xl font-bold shadow-xs transition-colors',
            hasActivePeers
              ? 'bg-emerald-500 text-white shadow-emerald-500/20 shadow-md'
              : 'bg-muted text-muted-foreground border border-border/60',
          )}
        >
          {hasActivePeers ? (
            <Users className="h-5 w-5" />
          ) : meeting.callToGroup ? (
            <Users className="h-5 w-5" />
          ) : (
            <Video className="h-5 w-5" />
          )}
        </div>
        {hasActivePeers && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-600 px-1 text-[9px] font-bold text-white ring-2 ring-card">
            {meeting.peers.length}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col justify-center min-w-0">
        <div className="text-xs font-bold text-foreground truncate">{title}</div>
        <div
          className={cn(
            'text-[11px] truncate mt-0.5',
            hasActivePeers ? 'text-emerald-500 font-medium' : 'text-muted-foreground',
          )}
        >
          {text}
        </div>
        <div className="text-[10px] text-muted-foreground/60 truncate font-mono mt-0.5">{`ID: ${meeting._id}`}</div>
        {/* Call Timeline / Call History (spec §19) — kept as a single
            unobtrusive line, not a new button, to avoid cluttering the
            card; clicking it opens the detailed on-demand timeline. Only
            rendered when this user actually has at least one CallSession
            for this meeting (participation comes from /meeting/list's
            lightweight per-meeting rollup, never fetched separately here). */}
        {meeting.participation && (
          <button
            type="button"
            className="mt-0.5 w-fit text-left text-[10px] text-muted-foreground/80 underline decoration-dotted underline-offset-2 hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              setShowTimeline(true);
            }}
          >
            {meeting.participation.sessionCount > 1
              ? `Joined ${meeting.participation.sessionCount} times · ${Math.max(1, Math.round(meeting.participation.totalDurationSeconds / 60))} min`
              : `Your participation: ${Math.max(1, Math.round(meeting.participation.totalDurationSeconds / 60))} min`}
          </button>
        )}
      </div>

      {meeting.summary?.status === 'SUMMARIZED' && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 shrink-0 gap-1.5 rounded-full px-2.5 text-[11px] font-semibold"
          onClick={(e) => {
            e.stopPropagation();
            setShowSummary(true);
          }}
        >
          <Sparkles className="h-3 w-3 text-primary" />
          Summary
        </Button>
      )}
      {meeting.summary && IN_PROGRESS_STATUSES.has(meeting.summary.status) && (
        <span className="flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Generating…
        </span>
      )}
      {meeting.summary?.status === 'FAILED' && (
        <span className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium text-muted-foreground/70">
          Summary unavailable
        </span>
      )}

      {!hasActivePeers && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
          disabled={deleting}
          onClick={handleDelete}
          aria-label="Delete from history"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
      </div>

      {showSummary && <MeetingSummaryPopup meetingId={meeting._id} onClose={() => setShowSummary(false)} />}
      {showTimeline && <CallTimelinePopup meetingId={meeting._id} onClose={() => setShowTimeline(false)} />}
    </>
  );
}

export default Meetings;
