import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ImageEditorModal from './ImageEditorModal';

vi.mock('../../../lib/getCroppedImageBlob', () => ({ default: vi.fn() }));

// react-easy-crop's actual drag/zoom internals aren't under test here — only
// ImageEditorModal's own wiring is. Stub it so onCropComplete can be invoked
// directly with a fixed crop region.
vi.mock('react-easy-crop', () => ({
  default: ({ onCropComplete }) => {
    onCropComplete({}, {
      x: 0, y: 0, width: 100, height: 100,
    });
    return null;
  },
}));

// eslint-disable-next-line import/first
import getCroppedImageBlob from '../../../lib/getCroppedImageBlob';

const FILE = new File(['x'], 'photo.png', { type: 'image/png' });

function renderModal(props = {}) {
  const onCancel = vi.fn();
  const onDone = vi.fn();
  render(<ImageEditorModal file={FILE} onCancel={onCancel} onDone={onDone} {...props} />);
  return { onCancel, onDone };
}

beforeEach(() => {
  getCroppedImageBlob.mockReset();
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ImageEditorModal', () => {
  it('renders the editor controls for the given file', () => {
    renderModal();
    expect(screen.getByText('Edit Image')).toBeInTheDocument();
    expect(screen.getByText('Zoom')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rotate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('creates an object URL on mount and revokes it on unmount', () => {
    const { unmount } = render(<ImageEditorModal file={FILE} onCancel={vi.fn()} onDone={vi.fn()} />);
    expect(URL.createObjectURL).toHaveBeenCalledWith(FILE);
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('Cancel calls onCancel and never touches getCroppedImageBlob', async () => {
    const user = userEvent.setup();
    const { onCancel, onDone } = renderModal();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(getCroppedImageBlob).not.toHaveBeenCalled();
  });

  it('Escape triggers onCancel via the dialog\'s built-in handling', async () => {
    const user = userEvent.setup();
    const { onCancel } = renderModal();

    await user.keyboard('{Escape}');

    await waitFor(() => expect(onCancel).toHaveBeenCalled());
  });

  it('Done processes the crop and calls onDone with a File of the returned blob\'s type', async () => {
    const user = userEvent.setup();
    getCroppedImageBlob.mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }));
    const { onDone } = renderModal();

    await user.click(screen.getByRole('button', { name: 'Done' }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const editedFile = onDone.mock.calls[0][0];
    expect(editedFile).toBeInstanceOf(File);
    expect(editedFile.type).toBe('image/jpeg');
    expect(editedFile.name).toBe('photo.jpg');
  });

  it('shows an inline error and does not call onDone when processing fails', async () => {
    const user = userEvent.setup();
    getCroppedImageBlob.mockRejectedValue(new Error('boom'));
    const { onDone } = renderModal();

    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(await screen.findByText('Could not process this image. Please try again.')).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });
});
