import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ControlDock, TelemetryHeader } from './components/ControlOverlay';
import { MobileControls } from './components/MobileControls';
import { OffScreenHud, OffScreenHudHandle } from './components/OffScreenHud';
import { FlightEngine, VirtualInputs } from './engine/FlightEngine';
import {
  CameraMode,
  DEFAULT_CONFIG,
  SimulationConfig,
  TelemetrySnapshot,
} from './types/simulation';

const STORAGE_KEY = 'aetheris.config.v2';
const LEGACY_STORAGE_KEY = 'aetheris.config.v1';
const SAVE_DEBOUNCE_MS = 300;

interface LoadedSettings {
  config: SimulationConfig;
  muted: boolean;
  autoQuality: boolean;
}

const INITIAL_TELEMETRY: TelemetrySnapshot = {
  speed: 0,
  altitude: 10,
  headingDeg: 0,
  inSpace: false,
  atmospherePct: 100,
  biome: '',
  planetPatches: 96,
  targetDistance: 90,
  targetZone: 'surface',
  waypointsCaptured: 0,
  targetLocked: false,
  reentryIntensity: 0,
  isThrusting: false,
  isBoosting: false,
  qualityLevel: 0,
  landingState: 'flying',
  canLand: false,
  landHint: '',
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isCameraMode(value: unknown): value is CameraMode {
  return (
    value === 'chase' ||
    value === 'tactical' ||
    value === 'cockpit' ||
    value === 'orbit'
  );
}

function readStoredSettingsRaw(): Record<string, unknown> | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    if (window.localStorage.getItem(LEGACY_STORAGE_KEY) !== null) {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function createDefaultConfig(isTouch: boolean): SimulationConfig {
  const base = structuredClone(DEFAULT_CONFIG);
  if (isTouch) {
    base.backdrop.starCount = 900;
  }
  return base;
}

function createInitialConfig(isTouch: boolean): SimulationConfig {
  const base = structuredClone(DEFAULT_CONFIG);
  const stored = readStoredSettingsRaw();
  const rawConfig = stored
    ? isRecord(stored.config)
      ? stored.config
      : stored
    : null;

  let hasSavedStarCount = false;

  if (rawConfig) {
    if (isRecord(rawConfig.ship)) {
      const s = rawConfig.ship;
      if (isFiniteNum(s.rotationSpeed)) base.ship.rotationSpeed = s.rotationSpeed;
      if (isFiniteNum(s.thrustForce)) base.ship.thrustForce = s.thrustForce;
      if (isFiniteNum(s.maxSpeed)) base.ship.maxSpeed = s.maxSpeed;
      if (isFiniteNum(s.drag)) base.ship.drag = s.drag;
      if (typeof s.invertPitch === 'boolean') base.ship.invertPitch = s.invertPitch;
    }

    if (isRecord(rawConfig.planet)) {
      const p = rawConfig.planet;
      if (isFiniteNum(p.planetRadius)) base.planet.planetRadius = p.planetRadius;
      if (isFiniteNum(p.maxHeight)) base.planet.maxHeight = p.maxHeight;
      if (isFiniteNum(p.noiseScale)) base.planet.noiseScale = p.noiseScale;
      if (isFiniteNum(p.atmosphereHeight)) {
        base.planet.atmosphereHeight = p.atmosphereHeight;
      }
      if (isFiniteNum(p.seaLevel)) base.planet.seaLevel = p.seaLevel;
      if (typeof p.wireframe === 'boolean') base.planet.wireframe = p.wireframe;
      if (typeof p.showContours === 'boolean') base.planet.showContours = p.showContours;
    }

    if (isRecord(rawConfig.backdrop)) {
      const b = rawConfig.backdrop;
      if (isFiniteNum(b.starCount)) {
        base.backdrop.starCount = b.starCount;
        hasSavedStarCount = true;
      }
      if (isFiniteNum(b.minStarSize)) base.backdrop.minStarSize = b.minStarSize;
      if (isFiniteNum(b.maxStarSize)) base.backdrop.maxStarSize = b.maxStarSize;
      if (isFiniteNum(b.nebulaOpacity)) base.backdrop.nebulaOpacity = b.nebulaOpacity;
      if (isFiniteNum(b.indicatorMargin)) {
        base.backdrop.indicatorMargin = b.indicatorMargin;
      }
    }

    if (isCameraMode(rawConfig.cameraMode)) {
      base.cameraMode = rawConfig.cameraMode;
    }
  }

  if (isTouch && !hasSavedStarCount) {
    base.backdrop.starCount = 900;
  }

  return base;
}

function loadInitialSettings(isTouch: boolean): LoadedSettings {
  const stored = readStoredSettingsRaw();
  return {
    config: createInitialConfig(isTouch),
    muted: stored && typeof stored.muted === 'boolean' ? stored.muted : false,
    autoQuality:
      stored && typeof stored.autoQuality === 'boolean' ? stored.autoQuality : true,
  };
}

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<FlightEngine | null>(null);
  const hudRef = useRef<OffScreenHudHandle | null>(null);
  const captureTimerRef = useRef<number | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const isFirstSaveEffectRef = useRef(true);
  const skipNextSaveRef = useRef(false);

  const initialTouch = useMemo(() => detectTouchDevice(), []);
  const initialSettings = useMemo(
    () => loadInitialSettings(initialTouch),
    [initialTouch],
  );

  const [isTouchDevice, setIsTouchDevice] = useState<boolean>(initialTouch);
  const [isPortraitMobile, setIsPortraitMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return initialTouch && window.innerHeight > window.innerWidth;
  });
  const [portraitDismissed, setPortraitDismissed] = useState(false);

  const [config, setConfig] = useState<SimulationConfig>(initialSettings.config);
  const [telemetry, setTelemetry] =
    useState<TelemetrySnapshot>(INITIAL_TELEMETRY);

  // Settings drawer starts closed so the viewport is clean; opened via Gear icon (or H)
  const [dockOpen, setDockOpen] = useState<boolean>(false);
  const [activeSliderId, setActiveSliderId] = useState<string | null>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [targetLocked, setTargetLocked] = useState(false);
  const [isMuted, setIsMuted] = useState(initialSettings.muted);
  const [autoQuality, setAutoQuality] = useState(initialSettings.autoQuality);
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

    const engine = new FlightEngine(mountEl, initialSettings.config, {
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

    engine.setMuted(initialSettings.muted);
    engine.setAutoQuality(initialSettings.autoQuality);
    engineRef.current = engine;

    return () => {
      if (captureTimerRef.current !== null) {
        window.clearTimeout(captureTimerRef.current);
      }
      engine.dispose();
      engineRef.current = null;
    };
  }, [initialSettings]);

  useEffect(() => {
    engineRef.current?.updateConfig(config);
  }, [config]);

  useEffect(() => {
    engineRef.current?.setAutoQuality(autoQuality);
  }, [autoQuality]);

  useEffect(() => {
    engineRef.current?.setSliderDragging(activeSliderId !== null);
  }, [activeSliderId]);

  useEffect(() => {
    if (isFirstSaveEffectRef.current) {
      isFirstSaveEffectRef.current = false;
      return;
    }
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ config, muted: isMuted, autoQuality }),
          );
        }
      } catch {
        // Ignore storage quota or private browsing errors
      }
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [config, isMuted, autoQuality]);

  const handleToggleTargetLock = useCallback(() => {
    setTargetLocked((prev) => {
      const next = !prev;
      engineRef.current?.setTargetLocked(next);
      return next;
    });
  }, []);

  const handleToggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      engineRef.current?.setMuted(next);
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
      } else if (e.code === 'KeyM') {
        handleToggleMute();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleToggleTargetLock, handleToggleMute]);

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
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Ignore storage errors
    }
    skipNextSaveRef.current = true;
    setConfig(createDefaultConfig(detectTouchDevice()));
    setIsMuted(false);
    engineRef.current?.setMuted(false);
    setAutoQuality(true);
    engineRef.current?.setAutoQuality(true);
  }, []);

  const handleToggleAutoQuality = useCallback(() => {
    setAutoQuality((prev) => !prev);
  }, []);

  const handleVirtualInput = useCallback((inputs: VirtualInputs) => {
    engineRef.current?.setVirtualInputs(inputs);
  }, []);

  const handleToggleLanding = useCallback(() => {
    engineRef.current?.toggleLanding();
  }, []);

  const isDraggingSlider = activeSliderId !== null;

  let landingNoticeText = '';
  let landingNoticeTone = 'text-slate-300 border-white/10';
  if (telemetry.landingState === 'flying') {
    if (telemetry.canLand) {
      landingNoticeText = isTouchDevice ? 'Toque em POUSAR / DECOLAR' : '[L] Pousar';
      landingNoticeTone = 'text-emerald-300 border-emerald-400/40';
    } else if (telemetry.altitude < 80 && telemetry.landHint) {
      landingNoticeText = telemetry.landHint;
      landingNoticeTone = 'text-slate-300 border-white/10';
    }
  } else if (telemetry.landingState === 'landing') {
    landingNoticeText = isTouchDevice
      ? 'Pousando… Toque em POUSAR / DECOLAR'
      : 'Pousando… [L] Cancelar';
    landingNoticeTone = 'text-amber-300 border-amber-400/40';
  } else if (telemetry.landingState === 'landed') {
    landingNoticeText = isTouchDevice
      ? 'Pousado · Toque em POUSAR / DECOLAR'
      : 'Pousado · [L] Decolar';
    landingNoticeTone = 'text-sky-300 border-sky-400/35';
  } else if (telemetry.landingState === 'takeoff') {
    landingNoticeText = 'Decolando…';
    landingNoticeTone = 'text-sky-300 border-sky-400/35';
  }

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
          landingState={telemetry.landingState}
          canLand={telemetry.canLand}
          isPortraitMobile={isPortraitMobile && isTouchDevice}
          portraitDismissed={portraitDismissed}
          onDismissPortrait={handleDismissPortrait}
          onRequestLandscapeFullscreen={handleRequestLandscapeFullscreen}
          onToggleTargetLock={handleToggleTargetLock}
          onToggleLanding={handleToggleLanding}
          onVirtualInputChange={handleVirtualInput}
        />
      </div>

      {!dockOpen && landingNoticeText && (
        <div
          className={`pointer-events-none fixed bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 z-20 px-3 py-1 bg-[#090c16]/85 border rounded-lg text-xs font-medium font-mono-tabular whitespace-nowrap transition-opacity duration-150 ${
            isDraggingSlider ? 'opacity-15' : 'opacity-100'
          } ${landingNoticeTone}`}
        >
          {landingNoticeText}
        </div>
      )}

      <TelemetryHeader
        telemetry={telemetry}
        dockOpen={dockOpen}
        isFullscreen={isFullscreen}
        isTouchDevice={isTouchDevice}
        targetLocked={targetLocked}
        isMuted={isMuted}
        dimmed={isDraggingSlider}
        onToggleDock={handleToggleDock}
        onToggleFullscreen={handleToggleFullscreen}
        onToggleTargetLock={handleToggleTargetLock}
        onToggleMute={handleToggleMute}
      />

      <ControlDock
        config={config}
        dockOpen={dockOpen}
        activeSliderId={activeSliderId}
        autoQuality={autoQuality}
        qualityLevel={telemetry.qualityLevel}
        onActiveSliderChange={setActiveSliderId}
        onToggleAutoQuality={handleToggleAutoQuality}
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
