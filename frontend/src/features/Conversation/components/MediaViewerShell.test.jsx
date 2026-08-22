import {
  describe, it, expect, vi, afterEach, beforeEach,
} from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import MediaViewerShell from './MediaViewerShell';

vi.mock('../../../lib/downloadFile', () => ({ default: vi.fn() }));
vi.mock('axios');

// eslint-disable-next-line import/first
import downloadFile from '../../../lib/downloadFile';

// Sub-viewers aren't under test here — only the shell's own header/nav/
// keyboard/close wiring is. Each stub renders a marker with the src it
// received so tests can assert which message is currently showing.
vi.mock('./ImageViewer', () => ({
  default: ({ src }) => (
    <div>
      ImageViewer:
      {src}
    </div>
  ),
  clampImageScale: (value) => Math.min(4, Math.max(1, value)),
}));
vi.mock('./VideoViewer', () => ({
  default: ({ src }) => (
    <div>
      VideoViewer:
      {src}
    </div>
  ),
}));
vi.mock('./AudioViewer', () => ({
  default: ({ src }) => (
    <div>
      AudioViewer:
      {src}
    </div>
  ),
}));
vi.mock('./PdfViewer', () => ({
  default: ({ src }) => (
    <div>
      PdfViewer:
      {src}
    </div>
  ),
}));
vi.mock('./FileViewer', () => ({
  default: ({ src }) => (
    <div>
      FileViewer:
      {src}
    </div>
  ),
}));

const IMAGE_MESSAGE = { _id: 'm1', type: 'image', content: 'shielded-1' };
const FILE_MESSAGE = {
  _id: 'm2', type: 'file', content: 'shielded-2', file: { name: 'report.pdf', size: 1024, type: 'application/pdf' },
};
const OTHER_FILE_MESSAGE = {
  _id: 'm3', type: 'file', content: 'shielded-3', file: { name: 'notes.txt', size: 512, type: 'text/plain' },
};

beforeEach(() => {
  downloadFile.mockReset();
  axios.get.mockReset();
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-media-url');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
  document.body.style.overflow = '';
});

