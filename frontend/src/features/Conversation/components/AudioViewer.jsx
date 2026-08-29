import {
  useState, useRef, useEffect, useCallback,
} from 'react';
import {
  Play, Pause, Volume2, VolumeX, AudioLines,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

const PLAYBACK_RATES = [0.5, 1, 1.5, 2];

const formatTime = (seconds) => {
  if (!Number.isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
};

// Native <audio> element driven entirely by refs — no state library needed,
// this custom UI IS the "minimal zeph audio player" the brief asks for.
// preload="metadata" so opening the viewer only fetches duration, not the
// full file, matching the low-bandwidth-first priority in CLAUDE.md.
function AudioViewer({ src }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [rate, setRate] = useState(1);
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onEnded = () => setPlaying(false);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) audio.pause();
    else audio.play().catch(() => setError(true));
    setPlaying(!playing);
  }, [playing]);

  const seek = ([value]) => {
    if (audioRef.current) audioRef.current.currentTime = value;
    setCurrentTime(value);
  };

  const changeVolume = ([value]) => {
    setVolume(value);
    if (audioRef.current) audioRef.current.volume = value;
  };

  const setPlaybackRate = (value) => {
    setRate(value);
    if (audioRef.current) audioRef.current.playbackRate = value;
  };

  if (error) {
    return <span className="text-sm text-white/70">This audio could not be played.</span>;
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-white/10 bg-white/5 p-6">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => {
          setDuration(e.target.duration);
          setReady(true);
        }}
        onError={() => setError(true)}
      />

      <div className="flex items-center justify-center">
        <AudioLines className={cn('h-10 w-10 text-primary', playing && 'animate-pulse')} />
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={!ready}
          onClick={togglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
          className="h-9 w-9 shrink-0 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>

        <span className="w-9 shrink-0 text-right text-xs tabular-nums text-white/60">
          {formatTime(currentTime)}
        </span>
        <Slider
          value={[currentTime]}
          min={0}
          max={duration || 0}
          step={0.1}
          disabled={!ready}
          onValueChange={seek}
          className="flex-1"
        />
        <span className="w-9 shrink-0 text-xs tabular-nums text-white/60">
          {formatTime(duration)}
        </span>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          {volume === 0 ? (
            <VolumeX className="h-3.5 w-3.5 text-white/60" />
          ) : (
            <Volume2 className="h-3.5 w-3.5 text-white/60" />
          )}
          <Slider
            value={[volume]}
            min={0}
            max={1}
            step={0.05}
            onValueChange={changeVolume}
            className="w-20"
          />
        </div>

        <div className="flex items-center gap-1">
          {PLAYBACK_RATES.map((value) => (
            <Button
              key={value}
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setPlaybackRate(value)}
              className={cn(
                'h-6 rounded-full px-2 text-[11px] text-white/70 hover:bg-white/10 hover:text-white',
                rate === value && 'bg-white/15 text-white',
              )}
            >
              {value}
              x
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default AudioViewer;
