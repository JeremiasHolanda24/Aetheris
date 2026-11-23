import React, { useEffect, useImperativeHandle, useRef } from 'react';
import { OffScreenIndicatorState } from '../types/simulation';

export interface OffScreenHudHandle {
  updateIndicator: (indicator: OffScreenIndicatorState) => void;
  flashHitmarker: (kind: 'beacon' | 'terrain') => void;
}

interface OffScreenHudProps {
  captureFlash: number | null;
  targetLocked: boolean;
  reentryIntensity: number;
}

/**
 * Direct-DOM OffScreenIndicator + Centered Crosshair HUD:
 * Updates screen-edge arrow, on-screen reticle, and hitmarker flashes via refs
 * without triggering React re-renders of the HUD tree.
 */
export const OffScreenHud = React.forwardRef<
  OffScreenHudHandle,
  OffScreenHudProps
>(({ captureFlash, targetLocked, reentryIntensity }, ref) => {
  const offScreenWrapRef = useRef<HTMLDivElement | null>(null);
  const offScreenArrowRef = useRef<HTMLDivElement | null>(null);
  const offScreenPathRef = useRef<SVGPathElement | null>(null);
  const offScreenLabelRef = useRef<HTMLSpanElement | null>(null);

  const onScreenWrapRef = useRef<HTMLDivElement | null>(null);
  const onScreenBoxRef = useRef<HTMLDivElement | null>(null);
  const onScreenDotRef = useRef<HTMLDivElement | null>(null);
  const onScreenLabelRef = useRef<HTMLSpanElement | null>(null);

  const hitmarkerRef = useRef<SVGSVGElement | null>(null);
  const hitTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (hitTimerRef.current !== null) {
        window.clearTimeout(hitTimerRef.current);
      }
    };
  }, []);

  useImperativeHandle(ref, () => ({
    updateIndicator: (ind: OffScreenIndicatorState) => {
      if (!ind.active) {
        if (offScreenWrapRef.current) offScreenWrapRef.current.style.display = 'none';
        if (onScreenWrapRef.current) onScreenWrapRef.current.style.display = 'none';
        return;
      }

      const distText = `${Math.round(ind.distance)}m`;

      if (!ind.onScreen) {
        if (offScreenWrapRef.current) {
          offScreenWrapRef.current.style.display = 'flex';
          offScreenWrapRef.current.style.transform = `translate3d(${ind.x}px, ${ind.y}px, 0) translate(-50%, -50%)`;
        }
        if (offScreenArrowRef.current) {
          offScreenArrowRef.current.style.transform = `rotate(${ind.angleDeg}deg)`;
        }
        if (offScreenPathRef.current) {
          offScreenPathRef.current.setAttribute('fill', ind.color);
        }
        if (offScreenLabelRef.current) {
          offScreenLabelRef.current.style.color = ind.color;
          offScreenLabelRef.current.textContent = distText;
        }
        if (onScreenWrapRef.current) {
          onScreenWrapRef.current.style.display = 'none';
        }
      } else {
        if (offScreenWrapRef.current) {
          offScreenWrapRef.current.style.display = 'none';
        }
        if (onScreenWrapRef.current) {
          onScreenWrapRef.current.style.display = 'flex';
          onScreenWrapRef.current.style.transform = `translate3d(${ind.x}px, ${ind.y}px, 0) translate(-50%, -50%)`;
        }
        if (onScreenBoxRef.current) {
          onScreenBoxRef.current.style.borderColor = ind.color;
        }
        if (onScreenDotRef.current) {
          onScreenDotRef.current.style.backgroundColor = ind.color;
        }
        if (onScreenLabelRef.current) {
          onScreenLabelRef.current.style.color = ind.color;
          onScreenLabelRef.current.textContent = distText;
        }
      }
    },

    flashHitmarker: (kind: 'beacon' | 'terrain') => {
      const el = hitmarkerRef.current;
      if (!el) return;
      el.style.color = kind === 'beacon' ? '#facc15' : '#38bdf8';
      el.style.opacity = '1';
      el.style.transform = 'scale(1.12)';

      if (hitTimerRef.current !== null) {
        window.clearTimeout(hitTimerRef.current);
      }
      hitTimerRef.current = window.setTimeout(() => {
        if (hitmarkerRef.current) {
          hitmarkerRef.current.style.opacity = '0';
          hitmarkerRef.current.style.transform = 'scale(0.85)';
        }
      }, 150);
    },
  }));

  const showReentry = reentryIntensity > 0.2;

  return (
    <div className="pointer-events-none fixed inset-0 z-10 overflow-hidden">
      {/* Subtle Atmospheric Re-Entry Edge Heat Glow */}
      {reentryIntensity > 0.08 && (
        <div
          aria-hidden="true"
          className="fixed inset-0 pointer-events-none transition-opacity duration-150"
          style={{
            opacity: Math.min(0.65, reentryIntensity * 0.72),
            boxShadow:
              'inset 0 0 90px rgba(249, 115, 22, 0.55), inset 0 0 36px rgba(192, 38, 211, 0.4)',
          }}
        />
      )}

      {/* Centered Combat Crosshair (Mira Centralizada) */}
      <div
        aria-hidden="true"
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center justify-center"
      >
        <div className="relative flex items-center justify-center">
          {targetLocked && (
            <div className="absolute w-11 h-11 border border-amber-400/80 rotate-45 pointer-events-none" />
          )}
          <svg
            width="48"
            height="48"
            viewBox="0 0 48 48"
            fill="none"
            className={`${
              targetLocked ? 'text-amber-300' : 'text-sky-300/85'
            } drop-shadow-[0_0_4px_rgba(5,5,13,0.9)] transition-colors duration-150`}
          >
            {/* Outer aerospace corner ticks */}
            <path
              d="M15 9H9V15M33 9H39V15M15 39H9V33M33 39H39V33"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.75"
            />
            {/* Short cross-hairs leaving a crisp central sightline */}
            <line x1="24" y1="12" x2="24" y2="19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="24" y1="29" x2="24" y2="36" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="12" y1="24" x2="19" y2="24" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="29" y1="24" x2="36" y2="24" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            {/* Center precision pip */}
            <circle cx="24" cy="24" r="1.6" fill="#facc15" />
          </svg>

          {/* Impact Hitmarker Flash */}
          <svg
            ref={hitmarkerRef}
            width="36"
            height="36"
            viewBox="0 0 36 36"
            fill="none"
            style={{ opacity: 0, transition: 'opacity 90ms ease, transform 90ms ease' }}
            className="absolute"
          >
            <path
              d="M8 8L14 14M28 8L22 14M8 28L14 22M28 28L22 22"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </svg>
        </div>

        {targetLocked && (
          <span className="mt-1 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider uppercase font-mono-tabular bg-[#090c16]/85 text-amber-300 border border-amber-400/45 rounded">
            Alvo Travado
          </span>
        )}
      </div>

      {/* Off-Screen Arrow Indicator */}
      <div
        ref={offScreenWrapRef}
        className="absolute left-0 top-0 flex-col items-center hidden"
      >
        <div ref={offScreenArrowRef}>
          <svg
            width="28"
            height="28"
            viewBox="0 0 28 28"
            fill="none"
            aria-hidden="true"
          >
            <path
              ref={offScreenPathRef}
              d="M14 2L24 23L14 18.2L4 23L14 2Z"
              fill="#facc15"
              stroke="#05050d"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <span
          ref={offScreenLabelRef}
          className="mt-1 px-1.5 py-0.5 text-[11px] font-medium leading-none font-mono-tabular bg-[#05050d]/85 border border-white/15 rounded"
        >
          0m
        </span>
      </div>

      {/* On-Screen Target Reticle */}
      <div
        ref={onScreenWrapRef}
        className="absolute left-0 top-0 flex-col items-center hidden"
      >
        <div
          ref={onScreenBoxRef}
          className="w-7 h-7 border rotate-45 flex items-center justify-center"
        >
          <div ref={onScreenDotRef} className="w-1.5 h-1.5" />
        </div>
        <span
          ref={onScreenLabelRef}
          className="mt-2 px-1.5 py-0.5 text-[11px] font-medium leading-none font-mono-tabular bg-[#05050d]/80 rounded"
        >
          0m
        </span>
      </div>

      {/* Atmospheric Re-Entry Banner */}
      {showReentry && (
        <div className="absolute top-22 left-1/2 -translate-x-1/2 px-3.5 py-1 bg-[#160b09]/90 border border-orange-400/60 rounded-lg text-center">
          <div className="text-[11px] font-semibold text-orange-300 font-display tracking-wider uppercase whitespace-nowrap">
            Entrada Atmosférica · Blindagem Térmica Ativa
          </div>
        </div>
      )}

      {/* Waypoint Captured Banner */}
      {captureFlash !== null && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 px-4 py-1.5 bg-[#0b0f1c]/95 border border-amber-400/50 rounded-lg text-center">
          <div className="text-xs font-medium text-amber-300 font-display tracking-wide whitespace-nowrap">
            Alvo #{captureFlash} Capturado · Próximo Beacon Travado
          </div>
        </div>
      )}
    </div>
  );
});

OffScreenHud.displayName = 'OffScreenHud';
