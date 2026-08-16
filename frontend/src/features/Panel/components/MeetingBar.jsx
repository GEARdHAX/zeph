import { useGlobal } from 'reactn';
import { useNavigate } from 'react-router-dom';

function MeetingBar() {
  const [meeting] = useGlobal('meetingID');
  const setOver = useGlobal('over')[1];
  const setShowPanel = useGlobal('showPanel')[1];

  const navigate = useNavigate();

  return (
    <div
      className="flex h-[50px] cursor-pointer animate-pulse items-center justify-center bg-blue-800 text-white"
      onClick={() => {
        setShowPanel(false);
        setOver(true);
        navigate(`/meeting/${meeting}`, { replace: true });
      }}
    >
      Go back to the meeting
    </div>
  );
}

export default MeetingBar;
