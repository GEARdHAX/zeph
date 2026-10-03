import { useEffect, useRef, useCallback, useState } from 'react';
import createGlobe from 'cobe';

const defaultMarkers = [
  { id: 'cdn-iad', location: [38.95, -77.45], region: 'iad1' },
  { id: 'cdn-sfo', location: [37.62, -122.38], region: 'sfo1' },
  { id: 'cdn-cdg', location: [49.01, 2.55], region: 'cdg1' },
  { id: 'cdn-hnd', location: [35.55, 139.78], region: 'hnd1' },
  { id: 'cdn-syd', location: [-33.95, 151.18], region: 'syd1' },
  { id: 'cdn-gru', location: [-23.43, -46.47], region: 'gru1' },
  { id: 'cdn-sin', location: [1.36, 103.99], region: 'sin1' },
  { id: 'cdn-arn', location: [59.65, 17.93], region: 'arn1' },
  { id: 'cdn-dub', location: [53.43, -6.25], region: 'dub1' },
  { id: 'cdn-bom', location: [19.09, 72.87], region: 'bom1' },
];

const defaultArcs = [
  { id: 'cdn-arc-1', from: [38.95, -77.45], to: [49.01, 2.55] },
  { id: 'cdn-arc-2', from: [37.62, -122.38], to: [35.55, 139.78] },
  { id: 'cdn-arc-3', from: [49.01, 2.55], to: [1.36, 103.99] },
  { id: 'cdn-arc-4', from: [38.95, -77.45], to: [-23.43, -46.47] },
  { id: 'cdn-arc-5', from: [35.55, 139.78], to: [-33.95, 151.18] },
  { id: 'cdn-arc-6', from: [49.01, 2.55], to: [19.09, 72.87] },
];

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Black + Red Digital Earth color system:
// baseColor: digital red land dots (#FF2638 / #E31B2D) with dark crimson unlit ocean (#080808)
const RED_LAND_RGB = [1.0, 0.14, 0.22];
// glowColor: subtle sophisticated atmospheric rim (#5A0B12 / #8F111C / #D7192A)
const RED_ATMOSPHERE_RGB = [0.55, 0.07, 0.11];
// arcColor: dark-red communication signal trails — was pure white, which
// out-competed the red digital-Earth surface as the focal point; switched to
// a muted red so the globe itself stays dominant.
const DARK_RED_ARC_RGB = [0.72, 0.09, 0.14];
// markerColor: bright red communication signal beacon (#FF3042)
const RED_MARKER_RGB = [1.0, 0.19, 0.26];

