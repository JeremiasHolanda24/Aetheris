import type { PlayerStateSnapshot } from '../engine/playerState';
import type { PoiType } from '../engine/PoiManager';

export type CameraMode = 'chase' | 'cockpit' | 'orbit';
export type PlayerMode = 'ship' | 'character';
export type CharacterCameraMode = 'third' | 'first';
export type QualityLevel = 0 | 1 | 2 | 3;
export type LandingState = 'flying' | 'landing' | 'landed' | 'takeoff';
export type { PoiType };

export interface ShipParams {
  rotationSpeed: number; // deg/s (default 110)
  thrustForce: number;   // units/s^2 (default 34)
  maxSpeed: number;      // units/s (default 58)
  drag: number;          // damping factor normalized to 60fps (default 0.985)
  invertPitch: boolean;
}

export interface PlanetParams {
  planetRadius: number;     // default 360
  maxHeight: number;        // default 14
  noiseScale: number;       // default 0.045
  atmosphereHeight: number; // default 70
  seaLevel: number;         // default -0.15 (normalized -1..1)
  wireframe: boolean;
  showContours: boolean;
}

export interface BackdropParams {
  starCount: number;       // default 1600
  minStarSize: number;     // default 1.5
  maxStarSize: number;     // default 4.5
  nebulaOpacity: number;   // default 0.52
  indicatorMargin: number; // default 0.1
}

export interface FloraParams {
  enabled: boolean; // default true
  density: number;  // default 1 (0..1.5)
}

export interface DiagnosticFlags {
  simpleTerrain: boolean;
  noAtmosphere: boolean;
  noSpaceBackdrop: boolean;
  noFlora: boolean;
  hideShip: boolean;
  hideCharacter: boolean;
  halfResolution: boolean;
  noProceduralGrass: boolean;
  noContours: boolean;
  noPixelBiomeBlend: boolean;
  noReceiveShadow: boolean;
  noNoiseDetail: boolean;
  terrainNoTexture: boolean;
  terrainNoLighting: boolean;
  terrainNoSkyAtmo: boolean;
  terrainFewerPatches: boolean;
  showColliders: boolean;
  noReentryGlow: boolean;
  noReentryParticles: boolean;
  noPois: boolean;
  noPoiHudMarkers: boolean;
  noPoiEffects: boolean;
  noFuelHullBars: boolean;
  noAutosave: boolean;
}

export const DEFAULT_DIAGNOSTICS: DiagnosticFlags = {
  simpleTerrain: false,
  noAtmosphere: false,
  noSpaceBackdrop: false,
  noFlora: false,
  hideShip: false,
  hideCharacter: false,
  halfResolution: false,
  noProceduralGrass: false,
  noContours: false,
  noPixelBiomeBlend: false,
  noReceiveShadow: false,
  noNoiseDetail: false,
  terrainNoTexture: false,
  terrainNoLighting: false,
  terrainNoSkyAtmo: false,
  terrainFewerPatches: false,
  showColliders: false,
  noReentryGlow: false,
  noReentryParticles: false,
  noPois: false,
  noPoiHudMarkers: false,
  noPoiEffects: false,
  noFuelHullBars: false,
  noAutosave: false,
};

export interface BenchmarkStepResult {
  stepNumber: number;
  key: string;
  label: string;
  avgFps: number;
  worstFps: number;
  avgCpuMs: number;
  poiUpdateAvgMs: number;
  poiUpdateWorstMs: number;
  poiHudAvgMs: number;
  poiHudWorstMs: number;
  autosaveAvgMs: number;
  autosaveWorstMs: number;
  hitches: number;
  drawCalls: number;
  triangles: number;
  qualityLevel: QualityLevel;
  qualityPaused: boolean;
  descentScale: number;
  pixelRatio: number;
  canvasWidth: number;
  canvasHeight: number;
  shadowMapEnabled: boolean;
  floraDensityRatio: number;
  floraViewRatio: number;
}

export interface DescentBenchmarkSample {
  second: number;
  altitude: number;
  speed: number;
  atmospherePct: number;
  reentryIntensity: number;
  reentryGlowActive: boolean;
  reentryBannerActive: boolean;
  reentryParticlesActive: boolean;
  fps: number;
  worstFrameMs: number;
  cpuMs: number;
  culprit: string;
  worstFrameSubsystems?: string;
  hitches: number;
  drawCalls: number;
  triangles: number;
  activeParticles: number;
  terrainPatchesBuilt: number;
  floraCellsBuilt: number;
  qualityLevel: QualityLevel;
  qualityPaused: boolean;
  descentScale: number;
  pixelRatio: number;
  canvasWidth: number;
  canvasHeight: number;
  shadowMapEnabled: boolean;
  floraDensityRatio: number;
  floraViewRatio: number;
}

