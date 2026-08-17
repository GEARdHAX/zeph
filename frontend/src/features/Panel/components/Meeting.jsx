import { useGlobal } from 'reactn';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import moment from 'moment';
import { Phone, Video, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import Actions from '../../../constants/Actions';
import postCall from '../../../actions/postCall';

function Meetings({ meeting }) {
  const setMeeting = useGlobal('meetingID')[1];
  const setOver = useGlobal('over')[1];
  const setShowPanel = useGlobal('showPanel')[1];
  const setAudio = useGlobal('audio')[1];
  const setVideo = useGlobal('video')[1];
  const setCallDirection = useGlobal('callDirection')[1];
  const user = useGlobal('user')[0] || {};

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

  return (
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
        <div className={cn('text-[11px] truncate mt-0.5', hasActivePeers ? 'text-emerald-500 font-medium' : 'text-muted-foreground')}>
          {text}
        </div>
        <div className="text-[10px] text-muted-foreground/60 truncate font-mono mt-0.5">{`ID: ${meeting._id}`}</div>
      </div>
    </div>
  );
}

export default Meetings;
