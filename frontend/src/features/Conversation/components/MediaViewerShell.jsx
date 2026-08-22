import {
  useState, useEffect, useMemo, useCallback, useRef,
} from 'react';
import {
  X, Download, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCw, RefreshCw, Loader2,
} from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import Config from '../../../config';
import getMediaCategory from '../../../lib/mediaType';
import downloadFile from '../../../lib/downloadFile';
import useAuthorizedMediaUrl from '../../../lib/useAuthorizedMediaUrl';
import ImageViewer, { clampImageScale } from './ImageViewer';
import VideoViewer from './VideoViewer';
import AudioViewer from './AudioViewer';
import PdfViewer from './PdfViewer';
import FileViewer from './FileViewer';

const SWIPE_THRESHOLD = 60; // px — a horizontal drag past this counts as a swipe, not a tap

// Every media URL still goes through the same existing authenticated-by-
// shieldedID endpoints already used for direct download today — this shell
// adds a preview layer, it does not change what's trusted or how it's
// fetched. Filenames are always rendered as plain text, never
// dangerouslySetInnerHTML.
function MediaViewerShell({ messages, initialMessage, onClose }) {
  const [index, setIndex] = useState(() => {
    const found = messages.findIndex((m) => m._id === initialMessage._id);
    return found === -1 ? 0 : found;
  });
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const swipeState = useRef(null);

  const message = messages[index] || initialMessage;
  const category = useMemo(() => getMediaCategory(message), [message]);

  const hasPrevious = index > 0;
  const hasNext = index < messages.length - 1;

  const resetTransform = useCallback(() => {
    setScale(1);
    setRotation(0);
  }, []);

  const goPrevious = useCallback(() => {
    if (!hasPrevious) return;
    setIndex((i) => i - 1);
    resetTransform();
  }, [hasPrevious, resetTransform]);

  const goNext = useCallback(() => {
    if (!hasNext) return;
    setIndex((i) => i + 1);
    resetTransform();
  }, [hasNext, resetTransform]);

  // Body-scroll lock while the viewer is open, restored on close — the
  // Radix Dialog this is built on already traps focus/Escape, but doesn't
  // lock scroll on the underlying chat scroll container by itself here
  // since this isn't rendered through DialogTrigger's normal flow.
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowLeft') goPrevious();
      else if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goPrevious, goNext]);

  const onPointerDown = (e) => {
    swipeState.current = { startX: e.clientX, startY: e.clientY };
  };

  const onPointerUp = (e) => {
    if (!swipeState.current) return;
    const dx = e.clientX - swipeState.current.startX;
    const dy = e.clientY - swipeState.current.startY;
    swipeState.current = null;
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy)) return;
    if (dx > 0) goPrevious();
    else goNext();
  };

  // New-format messages (message.media, from upload-media.js) are served
  // through the authenticated /api/media/:id route; old-format image/file
  // messages keep using the legacy unauthenticated /api/images|files/:id
  // routes unchanged — both endpoints coexist, nothing old breaks. Computed
  // before the `!message` early return below (never after) so the two
  // useAuthorizedMediaUrl hook calls that depend on them always run in the
  // same order every render, regardless of whether message exists.
  // message.media is a populated Media object once join-room.js/sync-
  // messages.js/etc. run their populate() — but a message can reach here
  // with it still an unpopulated ObjectId string (stale client state from
  // before a populate fix, a route that doesn't populate it, or a broken/
  // deleted ref resolving to null). Only treat it as new-format when it's
  // genuinely an object with an _id, not just any truthy value — otherwise
  // message.media._id/.originalName silently evaluate to undefined and the
  // viewer renders a blank "File / Unknown size" card with a dead URL
  // instead of the "could not load" error state.
  const isNewFormat = !!(message?.media && typeof message.media === 'object' && message.media._id);
  const filename = message && (isNewFormat
    ? message.media.originalName || `${message.media.category || 'file'}`
    : (category === 'image' ? undefined : (message.file?.name || 'File')));
  const fileUrl = message && (isNewFormat
    ? `${Config.url || ''}/api/media/${message.media._id}`
    : (category === 'image'
      ? `${Config.url || ''}/api/images/${message.content}/2048`
      : `${Config.url || ''}/api/files/${message.content}`));
  const thumbnailUrl = isNewFormat && message.media.thumbnailKey
    ? `${Config.url || ''}/api/media/${message.media._id}/thumbnail`
    : undefined;
  const fileSize = message && (isNewFormat ? message.media.size : message.file?.size);

  // Native <audio>/<video>/<img src> and downloadFile.js's fetch() can't
  // attach the Authorization header /api/media/:id requires (unlike the
  // legacy unauthenticated /api/images|files/:id routes, which pass
  // straight through as a plain URL) — resolve to a same-origin blob: URL
  // via axios (which does carry the header) before handing it to any
  // native element or the download button.
  const {
    url: resolvedUrl, loading: mediaLoading, error: mediaError,
  } = useAuthorizedMediaUrl(fileUrl, { authorized: isNewFormat });
  const { url: resolvedThumbnailUrl } = useAuthorizedMediaUrl(thumbnailUrl, { authorized: isNewFormat });

  if (!message) return null;

  const renderMedia = () => {
    if (mediaError) {
      return <span className="text-sm text-white/70">Could not load this media.</span>;
    }
    if (mediaLoading || !resolvedUrl) {
      return <Loader2 className="h-8 w-8 animate-spin text-white/60" />;
    }
    switch (category) {
      case 'image':
        return <ImageViewer src={resolvedUrl} alt="" scale={scale} rotation={rotation} />;
      case 'video':
        return <VideoViewer src={resolvedUrl} poster={resolvedThumbnailUrl} />;
      case 'audio':
        return <AudioViewer src={resolvedUrl} />;
      case 'pdf':
        return <PdfViewer src={resolvedUrl} filename={filename} />;
      case 'document':
      case 'archive':
      case 'text':
      default:
        return <FileViewer src={resolvedUrl} filename={filename} size={fileSize} />;
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-screen w-screen max-w-none flex-col gap-0 rounded-none border-0 bg-black p-0 text-white sm:max-w-none"
        onEscapeKeyDown={onClose}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-3 sm:px-4">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close"
            className="h-9 w-9 rounded-full text-white/80 hover:bg-white/10 hover:text-white"
          >
            <X className="h-4.5 w-4.5" />
          </Button>

          <span className="max-w-[45%] truncate text-xs font-medium text-white/80 sm:max-w-[60%]">
            {filename}
          </span>

          <div className="flex items-center gap-1">
            {category === 'image' && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setScale((s) => clampImageScale(s - 0.5))}
                  aria-label="Zoom out"
                  className="h-9 w-9 rounded-full text-white/80 hover:bg-white/10 hover:text-white"
                >
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setScale((s) => clampImageScale(s + 0.5))}
                  aria-label="Zoom in"
                  className="h-9 w-9 rounded-full text-white/80 hover:bg-white/10 hover:text-white"
                >
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setRotation((r) => (r + 90) % 360)}
                  aria-label="Rotate"
                  className="h-9 w-9 rounded-full text-white/80 hover:bg-white/10 hover:text-white"
                >
                  <RotateCw className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={resetTransform}
                  aria-label="Reset"
                  className="h-9 w-9 rounded-full text-white/80 hover:bg-white/10 hover:text-white"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Download"
              disabled={mediaLoading || mediaError || !resolvedUrl}
              className="h-9 w-9 rounded-full text-white/80 hover:bg-white/10 hover:text-white"
              onClick={() => downloadFile(resolvedUrl, filename || 'image.jpg')}
            >
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div
          className="relative flex flex-1 items-center justify-center overflow-hidden p-4 sm:p-8"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
        >
          {renderMedia()}

          {hasPrevious && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={goPrevious}
              aria-label="Previous"
              className="absolute left-2 top-1/2 h-10 w-10 -translate-y-1/2 rounded-full bg-black/40 text-white hover:bg-black/60 sm:left-4"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          )}
          {hasNext && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={goNext}
              aria-label="Next"
              className={cn(
                'absolute right-2 top-1/2 h-10 w-10 -translate-y-1/2 rounded-full bg-black/40 text-white hover:bg-black/60 sm:right-4',
              )}
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default MediaViewerShell;
