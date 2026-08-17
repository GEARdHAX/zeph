import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useGlobal } from 'reactn';
import { Mic, PhoneOff } from 'lucide-react';
import callManager from '../../lib/callManager';

// Mounted once at the app root (sibling to <Router> in App.jsx), so it is
// never unmounted by route changes — unlike <Meeting/>, which only exists
// while the user is actually on /meeting/:id. This is what makes an active
// call visibly stay in view (camera/screen-share feed, not just an "in
// call" text bar) while the user browses other chats, instead of silently
// broadcasting in the background with zero indication.
function PictureInPicture() {
  const [callStatus] = useGlobal('callStatus');
  const [localStream] = useGlobal('localStream');
  const [videoStream] = useGlobal('videoStream');
  const [streams] = useGlobal('streams');
  const [video] = useGlobal('video');
  const [audio] = useGlobal('audio');
  const [isScreen] = useGlobal('screen');
  const [meetingID] = useGlobal('meetingID');
  const setOver = useGlobal('over')[1];
  const setShowPanel = useGlobal('showPanel')[1];
  const videoRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();

  const onMeetingPage = location.pathname.startsWith('/meeting');
  const visible = callStatus === 'in-call' && !onMeetingPage;
  const activeVideoStream = (video || isScreen) ? (localStream || videoStream) : (streams?.find((s) => s.isVideo)?.stream || null);
  const hasVideo = !!activeVideoStream;

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = activeVideoStream;
    if (activeVideoStream) {
      videoRef.current.play().catch(() => {});
    }
  }, [activeVideoStream, visible]);

  if (!visible) return null;

  const returnToCall = () => {
    setShowPanel(false);
    setOver(true);
    navigate(`/meeting/${meetingID}`, { replace: true });
  };

  return (
    <div className="fixed bottom-4 right-4 z-[2000] flex w-[160px] flex-col overflow-hidden rounded-xl border border-border bg-black shadow-xl sm:w-[200px]">
      <button
        type="button"
        onClick={returnToCall}
        className="relative flex aspect-video w-full items-center justify-center bg-black"
        title="Return to call"
      >
        {hasVideo ? (
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            onLoadedMetadata={() => videoRef.current?.play()}
            muted
            playsInline
          />
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-white/80">
            <Mic className={`h-6 w-6 ${audio ? 'text-primary' : ''}`} />
            <span className="text-[11px] font-medium">In call</span>
          </div>
        )}
        {isScreen && (
          <span className="absolute left-1.5 top-1.5 rounded-full bg-primary/90 px-1.5 py-0.5 text-[9px] font-semibold text-primary-foreground">
            Sharing screen
          </span>
        )}
      </button>
      <div className="flex items-center justify-between gap-1.5 bg-secondary px-2 py-1.5">
        <span className="truncate text-[11px] font-medium text-white/90">Tap to return</span>
        <button
          type="button"
          onClick={() => callManager.leave()}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-destructive text-white hover:bg-red-700"
          title="Hang up"
        >
          <PhoneOff className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export default PictureInPicture;
