import { useEffect, useRef, useState } from 'react';
import {
  Maximize,
  Mic,
  MicOff,
  Minimize,
  PhoneOff,
  Video,
  VideoOff,
  UserPlus,
  Monitor,
  XOctagon,
  Grid3x3,
  Columns2,
  Share2,
  MoreHorizontal,
  ChevronLeft,
} from 'lucide-react';
import { useSelector } from 'react-redux';
import { useNavigate, useParams } from 'react-router-dom';
import { useGlobal } from 'reactn';
import { toast } from 'react-toastify';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import Join from './components/Join';
import AddPeers from './components/AddPeers';
import Ringing from './components/Ringing';
import Streams from './components/Streams';
import MeetingRecorder from './components/MeetingRecorder';
import ShareMeetingInvite from './components/ShareMeetingInvite';
import callManager from '../../lib/callManager';
import getInfo from '../../actions/getInfo';

// The mediasoup session itself (Device, transports, producers) lives in
// callManager.js as module-level state, not here — that's what lets a call
// survive navigating to a different route. This component is now just the
// UI: it calls into callManager and renders whatever global/Redux state
// currently holds, exactly like the always-mounted PictureInPicture tile
// does when this component isn't mounted at all.
function Meeting() {
  const lastLeave = useSelector((state) => state.rtc.lastLeave);
  const lastLeaveType = useSelector((state) => state.rtc.lastLeaveType);
  const increment = useSelector((state) => state.rtc.increment);
  const closingState = useSelector((state) => state.rtc.closingState);
  const reconnecting = useSelector((state) => state.rtc.reconnecting);
  const [streams, setStreams] = useGlobal('streams');
  const [localStream] = useGlobal('localStream');
  const [video] = useGlobal('video');
  const [audio] = useGlobal('audio');
  const [isScreen] = useGlobal('screen');
  const setScreenStream = useGlobal('screenStream')[1];
  const [callStatus] = useGlobal('callStatus');
  const [callDirection] = useGlobal('callDirection');
  const [joined, setJoined] = useGlobal('joined');
  // Video crop style (object-fit: cover vs contain) — previously user-
  // toggleable via the "Fill screen"/"Fit to screen" button, which despite
  // its Maximize/Minimize icon never actually invoked the browser's
  // Fullscreen API (see isFullscreen below, which now owns that button).
  // Pinned to cover (full-bleed, no letterboxing) — the sensible default
  // for a video call — rather than removed outright, so Streams/Interface/
  // LittleInterface's isMaximized prop plumbing stays unchanged.
  const isMaximized = true;
  // Phones' browsers mostly cannot capture the screen; hide the button instead of failing on tap.
  const canShareScreen = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
  // Real fullscreen state, synced both ways: toggleFullscreen() drives it,
  // and the fullscreenchange listener below catches the user exiting via
  // Esc/browser-chrome so the icon doesn't go stale.
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef(null);
  const [isGrid, setGrid] = useState(true);
  const [acccepted, setAccepted] = useGlobal('accepted');
  const [showPanel, setShowPanel] = useGlobal('showPanel');
  const setOver = useGlobal('over')[1];
  const setMeeting = useGlobal('meetingID')[1];
  const [addPeers, setAddPeers] = useState(false);
  const [showShareInvite, setShowShareInvite] = useState(false);
  // No loading state previously covered the initial join at all — only a
  // mid-call socket drop ("Reconnecting…" below) did. onJoin flips `joined`
  // true synchronously and this component falls straight through to the
  // full call UI while callManager.join()'s socket handshake/mediasoup
  // negotiation is still in flight (fire-and-forget, no caught rejection
  // either) — on a slow/unstable connection that's empty/black video tiles
  // with no "something is happening" cue, and a failure (denied camera
  // permission, dropped handshake) threw silently with zero user feedback.
  const [connecting, setConnecting] = useState(false);
  const [meetingAiEnabled, setMeetingAiEnabled] = useState(false);

  useEffect(() => {
    getInfo()
      .then((res) => setMeetingAiEnabled(!!res.data.meetingAiEnabled))
      .catch(() => {});
  }, []);

  const answerIncrement = useSelector((state) => state.rtc.answerIncrement);
  const answerData = useSelector((state) => state.rtc.answerData);

  const params = useParams();
  const roomID = params.id;

  const navigate = useNavigate();

  const init = () => {
    setConnecting(true);
    callManager
      .join(roomID)
      .catch((err) => {
        // The toast is deliberately generic; the real reason (e.g. call_request_failed) goes to the console.
        console.error('call join failed:', err && err.message);
        toast.error('Could not connect to the call. Check your connection and try again.');
      })
      .finally(() => setConnecting(false));
  };

  useEffect(() => {
    if (!answerData) return;
    if (callDirection === 'outgoing' && callStatus !== 'in-call' && answerData.meetingID === roomID) {
      setJoined(true);
      init();
    }
  }, [answerIncrement, answerData]);

  useEffect(() => {
    if (acccepted) {
      setAccepted(false).then(() => {
        setJoined(true);
        init();
      });
    }
  }, [acccepted]);

  // No unmount cleanup here anymore — leaving this route must never
  // implicitly end the call (that used to silently keep the camera/mic/
  // screen-share broadcasting anyway, since the old guard on callStatus
  // meant the cleanup never actually ran). The call now genuinely persists
  // in the background via callManager, and stays visible via the
  // always-mounted PictureInPicture tile. The only way to end a call is the
  // explicit hang-up button, which calls callManager.leave().
  useEffect(() => {
    setMeeting(roomID);
  }, []);

  // Keeps isFullscreen accurate when the user exits fullscreen WITHOUT
  // clicking our own button — Esc, the browser's own "Exit fullscreen"
  // chrome, or the OS switching away. Without this the button's icon/label
  // would silently go stale (still say "Fit to screen" while the page is
  // actually back in normal layout).
  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await containerRef.current?.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
      // fullscreenchange (above) also fires and would set this correctly,
      // but setting it here too means the icon updates immediately rather
      // than waiting on that event round-trip.
      setIsFullscreen(!!document.fullscreenElement);
    } catch (err) {
      // Fullscreen requests reject if not triggered by a direct user
      // gesture, or if the browser/embedder disallows it entirely (some
      // in-app webviews) — fail quietly rather than surface a toast for
      // what's a non-essential visual feature.
      console.error('Fullscreen request failed:', err);
    }
  };

  // Each wraps getUserMedia/getDisplayMedia with a user-visible error —
  // a denied permission or a busy device otherwise rejected silently,
  // leaving the toggle stuck "off" with no explanation. Rethrow so the
  // .then(produce…) chain doesn't run against an undefined stream.
  const getAudio = async () => {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      toast.error('Could not access your microphone. Check the browser permission and try again.');
      throw e;
    }
  };
  const getVideo = async () => {
    try {
      return await navigator.mediaDevices.getUserMedia({ video: true });
    } catch (e) {
      toast.error('Could not access your camera. Check the browser permission and try again.');
      throw e;
    }
  };
  // No toast on failure here — the common rejection is the user simply
  // cancelling the browser's screen-picker.
  const getScreen = async () => {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    setScreenStream(stream);
    return stream;
  };

  useEffect(() => {
    if (lastLeaveType === 'leave') setStreams(streams.filter((s) => s.socketID !== lastLeave));
    else setStreams(streams.filter((s) => s.producerID !== lastLeave));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastLeave, lastLeaveType, increment]);

  // callManager.leave() does the actual teardown (stop tracks, close
  // transport, notify the server + counterpart, reset every call global) —
  // it's self-contained so the PiP tile's hang-up button can call it too
  // without this component being mounted. Navigate first, then tear down:
  // callManager.leave() flips `joined` to false, and doing that before
  // navigating away would otherwise flash this component's Join screen for
  // a frame while still on /meeting/:id.
  const close = async () => {
    navigate('/', { replace: true });
    await callManager.leave();
  };

  useEffect(() => {
    if (closingState && joined) close();
  }, [closingState]);

  if (callDirection === 'incoming' && !joined) {
    return (
      <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-background/80 backdrop-blur-xl p-4">
        <div className="absolute inset-0 bg-radial from-primary/10 via-transparent to-black/60 pointer-events-none" />
        <Ringing
          incoming
          meetingID={roomID}
          onJoin={() => {
            setJoined(true);
            init();
          }}
        />
      </div>
    );
  }

  if (callDirection === 'outgoing' && !joined) {
    return (
      <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-background/80 backdrop-blur-xl p-4">
        <div className="absolute inset-0 bg-radial from-primary/10 via-transparent to-black/60 pointer-events-none" />
        <Ringing incoming={false} meetingID={roomID} />
      </div>
    );
  }

  if (!joined) {
    return (
      <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-background/80 backdrop-blur-xl p-4">
        <div className="absolute inset-0 bg-radial from-primary/10 via-transparent to-black/60 pointer-events-none" />
        <Join
          onClose={() => {
            setShowPanel(true);
            setOver(false);
            navigate('/', { replace: true });
          }}
          onJoin={() => {
            setJoined(true);
            init();
          }}
        />
      </div>
    );
  }

  // Floating chevron (minimize to Picture-in-Picture) and your own preview, labelled "You".
  function TopBarTransparent({ localStream }) {
    const localVideoRef = useRef(null);

    useEffect(() => {
      if (!localStream || !localVideoRef.current) return;
      localVideoRef.current.srcObject = localStream;
    }, [localStream]);

    return (
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[1000] flex items-start justify-between p-2 sm:p-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="pointer-events-auto h-10 w-10 rounded-full bg-black/50 text-white backdrop-blur-md hover:bg-black/70 hover:text-white"
          onClick={() => {
            setShowPanel(true);
            setOver(false);
            navigate('/');
          }}
          title="Minimize to Picture-in-Picture"
          aria-label="Minimize to Picture-in-Picture"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        {(video || isScreen) && (
          <div className="pointer-events-auto relative h-[72px] w-[96px] overflow-hidden rounded-xl border border-white/15 bg-black shadow-2xl sm:h-[105px] sm:w-[140px] sm:rounded-2xl">
            <video
              className={cn('h-full w-full object-cover', !isScreen && 'scale-x-[-1]')}
              onLoadedMetadata={() => localVideoRef.current.play()}
              ref={localVideoRef}
              playsInline
              muted
            />
            <span className="absolute bottom-1 left-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-md sm:text-xs">
              {isScreen ? 'You · presenting' : 'You'}
            </span>
          </div>
        )}
      </div>
    );
  }

  // One shared shape for every pill control so seven near-identical
  // className strings don't drift out of sync — active === the feature this
  // button controls is currently ON (video/audio/screen-share), which gets
  // a filled/tinted look instead of the flat neutral default, and danger is
  // the one-off hang-up button.
  function ControlButton({ icon: Icon, onClick, title, active, danger }) {
    return (
      <Button
        type="button"
        size="icon"
        onClick={onClick}
        title={title}
        aria-label={title}
        className={cn(
          'h-11 w-11 shrink-0 rounded-full shadow-md transition-transform active:scale-95 sm:h-14 sm:w-14',
          danger
            ? 'bg-destructive text-white hover:bg-destructive/90'
            : active
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-white/10 text-white hover:bg-white/20',
        )}
      >
        <Icon className="h-5 w-5" />
      </Button>
    );
  }

  return (
    <div ref={containerRef} className="relative flex h-full w-full flex-col">
      {connecting && (
        <div className="absolute left-1/2 top-4 z-[1001] -translate-x-1/2 rounded-full border border-white/15 bg-black/75 px-4 py-2 text-xs font-medium text-white shadow-2xl backdrop-blur-2xl">
          Connecting…
        </div>
      )}
      {!connecting && reconnecting && (
        <div className="absolute left-1/2 top-4 z-[1001] -translate-x-1/2 rounded-full border border-white/15 bg-black/75 px-4 py-2 text-xs font-medium text-white shadow-2xl backdrop-blur-2xl">
          Reconnecting…
        </div>
      )}
      <TopBarTransparent localStream={localStream} />
      <Streams
        isGrid={isGrid}
        streams={streams}
        localStream={localStream}
        isVideo={video}
        isScreen={isScreen}
        isMaximized={isMaximized}
      >
        <div className="absolute inset-x-0 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[1000] flex justify-center px-2 sm:bottom-6 sm:px-4">
          <div className="flex max-w-full items-center gap-1.5 rounded-full border border-white/15 bg-black/75 p-1.5 shadow-2xl backdrop-blur-2xl sm:gap-2.5 sm:p-2">
            <ControlButton
              icon={video ? Video : VideoOff}
              active={video}
              title={video ? 'Turn off camera' : 'Turn on camera'}
              onClick={() =>
                video
                  ? callManager.stopVideo()
                  : getVideo()
                      .then((stream) => callManager.produceVideo(stream))
                      .catch(() => {})
              }
            />
            <ControlButton
              icon={audio ? Mic : MicOff}
              active={audio}
              title={audio ? 'Mute microphone' : 'Unmute microphone'}
              onClick={() =>
                audio
                  ? callManager.stopAudio()
                  : getAudio()
                      .then((stream) => callManager.produceAudio(stream))
                      .catch(() => {})
              }
            />
            {canShareScreen && (
              <ControlButton
                icon={isScreen ? XOctagon : Monitor}
                active={isScreen}
                title={isScreen ? 'Stop sharing screen' : 'Share screen'}
                onClick={() =>
                  isScreen
                    ? callManager.stopScreen()
                    : getScreen()
                        .then((stream) => callManager.produceScreen(stream))
                        .catch(() => {})
                }
              />
            )}

            {meetingAiEnabled && <MeetingRecorder meetingId={roomID} />}

            {/* Tablet/desktop: the rest of the controls sit inline. */}
            <div className="hidden items-center gap-2.5 sm:flex">
              <div className="mx-0.5 h-8 w-px bg-white/15" />
              <ControlButton icon={UserPlus} title="Add people" onClick={() => setAddPeers(true)} />
              <ControlButton icon={Share2} title="Share meeting" onClick={() => setShowShareInvite(true)} />
              <ControlButton
                icon={isFullscreen ? Minimize : Maximize}
                title={isFullscreen ? 'Exit fullscreen' : 'Fill screen'}
                onClick={toggleFullscreen}
              />
              <ControlButton
                icon={isGrid ? Columns2 : Grid3x3}
                title={isGrid ? 'Switch to spotlight view' : 'Switch to tiled view'}
                onClick={() => setGrid(!isGrid)}
              />
              <div className="mx-0.5 h-8 w-px bg-white/15" />
            </div>

            {/* Phone: the rest collapse into a "More" menu so the bar always fits. */}
            <div className="sm:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    title="More"
                    aria-label="More"
                    className="h-11 w-11 shrink-0 rounded-full bg-white/10 text-white shadow-md hover:bg-white/20"
                  >
                    <MoreHorizontal className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="end" sideOffset={12} className="z-[1100] min-w-48">
                  <DropdownMenuItem onSelect={() => setAddPeers(true)}>
                    <UserPlus className="mr-2 h-4 w-4" /> Add people
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setShowShareInvite(true)}>
                    <Share2 className="mr-2 h-4 w-4" /> Share meeting
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setGrid(!isGrid)}>
                    {isGrid ? <Columns2 className="mr-2 h-4 w-4" /> : <Grid3x3 className="mr-2 h-4 w-4" />}
                    {isGrid ? 'Spotlight view' : 'Tiled view'}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <ControlButton icon={PhoneOff} danger title="Leave call" onClick={close} />
          </div>
        </div>
      </Streams>
      {addPeers && <AddPeers onClose={() => setAddPeers(false)} />}
      {showShareInvite && <ShareMeetingInvite meetingId={roomID} onClose={() => setShowShareInvite(false)} />}
    </div>
  );
}

export default Meeting;
