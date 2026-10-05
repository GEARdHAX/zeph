import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';

// Trims a video client-side with zero new dependencies: seek the source
// <video> to the chosen start time, capture its rendered output via
// captureStream(), record that MediaStream with the native MediaRecorder
// API until the chosen end time, and resolve with the recorded Blob. This
// re-encodes to WebM (universally supported for MediaRecorder output
// regardless of the source container) rather than doing a byte-exact cut of
// the original file — the tradeoff that keeps this dependency-free instead
// of pulling in ffmpeg.wasm for frame-accurate trimming.
function VideoEditorModal({ file, onCancel, onDone }) {
  const videoRef = useRef(null);
  const [objectUrl, setObjectUrl] = useState(null);
  const [duration, setDuration] = useState(0);
  const [range, setRange] = useState([0, 0]);
  const [muted, setMuted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [progress, setProgress] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const recorderState = useRef(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const onLoadedMetadata = () => {
    const total = videoRef.current.duration;
    setDuration(total);
    setRange([0, total]);
  };

  // Playhead + range guard. Runs always (not only while "previewing") so the scrubber stays in sync and playback
  // can never run past the trim end into untrimmed footage.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const onTimeUpdate = () => {
      setCurrent(video.currentTime);
      if (!processing && video.currentTime >= range[1]) video.pause();
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onPause);
    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onPause);
    };
  }, [range, processing, objectUrl]);

  // Play/pause toggle. Resumes from where it paused; only restarts from the trim start when the playhead is outside
  // the range (first play, or it already reached the end).
  const togglePlay = () => {
    const video = videoRef.current;
    if (!video || processing) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    if (video.currentTime < range[0] || video.currentTime >= range[1] - 0.05) video.currentTime = range[0];
    video.muted = muted;
    video.play();
  };

  // Dragging a handle shows that exact frame, so the trim points can be chosen by eye.
  const onRangeChange = (next) => {
    const video = videoRef.current;
    if (video) {
      video.pause();
      const moved = next[0] !== range[0] ? next[0] : next[1];
      video.currentTime = moved;
      setCurrent(moved);
    }
    setRange(next);
  };

  const seekTo = (value) => {
    const video = videoRef.current;
    if (!video || processing) return;
    video.currentTime = value[0];
    setCurrent(value[0]);
  };

  const seekedAt = (video, time) =>
    new Promise((resolve) => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      };
      video.addEventListener('seeked', onSeeked);
      video.currentTime = time;
    });

  // Grabs a single frame at the trim start as a JPEG blob: the video message's poster/thumbnail. Seeks there first
  // (it used to draw whatever frame the preview had left on screen).
  const capturePoster = async (start) => {
    const video = videoRef.current;
    await seekedAt(video, start);
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85);
    });
  };

  const stopRecording = () => {
    const recorder = recorderState.current?.recorder;
    if (recorder && recorder.state !== 'inactive') {
      recorderState.current.cancelled = true;
      recorder.stop();
    }
  };
  useEffect(() => () => stopRecording(), []);

  const handleDone = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    setProcessing(true);
    setError(null);
    video.pause();

    try {
      const [trimStart, trimEnd] = range;
      const poster = await capturePoster(trimStart);

      // Nothing trimmed and audio kept: send the ORIGINAL file. Re-recording it would take as long as the video, lose
      // quality and turn every upload into WebM for no reason.
      if (trimStart <= 0.05 && trimEnd >= duration - 0.05 && !muted) {
        onDone(file, poster);
        return;
      }

      const stream = video.captureStream ? video.captureStream() : video.mozCaptureStream();
      const tracks = muted ? stream.getVideoTracks() : stream.getTracks();
      const recordStream = new MediaStream(tracks);
      const recorder = new MediaRecorder(recordStream, { mimeType: 'video/webm' });
      const chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      const recordingDone = new Promise((resolve, reject) => {
        recorder.onstop = () => resolve();
        recorder.onerror = (e) => reject(e.error || new Error('Recording failed'));
      });

      video.muted = muted;
      recorderState.current = { recorder, cancelled: false };
      await seekedAt(video, trimStart);

      recorder.start();
      video.play();

      await new Promise((resolve) => {
        const finish = () => {
          video.removeEventListener('timeupdate', onTick);
          video.removeEventListener('ended', finish);
          video.pause();
          if (recorder.state !== 'inactive') recorder.stop();
          resolve();
        };
        const onTick = () => {
          setProgress(Math.min(1, (video.currentTime - trimStart) / Math.max(0.1, trimEnd - trimStart)));
          if (video.currentTime >= trimEnd) finish();
        };
        video.addEventListener('timeupdate', onTick);
        video.addEventListener('ended', finish); // the last timeupdate can land just short of the end
      });

      await recordingDone;
      if (recorderState.current?.cancelled) return;

      const blob = new Blob(chunks, { type: 'video/webm' });
      const trimmedFile = new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.webm`, { type: 'video/webm' });
      onDone(trimmedFile, poster);
    } catch (e) {
      setError('Could not process this video. Please try again.');
    } finally {
      setProcessing(false);
      setProgress(0);
    }
  }, [file, muted, range, duration, onDone]);

  const formatTime = (seconds) => {
    if (!Number.isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60)
      .toString()
      .padStart(2, '0');
    return `${mins}:${secs}`;
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onCancel()}>
      <DialogContent
        className="flex flex-col gap-4 border-border bg-black p-4 text-white sm:max-w-md"
        onEscapeKeyDown={onCancel}
      >
        <DialogHeader>
          <DialogTitle className="text-white">Edit Video</DialogTitle>
        </DialogHeader>

        <div className="relative flex h-64 w-full items-center justify-center overflow-hidden rounded-xl bg-black sm:h-80">
          {objectUrl && (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              ref={videoRef}
              src={objectUrl}
              onLoadedMetadata={onLoadedMetadata}
              onClick={togglePlay}
              className="max-h-full max-w-full cursor-pointer"
              playsInline
            />
          )}
        </div>

        {duration > 0 && (
          <>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={playing ? 'Pause' : 'Play'}
                className="h-9 w-9 shrink-0 rounded-full bg-white/10 text-white hover:bg-white/20 hover:text-white"
                onClick={togglePlay}
                disabled={processing}
              >
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              <Slider
                aria-label="Playback position"
                value={[Math.min(Math.max(current, 0), duration)]}
                min={0}
                max={duration}
                step={0.1}
                onValueChange={seekTo}
                disabled={processing}
                className="flex-1"
              />
              <span className="w-20 shrink-0 text-right text-xs tabular-nums text-white/70">
                {formatTime(current)} / {formatTime(duration)}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-white/70">
              <span>{formatTime(range[0])}</span>
              <span>Trim range — drag a handle to pick the frame</span>
              <span>{formatTime(range[1])}</span>
            </div>
            <Slider
              value={range}
              min={0}
              max={duration}
              step={0.1}
              onValueChange={onRangeChange}
              disabled={processing}
              className="flex-1"
            />
          </>
        )}

        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 text-white/80 hover:bg-white/10 hover:text-white"
            onClick={() => setMuted((m) => !m)}
          >
            {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            {muted ? 'Muted' : 'Mute audio'}
          </Button>
        </div>

        {processing && progress > 0 && (
          <div className="text-xs text-white/70" role="status">
            {`Processing ${Math.round(progress * 100)}% (trimmed or muted clips are re-encoded at normal speed)`}
          </div>
        )}
        {error && <div className="text-xs text-destructive">{error}</div>}

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={handleDone}
            disabled={processing || duration === 0}
          >
            {processing ? 'Processing…' : 'Done'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default VideoEditorModal;
