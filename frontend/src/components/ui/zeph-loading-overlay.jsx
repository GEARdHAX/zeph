import * as React from 'react';
import { ZephSpinner } from './zeph-spinner';
import { ZephGeneratingLoader } from './ZephGeneratingLoader';

function ZephLoadingOverlay({ isOpen, label, variant }) {
  // NOTE: isOpen/label API is what App.jsx (the sole mount point, via
  // useZephLoader()) actually calls this with — z-[100000] deliberately
  // clears GroupAdminPanel's z-[99999], the highest other z-index in the
  // app as of this writing.
  const overlayRef = React.useRef(null);

  // Body scroll lock + focus trap
  React.useEffect(() => {
    if (!isOpen) return undefined;

    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = 'hidden';

    const previouslyFocused = document.activeElement;
    overlayRef.current?.focus();

    const trapFocus = (e) => {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      overlayRef.current?.focus();
    };
    document.addEventListener('keydown', trapFocus, true);

    return () => {
      body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', trapFocus, true);
      if (previouslyFocused && document.body.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const isAiTask =
    variant === 'generating' ||
    (typeof label === 'string' && /^(generat|summariz|transcrib|draft|rewrit)/i.test(label));

  return (
    <div
      ref={overlayRef}
      tabIndex={-1}
      aria-live="polite"
      className="fixed inset-0 z-[100000] flex items-center justify-center bg-background/80 backdrop-blur-md outline-none"
      onClick={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {isAiTask ? (
        <ZephGeneratingLoader
          size={180}
          text={
            /summariz/i.test(label)
              ? 'Summarizing'
              : /transcrib/i.test(label)
                ? 'Transcribing'
                : /draft/i.test(label)
                  ? 'Drafting'
                  : /rewrit/i.test(label)
                    ? 'Rewriting'
                    : 'Generating'
          }
          subtext={typeof label === 'string' ? label : undefined}
          aria-label={label || 'Generating'}
        />
      ) : (
        <ZephSpinner size={56} label={label} />
      )}
    </div>
  );
}

export { ZephLoadingOverlay };