export function GlobeCdn({
  markers = defaultMarkers,
  arcs = defaultArcs,
  className = '',
  speed = 0.003,
  // false drops the HTML region chips + req/s readouts (the CDN-dashboard look)
  // and their 250ms re-render timer, leaving just the globe, markers and arcs.
  showLabels = true,
}) {
  const canvasRef = useRef(null);
  const pointerInteracting = useRef(null);
  const dragOffset = useRef({ phi: 0, theta: 0 });
  const phiOffsetRef = useRef(0);
  const thetaOffsetRef = useRef(0);
  const isPausedRef = useRef(false);
  const [traffic, setTraffic] = useState(() =>
    defaultArcs.map((a, i) => ({ id: a.id, value: [420, 380, 290, 185, 156, 134][i] || 100 }))
  );

  useEffect(() => {
    if (!showLabels) return undefined;
    const interval = setInterval(() => {
      setTraffic((data) =>
        data.map((t) => ({
          ...t,
          value: Math.max(50, t.value + Math.floor(Math.random() * 21) - 10),
        }))
      );
    }, 250);
    return () => clearInterval(interval);
  }, [showLabels]);

  const handlePointerDown = useCallback((e) => {
    pointerInteracting.current = { x: e.clientX, y: e.clientY };
    if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
    isPausedRef.current = true;
  }, []);

  const handlePointerUp = useCallback(() => {
    if (pointerInteracting.current !== null) {
      phiOffsetRef.current += dragOffset.current.phi;
      thetaOffsetRef.current += dragOffset.current.theta;
      dragOffset.current = { phi: 0, theta: 0 };
    }
    pointerInteracting.current = null;
    if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
    isPausedRef.current = false;
  }, []);

  useEffect(() => {
    const handlePointerMove = (e) => {
      if (pointerInteracting.current !== null) {
        dragOffset.current = {
          phi: (e.clientX - pointerInteracting.current.x) / 300,
          theta: (e.clientY - pointerInteracting.current.y) / 1000,
        };
      }
    };
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerup', handlePointerUp, { passive: true });
    // touch: the browser takes over for a vertical page scroll and cancels the pointer
    window.addEventListener('pointercancel', handlePointerUp, { passive: true });
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [handlePointerUp]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const reducedMotion = prefersReducedMotion();
    let globe = null;
    let animationId;
    let phi = 0;

    function init() {
      const width = canvas.offsetWidth;
      if (width === 0 || globe) return;

      const isSmallViewport = typeof window !== 'undefined' && window.innerWidth < 768;
      const dprCap = isSmallViewport ? 1.5 : 2;

      globe = createGlobe(canvas, {
        devicePixelRatio: Math.min(window.devicePixelRatio || 1, dprCap),
        width,
        height: width,
        phi: 0,
        theta: 0.2,
        // dark:1 renders unlit ocean/sphere as deep near-black (#080808)
        dark: 1,
        diffuse: 1.5,
        // Digital continent density: preserved coastlines with digital data-point aesthetic
        mapSamples: 16000,
        mapBrightness: 10,
        // baseColor: digital red land dots (front-facing bright #FF2638, sides medium red, ocean near-black)
        baseColor: RED_LAND_RGB,
        markerColor: RED_MARKER_RGB,
        // glowColor: subtle, restrained red atmospheric rim (#8F111C / #D7192A)
        glowColor: RED_ATMOSPHERE_RGB,
        markerElevation: 0.02,
        markers: markers.map((m) => ({ location: m.location, size: 0.012, id: m.id })),
        arcs: arcs.map((a) => ({ from: a.from, to: a.to, id: a.id })),
        arcColor: DARK_RED_ARC_RGB,
        arcWidth: 0.5,
        arcHeight: 0.25,
        opacity: 0.7,
      });

      function animate() {
        // Reduced motion slows the spin to a quarter rather than freezing it: a calm
        // decorative globe that never moves reads as broken.
        if (!isPausedRef.current) phi += reducedMotion ? speed * 0.25 : speed;
        globe.update({
          phi: phi + phiOffsetRef.current + dragOffset.current.phi,
          theta: 0.2 + thetaOffsetRef.current + dragOffset.current.theta,
        });
        animationId = requestAnimationFrame(animate);
      }
      animate();
      setTimeout(() => canvas && (canvas.style.opacity = '1'));
    }

    if (canvas.offsetWidth > 0) {
      init();
    } else {
      const ro = new ResizeObserver((entries) => {
        if (entries[0]?.contentRect.width > 0) {
          ro.disconnect();
          init();
        }
      });
      ro.observe(canvas);
    }

    return () => {
      if (animationId) cancelAnimationFrame(animationId);
      if (globe) globe.destroy();
    };
  }, [markers, arcs, speed]);

  const pyramidFaceStyle = (nth) => {
    const transforms = [
      'rotateY(0deg) translateZ(4px) rotateX(19.5deg)',
      'rotateY(120deg) translateZ(4px) rotateX(19.5deg)',
      'rotateY(240deg) translateZ(4px) rotateX(19.5deg)',
      'rotateX(-90deg) rotateZ(60deg) translateY(4px)',
    ];
    // Dark crimson 3D tetrahedron faces
    const colors = ['#2a070b', '#4a080c', '#6b0f14', '#1a0507'];
    return {
      position: 'absolute',
      left: -0.5,
      top: 0,
      width: 0,
      height: 0,
      borderLeft: '6.5px solid transparent',
      borderRight: '6.5px solid transparent',
      borderBottom: `13px solid ${colors[nth]}`,
      transformOrigin: 'center bottom',
      transform: transforms[nth],
    };
  };

  return (
    <div className={`relative aspect-square select-none ${className}`}>
      <style>{`
        @keyframes pyramid-spin {
          0% { transform: rotateX(20deg) rotateY(0deg); }
          100% { transform: rotateX(20deg) rotateY(360deg); }
        }
      `}</style>
      {/* Subtle, sophisticated red atmospheric glow behind globe */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          width: '80%',
          height: '80%',
          background:
            'radial-gradient(circle, rgba(143, 17, 28, 0.14) 0%, rgba(90, 11, 18, 0.05) 50%, transparent 72%)',
          filter: 'blur(36px)',
        }}
      />
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        style={{
          width: '100%',
          height: '100%',
          cursor: 'grab',
          opacity: 0,
          transition: 'opacity 1.2s ease',
          // pan-y: a vertical swipe over the globe still scrolls the page (it sits in
          // the normal flow on mobile); a horizontal drag rotates it.
          touchAction: 'pan-y',
        }}
      />
      {showLabels && markers.map((m) => (
        <div
          key={m.id}
          style={{
            position: 'absolute',
            positionAnchor: `--cobe-${m.id}`,
            bottom: 'anchor(top)',
            left: 'anchor(center)',
            translate: '-50% 0',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
            pointerEvents: 'none',
            opacity: `var(--cobe-visible-${m.id}, 0)`,
            filter: `blur(calc((1 - var(--cobe-visible-${m.id}, 0)) * 8px))`,
            transition: 'opacity 0.3s, filter 0.3s',
          }}
        >
          <div
            style={{
              width: 12,
              height: 12,
              position: 'relative',
              transformStyle: 'preserve-3d',
              animation: 'pyramid-spin 4s linear infinite',
            }}
          >
            {[0, 1, 2, 3].map((n) => (
              <div key={n} style={pyramidFaceStyle(n)} />
            ))}
          </div>
          <span
            style={{
              fontFamily: 'monospace',
              fontSize: '0.55rem',
              fontWeight: 600,
              color: '#ffffff',
              background: '#0a0a0c',
              border: '1px solid rgba(255, 255, 255, 0.22)',
              padding: '2px 6px',
              borderRadius: 3,
              letterSpacing: '0.05em',
              whiteSpace: 'nowrap',
              boxShadow: '0 1px 4px rgba(0, 0, 0, 0.7), 0 0 6px rgba(255, 255, 255, 0.1)',
            }}
          >
            {m.region}
          </span>
        </div>
      ))}
      {showLabels && traffic.map((t) => (
        <div
          key={t.id}
          style={{
            position: 'absolute',
            positionAnchor: `--cobe-arc-${t.id}`,
            bottom: 'anchor(top)',
            left: 'anchor(center)',
            translate: '-50% 0',
            fontFamily: 'monospace',
            fontSize: '0.5rem',
            fontWeight: 600,
            color: '#ffffff',
            background: '#0a0a0c',
            border: '1px solid rgba(255, 255, 255, 0.18)',
            padding: '3px 8px',
            borderRadius: 4,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            opacity: `var(--cobe-visible-arc-${t.id}, 0)`,
            filter: `blur(calc((1 - var(--cobe-visible-arc-${t.id}, 0)) * 8px))`,
            transition: 'opacity 0.3s, filter 0.3s',
            boxShadow: '0 1px 4px rgba(0, 0, 0, 0.7), 0 0 6px rgba(255, 255, 255, 0.08)',
          }}
        >
          {t.value}k req/s
        </div>
      ))}
    </div>
  );
}

export default GlobeCdn;
