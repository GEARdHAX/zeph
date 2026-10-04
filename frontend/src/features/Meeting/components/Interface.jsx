import { useEffect, useRef } from 'react';
import { Loader2, Monitor } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import Config from '../../../config';

// One participant tile (a person's camera / avatar, or a shared screen). Every tile carries a
// name tag so you always know who is who; the person tile also owns that person's <audio>.
function Interface({ audio, video, peer = {}, isMaximized, isScreen, label, compact = false, testId, loadingLabel = '' }) {
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
  const name = label || [peer?.firstName, peer?.lastName].filter(Boolean).join(' ') || 'Guest';

  return (
    <div
      data-testid={testId}
      className={cn(
        'relative flex h-full w-full items-center justify-center overflow-hidden border border-border/40 bg-card/60 shadow-sm backdrop-blur-xl',
        compact ? 'rounded-xl' : 'rounded-2xl sm:rounded-3xl',
      )}
    >
      {audio && (
        <audio ref={audioRef} onLoadedMetadata={() => audioRef.current.play()} className="hidden" controls={false} />
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
        <div className="relative flex items-center justify-center p-2">
          <div className={cn('absolute rounded-full bg-primary/20 blur-3xl', compact ? 'h-16 w-16' : 'h-36 w-36')} />
          <Avatar
            className={cn(
              'relative border-2 border-primary/30 bg-gradient-to-br from-rose-600 to-primary text-white shadow-xl',
              compact ? 'h-9 w-9' : 'h-20 w-20 sm:h-28 sm:w-28',
            )}
          >
            {peer?.picture && (
              <img
                src={`${Config.url || ''}/api/images/${peer.picture.shieldedID}/256`}
                alt=""
                className="aspect-square size-full object-cover"
              />
            )}
            <AvatarFallback
              className={cn('bg-transparent font-bold text-white', compact ? 'text-[10px]' : 'text-xl sm:text-3xl')}
            >
              {initials}
            </AvatarFallback>
          </Avatar>
        </div>
      )}

      {loadingLabel && (
        // Shown while the stream is announced but its media has not arrived yet.
        <div role="status" aria-live="polite" className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2">
          <div className="absolute inset-0 animate-pulse bg-muted/70 backdrop-blur-sm" />
          <Loader2 className={cn('relative animate-spin text-primary', compact ? 'h-4 w-4' : 'h-7 w-7')} aria-hidden />
          {!compact && <span className="relative px-3 text-center text-xs font-medium text-foreground sm:text-sm">{loadingLabel}</span>}
        </div>
      )}

      <div
        className={cn(
          'absolute flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-full bg-black/60 font-medium text-white backdrop-blur-md',
          compact ? 'bottom-1 left-1 px-1.5 py-0.5 text-[10px]' : 'bottom-2 left-2 px-2.5 py-1 text-xs sm:bottom-3 sm:left-3 sm:text-sm',
        )}
      >
        {isScreen && <Monitor className={cn('shrink-0', compact ? 'h-3 w-3' : 'h-3.5 w-3.5')} aria-hidden />}
        <span className="truncate">{name}</span>
      </div>
    </div>
  );
}

export default Interface;
