import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useGlobal } from 'reactn';
import {
  Mic, MicOff, Video, VideoOff, PhoneOff,
} from 'lucide-react';
import callManager from '../../lib/callManager';

const TILE_WIDTH = 200; // matches the sm:w-[200px] tile size, used to clamp drag bounds
const TILE_MARGIN = 16; // matches the bottom-4/right-4 default offset

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
  const audioRef = useRef(null);
  const tileRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();

  // Position is tracked as {right, bottom} (matching the tile's default
  // fixed bottom-4 right-4 corner anchor) rather than {top, left} — this
  // way the tile stays pinned near whichever corner it was dropped in even
  // if the window is resized, instead of drifting off toward top-left.
  const [position, setPosition] = useState({ right: TILE_MARGIN, bottom: TILE_MARGIN });
  const dragState = useRef(null); // { startX, startY, startRight, startBottom, moved }

  const onMeetingPage = location.pathname.startsWith('/meeting');
  const visible = callStatus === 'in-call' && !onMeetingPage;
  // Each entry in `streams` (see callManager.js's consume()) IS the raw
  // MediaStream itself, tagged with .isVideo — not a wrapper object with a
  // nested `.stream` field. The previous `?.stream` access was always
  // undefined, so this tile could only ever show your own local
  // self-preview and never the remote peer's actual video.
  const activeVideoStream = (video || isScreen) ? (localStream || videoStream) : (streams?.find((s) => s.isVideo) || null);
  const hasVideo = !!activeVideoStream;
  // Remote video/audio are always separate mediasoup producers/streams
  // (see Meeting/components/Interface.jsx, the full-screen equivalent) —
  // the video element above only ever carries picture. Without this, the
  // PiP tile was silent for anything except your own muted self-preview:
  // no code anywhere attached the remote peer's audio-only stream to
  // anything while this tile was showing.
  const remoteAudioStream = streams?.find((s) => !s.isVideo) || null;

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = activeVideoStream;
    if (activeVideoStream) {
      videoRef.current.play().catch(() => {});
    }
  }, [activeVideoStream, visible]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.srcObject = remoteAudioStream;
    if (remoteAudioStream) {
      audioRef.current.play().catch(() => {});
    }
  }, [remoteAudioStream, visible]);

  // Clamp back on screen if the tile was dragged somewhere that a window
  // resize (or a re-mount at a different viewport size) would now put
  // partially or fully off-screen.
  useEffect(() => {
    const clamp = () => {
      setPosition((prev) => {
        const width = tileRef.current?.offsetWidth || TILE_WIDTH;
        const height = tileRef.current?.offsetHeight || width * 0.75;
        const maxRight = window.innerWidth - width - TILE_MARGIN;
        const maxBottom = window.innerHeight - height - TILE_MARGIN;
        return {
          right: Math.min(Math.max(prev.right, TILE_MARGIN), Math.max(maxRight, TILE_MARGIN)),
          bottom: Math.min(Math.max(prev.bottom, TILE_MARGIN), Math.max(maxBottom, TILE_MARGIN)),
        };
      });
    };
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, []);

  if (!visible) return null;

  const returnToCall = () => {
    // A drag that moved the pointer more than a few pixels is a drag, not a
    // click — don't also navigate away when the user was just repositioning
    // the tile.
    if (dragState.current?.moved) return;
    setShowPanel(false);
    setOver(true);
    navigate(`/meeting/${meetingID}`, { replace: true });
  };

  const onPointerDown = (e) => {
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      startRight: position.right,
      startBottom: position.bottom,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragState.current.moved = true;
    if (!dragState.current.moved) return;

    const width = tileRef.current?.offsetWidth || TILE_WIDTH;
    const height = tileRef.current?.offsetHeight || width * 0.75;
    const maxRight = window.innerWidth - width - TILE_MARGIN;
    const maxBottom = window.innerHeight - height - TILE_MARGIN;

    setPosition({
      right: Math.min(Math.max(dragState.current.startRight - dx, TILE_MARGIN), Math.max(maxRight, TILE_MARGIN)),
      bottom: Math.min(Math.max(dragState.current.startBottom - dy, TILE_MARGIN), Math.max(maxBottom, TILE_MARGIN)),
    });
  };

  const onPointerUp = (e) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    // Defer clearing so the subsequent click event (fired right after
    // pointerup on the same element) can still see dragState.current.moved.
    setTimeout(() => { dragState.current = null; }, 0);
  };

  const toggleAudio = async (e) => {
    e.stopPropagation();
    try {
      if (audio) {
        await callManager.stopAudio();
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        await callManager.produceAudio(stream);
      }
    } catch (err) {
      console.error('Failed to toggle audio in PiP:', err);
    }
  };

  const toggleVideo = async (e) => {
    e.stopPropagation();
    try {
      if (video) {
        await callManager.stopVideo();
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        await callManager.produceVideo(stream);
      }
    } catch (err) {
      console.error('Failed to toggle video in PiP:', err);
    }
  };

  const handleHangup = async (e) => {
    e.stopPropagation();
    await callManager.leave();
  };

  return (
    <div
      ref={tileRef}
      className="fixed z-[2000] flex w-[160px] select-none flex-col overflow-hidden rounded-xl border border-border bg-black shadow-2xl sm:w-[200px]"
      style={{ right: position.right, bottom: position.bottom }}
    >
      <button
        type="button"
        onClick={returnToCall}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="relative flex aspect-video w-full touch-none cursor-grab items-center justify-center bg-black active:cursor-grabbing"
        title="Drag to move · tap to return to call"
      >
        {/* Remote audio is a separate producer/stream from remote video
            (see Interface.jsx) — without this, the tile was silent
            whenever it showed anything other than your own muted
            self-preview. Not `muted`, unlike the video element above. */}
        {remoteAudioStream && (
          <audio
            ref={audioRef}
            onLoadedMetadata={() => audioRef.current?.play()}
            className="hidden"
            controls={false}
          />
        )}
        {hasVideo ? (
          <video
            ref={videoRef}
            className="h-full w-full object-cover pointer-events-none"
            onLoadedMetadata={() => videoRef.current?.play()}
            muted
            playsInline
          />
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-white/80 pointer-events-none">
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
      <div
        className="flex items-center justify-center gap-2 bg-secondary/95 px-2 py-2 backdrop-blur-md"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={toggleAudio}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
            audio ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-destructive/80 text-white hover:bg-destructive'
          }`}
          title={audio ? 'Mute microphone' : 'Unmute microphone'}
        >
          {audio ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={toggleVideo}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
            video ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-white/10 text-white/60 hover:bg-white/20'
          }`}
          title={video ? 'Turn off camera' : 'Turn on camera'}
        >
          {video ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={handleHangup}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-destructive text-white shadow-md transition-colors hover:bg-red-700 active:scale-95"
          title="Hang up"
        >
          <PhoneOff className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default PictureInPicture;
