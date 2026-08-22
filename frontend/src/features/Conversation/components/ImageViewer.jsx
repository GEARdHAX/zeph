import {
  memo, useState, useCallback, useRef, useEffect,
} from 'react';
import { Loader2, ImageOff } from 'lucide-react';

const MIN_SCALE = 1;
const MAX_SCALE = 4;

// Fit-to-screen by default (object-contain), CSS-transform zoom/rotate —
// no canvas work needed since this is preview-only, not the pre-upload
// editor (getCroppedImageBlob.js handles that separate, already-solved case).
function ImageViewer({
  src, alt, scale, rotation,
}) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [containerSize, setContainerSize] = useState(null);
  const containerRef = useRef(null);

  const handleLoad = useCallback(() => setLoaded(true), []);
  const handleError = useCallback(() => setError(true), []);

  // A 90°/270° rotation swaps the image's effective width/height on screen,
  // but an <img> capped with max-h-full/max-w-full keeps those caps relative
  // to its OWN (pre-rotation) box — so a wide image rotated 90° swings its
  // now-tall extent past the container's edges instead of shrinking to fit.
  // Measuring the container and swapping which pixel dimension constrains
  // width vs height (rather than guessing with viewport units) keeps the
  // rotated image fully inside the viewer regardless of header/padding.
  useEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        setContainerSize({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 text-white/70">
        <ImageOff className="h-10 w-10" />
        <span className="text-sm">Could not load this image.</span>
      </div>
    );
  }

  const isSideways = rotation % 180 !== 0;
  const constrainedStyle = isSideways && containerSize
    ? { maxWidth: containerSize.height, maxHeight: containerSize.width }
    : { maxWidth: '100%', maxHeight: '100%' };

  return (
    <div ref={containerRef} className="relative flex h-full w-full items-center justify-center overflow-hidden">
      {!loaded && <Loader2 className="absolute h-8 w-8 animate-spin text-white/60" />}
      <img
        src={src}
        alt={alt}
        onLoad={handleLoad}
        onError={handleError}
        draggable={false}
        className="select-none object-contain transition-transform duration-150"
        style={{
          ...constrainedStyle,
          transform: `scale(${scale}) rotate(${rotation}deg)`,
          opacity: loaded ? 1 : 0,
        }}
      />
    </div>
  );
}

// A plain named export, not a static property on the component — React.memo()
// wraps ImageViewer in a new object that does not carry over statics set on
// the original function, so `MemoizedImageViewer.clampScale` would silently
// be undefined and throw when called as a function.
export const clampImageScale = (value) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

export default memo(ImageViewer);
