import { useEffect, useRef } from 'react';
import { Video, Mic, VideoOff, MicOff } from 'lucide-react';
import { useGlobal } from 'reactn';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import logo from '../../../assets/logo.png';

function Join({ onJoin }) {
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
      localVideoRef.current.srcObject = stream;
    });

  useEffect(() => {
    if (isVideo) getVideo();
    if (isAudio) getAudio();
  }, []);

  const onChangeAudio = (checked) => {
    if (checked) getAudio();
    else audio.getTracks().forEach((track) => track.stop());
    setAudio(checked);
  };

  const onChangeVideo = (checked) => {
    if (checked) getVideo();
    else video.getTracks().forEach((track) => track.stop());
    setVideo(checked);
  };

  return (
    <div className="w-[360px] max-w-[calc(100%-80px)] border bg-card p-5">
      <img className="-mb-8 h-[50px] object-contain" src={logo} alt="Logo" />
      <p className="mb-0 text-lg font-bold uppercase">Join Meeting</p>
      {!isVideo && !isAudio && <p>Join as spectator.</p>}
      {isVideo && (
        <video
          className="my-3 h-[113px] w-[200px] scale-x-[-1] bg-black object-contain"
          ref={localVideoRef}
          onLoadedMetadata={() => localVideoRef.current.play()}
          playsInline
        />
      )}
      {isAudio && <p style={{ marginTop: isVideo ? 0 : 20 }}>Speak to test audio.</p>}
      <div className="flex items-center justify-center gap-6 px-4">
        <div className="flex items-center gap-2">
          {isAudio ? <Mic className="h-[18px] w-[18px]" /> : <MicOff className="h-[18px] w-[18px]" />}
          <Switch checked={isAudio} onCheckedChange={onChangeAudio} />
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={isVideo} onCheckedChange={onChangeVideo} />
          {isVideo ? <Video className="h-[18px] w-[18px]" /> : <VideoOff className="h-[18px] w-[18px]" />}
        </div>
      </div>
      <Button className="mt-5 w-full" onClick={onJoin}>
        Join
      </Button>
    </div>
  );
}

export default Join;
