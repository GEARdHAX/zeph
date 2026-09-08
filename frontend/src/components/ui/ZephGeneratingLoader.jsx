import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * ZephGeneratingLoader
 *
 * An ultra-premium, circular portal loader inspired by dexter-st on Uiverse.io,
 * customized for Zeph's design system with crimson glowing accents, rotating
 * volumetric inset shadows, and wave-pulsing staggered typography.
 *
 * @param {string} text - Text to display and animate inside the portal (default: 'Generating')
 * @param {number} size - Outer circle diameter in pixels (default: 180)
 * @param {string} subtext - Optional helper description rendered beneath the portal
 * @param {string} accentColor - Main glowing accent color (defaults to Zeph crimson)
 * @param {string} className - Additional container styling
 */
const ZephGeneratingLoader = React.forwardRef(
  (
    {
      text = 'Generating',
      size = 180,
      subtext,
      accentColor = '#e11d48',
      secondaryColor = 'rgba(255, 255, 255, 0.85)',
      className,
      ...props
    },
    ref,
  ) => {
    const letters = React.useMemo(() => (text ? text.split('') : []), [text]);
    const scale = size / 180;
    const fontSize = Math.max(12, Math.round(18 * scale));
    const letterSpacing = Math.max(1, Math.round(2 * scale));

    // Compute proportional shadow offsets
    const shadow1Y = Math.round(10 * scale);
    const shadow1Blur = Math.round(20 * scale);
    const shadow2Y = Math.round(20 * scale);
    const shadow2Blur = Math.round(30 * scale);

    return (
      <div
        ref={ref}
        role="status"
        aria-label={subtext ? `${text} — ${subtext}` : text}
        className={cn('flex flex-col items-center justify-center gap-4 select-none', className)}
        {...props}
      >
        <style>{`
        @keyframes zeph-loader-rotate {
          0% {
            transform: rotate(90deg);
            box-shadow: 0 ${shadow1Y}px ${shadow1Blur}px 0 ${secondaryColor} inset,
                        0 ${shadow2Y}px ${shadow2Blur}px 0 ${accentColor} inset;
          }
          50% {
            transform: rotate(270deg);
            box-shadow: 0 ${shadow1Y}px ${shadow1Blur}px 0 ${accentColor} inset,
                        0 ${shadow2Y}px ${shadow2Blur}px 0 ${secondaryColor} inset;
          }
          100% {
            transform: rotate(450deg);
            box-shadow: 0 ${shadow1Y}px ${shadow1Blur}px 0 ${secondaryColor} inset,
                        0 ${shadow2Y}px ${shadow2Blur}px 0 ${accentColor} inset;
          }
        }

        @keyframes zeph-letter-anim {
          0%, 100% {
            opacity: 0.35;
            transform: translateY(0);
          }
          50% {
            opacity: 1;
            transform: translateY(-2px);
            text-shadow: 0 0 12px ${accentColor}, 0 0 24px rgba(225, 29, 72, 0.4);
          }
        }

        .zeph-loader-circle {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(225, 29, 72, 0.04) 0%, transparent 70%);
          animation: zeph-loader-rotate 2.4s linear infinite;
          pointer-events: none;
        }

        .zeph-loader-letter {
          display: inline-block;
          font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
          font-weight: 400;
          letter-spacing: ${letterSpacing}px;
          color: hsl(var(--foreground));
          animation: zeph-letter-anim 2s infinite ease-in-out;
        }
      `}</style>

        {/* Main rotating portal */}
        <div
          className="relative flex items-center justify-center rounded-full bg-card/60 backdrop-blur-sm border border-border/40 shadow-inner"
          style={{ width: `${size}px`, height: `${size}px` }}
        >
          {/* Revolving iridescent light tube */}
          <div className="zeph-loader-circle" />

          {/* Ambient subtle back glow */}
          <div
            className="absolute inset-0 rounded-full opacity-30 blur-md pointer-events-none"
            style={{ background: `radial-gradient(circle, ${accentColor} 0%, transparent 65%)` }}
          />

          {/* Staggered animated letters */}
          <div
            className="relative z-10 flex items-center justify-center flex-wrap px-3 text-center"
            style={{ fontSize: `${fontSize}px` }}
          >
            {letters.map((char, idx) => (
              <span
                key={`${char}-${idx}`}
                className="zeph-loader-letter"
                style={{
                  animationDelay: `${(idx * 0.09).toFixed(2)}s`,
                }}
              >
                {char === ' ' ? '\u00A0' : char}
              </span>
            ))}
          </div>
        </div>

        {/* Optional subtext */}
        {subtext && (
          <div className="flex flex-col items-center gap-1 px-4 text-center max-w-[280px]">
            <p className="text-xs font-medium text-muted-foreground animate-pulse leading-relaxed">{subtext}</p>
          </div>
        )}
      </div>
    );
  },
);

ZephGeneratingLoader.displayName = 'ZephGeneratingLoader';

export default ZephGeneratingLoader;
export { ZephGeneratingLoader };
