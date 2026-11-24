export type CameraMode = 'chase' | 'tactical' | 'cockpit' | 'orbit';
export type QualityLevel = 0 | 1 | 2 | 3;

export interface ShipParams {
  rotationSpeed: number; // deg/s (default 110)
  thrustForce: number;   // units/s^2 (default 34)
  maxSpeed: number;      // units/s (default 58)
  drag: number;          // damping factor normalized to 60fps (default 0.985)
  invertPitch: boolean;
}

export interface PlanetParams {
  planetRadius: number;     // default 180
  maxHeight: number;        // default 12
  noiseScale: number;       // default 0.045
  atmosphereHeight: number; // default 55
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

export interface SimulationConfig {
  ship: ShipParams;
  planet: PlanetParams;
  backdrop: BackdropParams;
  cameraMode: CameraMode;
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

export interface TelemetrySnapshot {
  speed: number;
  altitude: number;
  headingDeg: number;
  inSpace: boolean;
  atmospherePct: number;
  planetPatches: number;
  targetDistance: number;
  targetZone: 'surface' | 'orbit' | 'moon';
  waypointsCaptured: number;
  targetLocked: boolean;
  reentryIntensity: number;
  isThrusting: boolean;
  isBoosting: boolean;
  qualityLevel: QualityLevel;
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
    planetRadius: 180,
    maxHeight: 12,
    noiseScale: 0.045,
    atmosphereHeight: 55,
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
  cameraMode: 'chase',
};
