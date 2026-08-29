import * as React from 'react';
import { ZephSpinner } from './zeph-spinner';

const ZephLoadingOverlay = ({ isOpen, label }) => {
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

  return (
    <div
      ref={overlayRef}
      tabIndex={-1}
      aria-live="polite"
      className="fixed inset-0 z-[100000] flex items-center justify-center bg-background/70 backdrop-blur-md outline-none"
      onClick={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <ZephSpinner size={56} label={label} />
    </div>
  );
};

export { ZephLoadingOverlay };
