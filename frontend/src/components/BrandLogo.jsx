import { cn } from '@/lib/utils';

/**
 * Graphical logo placeholder — centralizes the ONE place that needs to change
 * once the real logo asset is provided. Until then it renders a neutral,
 * clearly-a-placeholder mark (dashed border, no invented icon/shape) rather
 * than a fake logo, so nobody mistakes it for the final design.
 *
 * This is the graphical mark only — the "zeph." text wordmark is separate
 * (some contexts show both together, e.g. navbar; some show only the
 * wordmark, e.g. narrow footers). Compose them where needed:
 *   <BrandLogo className="h-8 w-8" /><span>{Config.wordmark}</span>
 *
 * Replace all duplicated/hardcoded <img src={logo}> usages with this
 * component so swapping in the real asset later touches this one file.
 */
function BrandLogo({ className = 'h-8 w-8', label = 'zeph logo placeholder' }) {
  return (
    <div
      role="img"
      aria-label={label}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/40 bg-muted/40 text-muted-foreground',
        className,
      )}
    >
      <span className="text-[0.5em] font-semibold leading-none">z</span>
    </div>
  );
}

export default BrandLogo;
