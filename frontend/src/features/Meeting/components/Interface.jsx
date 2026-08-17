import { useEffect, useRef } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import Config from '../../../config';

function Interface({
  audio, video, peer = {}, isMaximized, isScreen,
}) {
  const audioRef = useRef(null);
  const videoRef = useRef(null);

  useEffect(() => {
    if (!audio) return;
    audioRef.current.srcObject = audio;
  }, [audio]);

  useEffect(() => {
    if (!video) return;
    videoRef.current.srcObject = video;
  }, [video]);

  const initials = `${(peer?.firstName || 'U').charAt(0)}${(peer?.lastName || '').charAt(0)}`.toUpperCase();

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-3xl border border-border/40 bg-card/60 backdrop-blur-xl">
      {audio && (
        <audio
          ref={audioRef}
          onLoadedMetadata={() => audioRef.current.play()}
          className="hidden"
          controls={false}
        />
      )}

      {video ? (
        <video
          ref={videoRef}
          onLoadedMetadata={() => videoRef.current.play()}
          className="absolute inset-0 h-full w-full bg-black"
          playsInline
          controls={false}
          style={{ objectFit: !isMaximized || isScreen ? 'contain' : 'cover' }}
        />
      ) : (
        <div className="relative flex flex-col items-center justify-center gap-4 p-4 text-center">
          <div className="absolute h-36 w-36 rounded-full bg-primary/20 blur-3xl" />
          <Avatar className="relative h-24 w-24 border-2 border-primary/30 bg-gradient-to-br from-rose-600 to-primary text-white shadow-xl sm:h-28 sm:w-28">
            {peer?.picture && (
              <img
                src={`${Config.url || ''}/api/images/${peer.picture.shieldedID}/256`}
                alt=""
                className="aspect-square size-full object-cover"
              />
            )}
            <AvatarFallback className="bg-transparent text-2xl font-bold text-white sm:text-3xl">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="relative flex flex-col items-center gap-1">
            <span className="text-sm font-bold text-foreground sm:text-base">
              {peer?.firstName ? `${peer.firstName} ${peer.lastName || ''}` : 'Participant'}
            </span>
            <span className="text-xs text-muted-foreground">
              {audio ? 'Audio only' : 'Spectator'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export default Interface;
