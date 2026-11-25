export type CameraMode = 'chase' | 'cockpit' | 'orbit';
export type PlayerMode = 'ship' | 'character';
export type CharacterCameraMode = 'third' | 'first';
export type QualityLevel = 0 | 1 | 2 | 3;
export type LandingState = 'flying' | 'landing' | 'landed' | 'takeoff';

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

export interface SimulationConfig {
  ship: ShipParams;
  planet: PlanetParams;
  backdrop: BackdropParams;
  flora: FloraParams;
  cameraMode: CameraMode;
  characterCamera: CharacterCameraMode;
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
  floraInstances: number;
  floraGroups: number;
  renderCalls: number;
  terrainDraws: number;
  floraDraws: number;
  otherDraws: number;
  landingState: LandingState;
  canLand: boolean;
  landHint: string;
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
};
