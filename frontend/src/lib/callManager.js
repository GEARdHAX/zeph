import * as mediasoup from 'mediasoup-client';
import { getGlobal, setGlobal } from 'reactn';
import store from '../store';
import Actions from '../constants/Actions';
import postClose from '../actions/postClose';

// Owns the mediasoup call session (Device, transports, producers) as
// module-level state instead of component-local state — this is what makes
// a call survive navigating to a different route. Before this, everything
// lived inside <Meeting/>'s own useState/module-let bindings, so leaving
// /meeting/:id either silently kept the camera/mic/screen-share broadcasting
// forever (unmount cleanup never ran while callStatus === 'in-call') or, on
// returning via "Go back to the meeting", left a freshly-remounted
// component's `device` state null while the send transport/producers were
// still the old live objects — any code needing `device` (consuming a new
// remote producer that arrived while away) crashed with a silent
// TypeError. Session objects living here instead of in <Meeting/> means
// remounting the route is purely a UI reattachment, not a new session.
let device = null;
let sendTransport = null;
let audioProducer = null;
let videoProducer = null;
let screenProducer = null;
let roomID = null;
let unsubscribeFromProducers = null;
let unsubscribeFromClosingState = null;

const getIO = () => store.getState().io.io;

const consume = async (recvTransport, producer) => {
  const io = getIO();
  const { rtpCapabilities } = device;
  const data = await io.request('consume', {
    rtpCapabilities,
    socketID: producer.socketID,
    roomID,
    producerID: producer.producerID,
  });
  const {
    producerId, id, kind, rtpParameters,
  } = data;

  const consumer = await recvTransport.consume({
    id, producerId, kind, rtpParameters, codecOptions: {},
  });

  const stream = new MediaStream();
  stream.addTrack(consumer.track);
  stream.isVideo = kind === 'video';
  return stream;
};

// Runs whenever Redux rtc.producers changes, regardless of whether <Meeting/>
// is currently mounted — this is what lets a new remote producer (someone
// else's camera/screen-share turning on) get consumed while the local user
// is browsing a different chat, using the always-current module-level
// `device` rather than a component's stale/null useState.
const onProducersChanged = async () => {
  if (!device || !window.transport) return;
  const { producers } = store.getState().rtc;
  if (!window.consumers) window.consumers = [];
  const newStreams = [];
  for (const producer of producers) {
    if (!window.consumers.includes(producer.producerID) && producer.roomID === roomID) {
      window.consumers.push(producer.producerID);
      const io = getIO();
      const stream = await consume(window.transport, producer);
      stream.producerID = producer.producerID;
      stream.socketID = producer.socketID;
      stream.userID = producer.userID;
      newStreams.push(stream);
      io.request('resume', { producerID: producer.producerID, meetingID: roomID });
    }
  }
  if (newStreams.length) {
    setGlobal({ streams: [...getGlobal().streams, ...newStreams] });
  }
};

const subscribe = async (deviceInstance, socketID) => {
  const io = getIO();
  const data = await io.request('createConsumerTransport', {
    forceTcp: false,
    roomID,
    socketID,
  });
  if (data.error) {
    console.error(data.error);
    return;
  }

  const recvTransport = deviceInstance.createRecvTransport(data);
  recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
    io.request('connectConsumerTransport', {
      transportId: recvTransport.id,
      dtlsParameters,
      socketID,
    }).then(callback).catch(errback);
  });

  recvTransport.on('connectionstatechange', async (state) => {
    if (state === 'connected') {
      const { producers } = store.getState().rtc;
      for (const producer of producers) {
        await io.request('resume', { producerID: producer.producerID });
      }
    } else if (state === 'failed') {
      recvTransport.close();
    }
  });

  window.transport = recvTransport;
};

