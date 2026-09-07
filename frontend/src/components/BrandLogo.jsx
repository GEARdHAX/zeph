import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import darkBgLogo from '../assets/brand/dark-bg-logo.png';
import whiteBgLogo from '../assets/brand/white-bg-logo.png';
import useTheme from '../lib/useTheme';

/**
 * BrandLogo — Official ZEPH Brand Asset Component
 *
 * Automatically displays:
 *  - `dark-bg-logo.png` (white nodes, red core) when in Dark Mode (or when on dark surfaces)
 *  - `white-bg-logo.png` (black nodes, red core) when in Light Mode (or when on light surfaces)
 *
 * Variants:
 *  - 'auto' (default): dynamically switches based on current active theme
 *  - 'dark': forced dark surface variant (dark-bg-logo.png)
 *  - 'light': forced light surface variant (white-bg-logo.png)
 *  - 'mark' / 'lockup' / 'full' / 'white' / 'black' aliases for backwards compatibility
 */
function BrandLogo({
  variant = 'auto',
  className = 'h-8 w-8',
  alt = 'zeph logo placeholder',
  ...props
}) {
  const { theme } = useTheme();
  const [domTheme, setDomTheme] = useState(() => (
    typeof document !== 'undefined' && document.documentElement.classList.contains('light')
      ? 'light'
      : 'dark'
  ));

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const syncDomTheme = () => {
      const isLight = document.documentElement.classList.contains('light')
        || document.documentElement.getAttribute('data-theme') === 'light';
      setDomTheme(isLight ? 'light' : 'dark');
    };

    syncDomTheme();

    const observer = new MutationObserver(syncDomTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    });

    return () => observer.disconnect();
  }, []);

  let src = darkBgLogo;

  if (variant === 'dark' || variant === 'white') {
    src = darkBgLogo;
  } else if (variant === 'light' || variant === 'black') {
    src = whiteBgLogo;
  } else {
    // Auto variant: prioritize theme state, falling back to live DOM attribute
    const isLight = theme === 'light' || (theme !== 'dark' && domTheme === 'light');
    src = isLight ? whiteBgLogo : darkBgLogo;
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
