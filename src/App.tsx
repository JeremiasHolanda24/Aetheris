import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ControlDock, TelemetryHeader } from './components/ControlOverlay';
import { MobileControls } from './components/MobileControls';
import { OffScreenHud, OffScreenHudHandle } from './components/OffScreenHud';
import { FlightEngine, VirtualInputs } from './engine/FlightEngine';
import {
  DEFAULT_CONFIG,
  SimulationConfig,
  TelemetrySnapshot,
} from './types/simulation';

const INITIAL_TELEMETRY: TelemetrySnapshot = {
  speed: 0,
  altitude: 10,
  headingDeg: 0,
  inSpace: false,
  atmospherePct: 100,
  planetPatches: 24,
  targetDistance: 90,
  targetZone: 'surface',
  waypointsCaptured: 0,
  targetLocked: false,
  reentryIntensity: 0,
  isThrusting: false,
  isBoosting: false,
  indicator: {
    active: false,
    onScreen: false,
    x: 0,
    y: 0,
    angleDeg: 0,
    distance: 90,
    color: '#ef4444',
  },
};

function detectTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(pointer: coarse)').matches ||
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0
  );
}

function createInitialConfig(isTouch: boolean): SimulationConfig {
  const base = structuredClone(DEFAULT_CONFIG);
  if (isTouch) {
    base.backdrop.starCount = 900;
  }
  return base;
}

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<FlightEngine | null>(null);
  const hudRef = useRef<OffScreenHudHandle | null>(null);
  const captureTimerRef = useRef<number | null>(null);

  const initialTouch = useMemo(() => detectTouchDevice(), []);

  const [isTouchDevice, setIsTouchDevice] = useState<boolean>(initialTouch);
  const [isPortraitMobile, setIsPortraitMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return initialTouch && window.innerHeight > window.innerWidth;
  });
  const [portraitDismissed, setPortraitDismissed] = useState(false);

  const [config, setConfig] = useState<SimulationConfig>(() =>
    createInitialConfig(initialTouch),
  );
  const [telemetry, setTelemetry] =
    useState<TelemetrySnapshot>(INITIAL_TELEMETRY);

  // Settings drawer starts closed so the viewport is clean; opened via Gear icon (or H)
  const [dockOpen, setDockOpen] = useState<boolean>(false);
  const [activeSliderId, setActiveSliderId] = useState<string | null>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [targetLocked, setTargetLocked] = useState(false);
  const [captureFlash, setCaptureFlash] = useState<number | null>(null);
  const [contextLost, setContextLost] = useState(false);

  useEffect(() => {
    const syncViewportState = () => {
      const touch = detectTouchDevice();
      setIsTouchDevice(touch);
      const portrait = window.innerHeight > window.innerWidth;
      setIsPortraitMobile(touch && portrait);
      if (!portrait) {
        setPortraitDismissed(false);
      }
    };

    const syncFullscreen = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    window.addEventListener('resize', syncViewportState);
    window.addEventListener('orientationchange', syncViewportState);
    document.addEventListener('fullscreenchange', syncFullscreen);

    return () => {
      window.removeEventListener('resize', syncViewportState);
      window.removeEventListener('orientationchange', syncViewportState);
      document.removeEventListener('fullscreenchange', syncFullscreen);
    };
  }, []);

  useEffect(() => {
    const mountEl = canvasMountRef.current;
    if (!mountEl) return;

    const initialCfg = createInitialConfig(detectTouchDevice());
    const engine = new FlightEngine(mountEl, initialCfg, {
      onTelemetry: (snap) => setTelemetry(snap),
      onIndicatorFrame: (ind) => hudRef.current?.updateIndicator(ind),
      onHitmarker: (kind) => hudRef.current?.flashHitmarker(kind),
      onWaypointCaptured: (count) => {
        setCaptureFlash(count);
        if (captureTimerRef.current !== null) {
          window.clearTimeout(captureTimerRef.current);
        }
        captureTimerRef.current = window.setTimeout(() => {
          setCaptureFlash(null);
        }, 2400);
      },
      onContextLostChange: (lost) => setContextLost(lost),
    });

    engineRef.current = engine;

    return () => {
      if (captureTimerRef.current !== null) {
        window.clearTimeout(captureTimerRef.current);
      }
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.updateConfig(config);
  }, [config]);

  const handleToggleTargetLock = useCallback(() => {
    setTargetLocked((prev) => {
      const next = !prev;
      engineRef.current?.setTargetLocked(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return;
      }
      if (e.code === 'KeyH') {
        setDockOpen((prev) => !prev);
      } else if (e.code === 'KeyT') {
        handleToggleTargetLock();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleToggleTargetLock]);

  const handleRequestLandscapeFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
      const orientation = screen.orientation as ScreenOrientation & {
        lock?: (mode: string) => Promise<void>;
      };
      if (orientation && typeof orientation.lock === 'function') {
        await orientation.lock('landscape');
      }
    } catch {
      // Orientation lock or fullscreen may be restricted in iOS Safari / embedded iframe
    } finally {
      setPortraitDismissed(true);
    }
  }, []);

  const handleToggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        const orientation = screen.orientation as ScreenOrientation & {
          unlock?: () => void;
        };
        if (orientation && typeof orientation.unlock === 'function') {
          orientation.unlock();
        }
        await document.exitFullscreen();
      } else {
        await handleRequestLandscapeFullscreen();
      }
    } catch {
      // Graceful no-op
    }
  }, [handleRequestLandscapeFullscreen]);

  const handleUpdateConfig = useCallback(
    (updater: (prev: SimulationConfig) => SimulationConfig) => {
      setConfig((prev) => updater(prev));
    },
    [],
  );

  const handleToggleDock = useCallback(() => {
    setDockOpen((prev) => !prev);
  }, []);

  const handleCloseDock = useCallback(() => {
    setDockOpen(false);
    setActiveSliderId(null);
  }, []);

  const handleDismissPortrait = useCallback(() => {
    setPortraitDismissed(true);
  }, []);

  const handleLandSurface = useCallback(() => {
    engineRef.current?.landOnSurface();
  }, []);

  const handleLaunchOrbit = useCallback(() => {
    engineRef.current?.launchToOrbit();
  }, []);

  const handleRelocateTarget = useCallback(() => {
    engineRef.current?.relocateTarget('alternate');
  }, []);

  const handleResetDefaults = useCallback(() => {
    setConfig(createInitialConfig(detectTouchDevice()));
  }, []);

  const handleVirtualInput = useCallback((inputs: VirtualInputs) => {
    engineRef.current?.setVirtualInputs(inputs);
  }, []);

  const isDraggingSlider = activeSliderId !== null;

  return (
    <main className="relative w-screen h-[100dvh] overflow-hidden bg-[#05050d]">
      <div
        ref={canvasMountRef}
        className="w-full h-full"
        aria-label="3D Flight Simulation Viewport"
      />

      {contextLost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#05050d]/95 p-6">
          <div className="max-w-md border border-white/15 bg-[#090c16] rounded-xl p-6 text-center">
            <h2 className="font-display text-lg font-semibold text-slate-100">
              Graphics Context Suspended
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              WebGL rendering was interrupted by the browser. Waiting for automatic
              restoration or reload the viewport to resume flight.
            </p>
          </div>
        </div>
      )}

      <OffScreenHud
        ref={hudRef}
        captureFlash={captureFlash}
        targetLocked={targetLocked}
        reentryIntensity={telemetry.reentryIntensity}
      />

      {/* Mobile touch controls stay active on touch devices without needing a disable button */}
      <div
        className={`transition-opacity duration-150 ${
          isDraggingSlider ? 'opacity-20 pointer-events-none' : 'opacity-100'
        }`}
      >
        <MobileControls
          visible={isTouchDevice}
          targetLocked={targetLocked}
          isPortraitMobile={isPortraitMobile && isTouchDevice}
          portraitDismissed={portraitDismissed}
          onDismissPortrait={handleDismissPortrait}
          onRequestLandscapeFullscreen={handleRequestLandscapeFullscreen}
          onToggleTargetLock={handleToggleTargetLock}
          onVirtualInputChange={handleVirtualInput}
        />
      </div>

      <TelemetryHeader
        telemetry={telemetry}
        dockOpen={dockOpen}
        isFullscreen={isFullscreen}
        isTouchDevice={isTouchDevice}
        targetLocked={targetLocked}
        dimmed={isDraggingSlider}
        onToggleDock={handleToggleDock}
        onToggleFullscreen={handleToggleFullscreen}
        onToggleTargetLock={handleToggleTargetLock}
      />

      <ControlDock
        config={config}
        dockOpen={dockOpen}
        activeSliderId={activeSliderId}
        onActiveSliderChange={setActiveSliderId}
        onCloseDock={handleCloseDock}
        onUpdateConfig={handleUpdateConfig}
        onLandSurface={handleLandSurface}
        onLaunchOrbit={handleLaunchOrbit}
        onRelocateTarget={handleRelocateTarget}
        onResetDefaults={handleResetDefaults}
      />
    </main>
  );
}