describe('MediaViewerShell', () => {
  it('renders the ImageViewer for an image message', () => {
    render(
      <MediaViewerShell messages={[IMAGE_MESSAGE]} initialMessage={IMAGE_MESSAGE} onClose={vi.fn()} />,
    );
    expect(screen.getByText(/ImageViewer:/)).toBeInTheDocument();
  });

  it('renders the PdfViewer for a PDF file message and shows its filename', () => {
    render(
      <MediaViewerShell messages={[FILE_MESSAGE]} initialMessage={FILE_MESSAGE} onClose={vi.fn()} />,
    );
    expect(screen.getByText(/PdfViewer:/)).toBeInTheDocument();
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
  });

  it('renders the FileViewer fallback for an unrecognized file type', () => {
    render(
      <MediaViewerShell messages={[OTHER_FILE_MESSAGE]} initialMessage={OTHER_FILE_MESSAGE} onClose={vi.fn()} />,
    );
    expect(screen.getByText(/FileViewer:/)).toBeInTheDocument();
  });

  it('close button calls onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <MediaViewerShell messages={[IMAGE_MESSAGE]} initialMessage={IMAGE_MESSAGE} onClose={onClose} />,
    );
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape calls onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <MediaViewerShell messages={[IMAGE_MESSAGE]} initialMessage={IMAGE_MESSAGE} onClose={onClose} />,
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows Next but not Previous when starting on the first of multiple messages', () => {
    render(
      <MediaViewerShell messages={[IMAGE_MESSAGE, FILE_MESSAGE]} initialMessage={IMAGE_MESSAGE} onClose={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'Previous' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
  });

  it('Next button advances to the next message', async () => {
    const user = userEvent.setup();
    render(
      <MediaViewerShell messages={[IMAGE_MESSAGE, FILE_MESSAGE]} initialMessage={IMAGE_MESSAGE} onClose={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText(/PdfViewer:/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeInTheDocument();
  });

  it('ArrowRight/ArrowLeft keyboard navigation moves between messages', async () => {
    const user = userEvent.setup();
    render(
      <MediaViewerShell messages={[IMAGE_MESSAGE, FILE_MESSAGE]} initialMessage={IMAGE_MESSAGE} onClose={vi.fn()} />,
    );
    await user.keyboard('{ArrowRight}');
    expect(screen.getByText(/PdfViewer:/)).toBeInTheDocument();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByText(/ImageViewer:/)).toBeInTheDocument();
  });

  it('does not navigate past the last or before the first message', async () => {
    const user = userEvent.setup();
    render(
      <MediaViewerShell messages={[IMAGE_MESSAGE]} initialMessage={IMAGE_MESSAGE} onClose={vi.fn()} />,
    );
    await user.keyboard('{ArrowRight}');
    expect(screen.getByText(/ImageViewer:/)).toBeInTheDocument();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByText(/ImageViewer:/)).toBeInTheDocument();
  });

  it('locks body scroll while open and restores it on unmount', () => {
    const { unmount } = render(
      <MediaViewerShell messages={[IMAGE_MESSAGE]} initialMessage={IMAGE_MESSAGE} onClose={vi.fn()} />,
    );
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('zoom in/out/reset/rotate controls do not crash the viewer for an image message', async () => {
    const user = userEvent.setup();
    render(
      <MediaViewerShell messages={[IMAGE_MESSAGE]} initialMessage={IMAGE_MESSAGE} onClose={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await user.click(screen.getByRole('button', { name: 'Rotate' }));
    await user.click(screen.getByRole('button', { name: 'Reset' }));

    expect(screen.getByText(/ImageViewer:/)).toBeInTheDocument();
  });

  it('Download button calls downloadFile with the existing authenticated file URL and filename', async () => {
    const user = userEvent.setup();
    render(
      <MediaViewerShell messages={[FILE_MESSAGE]} initialMessage={FILE_MESSAGE} onClose={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: 'Download' }));

    expect(downloadFile).toHaveBeenCalledWith(
      expect.stringContaining('/api/files/shielded-2'),
      'report.pdf',
    );
  });

  it('Download for an image falls back to a default filename', async () => {
    const user = userEvent.setup();
    render(
      <MediaViewerShell messages={[IMAGE_MESSAGE]} initialMessage={IMAGE_MESSAGE} onClose={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: 'Download' }));

    expect(downloadFile).toHaveBeenCalledWith(
      expect.stringContaining('/api/images/shielded-1/2048'),
      'image.jpg',
    );
  });
});

describe('MediaViewerShell — new-format (message.media) audio/video/image', () => {
  // Regression coverage for a real bug: /api/media/:id requires an
  // Authorization header, which a plain <audio>/<video>/<img src> request
  // can never send — every new-format message showed as broken ("This
  // audio could not be played.") until the shell started resolving the URL
  // through axios (which does attach the header) into a blob: URL first.
  const AUDIO_MEDIA_MESSAGE = {
    _id: 'm4',
    type: 'file',
    media: {
      _id: 'media-1', category: 'audio', originalName: 'song.mp3', size: 2048, mimeType: 'audio/mpeg',
    },
  };

  it('resolves the media URL via axios (auth header attached) into a blob: URL, not a raw /api/media/:id src', async () => {
    axios.get.mockResolvedValue({ data: new Blob(['x'], { type: 'audio/mpeg' }) });
    render(
      <MediaViewerShell messages={[AUDIO_MEDIA_MESSAGE]} initialMessage={AUDIO_MEDIA_MESSAGE} onClose={vi.fn()} />,
    );

    await waitFor(() => expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining('/api/media/media-1'),
      { responseType: 'blob' },
    ));
    expect(await screen.findByText('AudioViewer:blob:mock-media-url')).toBeInTheDocument();
  });

  it('shows a loading state while the authorized fetch is in flight', () => {
    axios.get.mockImplementation(() => new Promise(() => {})); // never resolves
    render(
      <MediaViewerShell messages={[AUDIO_MEDIA_MESSAGE]} initialMessage={AUDIO_MEDIA_MESSAGE} onClose={vi.fn()} />,
    );

    expect(screen.queryByText(/AudioViewer:/)).not.toBeInTheDocument();
  });

  it('shows an inline error if the authorized fetch fails, instead of a broken player', async () => {
    axios.get.mockRejectedValue(new Error('Request failed with status code 401'));
    render(
      <MediaViewerShell messages={[AUDIO_MEDIA_MESSAGE]} initialMessage={AUDIO_MEDIA_MESSAGE} onClose={vi.fn()} />,
    );

    expect(await screen.findByText('Could not load this media.')).toBeInTheDocument();
    expect(screen.queryByText(/AudioViewer:/)).not.toBeInTheDocument();
  });

  it('the Download button is disabled until the authorized fetch resolves', async () => {
    let resolveFetch;
    axios.get.mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve; }));
    render(
      <MediaViewerShell messages={[AUDIO_MEDIA_MESSAGE]} initialMessage={AUDIO_MEDIA_MESSAGE} onClose={vi.fn()} />,
    );

    expect(screen.getByRole('button', { name: 'Download' })).toBeDisabled();

    resolveFetch({ data: new Blob(['x'], { type: 'audio/mpeg' }) });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download' })).not.toBeDisabled());
  });

  it('shows the real filename from message.media, not "File"', async () => {
    axios.get.mockResolvedValue({ data: new Blob(['x'], { type: 'audio/mpeg' }) });
    render(
      <MediaViewerShell messages={[AUDIO_MEDIA_MESSAGE]} initialMessage={AUDIO_MEDIA_MESSAGE} onClose={vi.fn()} />,
    );

    expect(await screen.findByText('song.mp3')).toBeInTheDocument();
  });

  // Regression coverage for a real bug: message.media can reach the client
  // as an unpopulated ObjectId STRING (stale state from before a route's
  // populate() fix, or a route that never populates it) rather than the
  // full Media object. !!message.media alone is true for a non-empty
  // string, so the old check treated this as new-format and then read
  // .originalName/._id off a string (always undefined) — rendering a blank
  // "File / Unknown size" card with a request to /api/media/undefined
  // instead of falling back to the legacy path or an error state.
  it('falls back to the legacy file path when message.media is an unpopulated ObjectId string, not an object', () => {
    const message = {
      _id: 'm5', type: 'file', content: 'shielded-legacy', file: { name: 'notes.txt', size: 512 }, media: '507f1f77bcf86cd799439011',
    };
    render(<MediaViewerShell messages={[message]} initialMessage={message} onClose={vi.fn()} />);

    // Legacy path used (message.file.name), not a broken new-format read —
    // axios.get is never called with /api/media/undefined, and the header
    // shows the real legacy filename instead of a blank/undefined one.
    expect(axios.get).not.toHaveBeenCalled();
    expect(screen.getByText('notes.txt')).toBeInTheDocument();
    expect(screen.queryByText('undefined')).not.toBeInTheDocument();
  });
});
