import { useEffect, useRef } from 'react';
import Picture from '../../../components/Picture';

function LittleInterface({ audio, video, peer, isMaximized }) {
  const audioRef = useRef(null);
  const videoRef = useRef(null);

  useEffect(() => {
    if (!audio) return;
    if (audio) audioRef.current.srcObject = audio;
  }, [audio]);

  useEffect(() => {
    if (!video) return;
    if (video) videoRef.current.srcObject = video;
  }, [video]);

  return (
    <div className="flex h-full flex-col items-center justify-center overflow-hidden">
      {audio && (
        <audio
          ref={audioRef}
          onLoadedMetadata={() => audioRef.current.play()}
          className="hidden"
          controls={false}
          hidden
          data-user={peer}
        />
      )}
      {video && (
        <video
          ref={videoRef}
          onLoadedMetadata={() => videoRef.current.play()}
          className="h-full w-full"
          playsInline
          controls={false}
          data-user={peer}
          style={{ objectFit: isMaximized ? 'cover' : 'contain' }}
        />
      )}
      {!video && (
        <div className="flex h-full w-full flex-1 flex-col items-center justify-center bg-muted">
          <div className="flex h-[16px] items-end py-px text-[11px] font-bold text-muted-foreground">
            {`${peer.firstName} ${peer.lastName}`}
          </div>
          <div className="h-10 w-10 min-w-10 [&_.img]:flex [&_.img]:h-10 [&_.img]:w-10 [&_.img]:items-center [&_.img]:justify-center [&_.img]:rounded-full [&_.img]:bg-muted-foreground [&_.img]:text-base [&_.img]:text-background [&_img]:h-10 [&_img]:w-10 [&_img]:rounded-full">
            <Picture user={peer} />
          </div>
          <div className="flex h-[16px] items-start py-px text-[11px] font-bold text-muted-foreground">
            {!video && !audio ? 'Spectator' : 'Audio Only'}
          </div>
        </div>
      )}
    </div>
  );
}

export default LittleInterface;