export interface DescentBenchmarkSummary {
  avgFps: number;
  minFps: number;
  groundAvgFps: number;
  worstFrameMs: number;
  worstCulprit: string;
  avgCpuMs: number;
  totalHitches: number;
  peakReentry: number;
  totalPatchesBuilt: number;
  totalFloraCellsBuilt: number;
  durationSec: number;
  qualityLevel: QualityLevel;
  qualityLevelEnd: QualityLevel;
  qualityPaused: boolean;
  descentScaleStart: number;
  descentScaleMin: number;
  descentScaleEnd: number;
  pixelRatio: number;
  pixelRatioEnd: number;
  canvasWidth: number;
  canvasHeight: number;
  canvasWidthEnd: number;
  canvasHeightEnd: number;
  shadowMapEnabled: boolean;
  shadowMapEnabledEnd: boolean;
  floraDensityRatio: number;
  floraDensityRatioEnd: number;
  floraViewRatio: number;
  floraViewRatioEnd: number;
}

export type DescentRunKey =
  | 'default'
  | 'autoQuality'
  | 'halfResolution'
  | 'noShadows'
  | 'qualityLevel3'
  | 'noAtmosphere'
  | 'noFlora'
  | 'hideShipAll'
  | 'descentScale';

export interface DescentBenchmarkRun {
  id: number;
  key: DescentRunKey;
  label: string;
  samples: DescentBenchmarkSample[];
  summary: DescentBenchmarkSummary;
}

export interface BenchmarkProgress {
  active: boolean;
  kind?: 'static' | 'descent';
  stepIndex: number;
  totalSteps: number;
  label: string;
  remainingSec: number;
  altitude?: number;
}

export interface OtherDrawBreakdown {
  nave: number;
  alvo: number;
  fundo: number;
  atmLua: number;
  fx: number;
}

export interface SimulationConfig {
  ship: ShipParams;
  planet: PlanetParams;
  backdrop: BackdropParams;
  flora: FloraParams;
  cameraMode: CameraMode;
  characterCamera: CharacterCameraMode;
  showFps: boolean;
}

export interface OffScreenIndicatorState {
  active: boolean;
  onScreen: boolean;
  x: number;
  y: number;
  angleDeg: number;
  distance: number;
  color: string;
}

export interface PoiHudMarkerState {
  active: boolean;
  onScreen: boolean;
  x: number;
  y: number;
  angleDeg: number;
  distance: number;
  color: string;
  type: PoiType;
  label: string;
}

export interface CollectHudState {
  available: boolean;
  collecting: boolean;
  progress: number;
  label: string;
  kind: PoiType | 'flora';
  inventoryFull: boolean;
}

export interface HudToastMessage {
  id: number;
  text: string;
  tone: 'info' | 'warn' | 'danger' | 'success';
}

export interface HorizonHudState {
  visible: boolean;
  pathD: string;
  opacity: number;
  color: string;
  viewportW: number;
  viewportH: number;
}

export interface TelemetrySnapshot {
  speed: number;
  altitude: number;
  headingDeg: number;
  inSpace: boolean;
  atmospherePct: number;
  biome: string;
  planetPatches: number;
  targetDistance: number;
  targetZone: 'surface' | 'orbit' | 'moon';
  waypointsCaptured: number;
  targetLocked: boolean;
  reentryIntensity: number;
  isThrusting: boolean;
  isBoosting: boolean;
  turboCharge: number;
  turboExhausted: boolean;
  playerMode: PlayerMode;
  characterCamera: CharacterCameraMode;
  jetpackEnabled: boolean;
  dampenersEnabled: boolean;
  qualityLevel: QualityLevel;
  fps: number;
  worstFps: number;
  cpuFrameMs: number;
  floraInstances: number;
  floraGroups: number;
  renderCalls: number;
  terrainDraws: number;
  floraDraws: number;
  otherDraws: number;
  otherBreakdown: OtherDrawBreakdown;
  landingState: LandingState;
  canLand: boolean;
  landHint: string;
  collectAvailable: boolean;
  collectLabel: string;
  player: PlayerStateSnapshot;
  indicator: OffScreenIndicatorState;
}

export const DEFAULT_CONFIG: SimulationConfig = {
  ship: {
    rotationSpeed: 110,
    thrustForce: 34,
    maxSpeed: 58,
    drag: 0.985,
    invertPitch: false,
  },
  planet: {
    planetRadius: 360,
    maxHeight: 14,
    noiseScale: 0.045,
    atmosphereHeight: 70,
    seaLevel: -0.15,
    wireframe: false,
    showContours: false,
  },
  backdrop: {
    starCount: 1600,
    minStarSize: 1.5,
    maxStarSize: 4.5,
    nebulaOpacity: 0.52,
    indicatorMargin: 0.1,
  },
  flora: {
    enabled: true,
    density: 1,
  },
  cameraMode: 'chase',
  characterCamera: 'third',
  showFps: true,
};
