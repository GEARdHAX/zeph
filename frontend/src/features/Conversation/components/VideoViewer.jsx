import { useState, useRef } from 'react';
import { Loader2, VideoOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const PLAYBACK_RATES = [0.5, 1, 1.5, 2];

// Native <video> only — controls, seek, volume, fullscreen all come free
// from the browser's own control bar. preload="metadata" so opening the
// viewer never pulls the entire file just to show a frame. `poster` is the
// media's thumbnailKey URL when one exists (client-captured video frame,
// see VideoEditorModal) — shown before the user presses play.
function VideoViewer({ src, poster }) {
  const videoRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [rate, setRate] = useState(1);

  const setPlaybackRate = (value) => {
    setRate(value);
    if (videoRef.current) videoRef.current.playbackRate = value;
  };

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 text-white/70">
        <VideoOff className="h-10 w-10" />
        <span className="text-sm">This video could not be played.</span>
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center gap-3">
      {!ready && <Loader2 className="absolute h-8 w-8 animate-spin text-white/60" />}
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        controls
        preload="metadata"
        onLoadedMetadata={() => setReady(true)}
        onError={() => setError(true)}
        className="max-h-[calc(100%-3rem)] max-w-full rounded-lg"
      >
        <track kind="captions" />
      </video>

      {ready && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-white/60">Speed</span>
          {PLAYBACK_RATES.map((value) => (
            <Button
              key={value}
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setPlaybackRate(value)}
              className={cn(
                'h-7 rounded-full px-2.5 text-xs text-white/70 hover:bg-white/10 hover:text-white',
                rate === value && 'bg-white/15 text-white',
              )}
            >
              {value}
              x
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export default VideoViewer;
