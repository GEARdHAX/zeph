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
import { useDispatch, useSelector } from 'react-redux';
import * as mediasoup from 'mediasoup-client';
import { useNavigate, useParams } from 'react-router-dom';
import { useGlobal, getGlobal } from 'reactn';
import Actions from '../../constants/Actions';
import Join from './components/Join';
import AddPeers from './components/AddPeers';
import Ringing from './components/Ringing';
import Streams from './components/Streams';
import LittleStreams from './components/LittleStreams';
import postClose from '../../actions/postClose';

let transport;
let videoProducer;
let screenProducer;
let audioProducer;

function Meeting() {
  const [device, setDevice] = useState(null);
  const io = useSelector((state) => state.io.io);
  const producers = useSelector((state) => state.rtc.producers);
  const lastLeave = useSelector((state) => state.rtc.lastLeave);
  const lastLeaveType = useSelector((state) => state.rtc.lastLeaveType);
  const increment = useSelector((state) => state.rtc.increment);
  const closingState = useSelector((state) => state.rtc.closingState);
  const [streams, setStreams] = useGlobal('streams');
  const [localStream, setLocalStream] = useGlobal('localStream');
  const [video, setVideo] = useGlobal('video');
  const [audio, setAudio] = useGlobal('audio');
  const [isScreen, setScreen] = useGlobal('screen');
  const [audioStream, setAudioStream] = useGlobal('audioStream');
  const [videoStream, setVideoStream] = useGlobal('videoStream');
  const setScreenStream = useGlobal('screenStream')[1];
  const [callStatus, setCallStatus] = useGlobal('callStatus');
  const callDirection = useGlobal('callDirection')[0];
  const [joined, setJoined] = useGlobal('joined');
  const [isMaximized, setMaximized] = useState(true);
  const [isGrid, setGrid] = useState(true);
  const [topBar, setTopBar] = useState(true);
  const [acccepted, setAccepted] = useGlobal('accepted');
  const [showPanel, setShowPanel] = useGlobal('showPanel');
  const setOver = useGlobal('over')[1];
  const setMeeting = useGlobal('meetingID')[1];
  const [addPeers, setAddPeers] = useState(false);
  const counterpart = useSelector((state) => state.rtc.counterpart) || {};

  const answerIncrement = useSelector((state) => state.rtc.answerIncrement);
  const answerData = useSelector((state) => state.rtc.answerData);

  const params = useParams();
  const roomID = params.id;

  const dispatch = useDispatch();
  const navigate = useNavigate();

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

  useEffect(() => {
    setMeeting(roomID);
    return () => {
      if (getGlobal().callStatus !== 'in-call') {
        try {
          if (getGlobal().audioStream) {
            getGlobal()
              .audioStream.getTracks()
              .forEach((track) => track.stop());
          }
        } catch (e) {}
        try {
          if (getGlobal().videoStream) {
            getGlobal()
              .videoStream.getTracks()
              .forEach((track) => track.stop());
          }
        } catch (e) {}
      }
    };
  }, []);

  const getAudio = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    setAudioStream(stream);
    return stream;
  };
  const getVideo = async () => {
    const stream = navigator.mediaDevices.getUserMedia({ video: true });
    setVideoStream(stream);
    return stream;
  };
  const getScreen = async () => {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    setScreenStream(stream);
    return stream;
  };

  const produceAudio = async (stream) => {
    const useStream = stream || audioStream;
    setAudio(true);
    try {
      const track = useStream.getAudioTracks()[0];
      const params = { track };
      audioProducer = await transport.produce(params);
    } catch (err) {
      console.log('getusermedia produce failed', err);
      setAudio(false);
    }
  };

  const produceVideo = async (stream) => {
    const useStream = stream || videoStream;
    setVideo(true);
    try {
      const track = useStream.getVideoTracks()[0];
      const params = { track, appData: { isScreen: false } };
      await setLocalStream(useStream);
      videoProducer = await transport.produce(params);
    } catch (err) {
      console.log('getusermedia produce failed', err);
      setVideo(false);
    }
  };

  const produceScreen = async (stream) => {
    try {
      const track = stream.getVideoTracks()[0];
      const params = { track, appData: { isScreen: true } };
      await setLocalStream(stream);
      screenProducer = await transport.produce(params);
      await setScreen(true);
    } catch (err) {
      console.log('getusermedia produce failed', err);
    }
  };

  const stopScreen = async () => {
    try {
      if (localStream) localStream.getVideoTracks()[0].stop();
      await io.request('remove', { producerID: screenProducer.id, roomID });
      screenProducer.close();
      screenProducer = null;
      await setScreen(false);
    } catch (e) {
      console.log(e);
    }
  };

  const stopVideo = async () => {
    try {
      if (localStream) localStream.getVideoTracks()[0].stop();
      await io.request('remove', { producerID: videoProducer.id, roomID });
      videoProducer.close();
      videoProducer = null;
      await setVideo(false);
    } catch (e) {
      console.log(e);
    }
  };

  const stopAudio = async () => {
    try {
      await io.request('remove', { producerID: audioProducer.id, roomID });
      audioProducer.close();
      audioProducer = null;
      await setAudio(false);
    } catch (e) {
      console.log(e);
    }
  };

  const init = async () => {
    await setCallStatus('in-call');
    await setShowPanel(false);
    await setOver(true);

    window.consumers = [];
    await setStreams([]);

    dispatch({ type: Actions.RTC_ROOM_ID, roomID });

    const { producers, consumers, peers } = await io.request('join', { roomID });

    dispatch({ type: Actions.RTC_CONSUMERS, consumers, peers });

    const routerRtpCapabilities = await io.request('getRouterRtpCapabilities');
    const device = new mediasoup.Device();
    await device.load({ routerRtpCapabilities });

    setDevice(device);

    await subscribe(device);

    dispatch({ type: Actions.RTC_PRODUCERS, producers: producers || [] });

    const data = await io.request('createProducerTransport', {
      forceTcp: false,
      rtpCapabilities: device.rtpCapabilities,
      roomID,
    });

    if (data.error) {
      console.error(data.error);
      return;
    }

    transport = device.createSendTransport(data);
    transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      io.request('connectProducerTransport', { dtlsParameters }).then(callback).catch(errback);
    });

    transport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
      try {
        const { id } = await io.request('produce', {
          transportId: transport.id,
          kind,
          rtpParameters,
          roomID,
          isScreen: appData && appData.isScreen,
        });
        callback({ id });
      } catch (err) {
        errback(err);
      }
    });

    transport.on('connectionstatechange', (state) => {
      switch (state) {
        case 'connecting':
          break;

        case 'connected':
          // document.querySelector('#local_video').srcObject = stream;
          break;

        case 'failed':
          transport.close();
          break;

        default:
          break;
      }
    });

    await produceAudio();
    await produceVideo();
  };

  useEffect(() => {
    if (lastLeaveType === 'leave') setStreams(getGlobal().streams.filter((s) => s.socketID !== lastLeave));
    else setStreams(getGlobal().streams.filter((s) => s.producerID !== lastLeave));
  }, [lastLeave, lastLeaveType, setStreams, increment]);

  useEffect(() => {
    const init = async () => {
      if (!window.consumers) {
        window.consumers = [];
      }
      const newStreams = [];
      for (const producer of producers) {
        if (!window.consumers.includes(producer.producerID) && producer.roomID === roomID) {
          window.consumers.push(producer.producerID);

          const stream = await consume(window.transport, producer);

          stream.producerID = producer.producerID;
          stream.socketID = producer.socketID;
          stream.userID = producer.userID;

          newStreams.push(stream);

          io.request('resume', { producerID: producer.producerID, meetingID: roomID });
        }
      }
      setStreams([...getGlobal().streams, ...newStreams]);
    };
    init();
  }, [producers]);

  const consume = async (transport, producer) => {
    const { rtpCapabilities } = device;
    const data = await io.request('consume', {
      rtpCapabilities,
      socketID: producer.socketID,
      roomID,
      producerID: producer.producerID,
    });
    const { producerId, id, kind, rtpParameters } = data;

    const codecOptions = {};
    const consumer = await transport.consume({
      id,
      producerId,
      kind,
      rtpParameters,
      codecOptions,
    });
    consumer.on('producerclose', () => {
      console.log('associated producer closed so consumer closed');
    });
    consumer.on('close', () => {
      console.log('consumer closed');
    });
    const stream = new MediaStream();
    stream.addTrack(consumer.track);
    stream.isVideo = kind === 'video';
    return stream;
  };

  const subscribe = async (device, socketID) => {
    const data = await io.request('createConsumerTransport', {
      forceTcp: false,
      roomID,
      socketID,
    });

    if (data.error) {
      console.error(data.error);
      return;
    }

    const transport = device.createRecvTransport(data);
    transport.on('connect', ({ dtlsParameters }, callback, errback) => {
      io.request('connectConsumerTransport', {
        transportId: transport.id,
        dtlsParameters,
        socketID,
      })
        .then(callback)
        .catch(errback);
    });

    transport.on('connectionstatechange', async (state) => {
      switch (state) {
        case 'connecting':
          break;

        case 'connected':
          // document.querySelector('#remote_video').srcObject = await stream;
          for (const producer of producers) {
            await io.request('resume', { producerID: producer.producerID });
          }
          break;

        case 'failed':
          transport.close();
          break;

        default:
          break;
      }
    });

    window.transport = transport;
  };

  const close = async () => {
    try {
      localStream.getVideoTracks()[0].stop();
    } catch (e) {}
    await setStreams([]);
    try {
      transport.close();
    } catch (e) {}
    try {
      await io.request('leave', { roomID });
    } catch (e) {}
    postClose({ roomID, userID: counterpart._id });
    navigate('/', { replace: true });
    await setJoined(false);
    await setShowPanel(true);
    await setCallStatus(null);
    dispatch({ type: Actions.RTC_LEAVE });
  };

  useEffect(() => {
    if (closingState && joined) close();
  }, [closingState]);

  if (callDirection === 'incoming' && !joined) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-black">
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
      <div className="flex h-full flex-col items-center justify-center bg-black">
        <Ringing incoming={false} meetingID={roomID} />
      </div>
    );
  }

  if (!joined) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-black">
        <Join
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
      <div className="z-[1] flex h-[95px] min-h-[95px] w-full max-w-full flex-grow items-center bg-secondary max-sm:h-[85px] max-sm:min-h-[85px]">
        <button
          type="button"
          className="flex h-full w-[60px] min-w-[60px] items-center justify-center text-neutral-100 hover:bg-muted-foreground/20 max-sm:w-[50px] max-sm:min-w-[50px]"
          onClick={() => {
            setShowPanel(!showPanel);
            setOver(showPanel);
          }}
        >
          {showPanel ? <ChevronLeft /> : <Menu />}
        </button>
        <LittleStreams streams={streams} />
        <div className="flex-none">
          <video
            hidden={!video && !isScreen}
            className="mx-px h-[95px] w-[135px] cursor-pointer bg-black object-cover max-sm:h-[85px] max-sm:w-[110px]"
            onLoadedMetadata={() => localVideoRef.current.play()}
            ref={localVideoRef}
            style={{ zIndex: 1000 }}
            playsInline
          />
        </div>
        <button
          type="button"
          className="flex h-full w-[60px] min-w-[60px] items-center justify-center text-neutral-100 hover:bg-muted-foreground/20 max-sm:w-[50px] max-sm:min-w-[50px]"
          onClick={() => setTopBar(!topBar)}
        >
          {topBar ? <ChevronDown /> : <ChevronUp />}
        </button>
      </div>
    );
  }

  function TopBarTransparent({ localStream }) {
    const localVideoRef = useRef(null);

    useEffect(() => {
      if (!localVideoRef) return;
      localVideoRef.current.srcObject = localStream;
    }, [localVideoRef]);

    return (
      <div className="z-[1000] flex h-0 w-full justify-between">
        <button
          type="button"
          className="relative flex h-[95px] w-[60px] min-w-[60px] items-center justify-center text-neutral-100"
          onClick={() => {
            setShowPanel(!showPanel);
            setOver(showPanel);
          }}
        >
          {showPanel ? <ChevronLeft /> : <Menu />}
        </button>
        <div className="relative flex-none" style={{ minWidth: video || isScreen ? 137 : 0 }}>
          <video
            hidden={!video && !isScreen}
            className="mx-px h-[105px] w-[140px] cursor-pointer bg-black object-cover"
            onLoadedMetadata={() => localVideoRef.current.play()}
            ref={localVideoRef}
            style={{ zIndex: 1000 }}
            playsInline
          />
        </div>
      </div>
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
          className="absolute z-[1] flex w-full items-center justify-center pb-[18px] max-sm:pb-3"
          style={{ bottom: topBar || isGrid ? 0 : 95 }}
        >
          <button
            type="button"
            className="m-0.5 flex h-[50px] w-[7vw] max-w-[80px] min-w-[50px] items-center justify-center bg-secondary text-white hover:bg-muted-foreground max-sm:h-[50px] max-sm:w-[13.5vw] max-sm:min-w-[40px] max-sm:text-sm"
            onClick={() => (video ? stopVideo() : getVideo().then((stream) => produceVideo(stream)))}
          >
            {video ? <Video /> : <VideoOff />}
          </button>
          <button
            type="button"
            className="m-0.5 flex h-[50px] w-[7vw] max-w-[80px] min-w-[50px] items-center justify-center bg-secondary text-white hover:bg-muted-foreground max-sm:h-[50px] max-sm:w-[13.5vw] max-sm:min-w-[40px] max-sm:text-sm"
            onClick={() => (audio ? stopAudio() : getAudio().then((stream) => produceAudio(stream)))}
          >
            {audio ? <Mic /> : <MicOff />}
          </button>
          <button
            type="button"
            className="m-0.5 flex h-[50px] w-[7vw] max-w-[80px] min-w-[50px] items-center justify-center bg-secondary text-white hover:bg-muted-foreground max-sm:h-[50px] max-sm:w-[13.5vw] max-sm:min-w-[40px] max-sm:text-sm"
            onClick={() => (isScreen ? stopScreen() : getScreen().then((stream) => produceScreen(stream)))}
          >
            {isScreen ? <XOctagon /> : <Monitor />}
          </button>
          <button
            type="button"
            className="m-0.5 flex h-[50px] w-[7vw] max-w-[80px] min-w-[50px] items-center justify-center border border-destructive bg-destructive text-white hover:border-red-700 hover:bg-red-700 max-sm:h-[50px] max-sm:w-[13.5vw] max-sm:min-w-[40px] max-sm:text-sm"
            onClick={close}
          >
            <PhoneOff />
          </button>
          <button
            type="button"
            className="m-0.5 flex h-[50px] w-[7vw] max-w-[80px] min-w-[50px] items-center justify-center bg-secondary text-white hover:bg-muted-foreground max-sm:h-[50px] max-sm:w-[13.5vw] max-sm:min-w-[40px] max-sm:text-sm"
            onClick={() => setAddPeers(true)}
          >
            <UserPlus />
          </button>
          <button
            type="button"
            className="m-0.5 flex h-[50px] w-[7vw] max-w-[80px] min-w-[50px] items-center justify-center bg-secondary text-white hover:bg-muted-foreground max-sm:h-[50px] max-sm:w-[13.5vw] max-sm:min-w-[40px] max-sm:text-sm"
            onClick={() => setMaximized(!isMaximized)}
          >
            {isMaximized ? <Maximize /> : <Minimize />}
          </button>
          <button
            type="button"
            className="m-0.5 flex h-[50px] w-[7vw] max-w-[80px] min-w-[50px] items-center justify-center bg-secondary text-white hover:bg-muted-foreground max-sm:h-[50px] max-sm:w-[13.5vw] max-sm:min-w-[40px] max-sm:text-sm"
            onClick={() => setGrid(!isGrid)}
          >
            {isGrid ? <Grid3x3 /> : <Columns2 />}
          </button>
        </div>
      </Streams>
      {!isGrid && !topBar && <TopBar localStream={localStream} />}
      {addPeers && <AddPeers onClose={() => setAddPeers(false)} />}
    </div>
  );
}

export default Meeting;
