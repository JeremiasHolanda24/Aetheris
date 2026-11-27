import React, { useEffect, useImperativeHandle, useRef } from 'react';
import {
  CollectHudState,
  HorizonHudState,
  HudToastMessage,
  OffScreenIndicatorState,
  PoiHudMarkerState,
} from '../types/simulation';

export interface OffScreenHudHandle {
  updateIndicator: (indicator: OffScreenIndicatorState) => void;
  updatePoiMarkers: (markers: readonly PoiHudMarkerState[]) => void;
  updateCollectHud: (collect: CollectHudState) => void;
  updateHorizon: (horizon: HorizonHudState) => void;
  updateReentry: (intensity: number, hideGlow?: boolean) => void;
  flashHitmarker: (kind: 'beacon' | 'terrain') => void;
}

interface OffScreenHudProps {
  captureFlash: number | null;
  targetLocked: boolean;
  toast?: HudToastMessage | null;
}

const POI_SLOT_INDICES = [0, 1, 2] as const;

function getPoiGlyph(type: PoiHudMarkerState['type']): string {
  switch (type) {
    case 'crystal':
      return '◆';
    case 'wreck':
      return '▲';
    case 'ruin':
      return '❖';
  }
}

/**
 * Direct-DOM OffScreenIndicator + POI Markers + Collect Prompt + Centered Crosshair HUD:
 * Updates screen-edge arrows, on-screen reticles, collect bar, re-entry glow/banner,
 * and hitmarker flashes via refs without triggering React re-renders of the HUD tree.
 */
export const OffScreenHud = React.forwardRef<
  OffScreenHudHandle,
  OffScreenHudProps
