import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

const WORD = 'zeph';
// Type the word out, hold, delete it, hold on empty, repeat — a small
// typewriter loop rather than a generic spinner, matching the brand wordmark.
const TYPE_MS = 120;
const HOLD_MS = 700;
const DELETE_MS = 80;
const EMPTY_HOLD_MS = 300;

/**
 * Loading animation that types/deletes the word "zeph" in a loop. This is a
 * LOADING SPINNER, not the brand logo/wordmark — see BrandLogo.jsx for the
 * graphical mark and Config.wordmark ("zeph.") for the static text wordmark.
 */
function ZephSpinner({ className, label = 'Loading zeph' }) {
  const [text, setText] = useState('');

  useEffect(() => {
    let i = 0;
    let deleting = false;
    let timer;

    const tick = () => {
      if (!deleting) {
        i += 1;
        setText(WORD.slice(0, i));
        if (i >= WORD.length) {
          deleting = true;
          timer = setTimeout(tick, HOLD_MS);
          return;
        }
        timer = setTimeout(tick, TYPE_MS);
      } else {
        i -= 1;
        setText(WORD.slice(0, i));
        if (i <= 0) {
          deleting = false;
          timer = setTimeout(tick, EMPTY_HOLD_MS);
          return;
        }
        timer = setTimeout(tick, DELETE_MS);
      }
    };

    timer = setTimeout(tick, TYPE_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div role="status" aria-label={label} className={cn('flex items-center justify-center font-zeph', className)}>
      <span className="text-2xl font-bold tabular-nums text-foreground">
        {text}
        <span className="ml-0.5 inline-block w-[2px] animate-pulse bg-primary align-middle" style={{ height: '1em' }} />
      </span>
    </div>
  );
}

export default ZephSpinner;
