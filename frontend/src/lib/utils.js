import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Named export (not default) is the shadcn/ui convention — every generated
// component imports `{ cn }`, so keep this file's export shape aligned with
// what `npx shadcn add` generates.
// eslint-disable-next-line import/prefer-default-export
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
