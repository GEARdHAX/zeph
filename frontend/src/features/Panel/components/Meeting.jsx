import { useGlobal } from 'reactn';
import { useNavigate } from 'react-router-dom';
import moment from 'moment';
import { cn } from '@/lib/utils';

function Meetings({ meeting }) {
  const setMeeting = useGlobal('meetingID')[1];
  const setOver = useGlobal('over')[1];
  const setShowPanel = useGlobal('showPanel')[1];
  const user = useGlobal('user')[0];

  const navigate = useNavigate();

  let text;

  if (meeting.peers.length > 0) text = `${meeting.peers.length} peers connected`;
  else if (meeting.lastLeave) text = `Meeting ended ${moment(meeting.lastLeave).fromNow()}`;

  const incoming = meeting.callee && user.id === meeting.callee._id;

  let title = 'Untitled Meeting';
  if (meeting.startedAsCall) {
    if (meeting.callToGroup) {
      title = `Group call in ${meeting.group.title}`;
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

  return (
    <div
      className="flex h-20 cursor-pointer items-center border-b"
      onClick={() => {
        setMeeting(meeting._id);
        setShowPanel(false);
        setOver(true);
        navigate(`/meeting/${meeting._id}`, { replace: true });
      }}
    >
      <div className="mx-3 h-10 w-10 shrink-0 overflow-hidden rounded-full">
        <div
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-lg text-secondary-foreground',
            meeting.peers.length && 'bg-emerald-500 text-white',
          )}
        >
          {meeting.peers.length}
        </div>
      </div>
      <div className="flex flex-1 flex-col justify-center">
        <div className="text-[13px] font-bold">{title}</div>
        <div className="text-[11px] text-muted-foreground">{text}</div>
        <div className="text-[11px] text-muted-foreground">{`ID: ${meeting._id}`}</div>
      </div>
    </div>
  );
}

export default Meetings;
