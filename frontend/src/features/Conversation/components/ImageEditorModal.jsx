import {
  useCallback, useEffect, useRef, useState,
} from 'react';
import Cropper from 'react-easy-crop';
import { RotateCcw, RefreshCw } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import getCroppedImageBlob from '../../../lib/getCroppedImageBlob';

const INITIAL_CROP = { x: 0, y: 0 };
const INITIAL_ZOOM = 1;
const INITIAL_ROTATION = 0;

// One image at a time (see BottomBar.jsx's editorQueue) — `file` is the raw
// File currently being edited, `aspect` defaults to a wide rectangle (chat's
// case) but can be 1 for a square avatar/profile crop in future reuse.
function ImageEditorModal({
  file, aspect = 4 / 3, onCancel, onDone,
}) {
  const [crop, setCrop] = useState(INITIAL_CROP);
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const [rotation, setRotation] = useState(INITIAL_ROTATION);
  const [error, setError] = useState(null);
  const [processing, setProcessing] = useState(false);
  const croppedAreaPixelsRef = useRef(null);
  const [imageObjectUrl, setImageObjectUrl] = useState(null);

  // One object URL per edited file — created when a new file arrives,
  // revoked on cleanup (covers Cancel, Done-then-advance-to-next-file, and
  // the modal unmounting entirely). Never held as a base64 string anywhere.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImageObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Reset the crop/zoom/rotation session whenever a new file starts editing
  // (advancing to the next image in a multi-select queue).
  useEffect(() => {
    setCrop(INITIAL_CROP);
    setZoom(INITIAL_ZOOM);
    setRotation(INITIAL_ROTATION);
    setError(null);
    croppedAreaPixelsRef.current = null;
  }, [file]);

  // Stable reference so react-easy-crop doesn't treat this as a changed prop
  // on every parent render — the one callback in this component where
  // useCallback actually earns its keep.
  const onCropComplete = useCallback((_croppedArea, croppedAreaPixels) => {
    croppedAreaPixelsRef.current = croppedAreaPixels;
  }, []);

  const reset = () => {
    setCrop(INITIAL_CROP);
    setZoom(INITIAL_ZOOM);
    setRotation(INITIAL_ROTATION);
  };

  const rotate = () => setRotation((r) => (r + 90) % 360);

  const handleDone = async () => {
    if (!croppedAreaPixelsRef.current) return;
    setProcessing(true);
    setError(null);
    try {
      const blob = await getCroppedImageBlob(imageObjectUrl, croppedAreaPixelsRef.current, rotation, file.type);
      const extension = blob.type === 'image/png' ? 'png' : 'jpg';
      const editedFile = new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.${extension}`, { type: blob.type });
      onDone(editedFile);
    } catch (e) {
      setError('Could not process this image. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onCancel()}>
      <DialogContent
        className="flex flex-col gap-4 border-border bg-black p-4 text-white sm:max-w-md"
        onEscapeKeyDown={onCancel}
      >
        <DialogHeader>
          <DialogTitle className="text-white">Edit Image</DialogTitle>
        </DialogHeader>

        <div className="relative h-64 w-full overflow-hidden rounded-xl bg-black sm:h-80">
          {imageObjectUrl && (
            <Cropper
              image={imageObjectUrl}
              crop={crop}
              zoom={zoom}
              rotation={rotation}
              aspect={aspect}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onRotationChange={setRotation}
              onCropComplete={onCropComplete}
            />
          )}
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-white/70">Zoom</span>
          <Slider
            value={[zoom]}
            min={1}
            max={3}
            step={0.05}
            onValueChange={([value]) => setZoom(value)}
            className="flex-1"
          />
        </div>

        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 text-white/80 hover:bg-white/10 hover:text-white"
            onClick={rotate}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Rotate
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 text-white/80 hover:bg-white/10 hover:text-white"
            onClick={reset}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Reset
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
            disabled={processing}
          >
            {processing ? 'Processing…' : 'Done'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ImageEditorModal;
