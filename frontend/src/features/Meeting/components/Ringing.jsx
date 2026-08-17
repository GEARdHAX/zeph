import { useEffect, useState } from 'react';
import { Video, Phone, PhoneOff } from 'lucide-react';
import { useGlobal } from 'reactn';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import postClose from '../../../actions/postClose';
import postAnswer from '../../../actions/postAnswer';
import Config from '../../../config';
import ringSound from '../../../assets/ring.mp3';
import Actions from '../../../constants/Actions';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';

function Ringing({ incoming, meetingID }) {
  const counterpart = useSelector((state) => state.rtc.counterpart) || {};
  const [isAudio, setAudio] = useGlobal('audio');
  const [isVideo, setVideo] = useGlobal('video');
  const [audioStream, setAudioStream] = useGlobal('audioStream');
  const [videoStream, setVideoStream] = useGlobal('videoStream');
  const setAccepted = useGlobal('accepted')[1];
  const setCallStatus = useGlobal('callStatus')[1];
  const setCallDirection = useGlobal('callDirection')[1];
  const setShowPanel = useGlobal('showPanel')[1];
  const setOver = useGlobal('over')[1];
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
      errorToast('Failed to acquire video!');
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

  const close = async (shouldNotify) => {
    if (isVideo && videoStream) videoStream.getVideoTracks()[0]?.stop();
    if (isAudio && audioStream) audioStream.getAudioTracks()[0]?.stop();
    dispatch({ type: Actions.RTC_LEAVE });
    if (shouldNotify && counterpart?._id) postClose({ meetingID, userID: counterpart._id });
    await setCallStatus(null);
    await setCallDirection(null);
    await setShowPanel(true);
    await setOver(false);
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

  const firstName = counterpart.firstName || 'Anonymous';
  const lastName = counterpart.lastName || 'User';
  const fullName = `${firstName} ${lastName}`;
  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();

  const getSubtitle = () => {
    if (incoming) {
      if (callData.added) return 'Adding you to meeting...';
      return isVideo ? 'Incoming video call...' : 'Incoming audio call...';
    }
    return isVideo ? 'Calling video...' : 'Calling audio...';
  };

  return (
    <div className="relative z-50 flex flex-col items-center justify-between overflow-hidden rounded-3xl border border-border/50 bg-card/80 p-8 shadow-2xl backdrop-blur-2xl transition-all duration-300 w-[340px] max-w-[90vw]">
      {/* Glow background effect */}
      <div className="absolute -top-16 -left-16 h-40 w-40 rounded-full bg-primary/20 blur-3xl" />
      <div className="absolute -bottom-16 -right-16 h-40 w-40 rounded-full bg-primary/20 blur-3xl" />

      {/* Header Info */}
      <div className="relative flex flex-col items-center text-center">
        <h2 className="text-xl font-bold tracking-tight text-foreground">{fullName}</h2>
        <span className="mt-1 text-xs font-medium text-muted-foreground animate-pulse">
          {getSubtitle()}
        </span>
      </div>

      {/* Avatar with ripple animation */}
      <div className="relative my-8 flex items-center justify-center">
        <div className="absolute h-36 w-36 rounded-full bg-primary/20 animate-ping opacity-30" />
        <div className="absolute h-32 w-32 rounded-full border-2 border-primary/40 animate-pulse" />

        <Avatar className="h-28 w-28 border-4 border-card bg-gradient-to-br from-rose-600 to-primary text-white shadow-xl ring-4 ring-primary/20">
          {counterpart.picture && (
            <img
              src={`${Config.url || ''}/api/images/${counterpart.picture.shieldedID}/256`}
              alt={fullName}
              className="aspect-square size-full object-cover"
            />
          )}
          <AvatarFallback className="bg-transparent text-2xl font-bold text-white">
            {initials}
          </AvatarFallback>
        </Avatar>
      </div>

      {/* Action Buttons */}
      <div className="relative flex items-center justify-center gap-5 pt-2">
        {incoming ? (
          <>
            {/* Decline / Hang up */}
            <Button
              type="button"
              size="icon"
              variant="destructive"
              className="h-14 w-14 rounded-full bg-destructive text-destructive-foreground shadow-lg hover:scale-110 hover:bg-destructive/90 transition-transform active:scale-95 cursor-pointer"
              onClick={() => close(true)}
              title="Decline Call"
            >
              <PhoneOff className="h-6 w-6" />
            </Button>

            {/* Answer Audio */}
            <Button
              type="button"
              size="icon"
              className="h-14 w-14 rounded-full bg-emerald-600 text-white shadow-lg hover:scale-110 hover:bg-emerald-500 transition-transform active:scale-95 cursor-pointer"
              onClick={join}
              title="Answer Audio Call"
            >
              <Phone className="h-6 w-6" />
            </Button>

            {/* Answer Video */}
            <Button
              type="button"
              size="icon"
              className="h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:scale-110 hover:bg-primary/90 transition-transform active:scale-95 cursor-pointer"
              onClick={joinWithVideo}
              title="Answer Video Call"
            >
              <Video className="h-6 w-6" />
            </Button>
          </>
        ) : (
          /* Outgoing End Call */
          <Button
            type="button"
            size="icon"
            variant="destructive"
            className="h-14 w-14 rounded-full bg-destructive text-destructive-foreground shadow-lg hover:scale-110 hover:bg-destructive/90 transition-transform active:scale-95 cursor-pointer"
            onClick={() => close(true)}
            title="End Call"
          >
            <PhoneOff className="h-6 w-6" />
          </Button>
        )}
      </div>
    </div>
  );
}

export default Ringing;
