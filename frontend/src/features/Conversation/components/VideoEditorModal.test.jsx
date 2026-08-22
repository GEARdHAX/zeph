import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import {
  render, screen, fireEvent, waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VideoEditorModal from './VideoEditorModal';

const FILE = new File(['x'], 'clip.mp4', { type: 'video/mp4' });

// jsdom implements neither HTMLMediaElement.captureStream, MediaRecorder,
// nor MediaStream — all three are stubbed here as plain `function`
// constructors rather than `class` (both are `new`-able exactly like the
// real APIs VideoEditorModal calls, and plain functions keep this file
// under the one-class-per-file lint rule). The stubbed MediaRecorder
// resolves immediately with one small fake chunk, enough to prove the
// component wires start/stop/onDone correctly without real video decoding.
function FakeMediaRecorder(stream, options) {
  this.stream = stream;
  this.options = options;
  this.state = 'inactive';
}
FakeMediaRecorder.prototype.start = function start() { this.state = 'recording'; };
FakeMediaRecorder.prototype.stop = function stop() {
  this.state = 'inactive';
  if (this.ondataavailable) this.ondataavailable({ data: new Blob(['fake-webm-bytes']) });
  if (this.onstop) this.onstop();
};

function FakeMediaStream(tracks = []) {
  this.tracks = tracks;
}
FakeMediaStream.prototype.getTracks = function getTracks() { return this.tracks; };
FakeMediaStream.prototype.getVideoTracks = function getVideoTracks() { return this.tracks; };

beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-video-url');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  global.MediaRecorder = FakeMediaRecorder;
  global.MediaStream = FakeMediaStream;
  window.HTMLMediaElement.prototype.captureStream = () => new FakeMediaStream([]);
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue();
  window.HTMLMediaElement.prototype.pause = vi.fn();
  HTMLCanvasElement.prototype.getContext = () => ({ drawImage: vi.fn() });
  HTMLCanvasElement.prototype.toBlob = (cb) => cb(new Blob(['fake-jpeg-bytes'], { type: 'image/jpeg' }));
});

afterEach(() => {
  vi.restoreAllMocks();
  delete global.MediaRecorder;
  delete global.MediaStream;
});

// Simulates the browser firing loadedmetadata with a fixed duration —
// jsdom never actually decodes video, so duration must be set manually.
const triggerLoadedMetadata = (durationSeconds) => {
  const video = document.querySelector('video');
  Object.defineProperty(video, 'duration', { value: durationSeconds, configurable: true });
  Object.defineProperty(video, 'videoWidth', { value: 640, configurable: true });
  Object.defineProperty(video, 'videoHeight', { value: 360, configurable: true });
  fireEvent.loadedMetadata(video);
};

describe('VideoEditorModal', () => {
  it('renders the trim controls once video metadata loads', () => {
    render(<VideoEditorModal file={FILE} onCancel={vi.fn()} onDone={vi.fn()} />);
    triggerLoadedMetadata(60);

    expect(screen.getByText(/trim range/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mute audio/i })).toBeInTheDocument();
  });

  it('Cancel calls onCancel and never calls onDone', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onDone = vi.fn();
    render(<VideoEditorModal file={FILE} onCancel={onCancel} onDone={onDone} />);
    triggerLoadedMetadata(60);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('Done produces a trimmed file and a poster blob, passed to onDone', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<VideoEditorModal file={FILE} onCancel={vi.fn()} onDone={onDone} />);
    triggerLoadedMetadata(60);

    const video = document.querySelector('video');
    Object.defineProperty(video, 'currentTime', { value: 0, configurable: true, writable: true });

    // handleDone awaits two real DOM events in sequence: 'seeked' (after
    // setting currentTime to the trim start) then 'timeupdate' (checked
    // against the trim end to know when to stop recording) — jsdom never
    // actually decodes/plays video, so both are dispatched manually here.
    // Repeatedly dispatching 'seeked' inside waitFor's poll loop guarantees
    // at least one dispatch lands after the component's listener is
    // actually attached, however many microtasks handleDone awaits first —
    // a fixed number of manual ticks would be fragile against that.
    user.click(screen.getByRole('button', { name: 'Done' }));

    await waitFor(() => {
      fireEvent(video, new Event('seeked'));
      video.currentTime = 60;
      fireEvent(video, new Event('timeupdate'));
      expect(onDone).toHaveBeenCalledTimes(1);
    });
    const [trimmedFile, poster] = onDone.mock.calls[0];
    expect(trimmedFile).toBeInstanceOf(File);
    expect(trimmedFile.type).toBe('video/webm');
    expect(poster).toBeInstanceOf(Blob);
  });

  it('mute toggle switches label between "Mute audio" and "Muted"', async () => {
    const user = userEvent.setup();
    render(<VideoEditorModal file={FILE} onCancel={vi.fn()} onDone={vi.fn()} />);
    triggerLoadedMetadata(60);

    const muteButton = screen.getByRole('button', { name: /mute audio/i });
    await user.click(muteButton);

    expect(screen.getByRole('button', { name: 'Muted' })).toBeInTheDocument();
  });

  it('revokes the object URL on unmount', () => {
    const { unmount } = render(<VideoEditorModal file={FILE} onCancel={vi.fn()} onDone={vi.fn()} />);
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-video-url');
  });
});
