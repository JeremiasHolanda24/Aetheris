import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackpackModal } from './components/BackpackModal';
import { BenchmarkOverlay } from './components/BenchmarkOverlay';
import { ControlDock, TelemetryHeader } from './components/ControlOverlay';
import { MobileControls } from './components/MobileControls';
import { OffScreenHud, OffScreenHudHandle } from './components/OffScreenHud';
import { INVENTORY_CAPACITY, MAX_FUEL, MAX_HULL, ResourceId } from './engine/economy';
import { FlightEngine, VirtualInputs } from './engine/FlightEngine';
import {
  BenchmarkProgress,
  BenchmarkStepResult,
  CameraMode,
  CharacterCameraMode,
  DEFAULT_CONFIG,
  DEFAULT_DIAGNOSTICS,
  DescentBenchmarkRun,
  DiagnosticFlags,
  HudToastMessage,
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
  turboCharge: 1,
  turboExhausted: false,
  playerMode: 'ship',
  characterCamera: 'third',
  jetpackEnabled: false,
  dampenersEnabled: true,
  qualityLevel: 0,
  fps: 60,
  worstFps: 60,
  cpuFrameMs: 8.0,
  floraInstances: 0,
  floraGroups: 0,
  renderCalls: 0,
  terrainDraws: 0,
  floraDraws: 0,
  otherDraws: 0,
  otherBreakdown: {
    nave: 0,
    alvo: 0,
    fundo: 0,
    atmLua: 0,
    fx: 0,
  },
  landingState: 'flying',
  canLand: false,
  landHint: '',
  collectAvailable: false,
  collectLabel: '',
  player: {
    credits: 0,
    inventory: { crystal: 0, scrap: 0, fiber: 0, relic: 0 },
    inventoryCount: 0,
    inventoryCapacity: INVENTORY_CAPACITY,
    fuel: MAX_FUEL,
    maxFuel: MAX_FUEL,
    hull: MAX_HULL,
    maxHull: MAX_HULL,
    reserveMode: false,
    upgrades: { tankLevel: 0, hullLevel: 0, cargoLevel: 0 },
  },
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
  return value === 'chase' || value === 'cockpit' || value === 'orbit';
}

