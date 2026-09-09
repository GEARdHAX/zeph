import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setGlobal, getGlobal } from 'reactn';
import Join from './Join';

// STRICT camera-release regression: the join-screen preview acquires
// getUserMedia streams; if the component unmounts WITHOUT the user starting
// the call, those tracks must be stopped — otherwise the browser keeps the
// camera/mic lit with no UI to turn them off until a full page refresh.

const makeStream = () => {
  const tracks = [{ stop: vi.fn(), kind: 'video' }];
  return { getTracks: () => tracks, getVideoTracks: () => tracks, getAudioTracks: () => tracks, _tracks: tracks };
};

beforeEach(async () => {
  await setGlobal({ audio: true, video: true, audioStream: null, videoStream: null });
  const videoStream = makeStream();
  const audioStream = makeStream();
  global.navigator.mediaDevices = {
    getUserMedia: vi.fn(async (constraints) => (constraints.video ? videoStream : audioStream)),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Join — preview stream lifecycle', () => {
  it('stops preview tracks when unmounted without joining', async () => {
    const { unmount } = render(<Join onJoin={vi.fn()} onClose={vi.fn()} />);
    // let the getUserMedia promises resolve into the globals
    await vi.waitFor(() => expect(getGlobal().videoStream).toBeTruthy());
    const { videoStream, audioStream } = getGlobal();

    unmount();

    expect(videoStream._tracks[0].stop).toHaveBeenCalled();
    expect(audioStream._tracks[0].stop).toHaveBeenCalled();
  });

  it('does NOT stop preview tracks when the user clicks Join Call', async () => {
    const onJoin = vi.fn();
    const { unmount } = render(<Join onJoin={onJoin} onClose={vi.fn()} />);
    await vi.waitFor(() => expect(getGlobal().videoStream).toBeTruthy());
    const { videoStream } = getGlobal();

    await userEvent.click(screen.getByRole('button', { name: 'Join Call' }));
    unmount();

    expect(onJoin).toHaveBeenCalled();
    expect(videoStream._tracks[0].stop).not.toHaveBeenCalled();
  });
});
