import { useEffect, useState } from 'react';
import { Video, Phone, PhoneOff } from 'lucide-react';
import { useGlobal } from 'reactn';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import logo from '../../../assets/logo.png';
import postClose from '../../../actions/postClose';
import postAnswer from '../../../actions/postAnswer';
import Config from '../../../config';
import ringSound from '../../../assets/ring.mp3';
import Actions from '../../../constants/Actions';

function Ringing({ incoming, meetingID }) {
  const counterpart = useSelector((state) => state.rtc.counterpart) || {};
  const [isAudio, setAudio] = useGlobal('audio');
  const [isVideo, setVideo] = useGlobal('video');
  const [audioStream, setAudioStream] = useGlobal('audioStream');
  const [videoStream, setVideoStream] = useGlobal('videoStream');
  const setAccepted = useGlobal('accepted')[1];
  const callData = useSelector((state) => state.rtc.callData) || {};
  const [acquireError, setAcquireError] = useState(false);
  const closingState = useSelector((state) => state.rtc.closingState);
  const closed = useSelector((state) => state.rtc.closed);

  const navigate = useNavigate();
  const dispatch = useDispatch();

  const errorToast = (content) => toast.error(content);

  const getAudio = async () => {
    setAcquireError(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await setAudioStream(stream);
    } catch (e) {
      setAcquireError(true);
      errorToast('Failed to acquire audio!');
    }
  };
  const getVideo = async () => {
    setAcquireError(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      await setVideoStream(stream);
    } catch (e) {
      setAcquireError(true);
      errorToast('Failed to acquire audio!');
    }
  };

  useEffect(() => {
    if (isAudio) getAudio();
    if (isVideo) getVideo();

    const audio = document.createElement('audio');
    audio.style.display = 'none';
    audio.src = ringSound;
    audio.autoplay = true;
    audio.loop = true;

    return () => {
      if (audio) {
        audio.pause();
        audio.remove();
      }
    };
  }, []);

  const close = (shouldNotify) => {
    if (isVideo && videoStream) videoStream.getVideoTracks()[0].stop();
    if (isAudio && audioStream) audioStream.getAudioTracks()[0].stop();
    dispatch({ type: Actions.RTC_LEAVE });
    if (shouldNotify) postClose({ meetingID, userID: counterpart._id });
    navigate('/', { replace: true });
  };

  useEffect(() => {
    if (closingState && !closed) close(true);
  }, [closingState, closed]);

  const join = async () => {
    await setAudio(true);
    await setVideo(false);
    await getAudio();
    if (acquireError) return;
    setAccepted(true);
    postAnswer({ userID: callData.caller, meetingID });
  };

  const joinWithVideo = async () => {
    await setAudio(true);
    await setVideo(true);
    await getVideo();
    if (acquireError) return;
    await getAudio();
    if (acquireError) return;
    setAccepted(true);
    postAnswer({ userID: callData.caller, meetingID });
  };

  function Picture() {
    if (!counterpart.firstName) counterpart.firstName = 'Anonymous';
    if (!counterpart.lastName) counterpart.lastName = 'User';
    if (counterpart.picture) {
      return (
        <img
          src={`${Config.url || ''}/api/images/${counterpart.picture.shieldedID}/256`}
          alt="Picture"
          className="h-full w-full rounded-full object-cover"
        />
      );
    }
    return (
      <div className="flex h-full w-full items-center justify-center rounded-full bg-muted-foreground text-5xl text-background">
        {counterpart.firstName.substr(0, 1)}
        {counterpart.lastName.substr(0, 1)}
      </div>
    );
  }

  const getTitle = () => {
    if (incoming) {
      if (callData.added) return 'Adding you to a meeting';
      return 'Incoming Call';
    }

    return 'Outgoing Call';
  };

  return (
    <div className="flex w-[360px] max-w-[calc(100%-80px)] flex-col items-center border bg-card p-5">
      <img className="-mb-8 h-[50px] object-contain" src={logo} alt="Logo" />
      <p className="mb-0 text-lg font-bold uppercase">{getTitle()}</p>
      <p className="mb-0 mt-2 text-sm font-bold uppercase">
        {`${counterpart.firstName || 'Anonymous'} ${counterpart.lastName || 'User'}`}
      </p>
      <div className="my-3 h-[150px] w-[150px] animate-ring-pulse rounded-full">
        <Picture />
      </div>
      {incoming && (
        <div className="flex">
          <button
            type="button"
            className="m-2 flex h-[60px] w-[60px] items-center justify-center rounded-full bg-primary/30 text-primary-foreground hover:opacity-90"
            onClick={() => close()}
          >
            <PhoneOff className="h-6 w-6" />
          </button>
          <button
            type="button"
            className="m-2 flex h-[60px] w-[60px] items-center justify-center rounded-full bg-primary text-primary-foreground hover:opacity-90"
            onClick={join}
          >
            <Phone className="h-6 w-6" />
          </button>
          <button
            type="button"
            className="m-2 flex h-[60px] w-[60px] items-center justify-center rounded-full bg-primary text-primary-foreground hover:opacity-90"
            onClick={joinWithVideo}
          >
            <Video className="h-6 w-6" />
          </button>
        </div>
      )}
      {!incoming && (
        <div className="flex">
          <button
            type="button"
            className="m-2 flex h-[60px] w-[60px] items-center justify-center rounded-full bg-primary/30 text-primary-foreground hover:opacity-90"
            onClick={() => close()}
          >
            <PhoneOff className="h-6 w-6" />
          </button>
        </div>
      )}
    </div>
  );
}

export default Ringing;
