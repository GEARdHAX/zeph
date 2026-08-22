import {
  useCallback, useEffect, useRef, useState,
} from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
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
function VideoEditorModal({
  file, onCancel, onDone,
}) {
  const videoRef = useRef(null);
  const [objectUrl, setObjectUrl] = useState(null);
  const [duration, setDuration] = useState(0);
  const [range, setRange] = useState([0, 0]);
  const [muted, setMuted] = useState(false);
  const [previewing, setPreviewing] = useState(false);
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

  // Preview only the selected [start,end] range, looping back to start
  // rather than continuing past `end` into untrimmed footage.
  const playPreview = () => {
    const video = videoRef.current;
    if (!video) return;
    const [start] = range;
    video.currentTime = start;
    video.muted = muted;
    video.play();
    setPreviewing(true);
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !previewing) return undefined;
    const onTimeUpdate = () => {
      if (video.currentTime >= range[1]) {
        video.pause();
        setPreviewing(false);
      }
    };
    video.addEventListener('timeupdate', onTimeUpdate);
    return () => video.removeEventListener('timeupdate', onTimeUpdate);
  }, [previewing, range]);

  // Grabs a single frame at the trim start as a JPEG blob — used as the
  // video message's poster/thumbnail, the same <canvas>-to-blob approach
  // getCroppedImageBlob.js already uses for images (reused technique, not
  // a new one).
  const capturePoster = () => new Promise((resolve) => {
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85);
  });

  const handleDone = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    setProcessing(true);
    setError(null);

    try {
      const poster = await capturePoster();

      const stream = video.captureStream ? video.captureStream() : video.mozCaptureStream();
      const tracks = muted ? stream.getVideoTracks() : stream.getTracks();
      const recordStream = new MediaStream(tracks);
      const recorder = new MediaRecorder(recordStream, { mimeType: 'video/webm' });
      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

      const recordingDone = new Promise((resolve, reject) => {
        recorder.onstop = () => resolve();
        recorder.onerror = (e) => reject(e.error || new Error('Recording failed'));
      });

      const [trimStart, trimEnd] = range;
      video.currentTime = trimStart;
      video.muted = muted;
      recorderState.current = { recorder };

      await new Promise((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        };
        video.addEventListener('seeked', onSeeked);
      });

      recorder.start();
      video.play();

      await new Promise((resolve) => {
        const onTimeUpdate = () => {
          if (video.currentTime >= trimEnd) {
            video.removeEventListener('timeupdate', onTimeUpdate);
            video.pause();
            recorder.stop();
            resolve();
          }
        };
        video.addEventListener('timeupdate', onTimeUpdate);
      });

      await recordingDone;

      const blob = new Blob(chunks, { type: 'video/webm' });
      const trimmedFile = new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.webm`, { type: 'video/webm' });
      onDone(trimmedFile, poster);
    } catch (e) {
      setError('Could not process this video. Please try again.');
    } finally {
      setProcessing(false);
    }
  }, [file, muted, range, onDone]);

  const formatTime = (seconds) => {
    if (!Number.isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
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
              onClick={playPreview}
              className="max-h-full max-w-full cursor-pointer"
              playsInline
            />
          )}
        </div>

        {duration > 0 && (
          <>
            <div className="flex items-center justify-between text-xs text-white/70">
              <span>{formatTime(range[0])}</span>
              <span>Trim range — click video to preview</span>
              <span>{formatTime(range[1])}</span>
            </div>
            <Slider
              value={range}
              min={0}
              max={duration}
              step={0.1}
              onValueChange={(next) => setRange(next)}
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

        {error && <div className="text-xs text-destructive">{error}</div>}

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={processing}>
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