const join = async (targetRoomID) => {
  const io = getIO();
  roomID = targetRoomID;

  await setGlobal({ callStatus: 'in-call' });

  window.consumers = [];
  await setGlobal({ streams: [] });

  store.dispatch({ type: Actions.RTC_ROOM_ID, roomID });

  const { producers, consumers, peers } = await io.request('join', { roomID });
  store.dispatch({ type: Actions.RTC_CONSUMERS, consumers, peers });

  const routerRtpCapabilities = await io.request('getRouterRtpCapabilities');
  device = new mediasoup.Device();
  await device.load({ routerRtpCapabilities });

  await subscribe(device);

  // Register both store subscriptions BEFORE dispatching RTC_PRODUCERS —
  // store.subscribe() only fires on subsequent changes after registration,
  // unlike a component's useEffect([producers]) which always runs at least
  // once on mount regardless of ordering. Dispatching first meant the
  // initial batch of producers already in the room at join time (i.e. the
  // other participant's already-active camera/mic) was recorded in Redux
  // but never actually consumed — this callManager module has been
  // running strictly reactively since, seeing only producers that changed
  // AFTER it started listening. Registering the subscriptions first, then
  // dispatching, ensures this dispatch itself is what onProducersChanged
  // reacts to.
  if (!unsubscribeFromProducers) {
    let previousProducers = store.getState().rtc.producers;
    unsubscribeFromProducers = store.subscribe(() => {
      const current = store.getState().rtc.producers;
      if (current !== previousProducers) {
        previousProducers = current;
        onProducersChanged();
      }
    });
  }

  if (!unsubscribeFromClosingState) {
    let previousClosingState = store.getState().rtc.closingState;
    unsubscribeFromClosingState = store.subscribe(() => {
      const current = store.getState().rtc.closingState;
      if (current && current !== previousClosingState && roomID) {
        leave();
      }
      previousClosingState = current;
    });
  }

  store.dispatch({ type: Actions.RTC_PRODUCERS, producers: producers || [] });

  const data = await io.request('createProducerTransport', {
    forceTcp: false,
    rtpCapabilities: device.rtpCapabilities,
    roomID,
  });
  if (data.error) {
    console.error(data.error);
    return;
  }

  sendTransport = device.createSendTransport(data);
  sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
    io.request('connectProducerTransport', { dtlsParameters }).then(callback).catch(errback);
  });
  sendTransport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
    try {
      const { id } = await io.request('produce', {
        transportId: sendTransport.id,
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
  sendTransport.on('connectionstatechange', (state) => {
    if (state === 'failed') sendTransport.close();
  });

  await produceAudio();
  await produceVideo();
};

async function produceAudio(stream) {
  const useStream = stream || getGlobal().audioStream;
  await setGlobal({ audio: true });
  try {
    const track = useStream.getAudioTracks()[0];
    audioProducer = await sendTransport.produce({ track });
  } catch (err) {
    console.log('getusermedia produce failed', err);
    await setGlobal({ audio: false });
  }
}

async function produceVideo(stream) {
  const useStream = stream || getGlobal().videoStream;
  await setGlobal({ video: true });
  try {
    const track = useStream.getVideoTracks()[0];
    await setGlobal({ localStream: useStream });
    videoProducer = await sendTransport.produce({ track, appData: { isScreen: false } });
  } catch (err) {
    console.log('getusermedia produce failed', err);
    await setGlobal({ video: false });
  }
}

async function produceScreen(stream) {
  try {
    const track = stream.getVideoTracks()[0];
    await setGlobal({ localStream: stream });
    screenProducer = await sendTransport.produce({ track, appData: { isScreen: true } });
    await setGlobal({ screen: true });
  } catch (err) {
    console.log('getusermedia produce failed', err);
  }
}

async function stopAudio() {
  try {
    const io = getIO();
    await io.request('remove', { producerID: audioProducer.id, roomID });
    audioProducer.close();
    audioProducer = null;
    await setGlobal({ audio: false });
  } catch (e) {
    console.log(e);
  }
}

async function stopVideo() {
  try {
    const io = getIO();
    const { localStream } = getGlobal();
    if (localStream) localStream.getVideoTracks()[0].stop();
    await io.request('remove', { producerID: videoProducer.id, roomID });
    videoProducer.close();
    videoProducer = null;
    await setGlobal({ video: false });
  } catch (e) {
    console.log(e);
  }
}

async function stopScreen() {
  try {
    const io = getIO();
    const { localStream } = getGlobal();
    if (localStream) localStream.getVideoTracks()[0].stop();
    await io.request('remove', { producerID: screenProducer.id, roomID });
    screenProducer.close();
    screenProducer = null;
    await setGlobal({ screen: false });
  } catch (e) {
    console.log(e);
  }
}

// Explicit hang-up — the ONLY place the session is torn down. Navigating
// away from /meeting/:id no longer calls this implicitly; it must be a
// deliberate hang-up (the PhoneOff button in Meeting, or the PiP tile's own
// hang-up button — both call this same function directly, since the PiP
// tile can trigger a hang-up while <Meeting/> isn't even mounted) so the
// user's stated intent ("I'm done") is what ends the call, not an
// incidental route change. Fully self-contained: does everything the old
// component-local close() did (stop tracks, close transport, notify the
// server, reset every call-related global, tell the counterpart via
// postClose) so it works correctly regardless of which component (if any)
// invoked it.
async function leave() {
  const io = getIO();
  const { localStream } = getGlobal();
  const endingRoomID = roomID;
  const { counterpart } = store.getState().rtc;

  try {
    if (localStream) localStream.getVideoTracks()[0].stop();
  } catch (e) { /* no active video track */ }

  try {
    if (sendTransport) sendTransport.close();
  } catch (e) { /* already closed */ }

  try {
    if (io && endingRoomID) await io.request('leave', { roomID: endingRoomID });
  } catch (e) { /* best-effort notify */ }

  if (unsubscribeFromProducers) {
    unsubscribeFromProducers();
    unsubscribeFromProducers = null;
  }
  if (unsubscribeFromClosingState) {
    unsubscribeFromClosingState();
    unsubscribeFromClosingState = null;
  }

  device = null;
  sendTransport = null;
  audioProducer = null;
  videoProducer = null;
  screenProducer = null;
  roomID = null;
  window.transport = null;
  window.consumers = [];

  if (counterpart && endingRoomID) {
    postClose({ meetingID: endingRoomID, userID: counterpart._id }).catch(() => {});
  }

  await setGlobal({
    streams: [],
    joined: false,
    showPanel: true,
    over: false,
    callStatus: null,
    callDirection: null,
  });

  store.dispatch({ type: Actions.RTC_LEAVE });
}

const getDevice = () => device;

export default {
  join,
  produceAudio,
  produceVideo,
  produceScreen,
  stopAudio,
  stopVideo,
  stopScreen,
  leave,
  getDevice,
};
