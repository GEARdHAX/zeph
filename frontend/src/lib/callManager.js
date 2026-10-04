import * as mediasoup from 'mediasoup-client';
import { getGlobal, setGlobal } from 'reactn';
import { toast } from 'react-toastify';
import store from '../store';
import Actions from '../constants/Actions';
import postClose from '../actions/postClose';
import uploadMedia from '../actions/uploadMedia';
import uploadMeetingRecording from '../actions/uploadMeetingRecording';
import summarizeMeeting from '../actions/summarizeMeeting';
import getMeetingSummary from '../actions/getMeetingSummary';
import { getAiErrorMessage } from './aiErrorMessage';
import * as cloudflareCall from './cloudflareCall';

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
let rejoinInFlight = false;
// Which engine carries the current call ('mediasoup' | 'cloudflare'). The SERVER
// decides (call:config) so one frontend build works with either backend.
let backend = null;
let lastCallConfig = null;

const getIO = () => store.getState().io.io;

const CALL_ERROR_MESSAGES = {
  room_full: 'This call is full. Group calls are limited to a few people.',
  calls_not_configured: "Calling isn't set up on this server yet.",
  monthly_limit_reached: 'Calling is paused for now because the monthly usage limit was reached.',
  unauthorized: "You can't join this call.",
};

// Ends a call that failed to start. Known server refusals get a friendly toast
// and resolve quietly; anything else rethrows so the caller's generic handler
// shows its message. serverKnowsRoom=false skips the server-side leave/summary
// work for a join the server never accepted.
async function failCall(err, serverKnowsRoom) {
  const message = CALL_ERROR_MESSAGES[err && err.message];
  await leave({ serverKnowsRoom });
  if (message) {
    toast.error(message);
    return;
  }
  throw err;
}

// STRICT camera/mic release: stop every getUserMedia()/getDisplayMedia()
// track this tab could be holding — the join-screen preview streams
// (audioStream/videoStream), whatever is live (localStream/screenStream)
// — and null the globals so nothing re-references a stopped track. The
// browser's camera/mic "in use" indicator only clears once the LAST live
// track from a device is stopped, so this must be exhaustive. Safe to call
// from any teardown or failure path, any number of times.
async function releaseAllMedia() {
  const g = getGlobal();
  const seen = new Set();
  [g.localStream, g.audioStream, g.videoStream, g.screenStream].forEach((stream) => {
    if (!stream || seen.has(stream)) return;
    seen.add(stream);
    try {
      stream.getTracks().forEach((track) => track.stop());
    } catch (e) {
      /* already stopped */
    }
  });
  await setGlobal({
    localStream: null,
    audioStream: null,
    videoStream: null,
    screenStream: null,
    audio: false,
    video: false,
    screen: false,
  });
}

