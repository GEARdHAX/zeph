import * as React from 'react';
import { cn } from '@/lib/utils';

// ===== ULTRA-FAST SNAPPY PHASE TIMINGS =====
const PHASE_TIMINGS = {
  bounceMs: 380, // Snappy 0.38s bounce
  squashMs: 60,
  squashSettleMs: 40,
  typeCharMs: 50, // Rapid typewriter pace (50ms/char)
  typeHoldMs: 150,
  blinkMs: 800, // 2 rapid blinks (2 * 400ms)
  blinkSettleMs: 40,
  deleteCharMs: 25, // Lightning backspace
  deleteHoldMs: 90,
};

const FULL_TEXT = 'zeph';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ZephSpinner = React.forwardRef(({ className, size = 42, label = 'Loading', ...props }, ref) => {
  const [text, setText] = React.useState('');
  const [dotPhase, setDotPhase] = React.useState('bouncing'); // 'bouncing' | 'squash' | 'blink' | 'idle'

  React.useEffect(() => {
    let cancelled = false;

    // ===== FRAME 1: Red Dot Bounces =====
    const frame1_Bounce = async () => {
      if (cancelled) return;
      setDotPhase('bouncing');
      setText('');

      await sleep(PHASE_TIMINGS.bounceMs);
      if (cancelled) return;

      setDotPhase('squash');
      await sleep(PHASE_TIMINGS.squashMs);
      if (cancelled) return;

      setDotPhase('idle');
      await sleep(PHASE_TIMINGS.squashSettleMs);
    };

    // ===== FRAME 2: Type "zeph" =====
    const frame2_Type = async () => {
      if (cancelled) return;
      let currentText = '';
      setText('');
      setDotPhase('idle');

      const chars = FULL_TEXT.split('');
      for (let i = 0; i < chars.length; i += 1) {
        if (cancelled) return;
        currentText += chars[i];
        setText(currentText);
        await sleep(PHASE_TIMINGS.typeCharMs);
      }
      if (cancelled) return;
      await sleep(PHASE_TIMINGS.typeHoldMs);
    };

    // ===== FRAME 3: Dot Blinks =====
    const frame3_Blink = async () => {
      if (cancelled) return;
      setDotPhase('blink');
      await sleep(PHASE_TIMINGS.blinkMs);
      if (cancelled) return;
      setDotPhase('idle');
      await sleep(PHASE_TIMINGS.blinkSettleMs);
    };

    // ===== FRAME 4: Delete =====
    const frame4_Delete = async () => {
      if (cancelled) return;
      let deleteText = FULL_TEXT;
      for (let i = deleteText.length; i > 0; i -= 1) {
        if (cancelled) return;
        deleteText = deleteText.slice(0, -1);
        setText(deleteText);
        await sleep(PHASE_TIMINGS.deleteCharMs);
      }
      if (cancelled) return;
      setText('');
      await sleep(PHASE_TIMINGS.deleteHoldMs);
    };

    // ===== Main Loop =====
    const mainLoop = async () => {
      while (!cancelled) {
        await frame1_Bounce();
        await frame2_Type();
        await frame3_Blink();
        await frame4_Delete();
      }
    };

    mainLoop();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      ref={ref}
      role="status"
      aria-label={label}
      className={cn('zeph-container zeph-spinner-container', className)}
      style={{ '--zeph-size': `${size}px` }}
      {...props}
    >
      <style>{`
        .zeph-container {
          display: inline-flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          position: relative;
          --zeph-size: 42px;
        }

        .zeph-row {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 2px;
          min-height: calc(var(--zeph-size) * 1.9);
          position: relative;
        }

        .zeph-wordmark,
        .zeph-spinner-wordmark {
          font-family: 'Google Sans Flex Variable', 'Google Sans Flex', 'Space Grotesk', -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: var(--zeph-size);
          font-weight: 700;
          color: hsl(var(--foreground, 0 0% 4%));
          letter-spacing: 0.02em;
          min-width: 10px;
          display: inline-block;
          line-height: 1.2;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }

        .zeph-dot,
        .zeph-spinner-dot {
          width: calc(var(--zeph-size) * 0.5714);
          height: calc(var(--zeph-size) * 0.5714);
          background: #E63946;
          border-radius: 50%;
          flex-shrink: 0;
          position: relative;
          transform: translateY(0);
          transition: transform 0.08s ease, opacity 0.12s ease;
          box-shadow: 0 0 20px rgba(230, 57, 70, 0.2);
          opacity: 1;
        }

        .zeph-dot.bouncing,
        .zeph-spinner-dot.is-bouncing {
          animation: zeph-bounce 0.38s cubic-bezier(0.36, 0.07, 0.19, 0.97) infinite;
        }

        .zeph-dot.squash,
        .zeph-spinner-dot.is-squash {
          animation: zeph-squash 0.06s ease forwards;
        }

        .zeph-dot.blink,
        .zeph-spinner-dot.is-blink {
          animation: zeph-blinkDot 0.4s ease-in-out infinite;
        }

        @keyframes zeph-blinkDot {
          0%, 100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.15;
            transform: scale(0.85);
          }
        }

        @keyframes zeph-bounce {
          0% {
            transform: translateY(0) scale(1, 1);
          }
          30% {
            transform: translateY(calc(var(--zeph-size) * -0.952)) scale(1, 1);
          }
          50% {
            transform: translateY(0) scale(1, 1);
          }
          70% {
            transform: translateY(calc(var(--zeph-size) * -0.476)) scale(1, 1);
          }
          85% {
            transform: translateY(0) scale(1.15, 0.85);
          }
          100% {
            transform: translateY(0) scale(1, 1);
          }
        }

        @keyframes zeph-squash {
          0% {
            transform: scale(1.2, 0.8);
          }
          100% {
            transform: scale(1, 1);
          }
        }
      `}</style>

      <div className="zeph-row zeph-spinner-row">
        <span className="zeph-wordmark zeph-spinner-wordmark">{text}</span>
        <span
          className={cn(
            'zeph-dot zeph-spinner-dot',
            dotPhase === 'bouncing' && 'bouncing is-bouncing',
            dotPhase === 'squash' && 'squash is-squash',
            dotPhase === 'blink' && 'blink is-blink',
          )}
        />
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
});

ZephSpinner.displayName = 'ZephSpinner';

export default ZephSpinner;
export { ZephSpinner };
