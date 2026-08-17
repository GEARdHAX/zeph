import { useEffect, useRef } from 'react';
import { Video, Mic, VideoOff, MicOff, X } from 'lucide-react';
import { useGlobal } from 'reactn';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';

function Join({ onJoin, onClose }) {
  const [isAudio, setAudio] = useGlobal('audio');
  const [isVideo, setVideo] = useGlobal('video');
  const [audio, setAudioStream] = useGlobal('audioStream');
  const [video, setVideoStream] = useGlobal('videoStream');
  const localVideoRef = useRef(null);

  const getAudio = () =>
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      setAudioStream(stream);
    });
  const getVideo = () =>
    navigator.mediaDevices.getUserMedia({ video: true }).then((stream) => {
      setVideoStream(stream);
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    });

  useEffect(() => {
    if (isVideo) getVideo();
    if (isAudio) getAudio();
  }, []);

  const onChangeAudio = (checked) => {
    if (checked) getAudio();
    else if (audio) audio.getTracks().forEach((track) => track.stop());
    setAudio(checked);
  };

  const onChangeVideo = (checked) => {
    if (checked) getVideo();
    else if (video) video.getTracks().forEach((track) => track.stop());
    setVideo(checked);
  };

  const handleClose = () => {
    if (audio) {
      try {
        audio.getTracks().forEach((track) => track.stop());
      } catch (e) {}
    }
    if (video) {
      try {
        video.getTracks().forEach((track) => track.stop());
      } catch (e) {}
    }
    if (onClose) onClose();
  };

  return (
    <div className="relative z-50 flex flex-col items-center justify-between overflow-hidden rounded-3xl border border-border/50 bg-card/85 p-8 shadow-2xl backdrop-blur-2xl transition-all duration-300 w-[360px] max-w-[90vw]">
      {/* Background Glow */}
      <div className="absolute -top-16 -left-16 h-40 w-40 rounded-full bg-primary/20 blur-3xl" />
      <div className="absolute -bottom-16 -right-16 h-40 w-40 rounded-full bg-primary/20 blur-3xl" />

      {/* Close / Back button */}
      {onClose && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="absolute top-4 right-4 h-8 w-8 rounded-full text-muted-foreground hover:text-foreground cursor-pointer z-10"
          onClick={handleClose}
          title="Back to Chats"
        >
          <X className="h-4 w-4" />
        </Button>
      )}

      {/* Title */}
      <div className="relative flex flex-col items-center text-center">
        <h2 className="text-xl font-bold tracking-tight text-foreground">Join Meeting</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {!isVideo && !isAudio ? 'Join as spectator' : 'Configure camera & microphone'}
        </p>
      </div>

      {/* Video Preview or Avatar placeholder */}
      <div className="relative my-6 flex h-[160px] w-[240px] items-center justify-center overflow-hidden rounded-2xl border border-border/60 bg-muted shadow-inner">
        {isVideo ? (
          <video
            className="h-full w-full scale-x-[-1] object-cover"
            ref={localVideoRef}
            onLoadedMetadata={() => localVideoRef.current?.play()}
            playsInline
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <VideoOff className="h-8 w-8" />
            <span className="text-xs">Camera is turned off</span>
          </div>
        )}
      </div>

      {/* Audio / Video Toggles */}
      <div className="relative flex w-full items-center justify-around rounded-xl bg-muted/60 p-3 mb-6 border border-border/40">
        <div className="flex items-center gap-2.5">
          {isAudio ? <Mic className="h-4 w-4 text-primary" /> : <MicOff className="h-4 w-4 text-muted-foreground" />}
          <span className="text-xs font-medium text-foreground">Mic</span>
          <Switch checked={isAudio} onCheckedChange={onChangeAudio} />
        </div>

        <div className="h-4 w-px bg-border" />

        <div className="flex items-center gap-2.5">
          {isVideo ? <Video className="h-4 w-4 text-primary" /> : <VideoOff className="h-4 w-4 text-muted-foreground" />}
          <span className="text-xs font-medium text-foreground">Cam</span>
          <Switch checked={isVideo} onCheckedChange={onChangeVideo} />
        </div>
      </div>

      {/* Action Buttons */}
      <div className="relative flex w-full gap-3">
        {onClose && (
          <Button
            type="button"
            variant="outline"
            className="flex-1 rounded-xl py-2.5 font-semibold cursor-pointer"
            onClick={handleClose}
          >
            Cancel
          </Button>
        )}
        <Button
          type="button"
          className="flex-1 rounded-xl py-2.5 font-semibold shadow-md active:scale-98 transition-transform cursor-pointer"
          onClick={onJoin}
        >
          Join Call
        </Button>
      </div>
    </div>
  );
}

export default Join;
