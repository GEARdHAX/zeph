import { useEffect, useRef } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import Config from '../../../config';

function LittleInterface({
  audio, video, peer = {}, isMaximized,
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
    <div className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden rounded-xl border border-border/50 bg-card shadow-md">
      {audio && (
        <audio
          ref={audioRef}
          onLoadedMetadata={() => audioRef.current.play()}
          className="hidden"
          controls={false}
          hidden
        />
      )}
      {video ? (
        <video
          ref={videoRef}
          onLoadedMetadata={() => videoRef.current.play()}
          className="h-full w-full"
          playsInline
          controls={false}
          style={{ objectFit: isMaximized ? 'cover' : 'contain' }}
        />
      ) : (
        <div className="flex h-full w-full flex-1 flex-col items-center justify-center gap-1 bg-muted/60 p-1">
          <Avatar className="h-9 w-9 border border-border bg-gradient-to-br from-rose-600 to-primary text-white">
            {peer?.picture && (
              <img
                src={`${Config.url || ''}/api/images/${peer.picture.shieldedID}/256`}
                alt=""
                className="aspect-square size-full object-cover"
              />
            )}
            <AvatarFallback className="bg-transparent text-[10px] font-bold text-white">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="max-w-full truncate text-[10px] font-semibold text-foreground">
            {peer?.firstName || 'Guest'}
          </span>
        </div>
      )}
    </div>
  );
}

export default LittleInterface;
