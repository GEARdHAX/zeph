import { useEffect, useRef } from 'react';
import Picture from '../../../components/Picture';

function Interface({ audio, video, peer, isMaximized, isScreen }) {
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
    <div className="flex h-full flex-col items-center justify-center">
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
          className="absolute left-0 top-0 z-0 h-full w-full bg-black"
          playsInline
          controls={false}
          data-user={peer}
          style={{ objectFit: !isMaximized || isScreen ? 'contain' : 'cover' }}
        />
      )}
      {!video && (
        <div className="flex h-full w-full flex-1 flex-col items-center justify-center bg-muted max-sm:text-sm">
          <div className="flex h-[30px] items-end py-1 text-lg font-bold text-muted-foreground max-sm:text-sm">
            {`${peer.firstName} ${peer.lastName}`}
          </div>
          <div className="h-[120px] w-[120px] max-sm:h-[75px] max-sm:w-[75px] [&_.img]:flex [&_.img]:h-[120px] [&_.img]:w-[120px] [&_.img]:items-center [&_.img]:justify-center [&_.img]:rounded-full [&_.img]:bg-muted-foreground [&_.img]:text-5xl [&_.img]:text-background max-sm:[&_.img]:h-[75px] max-sm:[&_.img]:w-[75px] max-sm:[&_.img]:text-3xl [&_img]:h-[120px] [&_img]:w-[120px] [&_img]:rounded-full max-sm:[&_img]:h-[75px] max-sm:[&_img]:w-[75px]">
            <Picture user={peer} />
          </div>
          <div className="flex h-[30px] items-start py-1 text-lg font-bold text-muted-foreground max-sm:text-sm">
            {!video && !audio ? 'Spectator' : 'Audio Only'}
          </div>
        </div>
      )}
    </div>
  );
}

export default Interface;