>(({ captureFlash, targetLocked, toast = null }, ref) => {
  const offScreenWrapRef = useRef<HTMLDivElement | null>(null);
  const offScreenArrowRef = useRef<HTMLDivElement | null>(null);
  const offScreenPathRef = useRef<SVGPathElement | null>(null);
  const offScreenLabelRef = useRef<HTMLSpanElement | null>(null);

  const onScreenWrapRef = useRef<HTMLDivElement | null>(null);
  const onScreenBoxRef = useRef<HTMLDivElement | null>(null);
  const onScreenDotRef = useRef<HTMLDivElement | null>(null);
  const onScreenLabelRef = useRef<HTMLSpanElement | null>(null);

  const poiWrapRefs = useRef<Array<HTMLDivElement | null>>([null, null, null]);
  const poiGlyphRefs = useRef<Array<HTMLSpanElement | null>>([null, null, null]);
  const poiDistRefs = useRef<Array<HTMLSpanElement | null>>([null, null, null]);

  const collectWrapRef = useRef<HTMLDivElement | null>(null);
  const collectTextRef = useRef<HTMLSpanElement | null>(null);
  const collectBarRef = useRef<HTMLDivElement | null>(null);

  const hitmarkerRef = useRef<SVGSVGElement | null>(null);
  const hitTimerRef = useRef<number | null>(null);

  const horizonSvgRef = useRef<SVGSVGElement | null>(null);
  const horizonGlowRef = useRef<SVGPathElement | null>(null);
  const horizonCoreRef = useRef<SVGPathElement | null>(null);
  const horizonMaskRectRef = useRef<SVGRectElement | null>(null);
  const horizonXGradRef = useRef<SVGLinearGradientElement | null>(null);
  const horizonHoleRef = useRef<SVGRadialGradientElement | null>(null);
  const horizonHoleCircleRef = useRef<SVGCircleElement | null>(null);
  const lastHorizonWRef = useRef(0);
  const lastHorizonHRef = useRef(0);

  const reentryGlowRef = useRef<HTMLDivElement | null>(null);
  const reentryBannerRef = useRef<HTMLDivElement | null>(null);
  const lastReentryGlowVisibleRef = useRef(false);
  const lastReentryGlowOpacityRef = useRef('');
  const lastReentryBannerVisibleRef = useRef(false);

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

    updatePoiMarkers: (markers: readonly PoiHudMarkerState[]) => {
      for (let i = 0; i < 3; i++) {
        const wrap = poiWrapRefs.current[i];
        const glyph = poiGlyphRefs.current[i];
        const distEl = poiDistRefs.current[i];
        const m = markers[i];
        if (!wrap || !glyph || !distEl) continue;

        if (!m || !m.active) {
          wrap.style.display = 'none';
          continue;
        }

        wrap.style.display = 'flex';
        wrap.style.transform = `translate3d(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px, 0) translate(-50%, -50%)`;
        wrap.style.opacity = m.onScreen ? '0.94' : '0.78';
        glyph.textContent = getPoiGlyph(m.type);
        glyph.style.color = m.color;
        glyph.style.borderColor = m.color;
        distEl.textContent = `${Math.round(m.distance)}m`;
        distEl.style.color = m.color;
      }
    },

    updateCollectHud: (collect: CollectHudState) => {
      const wrap = collectWrapRef.current;
      const textEl = collectTextRef.current;
      const barEl = collectBarRef.current;
      if (!wrap || !textEl || !barEl) return;

      if (!collect.available) {
        wrap.style.display = 'none';
        return;
      }

      wrap.style.display = 'flex';
      if (collect.inventoryFull) {
        textEl.textContent = `${collect.label} · Mochila cheia (40/40)`;
        textEl.style.color = '#fbbf24';
      } else if (collect.collecting) {
        textEl.textContent = `Coletando ${collect.label}...`;
        textEl.style.color = '#7dd3fc';
      } else {
        textEl.textContent = `Segure [E] · Coletar ${collect.label}`;
        textEl.style.color = '#f1f5f9';
      }

      const pct = Math.round(Math.min(1, Math.max(0, collect.progress)) * 100);
      barEl.style.width = `${pct}%`;
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

    updateHorizon: (horizon: HorizonHudState) => {
      const svg = horizonSvgRef.current;
      const glow = horizonGlowRef.current;
      const core = horizonCoreRef.current;
      if (!svg || !glow || !core) return;

      if (!horizon.visible || !horizon.pathD || horizon.opacity <= 0.01) {
        svg.style.opacity = '0';
        return;
      }

      if (
        horizon.viewportW !== lastHorizonWRef.current ||
        horizon.viewportH !== lastHorizonHRef.current
      ) {
        const w = horizon.viewportW;
        const h = horizon.viewportH;
        lastHorizonWRef.current = w;
        lastHorizonHRef.current = h;

        const spanHalf = Math.min(w * 0.38, 380);
        const cx = w * 0.5;
        const cy = h * 0.5;

        horizonXGradRef.current?.setAttribute('x1', `${(cx - spanHalf).toFixed(1)}`);
        horizonXGradRef.current?.setAttribute('x2', `${(cx + spanHalf).toFixed(1)}`);
        horizonMaskRectRef.current?.setAttribute('width', `${w}`);
        horizonMaskRectRef.current?.setAttribute('height', `${h}`);
        horizonHoleRef.current?.setAttribute('cx', `${cx.toFixed(1)}`);
        horizonHoleRef.current?.setAttribute('cy', `${cy.toFixed(1)}`);
        horizonHoleCircleRef.current?.setAttribute('cx', `${cx.toFixed(1)}`);
        horizonHoleCircleRef.current?.setAttribute('cy', `${cy.toFixed(1)}`);
      }

      glow.setAttribute('d', horizon.pathD);
      glow.setAttribute('stroke', horizon.color);
      core.setAttribute('d', horizon.pathD);
      core.setAttribute('stroke', horizon.color);
      svg.style.opacity = horizon.opacity.toFixed(3);
    },

    updateReentry: (intensity: number, hideGlow = false) => {
      const glowEl = reentryGlowRef.current;
      if (glowEl) {
        const showGlow = !hideGlow && intensity >= 0.08;
        if (showGlow) {
          if (!lastReentryGlowVisibleRef.current) {
            glowEl.style.display = 'block';
            lastReentryGlowVisibleRef.current = true;
          }
          const nextOpacity = Math.min(0.65, intensity * 0.72).toFixed(3);
          if (nextOpacity !== lastReentryGlowOpacityRef.current) {
            glowEl.style.opacity = nextOpacity;
            lastReentryGlowOpacityRef.current = nextOpacity;
          }
        } else if (lastReentryGlowVisibleRef.current) {
          glowEl.style.display = 'none';
          glowEl.style.opacity = '0';
          lastReentryGlowVisibleRef.current = false;
          lastReentryGlowOpacityRef.current = '0';
        }
      }

      const bannerEl = reentryBannerRef.current;
      if (bannerEl) {
        const showBanner = intensity > 0.2;
        if (showBanner !== lastReentryBannerVisibleRef.current) {
          bannerEl.style.visibility = showBanner ? 'visible' : 'hidden';
          lastReentryBannerVisibleRef.current = showBanner;
        }
      }
    },
  }));

  const toastStyles =
    toast?.tone === 'danger'
      ? 'bg-[#1a090d]/95 border-rose-400/60 text-rose-200'
      : toast?.tone === 'warn'
        ? 'bg-[#161006]/95 border-amber-400/55 text-amber-200'
        : toast?.tone === 'success'
          ? 'bg-[#071610]/95 border-emerald-400/55 text-emerald-200'
          : 'bg-[#090c16]/95 border-sky-400/45 text-sky-200';

  return (
    <div className="pointer-events-none fixed inset-0 z-10 overflow-hidden">
      {/* Cheap Always-Mounted Atmospheric Re-Entry Edge Heat Glow */}
      <div
        ref={reentryGlowRef}
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none"
        style={{
          display: 'none',
          opacity: 0,
          willChange: 'opacity',
          background:
            'radial-gradient(ellipse at center, transparent 55%, rgba(249,115,22,0.55) 85%, rgba(192,38,211,0.4) 100%)',
        }}
      />

      {/* Subtle Glowing Curvature Horizon Line */}
      <svg
        ref={horizonSvgRef}
        aria-hidden="true"
        className="fixed inset-0 w-full h-full pointer-events-none"
        style={{ opacity: 0 }}
      >
        <defs>
          <linearGradient
            ref={horizonXGradRef}
            id="hud-horizon-xgrad"
            gradientUnits="userSpaceOnUse"
            x1="150"
            y1="0"
            x2="850"
            y2="0"
          >
            <stop offset="0%" stopColor="black" />
            <stop offset="18%" stopColor="white" />
            <stop offset="82%" stopColor="white" />
            <stop offset="100%" stopColor="black" />
          </linearGradient>
          <radialGradient
            ref={horizonHoleRef}
            id="hud-horizon-hole"
            gradientUnits="userSpaceOnUse"
            cx="500"
            cy="500"
            r="46"
          >
            <stop offset="0%" stopColor="black" stopOpacity="1" />
            <stop offset="62%" stopColor="black" stopOpacity="1" />
            <stop offset="100%" stopColor="black" stopOpacity="0" />
          </radialGradient>
          <mask id="hud-horizon-mask" maskUnits="userSpaceOnUse">
            <rect
              ref={horizonMaskRectRef}
              x="0"
              y="0"
              width="1000"
              height="1000"
              fill="url(#hud-horizon-xgrad)"
            />
            <circle
              ref={horizonHoleCircleRef}
              cx="500"
              cy="500"
              r="46"
              fill="url(#hud-horizon-hole)"
            />
          </mask>
        </defs>
        <g mask="url(#hud-horizon-mask)">
          <path
            ref={horizonGlowRef}
            fill="none"
            stroke="#38bdf8"
            strokeWidth="6"
            strokeOpacity="0.22"
            strokeLinecap="round"
          />
          <path
            ref={horizonCoreRef}
            fill="none"
            stroke="#38bdf8"
            strokeWidth="1.35"
            strokeOpacity="0.82"
            strokeLinecap="round"
          />
        </g>
      </svg>

      {/* Up to 3 Nearest POI Markers (<= 400m) */}
      {POI_SLOT_INDICES.map((slot) => (
        <div
          key={slot}
          ref={(el) => {
            poiWrapRefs.current[slot] = el;
          }}
          style={{ display: 'none' }}
          className="absolute left-0 top-0 flex-col items-center pointer-events-none"
        >
          <span
            ref={(el) => {
              poiGlyphRefs.current[slot] = el;
            }}
            className="w-5 h-5 rounded border bg-[#05050d]/80 flex items-center justify-center text-[10px] leading-none font-bold"
          >
            ◆
          </span>
          <span
            ref={(el) => {
              poiDistRefs.current[slot] = el;
            }}
            className="mt-0.5 px-1 py-0.5 text-[10px] font-medium leading-none font-mono-tabular bg-[#05050d]/80 rounded"
          >
            0m
          </span>
        </div>
      ))}

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
            <path
              d="M15 9H9V15M33 9H39V15M15 39H9V33M33 39H39V33"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.75"
            />
            <line x1="24" y1="12" x2="24" y2="19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="24" y1="29" x2="24" y2="36" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="12" y1="24" x2="19" y2="24" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="29" y1="24" x2="36" y2="24" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="24" cy="24" r="1.6" fill="#facc15" />
          </svg>

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

      {/* Off-Screen Arrow Indicator (Beacon) */}
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

      {/* On-Screen Target Reticle (Beacon) */}
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

      {/* Contextual On-Foot Collect Prompt + Progress Bar (direct-DOM) */}
      <div
        ref={collectWrapRef}
        style={{ display: 'none' }}
        className="fixed bottom-24 sm:bottom-16 left-1/2 -translate-x-1/2 flex-col items-center gap-1.5 px-3.5 py-2 bg-[#090c16]/92 border border-white/15 rounded-lg min-w-[220px] max-w-[90vw]"
      >
        <span
          ref={collectTextRef}
          className="text-xs font-medium text-slate-100 whitespace-nowrap"
        >
          Segure [E] · Coletar
        </span>
        <div className="w-full h-1.5 rounded-sm bg-slate-800 overflow-hidden">
          <div
            ref={collectBarRef}
            className="h-full bg-cyan-400"
            style={{ width: '0%' }}
          />
        </div>
      </div>

      {/* Atmospheric Re-Entry Banner */}
      <div
        ref={reentryBannerRef}
        style={{ visibility: 'hidden' }}
        className="absolute top-22 left-1/2 -translate-x-1/2 px-3.5 py-1 bg-[#160b09]/90 border border-orange-400/60 rounded-lg text-center"
      >
        <div className="text-[11px] font-semibold text-orange-300 font-display tracking-wider uppercase whitespace-nowrap">
          Entrada Atmosférica · Blindagem Térmica Ativa
        </div>
      </div>

      {/* Waypoint Captured Banner */}
      {captureFlash !== null && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 px-4 py-1.5 bg-[#0b0f1c]/95 border border-amber-400/50 rounded-lg text-center">
          <div className="text-xs font-medium text-amber-300 font-display tracking-wide whitespace-nowrap">
            Alvo #{captureFlash} Capturado · Próximo Beacon Travado
          </div>
        </div>
      )}

      {/* Economy / Hull / Fuel Alert Toast Banner */}
      {toast && (
        <div
          className={`absolute top-28 left-1/2 -translate-x-1/2 px-4 py-1.5 border rounded-lg text-center max-w-[92vw] ${toastStyles}`}
        >
          <div className="text-xs font-medium font-display tracking-wide whitespace-nowrap truncate">
            {toast.text}
          </div>
        </div>
      )}
    </div>
  );
});

OffScreenHud.displayName = 'OffScreenHud';
