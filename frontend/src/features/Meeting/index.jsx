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
  Menu,
  ChevronLeft,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { useSelector } from 'react-redux';
import { useNavigate, useParams } from 'react-router-dom';
import { useGlobal } from 'reactn';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import Join from './components/Join';
import AddPeers from './components/AddPeers';
import Ringing from './components/Ringing';
import Streams from './components/Streams';
import LittleStreams from './components/LittleStreams';
import callManager from '../../lib/callManager';

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
  const [streams, setStreams] = useGlobal('streams');
  const [localStream] = useGlobal('localStream');
  const [video] = useGlobal('video');
  const [audio] = useGlobal('audio');
  const [isScreen] = useGlobal('screen');
  const setScreenStream = useGlobal('screenStream')[1];
  const [callStatus] = useGlobal('callStatus');
  const [callDirection] = useGlobal('callDirection');
  const [joined, setJoined] = useGlobal('joined');
  const [isMaximized, setMaximized] = useState(true);
  const [isGrid, setGrid] = useState(true);
  const [topBar, setTopBar] = useState(true);
  const [acccepted, setAccepted] = useGlobal('accepted');
  const [showPanel, setShowPanel] = useGlobal('showPanel');
  const setOver = useGlobal('over')[1];
  const setMeeting = useGlobal('meetingID')[1];
  const [addPeers, setAddPeers] = useState(false);

  const answerIncrement = useSelector((state) => state.rtc.answerIncrement);
  const answerData = useSelector((state) => state.rtc.answerData);

  const params = useParams();
  const roomID = params.id;

  const navigate = useNavigate();

  const init = () => callManager.join(roomID);

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

  const getAudio = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return stream;
  };
  const getVideo = () => navigator.mediaDevices.getUserMedia({ video: true });
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

  function TopBar({ localStream }) {
    const localVideoRef = useRef(null);

    useEffect(() => {
      if (!localStream) return;
      localVideoRef.current.srcObject = localStream;
    }, [localStream]);

    return (
      <div className="z-[1] flex h-[95px] min-h-[95px] w-full max-w-full flex-grow items-center gap-2 border-b border-border/40 bg-card/95 px-2 backdrop-blur-xl max-sm:h-[85px] max-sm:min-h-[85px]">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
          onClick={() => {
            setShowPanel(!showPanel);
            setOver(showPanel);
          }}
          title={showPanel ? 'Hide sidebar' : 'Show sidebar'}
        >
          {showPanel ? <ChevronLeft className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </Button>
        <LittleStreams streams={streams} />
        <div className="shrink-0">
          <video
            hidden={!video && !isScreen}
            className="mx-0.5 h-[80px] w-[120px] scale-x-[-1] cursor-pointer rounded-xl border border-border/50 bg-black object-cover shadow-md max-sm:h-[70px] max-sm:w-[100px]"
            onLoadedMetadata={() => localVideoRef.current.play()}
            ref={localVideoRef}
            playsInline
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
          onClick={() => setTopBar(!topBar)}
          title={topBar ? 'Collapse top bar' : 'Expand top bar'}
        >
          {topBar ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </Button>
      </div>
    );
  }

  function TopBarTransparent({ localStream }) {
    const localVideoRef = useRef(null);

    useEffect(() => {
      if (!localStream || !localVideoRef.current) return;
      localVideoRef.current.srcObject = localStream;
    }, [localStream]);

    return (
      <div className="z-[1000] flex h-0 w-full items-start justify-between p-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 rounded-full bg-black/40 text-white backdrop-blur-md hover:bg-black/60 hover:text-white"
          onClick={() => {
            setShowPanel(!showPanel);
            setOver(showPanel);
          }}
          title={showPanel ? 'Hide sidebar' : 'Show sidebar'}
        >
          {showPanel ? <ChevronLeft className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </Button>
        {(video || isScreen) && (
          <video
            hidden={!video && !isScreen}
            className="h-[105px] w-[140px] scale-x-[-1] cursor-pointer rounded-2xl border border-white/15 bg-black object-cover shadow-2xl"
            onLoadedMetadata={() => localVideoRef.current.play()}
            ref={localVideoRef}
            playsInline
          />
        )}
      </div>
    );
  }

  // One shared shape for every pill control so seven near-identical
  // className strings don't drift out of sync — active === the feature this
  // button controls is currently ON (video/audio/screen-share), which gets
  // a filled/tinted look instead of the flat neutral default, and danger is
  // the one-off hang-up button.
  function ControlButton({
    icon: Icon, onClick, title, active, danger,
  }) {
    return (
      <Button
        type="button"
        size="icon"
        onClick={onClick}
        title={title}
        aria-label={title}
        className={cn(
          'h-12 w-12 shrink-0 rounded-full shadow-md transition-transform active:scale-95 sm:h-14 sm:w-14',
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
    <div className="flex h-full w-full flex-col">
      {isGrid && <TopBarTransparent localStream={localStream} />}
      {!isGrid && topBar && <TopBar localStream={localStream} />}
      <Streams
        isGrid={isGrid}
        streams={streams}
        localStream={localStream}
        isVideo={video}
        isScreen={isScreen}
        isMaximized={isMaximized}
      >
        <div
          className="absolute z-[1] flex w-full items-center justify-center pb-5 max-sm:pb-3"
          style={{ bottom: topBar || isGrid ? 0 : 95 }}
        >
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/50 p-2 shadow-2xl backdrop-blur-xl sm:gap-2.5">
            <ControlButton
              icon={video ? Video : VideoOff}
              active={video}
              title={video ? 'Turn off camera' : 'Turn on camera'}
              onClick={() => (video ? callManager.stopVideo() : getVideo().then((stream) => callManager.produceVideo(stream)))}
            />
            <ControlButton
              icon={audio ? Mic : MicOff}
              active={audio}
              title={audio ? 'Mute microphone' : 'Unmute microphone'}
              onClick={() => (audio ? callManager.stopAudio() : getAudio().then((stream) => callManager.produceAudio(stream)))}
            />
            <ControlButton
              icon={isScreen ? XOctagon : Monitor}
              active={isScreen}
              title={isScreen ? 'Stop sharing screen' : 'Share screen'}
              onClick={() => (isScreen ? callManager.stopScreen() : getScreen().then((stream) => callManager.produceScreen(stream)))}
            />

            <div className="mx-0.5 h-8 w-px bg-white/15" />

            <ControlButton
              icon={PhoneOff}
              danger
              title="Leave call"
              onClick={close}
            />

            <div className="mx-0.5 h-8 w-px bg-white/15" />

            <ControlButton
              icon={UserPlus}
              title="Add people"
              onClick={() => setAddPeers(true)}
            />
            <ControlButton
              icon={isMaximized ? Minimize : Maximize}
              title={isMaximized ? 'Fit to screen' : 'Fill screen'}
              onClick={() => setMaximized(!isMaximized)}
            />
            <ControlButton
              icon={isGrid ? Columns2 : Grid3x3}
              title={isGrid ? 'Switch to spotlight view' : 'Switch to grid view'}
              onClick={() => setGrid(!isGrid)}
            />
          </div>
        </div>
      </Streams>
      {!isGrid && !topBar && <TopBar localStream={localStream} />}
      {addPeers && <AddPeers onClose={() => setAddPeers(false)} />}
    </div>
  );
}

export default Meeting;
