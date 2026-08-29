import { cn } from '@/lib/utils';
import darkBgLogo from '../assets/brand/dark-bg-logo.png';
import whiteBgLogo from '../assets/brand/white-bg-logo.png';
import useTheme from '../lib/useTheme';

/**
 * BrandLogo — Official ZEPH Brand Asset Component
 *
 * Automatically displays:
 *  - `dark-bg-logo.png` when in Dark Mode (or when on dark surfaces)
 *  - `white-bg-logo.png` when in Light Mode (or when on light surfaces)
 *
 * Variants:
 *  - 'auto' (default): dynamically switches based on current active theme
 *  - 'dark': forced dark surface variant (dark-bg-logo.png)
 *  - 'light': forced light surface variant (white-bg-logo.png)
 *  - 'mark' / 'lockup' / 'full' / 'white' / 'black' aliases for full backwards compatibility
 */
function BrandLogo({
  variant = 'auto',
  className = 'h-8 w-8',
  alt = 'zeph logo placeholder',
  ...props
}) {
  const { theme } = useTheme?.() || { theme: 'dark' };
  const isDark = theme === 'dark';

  let src = isDark ? darkBgLogo : whiteBgLogo;

  if (variant === 'dark' || variant === 'white') {
    src = darkBgLogo;
  } else if (variant === 'light' || variant === 'black') {
    src = whiteBgLogo;
  }

  return (
    <img
      src={src}
      alt={alt}
      className={cn('inline-flex shrink-0 object-contain select-none pointer-events-none', className)}
      {...props}
    />
  );
}

export default BrandLogo;
export { BrandLogo };
