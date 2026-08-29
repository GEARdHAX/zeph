import { cn } from '@/lib/utils';

/**
 * ZephWordmark — Official ZEPH Stylized Wordmark
 *
 * Renders "zeph" with an official brand-red dot "." (#E63946 / text-primary).
 */
function ZephWordmark({ className, dotClassName }) {
  return (
    <span className={cn('font-zeph inline-flex items-baseline select-none', className)}>
      <span>zeph</span>
      <span className={cn('text-[#E63946]', dotClassName)}>.</span>
    </span>
  );
}

export default ZephWordmark;
export { ZephWordmark };
