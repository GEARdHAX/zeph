import { cn } from '@/lib/utils';
import ZephSpinner from './zeph-spinner';

/** Full-screen loading overlay wrapping ZephSpinner. Toggle with useZephLoader. */
function ZephLoadingOverlay({ show, className }) {
  if (!show) return null;
  return (
    <div
      className={cn(
        'fixed inset-0 z-[9999] flex items-center justify-center bg-background/80 backdrop-blur-sm',
        className,
      )}
    >
      <ZephSpinner />
    </div>
  );
}

export default ZephLoadingOverlay;