const consume = async (recvTransport, producer) => {
  const io = getIO();
  const { rtpCapabilities } = device;
  const data = await io.request('consume', {
    rtpCapabilities,
    socketID: producer.socketID,
    roomID,
    producerID: producer.producerID,
  });
  const { producerId, id, kind, rtpParameters } = data;

  const consumer = await recvTransport.consume({
    id,
    producerId,
    kind,
    rtpParameters,
    codecOptions: {},
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
  if (backend === 'cloudflare') {
    cloudflareCall.onProducersChanged();
    return;
  }
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
    })
      .then(callback)
      .catch(errback);
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

// Both store subscriptions must exist BEFORE RTC_PRODUCERS is dispatched at join:
// store.subscribe() only fires on later changes, so dispatching first would record
// the producers already in the room without ever acting on them. Idempotent.
function registerSubscriptions() {
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
}

// Cloudflare path of join(): the server already admitted this socket and picked
// the engine; open the Cloudflare session, then publish whatever we have.
async function joinCloudflare(config, producers) {
  lastCallConfig = config;
  registerSubscriptions();
  try {
    await cloudflareCall.start({ roomID, config, onFailed: reconnectCloudflareMedia });
    store.dispatch({ type: Actions.RTC_PRODUCERS, producers: producers || [] });
    // Only what the join screen actually captured (the toggles may both be off).
    if (getGlobal().audioStream) await produceAudio();
    if (getGlobal().videoStream) await produceVideo();
  } catch (err) {
    await failCall(err, true);
  }
}

// The socket reconnected mid-call (new socket id): the server dropped our meeting
// membership, so re-join it and rebuild the media connection from scratch.
async function rejoinCloudflare() {
  rejoinInFlight = true;
  let rejoinFailed = false;
  const targetRoomID = roomID;
  try {
    store.dispatch({ type: Actions.RTC_RECONNECTING, reconnecting: true });
    await setGlobal({ streams: [] });
    cloudflareCall.close();
    const io = getIO();
    const { producers } = await io.request('join', { roomID: targetRoomID });
    const config = await io.request('call:config', {});
    lastCallConfig = config;
    await cloudflareCall.start({ roomID: targetRoomID, config, onFailed: reconnectCloudflareMedia });
    store.dispatch({ type: Actions.RTC_PRODUCERS, producers: producers || [], replace: true });
    // Local tracks survive a network drop; just publish them on the new session.
    const { audioStream, videoStream } = getGlobal();
    if (audioStream) await produceAudio(audioStream);
    if (videoStream) await produceVideo(videoStream);
  } catch (err) {
    console.log('rejoin failed', err);
    rejoinFailed = true;
  } finally {
    rejoinInFlight = false;
    store.dispatch({ type: Actions.RTC_RECONNECTING, reconnecting: false });
  }
  if (rejoinFailed) await leave();
}

// Only the media connection died (ICE failed) while the socket is fine: no
// re-join needed, just a fresh Cloudflare session. The server drops our old
// tracks from the room; remote producers in Redux are still valid and re-pulled.
async function reconnectCloudflareMedia() {
  if (rejoinInFlight || !roomID || backend !== 'cloudflare') return;
  rejoinInFlight = true;
  let failed = false;
  try {
    store.dispatch({ type: Actions.RTC_RECONNECTING, reconnecting: true });
    await setGlobal({ streams: [] });
    await cloudflareCall.start({ roomID, config: lastCallConfig, renew: true, onFailed: reconnectCloudflareMedia });
    cloudflareCall.onProducersChanged();
    const { audioStream, videoStream } = getGlobal();
    if (audioStream) await produceAudio(audioStream);
    if (videoStream) await produceVideo(videoStream);
  } catch (err) {
    console.log('media reconnect failed', err);
    failed = true;
  } finally {
    rejoinInFlight = false;
    store.dispatch({ type: Actions.RTC_RECONNECTING, reconnecting: false });
  }
  if (failed) await leave();
}

const join = async (targetRoomID) => {
  const io = getIO();
  roomID = targetRoomID;

  await setGlobal({ callStatus: 'in-call' });

  window.consumers = [];
  await setGlobal({ streams: [] });

  store.dispatch({ type: Actions.RTC_ROOM_ID, roomID });

  let joinRes;
  try {
    joinRes = await io.request('join', { roomID });
  } catch (err) {
    await failCall(err, false);
    return;
  }
  const { producers, consumers, peers } = joinRes;
  store.dispatch({ type: Actions.RTC_CONSUMERS, consumers, peers });

  let callConfig;
  try {
    callConfig = await io.request('call:config', {});
  } catch (err) {
    // A backend older than call:config never acks it: it can only be mediasoup.
    if (/^Timed out/.test(err.message)) callConfig = { backend: 'mediasoup' };
    else {
      await failCall(err, true);
      return;
    }
  }
  backend = callConfig.backend;
  if (backend === 'cloudflare') {
    await joinCloudflare(callConfig, producers);
    return;
  }

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
  registerSubscriptions();

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

// Rejoins the mediasoup session after a socket reconnect mid-call (see
// initIO.jsx's 'authenticated' handler with wasConnected true). The server
// tore down this socket's transports/producers entirely on disconnect
// (init.js's socket.on('disconnect', ...) — mediasoup sessions are
// inherently per-connection, there's nothing cheaper to "resume"), so this
// re-runs the same negotiation join() does. One thing it deliberately does
// NOT do, unlike join(): it never calls getUserMedia() again — the browser
// tab's camera/mic tracks are untouched by a network drop (only stopVideo/
// stopAudio/leave() stop them), so audioStream/videoStream in globals are
// still the same live tracks, just re-produced onto a new transport.
// `streams` (remote peers' video tiles) IS reset to [] here, same as
// join() — the old entries' producerIDs reference a transport the server
// already discarded, so leaving them up would show frozen/dead tiles
// instead of the honest brief gap the `reconnecting` banner already covers.
const rejoin = async () => {
  if (rejoinInFlight || !roomID) return;
  if (backend === 'cloudflare') {
    await rejoinCloudflare();
    return;
  }
  if (!device) return;
  rejoinInFlight = true;
  let rejoinFailed = false;
  const targetRoomID = roomID;

  try {
    store.dispatch({ type: Actions.RTC_RECONNECTING, reconnecting: true });
    window.consumers = [];
    await setGlobal({ streams: [] });

    // The old transport/producer objects reference a connection the server
    // already discarded — close what's closeable, then null everything so
    // onProducersChanged() (still subscribed) treats every remote producer
    // as new-to-consume once RTC_PRODUCERS redispatches below.
    try {
      sendTransport?.close();
    } catch (e) {
      /* already gone */
    }
    try {
      window.transport?.close();
    } catch (e) {
      /* already gone */
    }
    sendTransport = null;
    audioProducer = null;
    videoProducer = null;
    screenProducer = null;
    window.transport = null;

    const io = getIO();
    const { producers } = await io.request('join', { roomID: targetRoomID });

    await subscribe(device);
    store.dispatch({ type: Actions.RTC_PRODUCERS, producers: producers || [], replace: true });

    const data = await io.request('createProducerTransport', {
      forceTcp: false,
      rtpCapabilities: device.rtpCapabilities,
      roomID: targetRoomID,
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
          roomID: targetRoomID,
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

    // Re-produce onto the new transport using whatever local tracks were
    // already live — a track the user had already turned off (audio/video
    // false) correctly stays off, produceAudio/produceVideo's own
    // .getAudioTracks()[0]/.getVideoTracks()[0] on a null stream would throw,
    // so each is skipped unless its stream still exists.
    const { audioStream, videoStream } = getGlobal();
    if (audioStream) await produceAudio(audioStream);
    if (videoStream) await produceVideo(videoStream);
  } catch (err) {
    console.log('rejoin failed', err);
    // Reconnecting the mediasoup session failed and there is no retry above
    // it — the call is genuinely dead. End it properly (STRICT: leave() is
    // what releases the camera/mic; otherwise the tab holds the devices
    // with no call and no UI to hang up until a full page refresh).
    rejoinFailed = true;
  } finally {
    rejoinInFlight = false;
    store.dispatch({ type: Actions.RTC_RECONNECTING, reconnecting: false });
  }
  if (rejoinFailed) await leave();
};

async function produceAudio(stream) {
  const useStream = stream || getGlobal().audioStream;
  // Store the stream in the global BEFORE producing — otherwise a mic
  // toggled on mid-call (Meeting/index.jsx passes a fresh getUserMedia
  // stream here) is never tracked anywhere, so stopAudio()/leave()/
  // releaseAllMedia() can't stop it and the browser mic indicator stays
  // lit after hang-up.
  await setGlobal({ audio: true, audioStream: useStream });
  try {
    if (backend === 'cloudflare') {
      await cloudflareCall.produce('audio', useStream);
    } else {
      const track = useStream.getAudioTracks()[0];
      audioProducer = await sendTransport.produce({ track });
    }
  } catch (err) {
    console.log('getusermedia produce failed', err);
    await setGlobal({ audio: false });
  }
}

async function produceVideo(stream) {
  const useStream = stream || getGlobal().videoStream;
  await setGlobal({ video: true, videoStream: useStream, localStream: useStream });
  try {
    if (backend === 'cloudflare') {
      await cloudflareCall.produce('video', useStream);
    } else {
      const track = useStream.getVideoTracks()[0];
      videoProducer = await sendTransport.produce({ track, appData: { isScreen: false } });
    }
  } catch (err) {
    console.log('getusermedia produce failed', err);
    await setGlobal({ video: false });
  }
}

async function produceScreen(stream) {
  try {
    await setGlobal({ localStream: stream });
    if (backend === 'cloudflare') {
      await cloudflareCall.produce('screen', stream, { isScreen: true });
    } else {
      const track = stream.getVideoTracks()[0];
      screenProducer = await sendTransport.produce({ track, appData: { isScreen: true } });
    }
    await setGlobal({ screen: true });
  } catch (err) {
    console.log('getusermedia produce failed', err);
  }
}

// Runs a mic / camera / screen-share change while marking it as in flight, so the controls can show a
// spinner and a second click can't start a conflicting change before the first finished.
async function withPending(kind, fn) {
  const current = getGlobal().mediaPending || {};
  if (current[kind]) return undefined;
  await setGlobal({ mediaPending: { ...current, [kind]: true } });
  try {
    return await fn();
  } finally {
    await setGlobal({ mediaPending: { ...(getGlobal().mediaPending || {}), [kind]: false } });
  }
}

async function stopAudio() {
  try {
    const io = getIO();
    const { audioStream } = getGlobal();
    // Closing the mediasoup producer alone doesn't release the underlying
    // getUserMedia() track — the browser's mic indicator stays lit until
    // the track itself is stopped (same class of bug as leave(), see
    // there for the full explanation).
    if (audioStream) audioStream.getAudioTracks().forEach((track) => track.stop());
    if (backend === 'cloudflare') {
      await cloudflareCall.unpublish('audio');
    } else {
      await io.request('remove', { producerID: audioProducer.id, roomID });
      audioProducer.close();
      audioProducer = null;
    }
    await setGlobal({ audio: false, audioStream: null });
  } catch (e) {
    console.log(e);
    // The mic is already stopped locally: never leave the button stuck on.
    await setGlobal({ audio: false, audioStream: null });
  }
}

async function stopVideo() {
  try {
    const io = getIO();
    const { localStream, videoStream, screenStream, screen } = getGlobal();
    // localStream may currently be the screen share: only stop the camera's own tracks.
    if (videoStream) videoStream.getVideoTracks().forEach((track) => track.stop());
    if (localStream && localStream !== screenStream) localStream.getVideoTracks().forEach((track) => track.stop());
    if (backend === 'cloudflare') {
      await cloudflareCall.unpublish('video');
    } else {
      await io.request('remove', { producerID: videoProducer.id, roomID });
      videoProducer.close();
      videoProducer = null;
    }
    await setGlobal({ video: false, localStream: screen ? screenStream : null, videoStream: null });
  } catch (e) {
    console.log(e);
    const { screen: sharing, screenStream: shared } = getGlobal();
    await setGlobal({ video: false, localStream: sharing ? shared : null, videoStream: null });
  }
}

async function stopScreen() {
  try {
    const io = getIO();
    const { screenStream, videoStream, video } = getGlobal();
    if (screenStream) screenStream.getVideoTracks().forEach((track) => track.stop());
    if (backend === 'cloudflare') {
      await cloudflareCall.unpublish('screen');
    } else {
      await io.request('remove', { producerID: screenProducer.id, roomID });
      screenProducer.close();
      screenProducer = null;
    }
    // Hand the local preview back to the camera if it is still on.
    await setGlobal({ screen: false, localStream: video ? videoStream : null, screenStream: null });
  } catch (e) {
    console.log(e);
    const { video: cameraOn, videoStream: camera } = getGlobal();
    await setGlobal({ screen: false, localStream: cameraOn ? camera : null, screenStream: null });
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
async function leave({ serverKnowsRoom = true } = {}) {
  const io = getIO();
  const endingRoomID = roomID;
  const { counterpart } = store.getState().rtc;

  // STRICT: release every camera/mic track this tab holds (see
  // releaseAllMedia). Done first so the device indicator clears the instant
  // the user hangs up, before the slower server round-trip below.
  await releaseAllMedia();

  cloudflareCall.close();

  try {
    if (sendTransport) sendTransport.close();
  } catch (e) {
    /* already closed */
  }

  try {
    if (io && endingRoomID && serverKnowsRoom) await io.request('leave', { roomID: endingRoomID });
  } catch (e) {
    /* best-effort notify */
  }

  // A pending MeetingRecorder recording, if any, can only be summarized
  // once the ack above confirms the server has processed this leave (see
  // finalizeMeetingRecording's comment). Fire-and-forget — must not block
  // the rest of teardown/navigation on an upload+AI round trip.
  if (endingRoomID && serverKnowsRoom) finalizeMeetingRecording(endingRoomID).catch(() => {});

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
  backend = null;
  lastCallConfig = null;
  window.transport = null;
  window.consumers = [];

  if (counterpart && endingRoomID && serverKnowsRoom) {
    postClose({ meetingID: endingRoomID, userID: counterpart._id }).catch(() => {});
  }

  await setGlobal({
    streams: [],
    joined: false,
    showPanel: true,
    over: false,
    callStatus: null,
    callDirection: null,
    localStream: null,
    audioStream: null,
    videoStream: null,
    screenStream: null,
    mediaPending: { audio: false, video: false, screen: false },
  });

  store.dispatch({ type: Actions.RTC_LEAVE });
}

// Uploads + summarizes a recording captured by MeetingRecorder.jsx, ONLY
// once the meeting has genuinely ended — calling /summarize any earlier
// always 422s (MEETING_NOT_ENDED). leave() calls this after its own
// io.request('leave', ...) resolves, which the server only acks once
// leaveRoom() has run (backend/src/mediasoup/index.js) — so this is the
// earliest point endedAt is guaranteed to be set FOR THIS PARTICIPANT'S
// leave. In a group call where others remain, the meeting hasn't actually
// ended yet; the backend still correctly rejects with MEETING_NOT_ENDED in
// that case, which is expected and not shown as an error — the recording
// stays pending in the global for a later participant's hangup to retry
// (best-effort; not guaranteed if nobody else records/triggers it).
// Picks the filename extension the backend needs to see for each recorded
// mimeType. Ogg goes through the general upload pipeline (mediaPolicy.js
// recognizes '.ogg' as an unambiguous audio extension); a fallback
// WebM/MP4/AAC recording goes through upload-recording.js instead (see that
// file's comment for why), which only needs a real container extension.
const extensionForMimeType = (mimeType) => {
  if (!mimeType) return '.webm';
  if (mimeType.includes('ogg')) return '.ogg';
  if (mimeType.includes('mp4') || mimeType.includes('m4a') || mimeType.includes('aac')) return '.m4a';
  return '.webm';
};

const finalizeMeetingRecording = async (endedMeetingID) => {
  const { pendingMeetingRecording } = getGlobal();
  if (!pendingMeetingRecording || pendingMeetingRecording.meetingId !== endedMeetingID) return;

  const { blob, mimeType, isMeetingAudioFallback } = pendingMeetingRecording;
  const toastId = toast.loading('Generating your meeting summary…');
  try {
    const extension = extensionForMimeType(mimeType);
    const file = new File([blob], `meeting-${endedMeetingID}${extension}`, { type: mimeType || 'audio/webm' });
    const uploadRes = isMeetingAudioFallback
      ? await uploadMeetingRecording(endedMeetingID, file)
      : await uploadMedia(file);
    const mediaId = uploadRes.data.media._id;
    const res = await summarizeMeeting(endedMeetingID, mediaId);

    if (res.status === 202) {
      await pollMeetingSummary(endedMeetingID, toastId);
      return;
    }
    await setGlobal({ pendingMeetingRecording: null });
    // There's no post-call screen to send the user to (see the comment on
    // this function) — the summary text goes straight in the toast, or
    // it's effectively lost.
    toast.update(toastId, {
      render: `Meeting summary: ${res.data.summary}`,
      type: 'success',
      isLoading: false,
      autoClose: 10000,
    });
  } catch (err) {
    // MEETING_NOT_ENDED means other participants are still on the call —
    // not a real failure, leave the recording pending and say nothing.
    if (err?.response?.data?.reason === 'MEETING_NOT_ENDED') {
      toast.dismiss(toastId);
      return;
    }
    await setGlobal({ pendingMeetingRecording: null });
    toast.update(toastId, {
      render: getAiErrorMessage(err),
      type: 'error',
      isLoading: false,
      autoClose: 6000,
    });
  }
};

const MEETING_SUMMARY_POLL_MS = 4000;
const MEETING_SUMMARY_POLL_DEADLINE_MS = 3 * 60 * 1000;

async function pollMeetingSummary(meetingID, toastId, deadline = Date.now() + MEETING_SUMMARY_POLL_DEADLINE_MS) {
  try {
    const res = await getMeetingSummary(meetingID);
    const { status } = res.data;
    if (status === 'SUMMARIZED') {
      await setGlobal({ pendingMeetingRecording: null });
      toast.update(toastId, {
        render: `Meeting summary: ${res.data.summary}`,
        type: 'success',
        isLoading: false,
        autoClose: 10000,
      });
      return;
    }
    if (status === 'FAILED') {
      await setGlobal({ pendingMeetingRecording: null });
      toast.update(toastId, {
        render: 'Could not generate a summary for this meeting.',
        type: 'error',
        isLoading: false,
        autoClose: 6000,
      });
      return;
    }
    if (Date.now() > deadline) {
      await setGlobal({ pendingMeetingRecording: null });
      toast.update(toastId, {
        render: 'Meeting summary is taking longer than expected.',
        type: 'error',
        isLoading: false,
        autoClose: 6000,
      });
      return;
    }
    setTimeout(() => pollMeetingSummary(meetingID, toastId, deadline), MEETING_SUMMARY_POLL_MS);
  } catch (err) {
    await setGlobal({ pendingMeetingRecording: null });
    toast.update(toastId, { render: getAiErrorMessage(err), type: 'error', isLoading: false, autoClose: 6000 });
  }
}

const getDevice = () => device;

export default {
  join,
  rejoin,
  produceAudio,
  produceVideo,
  produceScreen,
  withPending,
  stopAudio,
  stopVideo,
  stopScreen,
  leave,
  releaseAllMedia,
  getDevice,
};