function isCharacterCameraMode(value: unknown): value is CharacterCameraMode {
  return value === 'third' || value === 'first';
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

    if (isRecord(rawConfig.flora)) {
      const f = rawConfig.flora;
      if (typeof f.enabled === 'boolean') base.flora.enabled = f.enabled;
      if (isFiniteNum(f.density) && f.density >= 0 && f.density <= 1.5) {
        base.flora.density = f.density;
      }
    }

    if (isCameraMode(rawConfig.cameraMode)) {
      base.cameraMode = rawConfig.cameraMode;
    }

    if (isCharacterCameraMode(rawConfig.characterCamera)) {
      base.characterCamera = rawConfig.characterCamera;
    }

    if (typeof rawConfig.showFps === 'boolean') {
      base.showFps = rawConfig.showFps;
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
  const toastTimerRef = useRef<number | null>(null);
  const toastIdRef = useRef(0);
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
  const [backpackOpen, setBackpackOpen] = useState<boolean>(false);
  const [activeSliderId, setActiveSliderId] = useState<string | null>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [targetLocked, setTargetLocked] = useState(false);
  const [isMuted, setIsMuted] = useState(initialSettings.muted);
  const [autoQuality, setAutoQuality] = useState(initialSettings.autoQuality);
  const [diagnostics, setDiagnostics] =
    useState<DiagnosticFlags>(DEFAULT_DIAGNOSTICS);
  const [benchmarkProgress, setBenchmarkProgress] =
    useState<BenchmarkProgress | null>(null);
  const [benchmarkResults, setBenchmarkResults] = useState<
    BenchmarkStepResult[] | null
  >(null);
  const [descentRuns, setDescentRuns] = useState<DescentBenchmarkRun[] | null>(
    null,
  );
  const [descentError, setDescentError] = useState<string | null>(null);
  const [showDescentModal, setShowDescentModal] = useState(false);
  const [captureFlash, setCaptureFlash] = useState<number | null>(null);
  const [hudToast, setHudToast] = useState<HudToastMessage | null>(null);
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
      onPoiMarkersFrame: (markers) => hudRef.current?.updatePoiMarkers(markers),
      onCollectHudFrame: (collect) => hudRef.current?.updateCollectHud(collect),
      onHudToast: (toast) => {
        const id = ++toastIdRef.current;
        setHudToast({ id, text: toast.text, tone: toast.tone });
        if (toastTimerRef.current !== null) {
          window.clearTimeout(toastTimerRef.current);
        }
        toastTimerRef.current = window.setTimeout(() => {
          setHudToast((cur) => (cur?.id === id ? null : cur));
        }, 2800);
      },
      onReentryFrame: (intensity, hideGlow) =>
        hudRef.current?.updateReentry(intensity, hideGlow),
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
      onCharacterCameraChange: (mode) => {
        setConfig((prev) =>
          prev.characterCamera === mode
            ? prev
            : { ...prev, characterCamera: mode },
        );
      },
      onBenchmarkProgress: (prog) => setBenchmarkProgress(prog),
      onBenchmarkComplete: (res) => {
        setShowDescentModal(false);
        setDescentError(null);
        setBenchmarkResults(res);
      },
      onDescentBenchmarkComplete: (runs) => {
        setBenchmarkResults(null);
        setDescentError(null);
        setDescentRuns(runs);
        setShowDescentModal(true);
      },
      onDescentBenchmarkError: (msg) => {
        setBenchmarkResults(null);
        setShowDescentModal(false);
        setDescentError(msg);
      },
      onDiagnosticsRestored: (flags) => setDiagnostics(flags),
    });

    engine.setMuted(initialSettings.muted);
    engine.setAutoQuality(initialSettings.autoQuality);
    engineRef.current = engine;

    return () => {
      if (captureTimerRef.current !== null) {
        window.clearTimeout(captureTimerRef.current);
      }
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
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
    engineRef.current?.setDiagnostics(diagnostics);
  }, [diagnostics]);

  useEffect(() => {
    engineRef.current?.setSliderDragging(activeSliderId !== null);
  }, [activeSliderId]);

  useEffect(() => {
    engineRef.current?.setSettingsPanelOpen(dockOpen);
  }, [dockOpen]);

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

  const benchmarkActive = Boolean(benchmarkProgress?.active);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return;
      }
      if (e.code === 'KeyH') {
        if (!benchmarkActive) setDockOpen((prev) => !prev);
      } else if (e.code === 'KeyB' || e.code === 'KeyI') {
        if (!benchmarkActive) setBackpackOpen((prev) => !prev);
      } else if (e.code === 'Escape') {
        setBackpackOpen(false);
      } else if (e.code === 'KeyT') {
        if (!benchmarkActive) handleToggleTargetLock();
      } else if (e.code === 'KeyM') {
        handleToggleMute();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [benchmarkActive, handleToggleTargetLock, handleToggleMute]);

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
    if (benchmarkActive) return;
    setDockOpen((prev) => !prev);
  }, [benchmarkActive]);

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
    setDiagnostics(DEFAULT_DIAGNOSTICS);
  }, []);

  const handleToggleAutoQuality = useCallback(() => {
    setAutoQuality((prev) => !prev);
  }, []);

  const handleToggleDiagnostic = useCallback(
    (key: keyof DiagnosticFlags) => {
      setDiagnostics((prev) => ({
        ...prev,
        [key]: !prev[key],
      }));
    },
    [],
  );

  const handleStartBenchmark = useCallback(() => {
    setDockOpen(false);
    setActiveSliderId(null);
    setBenchmarkResults(null);
    setDescentError(null);
    setShowDescentModal(false);
    engineRef.current?.startBenchmark();
  }, []);

  const handleStartDescentBenchmark = useCallback(() => {
    setDockOpen(false);
    setActiveSliderId(null);
    setBenchmarkResults(null);
    setDescentError(null);
    setShowDescentModal(false);
    engineRef.current?.startDescentBenchmark();
  }, []);

  const handleCancelBenchmark = useCallback(() => {
    engineRef.current?.cancelBenchmark();
  }, []);

  const handleCloseBenchmarkResults = useCallback(() => {
    setBenchmarkResults(null);
    setDescentError(null);
    setShowDescentModal(false);
  }, []);

  const handleVirtualInput = useCallback((inputs: VirtualInputs) => {
    engineRef.current?.setVirtualInputs(inputs);
  }, []);

  const handleToggleLanding = useCallback(() => {
    engineRef.current?.toggleLanding();
  }, []);

  const handleToggleCharacterCamera = useCallback(() => {
    setConfig((prev) => ({
      ...prev,
      characterCamera: prev.characterCamera === 'third' ? 'first' : 'third',
    }));
  }, []);

  const handleToggleJetpack = useCallback(() => {
    engineRef.current?.toggleJetpack();
  }, []);

  const handleToggleDampeners = useCallback(() => {
    engineRef.current?.toggleDampeners();
  }, []);

  const handleToggleBackpack = useCallback(() => {
    if (benchmarkActive) return;
    setBackpackOpen((prev) => !prev);
  }, [benchmarkActive]);

  const handleCloseBackpack = useCallback(() => {
    setBackpackOpen(false);
  }, []);

  const handleSellResource = useCallback((id: ResourceId, amount?: number) => {
    engineRef.current?.sellResource(id, amount);
  }, []);

  const handleSellAll = useCallback(() => {
    engineRef.current?.sellAllResources();
  }, []);

  const handleUseCrystal = useCallback(() => {
    engineRef.current?.useCrystalForFuel();
  }, []);

  const handleRepairHull = useCallback(() => {
    engineRef.current?.repairHullWithScrap();
  }, []);

  const handleNewGame = useCallback(() => {
    engineRef.current?.resetNewGame();
    setBackpackOpen(false);
  }, []);

  const handleDebugAddCredits = useCallback(() => {
    engineRef.current?.debugAddCredits();
  }, []);

  const handleDebugFillInventory = useCallback(() => {
    engineRef.current?.debugFillInventory();
  }, []);

  const handleDebugDamageHull = useCallback(() => {
    engineRef.current?.debugDamageHull();
  }, []);

  const handleTeleportNearestPoi = useCallback(() => {
    engineRef.current?.teleportToNearestPoi();
  }, []);

  const isDraggingSlider = activeSliderId !== null;
  const hideTopHud =
    config.cameraMode === 'cockpit' && telemetry.playerMode === 'ship';

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
        toast={hudToast}
      />

      {/* Mobile touch controls stay active on touch devices without needing a disable button */}
      <div
        className={`transition-opacity duration-150 ${
          isDraggingSlider ? 'opacity-20 pointer-events-none' : 'opacity-100'
        }`}
      >
        <MobileControls
          visible={isTouchDevice && !benchmarkActive}
          playerMode={telemetry.playerMode}
          characterCamera={config.characterCamera}
          jetpackEnabled={telemetry.jetpackEnabled}
          dampenersEnabled={telemetry.dampenersEnabled}
          targetLocked={targetLocked}
          landingState={telemetry.landingState}
          canLand={telemetry.canLand}
          collectAvailable={telemetry.collectAvailable}
          collectLabel={telemetry.collectLabel}
          isPortraitMobile={isPortraitMobile && isTouchDevice && !benchmarkActive}
          portraitDismissed={portraitDismissed}
          showSettingsFallback={hideTopHud && !dockOpen && !benchmarkActive}
          onOpenDock={handleToggleDock}
          onDismissPortrait={handleDismissPortrait}
          onRequestLandscapeFullscreen={handleRequestLandscapeFullscreen}
          onToggleTargetLock={handleToggleTargetLock}
          onToggleLanding={handleToggleLanding}
          onToggleCharacterCamera={handleToggleCharacterCamera}
          onToggleJetpack={handleToggleJetpack}
          onToggleDampeners={handleToggleDampeners}
          onVirtualInputChange={handleVirtualInput}
        />
      </div>

      {!hideTopHud && benchmarkProgress?.kind !== 'descent' && (
        <TelemetryHeader
          telemetry={telemetry}
          showFps={config.showFps}
          dockOpen={dockOpen}
          backpackOpen={backpackOpen}
          isFullscreen={isFullscreen}
          isTouchDevice={isTouchDevice}
          targetLocked={targetLocked}
          isMuted={isMuted}
          dimmed={isDraggingSlider}
          hideFuelHullBars={diagnostics.noFuelHullBars}
          onToggleDock={handleToggleDock}
          onToggleBackpack={handleToggleBackpack}
          onToggleFullscreen={handleToggleFullscreen}
          onToggleTargetLock={handleToggleTargetLock}
          onToggleMute={handleToggleMute}
          onToggleCharacterCamera={handleToggleCharacterCamera}
          onToggleJetpack={handleToggleJetpack}
          onToggleDampeners={handleToggleDampeners}
          onToggleLanding={handleToggleLanding}
        />
      )}

      <BackpackModal
        open={backpackOpen && !benchmarkActive}
        player={telemetry.player}
        playerMode={telemetry.playerMode}
        landingState={telemetry.landingState}
        onClose={handleCloseBackpack}
        onSellResource={handleSellResource}
        onSellAll={handleSellAll}
        onUseCrystal={handleUseCrystal}
        onRepairHull={handleRepairHull}
      />

      <ControlDock
        config={config}
        diagnostics={diagnostics}
        dockOpen={dockOpen && !benchmarkActive}
        activeSliderId={activeSliderId}
        autoQuality={autoQuality}
        qualityLevel={telemetry.qualityLevel}
        fps={telemetry.fps}
        worstFps={telemetry.worstFps}
        cpuFrameMs={telemetry.cpuFrameMs}
        floraInstances={telemetry.floraInstances}
        floraGroups={telemetry.floraGroups}
        renderCalls={telemetry.renderCalls}
        terrainDraws={telemetry.terrainDraws}
        floraDraws={telemetry.floraDraws}
        otherDraws={telemetry.otherDraws}
        otherBreakdown={telemetry.otherBreakdown}
        benchmarkActive={benchmarkActive}
        onActiveSliderChange={setActiveSliderId}
        onToggleAutoQuality={handleToggleAutoQuality}
        onToggleDiagnostic={handleToggleDiagnostic}
        onStartBenchmark={handleStartBenchmark}
        onStartDescentBenchmark={handleStartDescentBenchmark}
        onCloseDock={handleCloseDock}
        onUpdateConfig={handleUpdateConfig}
        onLandSurface={handleLandSurface}
        onLaunchOrbit={handleLaunchOrbit}
        onRelocateTarget={handleRelocateTarget}
        onResetDefaults={handleResetDefaults}
        onNewGame={handleNewGame}
        onDebugAddCredits={handleDebugAddCredits}
        onDebugFillInventory={handleDebugFillInventory}
        onDebugDamageHull={handleDebugDamageHull}
        onTeleportNearestPoi={handleTeleportNearestPoi}
      />

      <BenchmarkOverlay
        progress={benchmarkProgress}
        results={benchmarkResults}
        descentRuns={descentRuns}
        descentError={descentError}
        showDescentModal={showDescentModal}
        onCancel={handleCancelBenchmark}
        onCloseResults={handleCloseBenchmarkResults}
      />
    </main>
  );
}
