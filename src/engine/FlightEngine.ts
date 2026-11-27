import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  BenchmarkProgress,
  BenchmarkStepResult,
  CameraMode,
  CharacterCameraMode,
  CollectHudState,
  DEFAULT_DIAGNOSTICS,
  DescentBenchmarkRun,
  DescentBenchmarkSample,
  DescentBenchmarkSummary,
  DescentRunKey,
  DiagnosticFlags,
  HorizonHudState,
  LandingState,
  OffScreenIndicatorState,
  OtherDrawBreakdown,
  PlayerMode,
  PoiHudMarkerState,
  QualityLevel,
  SimulationConfig,
  TelemetrySnapshot,
} from '../types/simulation';
import { BeaconController } from './BeaconController';
import { getBiomeName } from './biomes';
import { CameraRig } from './CameraRig';
import { CharacterController } from './CharacterController';
import {
  CRYSTAL_FUEL_REFILL,
  FLORA_COLLECT_DURATION_SEC,
  FLORA_INTERACT_RADIUS,
  POI_COLLECT_DURATION_SEC,
  POI_INTERACT_RADIUS,
  ResourceId,
  RESOURCES,
  SCRAP_HULL_REPAIR,
} from './economy';
import { FlightPhysics } from './FlightPhysics';
import { FloraHarvestQuery, FloraManager, TreeCollider } from './FloraManager';
import {
  FlightInputSample,
  InputController,
  VirtualInputs,
} from './InputController';
import { LandingBody, LandingHooks } from './LandingController';
import {
  computeHorizonHud,
  computeOffScreenIndicator,
  computeOffScreenIndicatorInto,
} from './OffScreenIndicator';
import { ParticleSystem } from './ParticleSystem';
import { PlanetTerrainManager } from './PlanetTerrainManager';
import { PlayerState } from './playerState';
import {
  POI_COLORS,
  POI_LABELS,
  PoiManager,
  PoiQueryResult,
} from './PoiManager';
import { createShipModel, ShipModelHandle } from './proceduralModels';
import { QualityPreset, QualityScaler } from './QualityScaler';
import { SoundEngine } from './SoundEngine';
import { SpaceBackground } from './SpaceBackground';
import { getPlanetTerrainHeight } from './terrainMath';
import { WeaponsSystem } from './WeaponsSystem';

export type { VirtualInputs };

// Pre-allocated math helpers outside render loop (Zero GC)
const _shipForward = new THREE.Vector3();
const _shipDir = new THREE.Vector3();
const _localUp = new THREE.Vector3();
const _snapCamPos = new THREE.Vector3();
const _snapLookAt = new THREE.Vector3();
const _snapUp = new THREE.Vector3();
const _sunDir = new THREE.Vector3();
const _clearingPos = new THREE.Vector3();
const _shipWorldQuat = new THREE.Quaternion();
const _debugTreeDir = new THREE.Vector3();
const _debugTreeUp = new THREE.Vector3(0, 1, 0);
const _benchDir = new THREE.Vector3();
const _benchUp = new THREE.Vector3();
const _benchForward = new THREE.Vector3();
const _benchBack = new THREE.Vector3();
const _benchRight = new THREE.Vector3();
const _benchBasis = new THREE.Matrix4();
const _benchUnitY = new THREE.Vector3(0, 1, 0);
const _benchUnitX = new THREE.Vector3(1, 0, 0);
const _poiPos = new THREE.Vector3();
const _poiNormal = new THREE.Vector3();
const _poiLandDir = new THREE.Vector3();
const _poiTangA = new THREE.Vector3();
const _poiTangB = new THREE.Vector3();

const _spaceBgColor = new THREE.Color(0x03040a);
const _dayAtmoBgColor = new THREE.Color(0x0e2547);
const _nightAtmoBgColor = new THREE.Color(0x040712);
const _sunsetAtmoBgColor = new THREE.Color(0x3a1e32);
const _daySunColor = new THREE.Color(0xfff1d6);
const _sunsetSunColor = new THREE.Color(0xff9f5a);
const _skyTmpColor = new THREE.Color();
const _blendedBgColor = new THREE.Color();
const _horizonFogRgb = { r: 0, g: 0, b: 0 };

const DAY_CYCLE_SECONDS = 180;
const SUN_ORBIT_TILT = 0.36;
const BENCHMARK_STEP_DURATION = 8.0;
const BENCHMARK_WARMUP = 2.0;

interface BenchmarkStepDef {
  key: string;
  label: string;
  bannerLabel: string;
  flags: DiagnosticFlags;
}

const BENCHMARK_STEPS: BenchmarkStepDef[] = [
  {
    key: 'base1',
    label: 'Base (1)',
    bannerLabel: 'Base',
    flags: { ...DEFAULT_DIAGNOSTICS },
  },
  {
    key: 'simpleTerrain',
    label: 'Terreno simples',
    bannerLabel: 'Terreno simples',
    flags: { ...DEFAULT_DIAGNOSTICS, simpleTerrain: true },
  },
  {
    key: 'noAtmosphere',
    label: 'Sem atmosfera',
    bannerLabel: 'Sem atmosfera',
    flags: { ...DEFAULT_DIAGNOSTICS, noAtmosphere: true },
  },
  {
    key: 'noSpaceBackdrop',
    label: 'Sem estrelas e nebulosa',
    bannerLabel: 'Sem estrelas',
    flags: { ...DEFAULT_DIAGNOSTICS, noSpaceBackdrop: true },
  },
  {
    key: 'noFlora',
    label: 'Sem flora',
    bannerLabel: 'Sem flora',
    flags: { ...DEFAULT_DIAGNOSTICS, noFlora: true },
  },
  {
    key: 'hideShip',
    label: 'Esconder nave',
    bannerLabel: 'Esconder nave',
    flags: { ...DEFAULT_DIAGNOSTICS, hideShip: true },
  },
  {
    key: 'hideCharacter',
    label: 'Esconder personagem',
    bannerLabel: 'Esconder personagem',
    flags: { ...DEFAULT_DIAGNOSTICS, hideCharacter: true },
  },
  {
    key: 'halfResolution',
    label: 'Resolução 0.5x',
    bannerLabel: 'Resolução 0.5x',
    flags: { ...DEFAULT_DIAGNOSTICS, halfResolution: true },
  },
  {
    key: 'noProceduralGrass',
    label: 'Sem grama procedural',
    bannerLabel: 'Sem grama',
    flags: { ...DEFAULT_DIAGNOSTICS, noProceduralGrass: true },
  },
  {
    key: 'noContours',
    label: 'Sem contornos',
    bannerLabel: 'Sem contornos',
    flags: { ...DEFAULT_DIAGNOSTICS, noContours: true },
  },
  {
    key: 'noPixelBiomeBlend',
    label: 'Sem mistura de bioma por pixel',
    bannerLabel: 'Sem mistura bioma',
    flags: { ...DEFAULT_DIAGNOSTICS, noPixelBiomeBlend: true },
  },
  {
    key: 'noReceiveShadow',
    label: 'Sem receber sombra',
    bannerLabel: 'Sem sombra terreno',
    flags: { ...DEFAULT_DIAGNOSTICS, noReceiveShadow: true },
  },
  {
    key: 'noNoiseDetail',
    label: 'Sem detalhe de ruído',
    bannerLabel: 'Sem ruído',
    flags: { ...DEFAULT_DIAGNOSTICS, noNoiseDetail: true },
  },
  {
    key: 'terrainNoTexture',
    label: 'Terreno sem textura',
    bannerLabel: 'Sem textura terreno',
    flags: { ...DEFAULT_DIAGNOSTICS, terrainNoTexture: true },
  },
  {
    key: 'terrainNoLighting',
    label: 'Terreno sem luz/normal',
    bannerLabel: 'Sem luz terreno',
    flags: { ...DEFAULT_DIAGNOSTICS, terrainNoLighting: true },
  },
  {
    key: 'terrainNoSkyAtmo',
    label: 'Terreno sem sombra do ceu/atmosfera',
    bannerLabel: 'Sem ceu/atmo terreno',
    flags: { ...DEFAULT_DIAGNOSTICS, terrainNoSkyAtmo: true },
  },
  {
    key: 'terrainFewerPatches',
    label: 'Terreno com menos patches',
    bannerLabel: 'Menos patches',
    flags: { ...DEFAULT_DIAGNOSTICS, terrainFewerPatches: true },
  },
  {
    key: 'noPois',
    label: 'Sem POIs',
    bannerLabel: 'Sem POIs',
    flags: { ...DEFAULT_DIAGNOSTICS, noPois: true },
  },
  {
    key: 'noPoiHudMarkers',
    label: 'Sem marcadores de POI no HUD',
    bannerLabel: 'Sem marcadores POI',
    flags: { ...DEFAULT_DIAGNOSTICS, noPoiHudMarkers: true },
  },
  {
    key: 'noPoiEffects',
    label: 'Sem fumaça/efeitos de POI',
    bannerLabel: 'Sem fumaça POI',
    flags: { ...DEFAULT_DIAGNOSTICS, noPoiEffects: true },
  },
  {
    key: 'noFuelHullBars',
    label: 'Sem barras de combustível e casco',
    bannerLabel: 'Sem barras comb/casco',
    flags: { ...DEFAULT_DIAGNOSTICS, noFuelHullBars: true },
  },
  {
    key: 'noAutosave',
    label: 'Sem salvar progresso',
    bannerLabel: 'Sem autosave',
    flags: { ...DEFAULT_DIAGNOSTICS, noAutosave: true },
  },
  {
    key: 'base2',
    label: 'Base (23)',
    bannerLabel: 'Base',
    flags: { ...DEFAULT_DIAGNOSTICS },
  },
];

const IDLE_FLIGHT_INPUTS: FlightInputSample = {
  turn: 0,
  pitch: 0,
  thrust: 0,
  isThrusting: false,
  isBoosting: false,
  wantsFire: false,
};

const AUTOPILOT_INPUTS: FlightInputSample = {
  turn: 0,
  pitch: 0,
  thrust: 1,
  isThrusting: true,
  isBoosting: true,
  wantsFire: false,
};

const DESCENT_ORBIT_WAIT_SECONDS = 2.0;
const DESCENT_GROUND_HOVER_SECONDS = 5.0;

interface DescentStepDef {
  key: 'warmup' | DescentRunKey;
  label: string;
  bannerLabel: string;
  flags: DiagnosticFlags;
  isWarmup?: boolean;
}

const DESCENT_BENCHMARK_STEPS: DescentStepDef[] = [
  {
    key: 'warmup',
    label: 'Aquecimento (descartado)',
    bannerLabel: 'Aquecimento',
    flags: { ...DEFAULT_DIAGNOSTICS },
    isWarmup: true,
  },
  {
    key: 'default',
    label: 'a) Padrão (qualidade pausada)',
    bannerLabel: 'a) Padrão',
    flags: { ...DEFAULT_DIAGNOSTICS },
  },
  {
    key: 'autoQuality',
    label: 'b) Qualidade automática ativa',
    bannerLabel: 'b) Qualidade auto',
    flags: { ...DEFAULT_DIAGNOSTICS },
  },
  {
    key: 'halfResolution',
    label: 'c) Resolução 0.5x (pausada)',
    bannerLabel: 'c) Resolução 0.5x',
    flags: { ...DEFAULT_DIAGNOSTICS, halfResolution: true },
  },
  {
    key: 'noShadows',
    label: 'd) Sem sombras (pausada)',
    bannerLabel: 'd) Sem sombras',
    flags: { ...DEFAULT_DIAGNOSTICS },
  },
  {
    key: 'qualityLevel3',
    label: 'e) Qualidade nível 3 (pausada)',
    bannerLabel: 'e) Nível 3',
    flags: { ...DEFAULT_DIAGNOSTICS },
  },
  {
    key: 'noAtmosphere',
    label: 'f) Sem atmosfera (nível 3)',
    bannerLabel: 'f) Sem atmosfera',
    flags: { ...DEFAULT_DIAGNOSTICS, noAtmosphere: true },
  },
  {
    key: 'noFlora',
    label: 'g) Sem flora (nível 3)',
    bannerLabel: 'g) Sem flora',
    flags: { ...DEFAULT_DIAGNOSTICS, noFlora: true },
  },
  {
    key: 'hideShipAll',
    label: 'h) Esconder nave + FX (nível 3)',
    bannerLabel: 'h) Esconder nave',
    flags: { ...DEFAULT_DIAGNOSTICS, hideShip: true },
  },
  {
    key: 'descentScale',
    label: 'i) Padrão (descentScale ativo)',
    bannerLabel: 'i) descentScale',
    flags: { ...DEFAULT_DIAGNOSTICS },
  },
];

export interface FlightEngineCallbacks {
  onTelemetry: (snapshot: TelemetrySnapshot) => void;
  onCharacterCameraChange?: (mode: CharacterCameraMode) => void;
  onIndicatorFrame?: (indicator: OffScreenIndicatorState) => void;
  onPoiMarkersFrame?: (markers: readonly PoiHudMarkerState[]) => void;
  onCollectHudFrame?: (state: CollectHudState) => void;
  onHudToast?: (toast: {
    text: string;
    tone: 'info' | 'warn' | 'danger' | 'success';
  }) => void;
  onHorizonFrame?: (horizon: HorizonHudState) => void;
  onReentryFrame?: (intensity: number, hideGlow: boolean) => void;
  onWaypointCaptured: (count: number) => void;
  onHitmarker?: (kind: 'beacon' | 'terrain') => void;
  onContextLostChange: (lost: boolean) => void;
  onBenchmarkProgress?: (progress: BenchmarkProgress | null) => void;
  onBenchmarkComplete?: (results: BenchmarkStepResult[]) => void;
  onDescentBenchmarkComplete?: (results: DescentBenchmarkRun[]) => void;
  onDescentBenchmarkError?: (message: string) => void;
  onDiagnosticsRestored?: (flags: DiagnosticFlags) => void;
}

function detectSoftwareGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

export class FlightEngine {
  private container: HTMLElement;
  private callbacks: FlightEngineCallbacks;
  private config: SimulationConfig;

  private isSoftwareGl: boolean;
  private isMobileDevice: boolean;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private fog: THREE.FogExp2;
  private envRT: THREE.WebGLRenderTarget;

  private hemiLight: THREE.HemisphereLight;
  private keyLight: THREE.DirectionalLight;
  private rimLight: THREE.DirectionalLight;
  private shipModel: ShipModelHandle;
  private planetManager: PlanetTerrainManager;
  private spaceBackground: SpaceBackground;

  // Extracted engine subsystems
  private soundEngine = new SoundEngine();
  private qualityScaler: QualityScaler;
  private inputController: InputController;
  private cameraRig: CameraRig;
  private physics: FlightPhysics;
  private character: CharacterController;
  private beaconController: BeaconController;
  private weaponsSystem: WeaponsSystem;
  private particleSystem: ParticleSystem;
  private floraManager: FloraManager;
  private poiManager: PoiManager;
  private playerState = new PlayerState();
  private particleRatio = 1.0;
  private floraDensityRatio = 1.0;
  private floraViewRatio = 1.0;

  // Debug collider wireframe helpers (only visible when diagnostics.showColliders is enabled)
  private readonly shipCollidersDebugGroup = new THREE.Group();
  private readonly shipGearDebugLines: THREE.LineSegments[] = [];
  private readonly treeCollidersDebugGroup = new THREE.Group();
  private readonly treeColliderPool: THREE.LineSegments[] = [];
  private readonly debugTrees: TreeCollider[] = [];
  private readonly debugBoxEdgesGeo: THREE.EdgesGeometry;
  private readonly debugTreeWireGeo: THREE.WireframeGeometry;
  private readonly debugShipMat: THREE.LineBasicMaterial;
  private readonly debugGearMat: THREE.LineBasicMaterial;
  private readonly debugTreeMat: THREE.LineBasicMaterial;

  // Mission & input state
  private playerMode: PlayerMode = 'ship';
  private waypointsCaptured = 0;
  private targetLocked = false;
  private wantsFire = false;
  private isThrusting = false;
  private isBoosting = false;
  private sunPhaseOffset = 0;

  // Gameplay loop: landing recovery, collection, POI HUD & autosave (pre-allocated Zero-GC)
  private readonly lastLandingDir = new THREE.Vector3(0, 1, 0);
  private lastLandingBody: LandingBody = 'planet';
  private collectTargetKind: 'poi' | 'flora' | 'none' = 'none';
  private collectTargetPoiId = -1;
  private collectTargetFloraGroupId = -1;
  private collectTargetFloraMemberIdx = -1;
  private collectTimer = 0;
  private collectCompletedHold = false;
  private collectFullNotifiedThisPress = false;
  private autosaveTimer = 0;
  private reserveToastShown = false;
  private readonly poiQuery: PoiQueryResult = {
    found: false,
    id: -1,
    type: 'crystal',
    label: '',
    distance: Infinity,
  };
  private readonly floraHarvestQuery: FloraHarvestQuery = {
    found: false,
    groupId: -1,
    memberIdx: -1,
    species: 'shrub',
    label: '',
    distance: Infinity,
  };
  private readonly poiHudMarkers: PoiHudMarkerState[] = [
    { active: false, onScreen: false, x: 0, y: 0, angleDeg: 0, distance: 0, color: '#22d3ee', type: 'crystal', label: '' },
    { active: false, onScreen: false, x: 0, y: 0, angleDeg: 0, distance: 0, color: '#fb923c', type: 'wreck', label: '' },
    { active: false, onScreen: false, x: 0, y: 0, angleDeg: 0, distance: 0, color: '#c084fc', type: 'ruin', label: '' },
  ];
  private readonly collectHudState: CollectHudState = {
    available: false,
    collecting: false,
    progress: 0,
    label: '',
    kind: 'crystal',
    inventoryFull: false,
  };

  // Loop & lifecycle
  private timer = new THREE.Timer();
  private frameId = 0;
  private disposed = false;
  private lastTelemetryEmit = -1;
  private lastViewportW = 1;
  private lastViewportH = 1;
  private avgFpsDt = 1 / 60;
  private avgCpuMs = 8.0;
  private hasFpsSample = false;
  private readonly fpsHistory1s = new Float32Array(10);
  private fpsHistoryCount = 0;
  private fpsHistoryIdx = 0;
  private fpsBucketElapsed = 0;
  private fpsBucketFrames = 0;

  private lastIndicator: OffScreenIndicatorState | null = null;
  private diagnostics: DiagnosticFlags = { ...DEFAULT_DIAGNOSTICS };
  private scalerPausedByHalfRes = false;
  private scalerPausedByBenchmark = false;

  private benchmarkActive = false;
  private benchmarkStepIdx = 0;
  private benchmarkStepElapsed = 0;
  private benchmarkMeasureFrames = 0;
  private benchmarkMeasureDtSum = 0;
  private benchmarkMeasureCpuSum = 0;
  private benchmarkMeasureCallsSum = 0;
  private benchmarkMeasureTrisSum = 0;
  private benchmarkMeasureHitches = 0;
  private benchmarkPoiUpdateSum = 0;
  private benchmarkPoiUpdateWorst = 0;
  private benchmarkPoiHudSum = 0;
  private benchmarkPoiHudWorst = 0;
  private benchmarkAutosaveSum = 0;
  private benchmarkAutosaveWorst = 0;
  private benchmark1sElapsed = 0;
  private benchmark1sFrames = 0;
  private benchmarkWorst1sFps = Infinity;
  private benchmarkResults: BenchmarkStepResult[] = [];
  private benchmarkLastProgressEmit = -1;

  private descentBenchmarkActive = false;
  private descentStepIdx = 0;
  private descentRuns: DescentBenchmarkRun[] = [];
  private descentInitialQualityLevel: QualityLevel = 0;
  private descentInitialAutoEnabled = true;
  private descentPhase: 'wait' | 'descent' = 'wait';
  private descentWaitElapsed = 0;
  private readonly descentOrbitPos = new THREE.Vector3();
  private readonly descentOrbitQuat = new THREE.Quaternion();
  private descentElapsed = 0;
  private descentStartAlt = 0;
  private descentBraking = false;
  private descentGroundHoverActive = false;
  private descentGroundElapsed = 0;
  private descentGroundDt = 0;
  private descentGroundFrames = 0;
  private descentStallChecked = false;
  private descentAutopilotMaxSpeed = 120;
  private descentSamples: DescentBenchmarkSample[] = [];
  private descentBucketDt = 0;
  private descentBucketFrames = 0;
  private descentBucketWorstMs = 0;
  private descentBucketWorstCulprit = '—';
  private descentBucketWorstBreakdown = '';
  private descentBucketCpuSum = 0;
  private descentBucketHitches = 0;
  private descentBucketCallsSum = 0;
  private descentBucketTrisSum = 0;
  private descentBucketParticlesSum = 0;
  private descentBucketMaxReentry = 0;
  private descentBucketGlowActive = false;
  private descentBucketBannerActive = false;
  private descentBucketParticlesActive = false;
  private descentRunWorstMs = 0;
  private descentRunWorstCulprit = '—';
  private descentLastProgressEmit = -1;
  private descentPrevCamMode: CameraMode | null = null;
  private descentStartQualityLevel: QualityLevel = 0;
  private descentStartPixelRatio = 1;
  private descentStartCanvasWidth = 1;
  private descentStartCanvasHeight = 1;
  private descentStartShadowMapEnabled = false;
  private descentStartFloraDensityRatio = 1;
  private descentStartFloraViewRatio = 1;
  private descentStartScale = 1.0;
  private descentRunMinScale = 1.0;

  private settingsPanelOpen = false;
  private descentScale = 1.0;
  private descentScaleEnabled = true;
  private descentScaleLowSpeedTimer = 0;
  private descentScaleCooldown = 0;
  private appliedPixelRatio = 1.0;

  private hasPendingDescentFrame = false;
  private pendingGroundHover = false;
  private pendingCpuMs = 0;
  private pendingCalls = 0;
  private pendingTris = 0;
  private pendingParticles = 0;
  private pendingAlt = 0;
  private pendingSpeed = 0;
  private pendingAtmoPct = 0;
  private pendingReentry = 0;
  private pendingGlowActive = false;
  private pendingBannerActive = false;
  private pendingParticlesActive = false;
  private pendingTPhysics = 0;
  private pendingTTerrain = 0;
  private pendingTFlora = 0;
  private pendingTParticles = 0;
  private pendingTCharacter = 0;
  private pendingTCamHud = 0;
  private pendingTRender = 0;
  private pendingProgBefore = 0;
  private pendingProgAfter = 0;
  private pendingQualityLevel: QualityLevel = 0;
  private pendingQualityPaused = false;
  private pendingDescentScale = 1.0;
  private pendingPixelRatio = 1;
  private pendingCanvasWidth = 1;
  private pendingCanvasHeight = 1;
  private pendingShadowMapEnabled = false;
  private pendingFloraDensityRatio = 1;
  private pendingFloraViewRatio = 1;

  private warmupActive = false;
  private warmupPromise: Promise<void> | null = null;
  private readonly warmupSavedBeaconVisibles = new Map<THREE.Object3D, boolean>();

  private lastOtherAudit = -10;
  private otherBreakdown: OtherDrawBreakdown = {
    nave: 0,
    alvo: 0,
    fundo: 0,
    atmLua: 0,
    fx: 0,
  };
  private readonly landingHooks: LandingHooks;
  private prevLandingState: LandingState = 'flying';

  private boundOnResize: () => void;
  private boundOnContextLost: (e: Event) => void;
  private boundOnContextRestored: () => void;

  constructor(
    container: HTMLElement,
    initialConfig: SimulationConfig,
    callbacks: FlightEngineCallbacks,
  ) {
    this.container = container;
    this.config = structuredClone(initialConfig);
    this.callbacks = callbacks;

    this.isSoftwareGl = detectSoftwareGl();
    this.isMobileDevice =
      window.matchMedia('(pointer: coarse)').matches ||
      navigator.maxTouchPoints > 0;

    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    this.lastViewportW = width;
    this.lastViewportH = height;

    // 1. Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl && !this.isMobileDevice,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    const maxDpr = this.isSoftwareGl
      ? 1
      : this.isMobileDevice
        ? 1.25
        : 1.5;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, maxDpr);
    this.appliedPixelRatio = pixelRatio;
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height);

    const enableShadowMap = !this.isSoftwareGl && !this.isMobileDevice;
    this.renderer.shadowMap.enabled = enableShadowMap;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.touchAction = 'none';
    this.renderer.domElement.style.userSelect = 'none';
    container.appendChild(this.renderer.domElement);

    // 2. Scene & Dynamic Atmosphere Fog
    this.scene = new THREE.Scene();
    this.scene.background = _dayAtmoBgColor.clone();
    this.fog = new THREE.FogExp2(0x0e2547, 0.0017);
    this.scene.fog = this.fog;

    // 3. Studio RoomEnvironment map
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.envRT.texture;
    pmrem.dispose();

    // 4. CameraRig
    this.cameraRig = new CameraRig(
      this.renderer.domElement,
      width,
      height,
      this.config.cameraMode,
      this.isSoftwareGl,
      this.config.planet.planetRadius,
    );

    // 5. Three-Point Solar Lighting Rig (day/night orbiting sun)
    this.hemiLight = new THREE.HemisphereLight(0xa5b4fc, 0x3b2d7a, 1.05);
    this.scene.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xfff1d6, 2.35);
    this.keyLight.position.set(260, 320, 180);
    this.keyLight.castShadow = enableShadowMap;
    if (enableShadowMap) {
      this.keyLight.shadow.mapSize.set(512, 512);
      this.keyLight.shadow.camera.near = 10;
      this.keyLight.shadow.camera.far = 750;
      const d = 48;
      this.keyLight.shadow.camera.left = -d;
      this.keyLight.shadow.camera.right = d;
      this.keyLight.shadow.camera.top = d;
      this.keyLight.shadow.camera.bottom = -d;
      this.keyLight.shadow.bias = -0.0005;
      this.keyLight.shadow.normalBias = 0.02;
    }
    this.scene.add(this.keyLight);
    this.scene.add(this.keyLight.target);

    this.rimLight = new THREE.DirectionalLight(0x6366f1, 0.25);
    this.rimLight.position.set(-240, -140, -220);
    this.scene.add(this.rimLight);

    // 6. Subsystems
    const lowSpec = this.isSoftwareGl || this.isMobileDevice;
    this.spaceBackground = new SpaceBackground(this.config.backdrop);
    this.spaceBackground.root.userData.perfTag = 'fundo';
    this.spaceBackground.setPixelRatio(pixelRatio);
    this.scene.add(this.spaceBackground.root);

    this.qualityScaler = new QualityScaler({
      isSoftwareGl: this.isSoftwareGl,
      basePixelRatio: pixelRatio,
      baseShadowsEnabled: enableShadowMap,
      onLevelApplied: (preset) => this.applyQualityPreset(preset),
    });

    this.planetManager = new PlanetTerrainManager(this.config.planet);
    this.planetManager.setGrassDetail(
      this.qualityScaler.getCurrentPreset().terrainDetailRatio,
      lowSpec,
    );
    this.scene.add(this.planetManager.root);

    this.shipModel = createShipModel(lowSpec);
    this.physics = new FlightPhysics(this.scene, this.shipModel);
    this.character = new CharacterController(this.scene, lowSpec);
    this.character.root.userData.perfTag = 'nave';
    this.beaconController = new BeaconController(this.scene);
    this.beaconController.model.group.userData.perfTag = 'alvo';

    this.weaponsSystem = new WeaponsSystem(this.scene, this.soundEngine);
    this.particleSystem = new ParticleSystem(this.scene);
    this.floraManager = new FloraManager(this.scene, {
      castShadows: enableShadowMap,
      isMobileOrSoftware: lowSpec,
      horizonFogColor: this.planetManager.horizonFogColorUniform,
      horizonFogParams: this.planetManager.horizonFogParamsUniform,
    });
    this.poiManager = new PoiManager(this.scene);

    const unitBoxGeo = new THREE.BoxGeometry(1, 1, 1);
    this.debugBoxEdgesGeo = new THREE.EdgesGeometry(unitBoxGeo);
    unitBoxGeo.dispose();

    const unitTreeCylGeo = new THREE.CylinderGeometry(0.72, 0.72, 1, 10, 1, true);
    this.debugTreeWireGeo = new THREE.WireframeGeometry(unitTreeCylGeo);
    unitTreeCylGeo.dispose();

    this.debugShipMat = new THREE.LineBasicMaterial({ color: 0x22d3ee });
    this.debugGearMat = new THREE.LineBasicMaterial({ color: 0xfbbf24 });
    this.debugTreeMat = new THREE.LineBasicMaterial({ color: 0x4ade80 });

    this.shipCollidersDebugGroup.visible = false;
    this.shipCollidersDebugGroup.userData.perfTag = 'fx';
    for (let i = 0; i < this.shipModel.colliders.length; i++) {
      const col = this.shipModel.colliders[i];
      const line = new THREE.LineSegments(
        this.debugBoxEdgesGeo,
        col.requiresGear ? this.debugGearMat : this.debugShipMat,
      );
      line.position.set(
        (col.min.x + col.max.x) * 0.5,
        (col.min.y + col.max.y) * 0.5,
        (col.min.z + col.max.z) * 0.5,
      );
      line.scale.set(
        col.max.x - col.min.x,
        col.max.y - col.min.y,
        col.max.z - col.min.z,
      );
      line.userData.perfTag = 'fx';
      this.shipCollidersDebugGroup.add(line);
      if (col.requiresGear) {
        this.shipGearDebugLines.push(line);
      }
    }
    this.physics.shipRoot.add(this.shipCollidersDebugGroup);

    this.treeCollidersDebugGroup.visible = false;
    this.treeCollidersDebugGroup.userData.perfTag = 'fx';
    for (let i = 0; i < 64; i++) {
      const line = new THREE.LineSegments(
        this.debugTreeWireGeo,
        this.debugTreeMat,
      );
      line.visible = false;
      line.frustumCulled = false;
      line.userData.perfTag = 'fx';
      this.treeCollidersDebugGroup.add(line);
      this.treeColliderPool.push(line);
    }
    this.scene.add(this.treeCollidersDebugGroup);

    this.landingHooks = {
      spawnDust: (pos, normal, count) =>
        this.weaponsSystem.spawnDust(pos, normal, count),
      onTouchdown: () => this.soundEngine.playTouchdown(),
      onGear: (extending) => this.soundEngine.playGear(extending),
    };

    this.inputController = new InputController(this.renderer.domElement, {
      getCameraMode: () => this.config.cameraMode,
      onUnlockAudio: () => this.soundEngine.unlock(),
      onVisibilityChange: (hidden) => this.soundEngine.setPaused(hidden),
      onLandToggle: () => this.toggleLanding(),
      onToggleJetpack: () => this.toggleJetpack(),
      onToggleDampeners: () => this.toggleDampeners(),
      onToggleCharacterCamera: () => this.toggleCharacterCamera(),
    });

    this.landOnSurface();
    this.lastLandingDir.copy(this.physics.landing.landedDir);
    this.lastLandingBody = this.physics.landing.landedBody;
    this.poiManager.rebuildIfNeeded(this.planetManager, this.config.planet);
    this.initSunPhaseForSpot(this.physics.shipRoot.position);
    this.beaconController.relocateTarget(
      'surface',
      this.physics.shipRoot.position,
      this.config.planet,
      this.planetManager,
    );

    if (!this.isSoftwareGl) {
      this.planetManager.updateHorizonCulling(
        this.cameraRig.camera.position,
        this.cameraRig.camera,
        this.physics.shipRoot.position,
      );
      void this.warmupShaders();
    }

    // 7. Viewport & Context Listeners
    this.boundOnResize = this.handleResize.bind(this);
    this.boundOnContextLost = (e: Event) => {
      e.preventDefault();
      this.callbacks.onContextLostChange(true);
    };
    this.boundOnContextRestored = () => {
      this.callbacks.onContextLostChange(false);
    };

    window.addEventListener('resize', this.boundOnResize);
    window.addEventListener('orientationchange', this.boundOnResize);
    window.visualViewport?.addEventListener('resize', this.boundOnResize);
    this.renderer.domElement.addEventListener(
      'webglcontextlost',
      this.boundOnContextLost,
    );
    this.renderer.domElement.addEventListener(
      'webglcontextrestored',
      this.boundOnContextRestored,
    );

    this.timer.connect(document);
    this.timer.reset();
    this.frameId = requestAnimationFrame(this.tick);
  }

  public updateConfig(next: SimulationConfig): void {
    const prevMode = this.config.cameraMode;
    const prevPlanet = this.config.planet;
    const planetRebuilt =
      next.planet.planetRadius !== prevPlanet.planetRadius ||
      next.planet.maxHeight !== prevPlanet.maxHeight ||
      next.planet.noiseScale !== prevPlanet.noiseScale ||
      next.planet.seaLevel !== prevPlanet.seaLevel;

    this.config = structuredClone(next);
    this.planetManager.updateParams(next.planet);
    if (planetRebuilt) {
      this.floraManager.invalidate();
      if (this.beaconController.targetZone === 'moon') {
        this.beaconController.syncMoonBeaconPosition(this.planetManager);
      }
    }
    this.cameraRig.setPlanetRadius(next.planet.planetRadius);
    this.spaceBackground.updateParams(next.backdrop);

    if (prevMode !== next.cameraMode) {
      if (next.cameraMode === 'orbit') {
        this.inputController.clearFirePointers();
      }
      this.cameraRig.setMode(
        next.cameraMode,
        this.playerMode === 'character'
          ? this.character.root.position
          : this.physics.shipRoot.position,
      );
    }
  }

  public setVirtualInputs(inputs: VirtualInputs): void {
    if (this.benchmarkActive || this.descentBenchmarkActive) return;
    this.inputController.setVirtualInputs(inputs);
  }

  public setTargetLocked(locked: boolean): void {
    if (this.benchmarkActive || this.descentBenchmarkActive) return;
    this.targetLocked = locked;
  }

  public setMuted(muted: boolean): void {
    this.soundEngine.setMuted(muted);
  }

  public setAutoQuality(enabled: boolean): void {
    this.qualityScaler.setEnabled(enabled);
  }

  public setSliderDragging(dragging: boolean): void {
    this.qualityScaler.setSliderDragging(dragging);
  }

  public setSettingsPanelOpen(open: boolean): void {
    this.settingsPanelOpen = open;
  }

  private getTargetPixelRatio(): number {
    if (this.diagnostics.halfResolution) {
      return 0.5;
    }
    const presetPr = this.qualityScaler.getCurrentPreset().pixelRatio;
    const minAllowed = Math.min(presetPr, 0.4);
    return Math.max(minAllowed, presetPr * this.descentScale);
  }

  private applyEffectivePixelRatio(force = false): void {
    const targetPr = this.getTargetPixelRatio();
    const targetW = Math.max(1, Math.floor(this.lastViewportW * targetPr));
    const targetH = Math.max(1, Math.floor(this.lastViewportH * targetPr));
    const curW = this.renderer.domElement.width;
    const curH = this.renderer.domElement.height;
    const delta = Math.abs(targetPr - this.appliedPixelRatio);

    if (!force && curW === targetW && curH === targetH && delta < 0.004) {
      return;
    }
    this.appliedPixelRatio = targetPr;
    this.renderer.setPixelRatio(targetPr);
    this.renderer.setSize(this.lastViewportW, this.lastViewportH);
    this.spaceBackground.setPixelRatio(targetPr);
  }

  private updateDescentScale(dt: number): void {
    this.descentScaleCooldown = Math.max(0, this.descentScaleCooldown - dt);

    const presetPr = this.qualityScaler.getCurrentPreset().pixelRatio;
    const minScaleFromPr = presetPr > 0 ? Math.min(1.0, 0.4 / presetPr) : 1.0;
    const targetLowScale = Math.max(0.72, minScaleFromPr);
    const targetMidScale = (targetLowScale + 1.0) * 0.5;

    const hardDisabled =
      !this.descentScaleEnabled ||
      this.benchmarkActive ||
      this.diagnostics.halfResolution;
    if (hardDisabled) {
      this.descentScale = 1.0;
      this.descentScaleLowSpeedTimer = 0;
      this.descentScaleCooldown = 0;
      return;
    }

    const allowed =
      this.playerMode === 'ship' &&
      this.physics.landing.state === 'flying' &&
      !this.settingsPanelOpen;

    if (!allowed) {
      this.descentScaleLowSpeedTimer = 0;
      if (this.descentScale < 0.9999 && this.descentScaleCooldown <= 0) {
        if (this.descentScale < targetMidScale - 0.001) {
          this.descentScale = targetMidScale;
        } else {
          this.descentScale = 1.0;
        }
        this.descentScaleCooldown = 0.4;
      }
      return;
    }

    _localUp.copy(this.physics.shipRoot.position).normalize();
    const radialVel = this.physics.velocity.dot(_localUp);
    const alt = this.physics.shipAltitude;
    const speed = this.physics.velocity.length();
    const reentry = this.physics.reentryIntensity;

    const isDescending = radialVel < -0.8;
    const danger = (isDescending && alt < 260 && speed > 10) || reentry > 0.1;

    if (danger) {
      this.descentScaleLowSpeedTimer = 0;
      if (
        this.descentScale > targetLowScale + 0.001 &&
        this.descentScaleCooldown <= 0
      ) {
        this.descentScale = targetLowScale;
        this.descentScaleCooldown = 0.4;
      }
      return;
    }

    if (this.descentScale >= 0.9999) {
      this.descentScale = 1.0;
      this.descentScaleLowSpeedTimer = 0;
      return;
    }

    if (speed < 4.0) {
      this.descentScaleLowSpeedTimer += dt;
    } else {
      this.descentScaleLowSpeedTimer = 0;
    }

    const curFps = 1 / Math.max(this.avgFpsDt, 0.001);
    if (
      this.descentScaleLowSpeedTimer >= 1.0 &&
      curFps > 50 &&
      this.descentScaleCooldown <= 0
    ) {
      if (this.descentScale < targetMidScale - 0.001) {
        this.descentScale = targetMidScale;
      } else {
        this.descentScale = 1.0;
      }
      this.descentScaleCooldown = 0.4;
    }
  }

  private syncQualityScalerPause(): void {
    const shouldPause =
      this.scalerPausedByHalfRes || this.scalerPausedByBenchmark;
    if (shouldPause && !this.qualityScaler.isPaused()) {
      this.qualityScaler.pause();
    } else if (!shouldPause && this.qualityScaler.isPaused()) {
      this.qualityScaler.resume();
    }
  }

  public setDiagnostics(flags: DiagnosticFlags): void {
    const prev = this.diagnostics;
    this.diagnostics = { ...flags };

    if (flags.simpleTerrain !== prev.simpleTerrain) {
      this.planetManager.setForceOrbitalTerrain(flags.simpleTerrain);
    }
    if (flags.noAtmosphere !== prev.noAtmosphere) {
      this.planetManager.setAtmosphereVisible(!flags.noAtmosphere);
    }
    if (
      flags.noAtmosphere !== prev.noAtmosphere ||
      flags.terrainNoSkyAtmo !== prev.terrainNoSkyAtmo
    ) {
      this.scene.fog =
        flags.noAtmosphere || flags.terrainNoSkyAtmo ? null : this.fog;
    }
    if (flags.terrainNoSkyAtmo !== prev.terrainNoSkyAtmo) {
      this.hemiLight.visible = !flags.terrainNoSkyAtmo;
      this.scene.environment = flags.terrainNoSkyAtmo
        ? null
        : this.envRT.texture;
    }
    if (flags.noSpaceBackdrop !== prev.noSpaceBackdrop) {
      this.spaceBackground.root.visible = !flags.noSpaceBackdrop;
    }
    if (flags.noFlora !== prev.noFlora) {
      this.floraManager.setForceDisabled(flags.noFlora);
    }
    if (flags.hideShip !== prev.hideShip) {
      this.shipModel.group.visible = !flags.hideShip;
    }
    if (flags.hideCharacter !== prev.hideCharacter) {
      this.character.setForceHidden(flags.hideCharacter);
    }
    if (flags.halfResolution !== prev.halfResolution) {
      this.scalerPausedByHalfRes = flags.halfResolution;
      this.syncQualityScalerPause();
      this.applyEffectivePixelRatio(true);
    }
    if (
      flags.noProceduralGrass !== prev.noProceduralGrass ||
      flags.noContours !== prev.noContours ||
      flags.noPixelBiomeBlend !== prev.noPixelBiomeBlend ||
      flags.noNoiseDetail !== prev.noNoiseDetail
    ) {
      this.planetManager.setTerrainShaderDiagnostics({
        noProceduralGrass: flags.noProceduralGrass,
        noContours: flags.noContours,
        noPixelBiomeBlend: flags.noPixelBiomeBlend,
        noNoiseDetail: flags.noNoiseDetail,
      });
    }
    if (
      flags.noReceiveShadow !== prev.noReceiveShadow ||
      flags.terrainNoSkyAtmo !== prev.terrainNoSkyAtmo
    ) {
      this.planetManager.setNoReceiveShadow(
        flags.noReceiveShadow || flags.terrainNoSkyAtmo,
      );
    }
    if (flags.terrainNoTexture !== prev.terrainNoTexture) {
      this.planetManager.setTerrainNoTexture(flags.terrainNoTexture);
    }
    if (flags.terrainNoLighting !== prev.terrainNoLighting) {
      this.planetManager.setTerrainNoLighting(flags.terrainNoLighting);
    }
    if (flags.terrainFewerPatches !== prev.terrainFewerPatches) {
      this.planetManager.setTerrainFewerPatches(flags.terrainFewerPatches);
    }
    if (flags.showColliders !== prev.showColliders) {
      this.shipCollidersDebugGroup.visible = flags.showColliders;
      this.treeCollidersDebugGroup.visible = flags.showColliders;
    }
    if (flags.noPois !== prev.noPois) {
      this.poiManager.setForceDisabled(flags.noPois);
    }
    if (flags.noPoiEffects !== prev.noPoiEffects) {
      this.poiManager.setEffectsDisabled(flags.noPoiEffects);
    }
    if (flags.noPoiHudMarkers && !prev.noPoiHudMarkers) {
      for (let i = 0; i < 3; i++) {
        this.poiHudMarkers[i].active = false;
      }
      this.callbacks.onPoiMarkersFrame?.(this.poiHudMarkers);
    }

    this.lastOtherAudit = -10;
    this.lastTelemetryEmit = -1;
  }

  public startBenchmark(): void {
    if (this.benchmarkActive || this.descentBenchmarkActive || this.disposed) return;
    this.inputController.clearFirePointers();
    this.benchmarkActive = true;
    this.descentScale = 1.0;
    this.descentScaleLowSpeedTimer = 0;
    this.descentScaleCooldown = 0;
    this.applyEffectivePixelRatio(true);
    this.scalerPausedByBenchmark = true;
    this.syncQualityScalerPause();
    this.cameraRig.setFrozen(true);
    this.benchmarkResults = [];
    this.beginBenchmarkStep(0);
  }

  private warmupShaders(): Promise<void> {
    if (this.warmupPromise) return this.warmupPromise;

    this.warmupPromise = (async () => {
      if (this.disposed) return;
      this.warmupActive = true;
      const shadowsEnabled = this.qualityScaler.getCurrentPreset().shadowsEnabled;
      const prevFog = this.scene.fog;
      const prevEnv = this.scene.environment;

      this.planetManager.prepareForShaderWarmup(shadowsEnabled);
      this.spaceBackground.prepareForShaderWarmup();
      this.floraManager.prepareForShaderWarmup(shadowsEnabled);
      this.poiManager.prepareForShaderWarmup();
      this.particleSystem.prepareForShaderWarmup();
      this.weaponsSystem.prepareForShaderWarmup();
      this.physics.prepareForShaderWarmup();
      this.character.prepareForShaderWarmup();
      this.warmupSavedBeaconVisibles.clear();
      this.beaconController.model.group.traverse((obj) => {
        this.warmupSavedBeaconVisibles.set(obj, obj.visible);
        obj.visible = true;
      });
      this.scene.fog = this.fog;
      this.scene.environment = this.envRT.texture;

      try {
        if (typeof this.renderer.compileAsync === 'function') {
          await this.renderer.compileAsync(this.scene, this.cameraRig.camera);
        } else {
          this.renderer.compile(this.scene, this.cameraRig.camera);
        }
      } catch {
        if (!this.disposed) {
          this.renderer.compile(this.scene, this.cameraRig.camera);
        }
      } finally {
        this.scene.fog = prevFog;
        this.scene.environment = prevEnv;
        this.beaconController.model.group.traverse((obj) => {
          const vis = this.warmupSavedBeaconVisibles.get(obj);
          if (vis !== undefined) obj.visible = vis;
        });
        this.warmupSavedBeaconVisibles.clear();
        this.character.restoreAfterShaderWarmup();
        this.physics.restoreAfterShaderWarmup();
        this.weaponsSystem.restoreAfterShaderWarmup();
        this.particleSystem.restoreAfterShaderWarmup();
        this.poiManager.restoreAfterShaderWarmup();
        this.floraManager.restoreAfterShaderWarmup();
        this.spaceBackground.restoreAfterShaderWarmup();
        this.planetManager.restoreAfterShaderWarmup();
        this.warmupActive = false;
        this.warmupPromise = null;
      }
    })();

    return this.warmupPromise;
  }

  public startDescentBenchmark(): void {
    if (this.benchmarkActive || this.descentBenchmarkActive || this.disposed) return;
    this.inputController.clearFirePointers();
    this.inputController.releaseAllInputs();
    this.descentBenchmarkActive = true;
    this.descentInitialQualityLevel = this.qualityScaler.getLevel();
    this.descentInitialAutoEnabled = this.qualityScaler.isEnabled();
    this.scalerPausedByBenchmark = true;
    this.syncQualityScalerPause();

    if (this.playerMode !== 'ship') {
      this.playerMode = 'ship';
      this.shipModel.setPilotSeated(true);
      this.inputController.setPlayerMode('ship');
      this.character.setVisible(false);
    }

    this.descentPrevCamMode =
      this.config.cameraMode === 'orbit' ? 'orbit' : null;
    if (this.descentPrevCamMode) {
      this.cameraRig.setMode('chase', this.physics.shipRoot.position);
    }

    this.descentRuns = [];
    void this.runDescentBenchmarkStartup();
  }

  private async runDescentBenchmarkStartup(): Promise<void> {
    this.callbacks.onBenchmarkProgress?.({
      active: true,
      kind: 'descent',
      stepIndex: 0,
      totalSteps: DESCENT_BENCHMARK_STEPS.length,
      label: 'Aquecendo shaders',
      remainingSec: 18,
      altitude: this.physics.shipAltitude,
    });
    await this.warmupShaders();
    if (this.disposed || !this.descentBenchmarkActive) return;
    this.beginDescentStep(0);
  }

  private resetDescentRunAccumulators(): void {
    this.planetManager.consumeBuiltPatchCount();
    this.floraManager.consumeBuiltCellCount();

    this.hasPendingDescentFrame = false;
    this.descentElapsed = 0;
    this.descentBraking = false;
    this.descentGroundHoverActive = false;
    this.descentGroundElapsed = 0;
    this.descentGroundDt = 0;
    this.descentGroundFrames = 0;
    this.descentStallChecked = false;
    this.descentAutopilotMaxSpeed = 120;
    this.descentSamples = [];
    this.descentBucketDt = 0;
    this.descentBucketFrames = 0;
    this.descentBucketWorstMs = 0;
    this.descentBucketWorstCulprit = '—';
    this.descentBucketWorstBreakdown = '';
    this.descentBucketCpuSum = 0;
    this.descentBucketHitches = 0;
    this.descentBucketCallsSum = 0;
    this.descentBucketTrisSum = 0;
    this.descentBucketParticlesSum = 0;
    this.descentBucketMaxReentry = 0;
    this.descentBucketGlowActive = false;
    this.descentBucketBannerActive = false;
    this.descentBucketParticlesActive = false;
    this.descentRunWorstMs = 0;
    this.descentRunWorstCulprit = '—';
    this.descentLastProgressEmit = -1;
    this.descentRunMinScale = this.descentScale;
  }

  private snapshotDescentStartGraphicsState(): void {
    this.descentStartQualityLevel = this.qualityScaler.getLevel();
    this.descentStartPixelRatio = this.renderer.getPixelRatio();
    this.descentStartCanvasWidth = this.renderer.domElement.width;
    this.descentStartCanvasHeight = this.renderer.domElement.height;
    this.descentStartShadowMapEnabled = this.renderer.shadowMap.enabled;
    this.descentStartFloraDensityRatio = this.floraDensityRatio;
    this.descentStartFloraViewRatio = this.floraViewRatio;
    this.descentStartScale = this.descentScale;
    this.descentRunMinScale = this.descentScale;
  }

  private beginDescentStep(idx: number): void {
    this.descentStepIdx = idx;
    const stepDef = DESCENT_BENCHMARK_STEPS[idx];

    // Always pause QualityScaler during the 2s orbit wait so all runs start from identical conditions
    this.scalerPausedByBenchmark = true;
    this.syncQualityScalerPause();
    this.qualityScaler.setEnabledSilent(this.descentInitialAutoEnabled);

    this.descentScaleEnabled = stepDef.key === 'descentScale';
    this.descentScale = 1.0;
    this.descentScaleLowSpeedTimer = 0;
    this.descentScaleCooldown = 0;

    this.setDiagnostics({ ...DEFAULT_DIAGNOSTICS });
    const forceLowLevel =
      stepDef.key === 'qualityLevel3' ||
      stepDef.key === 'noAtmosphere' ||
      stepDef.key === 'noFlora' ||
      stepDef.key === 'hideShipAll';
    const targetLevel: QualityLevel = forceLowLevel
      ? 3
      : this.descentInitialQualityLevel;
    this.qualityScaler.forceLevel(targetLevel);
    this.setDiagnostics(stepDef.flags);

    const hideParticles = stepDef.key === 'hideShipAll';
    this.particleSystem.root.visible = !hideParticles;
    this.physics.setForceHideHoverShadow(hideParticles);

    if (stepDef.key === 'noShadows') {
      if (this.renderer.shadowMap.enabled) {
        this.renderer.shadowMap.enabled = false;
        this.keyLight.castShadow = false;
        this.renderer.shadowMap.needsUpdate = true;
      }
      this.floraManager.setCastShadows(false);
    }
    this.applyEffectivePixelRatio(true);

    this.prevLandingState = 'flying';
    this.floraManager.setClearing(null, 8);

    // Deterministic fixed orbit over land above the atmosphere, nose pointed at planet center
    this.planetManager.findLandDirection(0, _benchDir);
    const surfR = this.planetManager.getSurfaceRadiusAt(
      _benchDir.x,
      _benchDir.y,
      _benchDir.z,
    );
    const startAlt = Math.max(this.config.planet.atmosphereHeight + 180, 220);
    _snapLookAt.copy(_benchDir).multiplyScalar(surfR + startAlt);

    const refAxis = Math.abs(_benchDir.y) < 0.9 ? _benchUnitY : _benchUnitX;
    _benchRight.crossVectors(refAxis, _benchDir).normalize();
    _benchForward.copy(_benchDir).negate();
    _benchUp.crossVectors(_benchRight, _benchForward).normalize();
    _benchBack.copy(_benchForward).negate();
    _benchBasis.makeBasis(_benchRight, _benchUp, _benchBack);

    const targetQuat = this.physics.shipQuat.setFromRotationMatrix(_benchBasis);
    this.descentOrbitPos.copy(_snapLookAt);
    this.descentOrbitQuat.copy(targetQuat);
    this.descentStartAlt = startAlt;
    this.physics.prepareDescentState(
      this.descentOrbitPos,
      this.descentOrbitQuat,
      startAlt,
      this.config.planet.atmosphereHeight,
    );

    this.initSunPhaseForSpot(this.physics.shipRoot.position);

    _snapCamPos
      .copy(this.physics.shipRoot.position)
      .addScaledVector(_benchForward, -16)
      .addScaledVector(_benchUp, 4.2);
    _snapLookAt
      .copy(this.physics.shipRoot.position)
      .addScaledVector(_benchForward, 135);
    this.cameraRig.snapTo(_snapCamPos, _snapLookAt, _benchUp, false);

    this.descentPhase = 'wait';
    this.descentWaitElapsed = 0;
    this.resetDescentRunAccumulators();
    this.snapshotDescentStartGraphicsState();

    this.callbacks.onBenchmarkProgress?.({
      active: true,
      kind: 'descent',
      stepIndex: idx,
      totalSteps: DESCENT_BENCHMARK_STEPS.length,
      label: `${stepDef.bannerLabel} (órbita 2s)`,
      remainingSec: 18,
      altitude: startAlt,
    });
  }

  private applyDescentAutopilotInputs(): void {
    const posLen = this.physics.shipRoot.position.length();
    if (posLen > 0.001) {
      _benchDir
        .copy(this.physics.shipRoot.position)
        .divideScalar(-posLen);
    } else {
      _benchDir.set(0, -1, 0);
    }

    _benchForward.set(0, 0, -1).applyQuaternion(this.physics.shipQuat);
    _benchRight.set(1, 0, 0).applyQuaternion(this.physics.shipQuat);
    _benchUp.set(0, 1, 0).applyQuaternion(this.physics.shipQuat);

    if (this.descentGroundHoverActive) {
      // Stationary 5s ground hover at ~10m altitude: level nose horizontally and zero thrust
      const radialUpDotFwd = -_benchDir.dot(_benchForward);
      const radialUpDotUp = -_benchDir.dot(_benchUp);
      const signToSky = radialUpDotUp >= 0 ? 1 : -1;
      AUTOPILOT_INPUTS.turn = 0;
      AUTOPILOT_INPUTS.pitch = THREE.MathUtils.clamp(
        -radialUpDotFwd * 2.5 * signToSky,
        -0.8,
        0.8,
      );
      AUTOPILOT_INPUTS.thrust = 0;
      AUTOPILOT_INPUTS.isThrusting = false;
      AUTOPILOT_INPUTS.isBoosting = false;
      this.descentAutopilotMaxSpeed = 0;
      return;
    }

    // Point directly toward the planet center (0, 0, 0) using standard player pitch/yaw inputs
    const rightDot = _benchDir.dot(_benchRight);
    const upDot = _benchDir.dot(_benchUp);
    const fwdDot = _benchDir.dot(_benchForward);

    AUTOPILOT_INPUTS.turn = THREE.MathUtils.clamp(-rightDot * 3.5, -1, 1);
    AUTOPILOT_INPUTS.pitch =
      fwdDot < -0.2 && Math.abs(upDot) < 0.15
        ? 1
        : THREE.MathUtils.clamp(upDot * 3.5, -1, 1);

    const alt = this.physics.shipAltitude;
    const atmoH = Math.max(10, this.config.planet.atmosphereHeight);
    const forwardSpeed = this.physics.velocity.dot(_benchForward);

    if (!this.descentBraking && alt <= 60) {
      this.descentBraking = true;
    }

    if (this.descentBraking) {
      // Smooth braking starting from 60 m altitude down to ~10 m hover
      AUTOPILOT_INPUTS.isBoosting = false;
      AUTOPILOT_INPUTS.isThrusting = false;
      this.descentAutopilotMaxSpeed = 70;
      const frac = THREE.MathUtils.clamp((alt - 10.0) / 50.0, 0, 1);
      const targetSpeed = 6.0 + 22.0 * Math.pow(frac, 1.5);
      AUTOPILOT_INPUTS.thrust = THREE.MathUtils.clamp(
        (targetSpeed - forwardSpeed) / 10,
        -1,
        0.35,
      );
    } else if (alt > atmoH) {
      // Turbo allowed only outside atmosphere up to 120 m/s
      this.physics.turboCharge = 1.0;
      this.physics.turboExhausted = false;
      AUTOPILOT_INPUTS.thrust = 1;
      AUTOPILOT_INPUTS.isThrusting = true;
      AUTOPILOT_INPUTS.isBoosting = true;
      this.descentAutopilotMaxSpeed = 120;
    } else {
      // Inside atmosphere: cap speed at 70 m/s (smoothly tightening near top of atmosphere)
      AUTOPILOT_INPUTS.isBoosting = false;
      this.descentAutopilotMaxSpeed = THREE.MathUtils.lerp(
        70,
        120,
        THREE.MathUtils.smoothstep(alt, atmoH * 0.82, atmoH),
      );
      if (forwardSpeed > 70) {
        AUTOPILOT_INPUTS.thrust = THREE.MathUtils.clamp(
          (70 - forwardSpeed) / 14,
          -1,
          0,
        );
        AUTOPILOT_INPUTS.isThrusting = false;
      } else {
        AUTOPILOT_INPUTS.thrust = 1;
        AUTOPILOT_INPUTS.isThrusting = true;
      }
    }
  }

  private flushDescentSample(
    altOverride?: number,
    speedOverride?: number,
    atmoPctOverride?: number,
  ): void {
    const frames = Math.max(1, this.descentBucketFrames);
    const dtSum = Math.max(0.001, this.descentBucketDt);
    const reentryPeak = Math.max(
      this.descentBucketMaxReentry,
      this.physics.reentryIntensity,
    );
    this.descentSamples.push({
      second: Number(((this.descentSamples.length + 1) * 0.5).toFixed(1)),
      altitude: altOverride ?? this.physics.shipAltitude,
      speed: speedOverride ?? this.physics.velocity.length(),
      atmospherePct: atmoPctOverride ?? this.physics.atmospherePct,
      reentryIntensity: reentryPeak,
      reentryGlowActive: this.descentBucketGlowActive,
      reentryBannerActive: this.descentBucketBannerActive,
      reentryParticlesActive: this.descentBucketParticlesActive,
      fps: frames / dtSum,
      worstFrameMs: this.descentBucketWorstMs,
      cpuMs: this.descentBucketCpuSum / frames,
      culprit: this.descentBucketWorstCulprit,
      worstFrameSubsystems: this.descentBucketWorstBreakdown,
      hitches: this.descentBucketHitches,
      drawCalls: Math.round(this.descentBucketCallsSum / frames),
      triangles: Math.round(this.descentBucketTrisSum / frames),
      activeParticles: Math.round(this.descentBucketParticlesSum / frames),
      // Real counters:
      // - terrainPatchesBuilt: PlanetTerrainManager patches/orbital buffers rebuilt with needsUpdate = true
      // - floraCellsBuilt: FloraManager uncached cells built in generateGroupData() + InstancedMesh uploads (needsUpdate = true)
      terrainPatchesBuilt: this.planetManager.consumeBuiltPatchCount(),
      floraCellsBuilt: this.floraManager.consumeBuiltCellCount(),
      qualityLevel: this.pendingQualityLevel,
      qualityPaused: this.pendingQualityPaused,
      descentScale: this.pendingDescentScale,
      pixelRatio: this.pendingPixelRatio,
      canvasWidth: this.pendingCanvasWidth,
      canvasHeight: this.pendingCanvasHeight,
      shadowMapEnabled: this.pendingShadowMapEnabled,
      floraDensityRatio: this.pendingFloraDensityRatio,
      floraViewRatio: this.pendingFloraViewRatio,
    });
    this.descentBucketDt = 0;
    this.descentBucketFrames = 0;
    this.descentBucketWorstMs = 0;
    this.descentBucketWorstCulprit = '—';
    this.descentBucketWorstBreakdown = '';
    this.descentBucketCpuSum = 0;
    this.descentBucketHitches = 0;
    this.descentBucketCallsSum = 0;
    this.descentBucketTrisSum = 0;
    this.descentBucketParticlesSum = 0;
    this.descentBucketMaxReentry = 0;
    this.descentBucketGlowActive = false;
    this.descentBucketBannerActive = false;
    this.descentBucketParticlesActive = false;
  }

  private buildCurrentDescentRun(): DescentBenchmarkRun {
    const stepDef = DESCENT_BENCHMARK_STEPS[this.descentStepIdx];
    const samples = [...this.descentSamples];
    let fpsSum = 0;
    let minFps = Infinity;
    let worstFrameMs = 0;
    let cpuSum = 0;
    let totalHitches = 0;
    let peakReentry = 0;
    let totalPatchesBuilt = 0;
    let totalFloraCellsBuilt = 0;

    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      fpsSum += s.fps;
      if (s.fps < minFps) minFps = s.fps;
      if (s.worstFrameMs > worstFrameMs) worstFrameMs = s.worstFrameMs;
      cpuSum += s.cpuMs;
      totalHitches += s.hitches;
      if (s.reentryIntensity > peakReentry) peakReentry = s.reentryIntensity;
      totalPatchesBuilt += s.terrainPatchesBuilt;
      totalFloraCellsBuilt += s.floraCellsBuilt;
    }

    const avgFps = samples.length > 0 ? fpsSum / samples.length : 0;
    const groundAvgFps =
      this.descentGroundDt > 0.1 && this.descentGroundFrames > 0
        ? this.descentGroundFrames / this.descentGroundDt
        : avgFps;

    const summary: DescentBenchmarkSummary = {
      avgFps,
      minFps: Number.isFinite(minFps) ? minFps : 0,
      groundAvgFps,
      worstFrameMs,
      worstCulprit: this.descentRunWorstCulprit,
      avgCpuMs: samples.length > 0 ? cpuSum / samples.length : 0,
      totalHitches,
      peakReentry,
      totalPatchesBuilt,
      totalFloraCellsBuilt,
      durationSec: this.descentElapsed,
      qualityLevel: this.descentStartQualityLevel,
      qualityLevelEnd: this.qualityScaler.getLevel(),
      qualityPaused: this.qualityScaler.isPaused(),
      descentScaleStart: this.descentStartScale,
      descentScaleMin: this.descentRunMinScale,
      descentScaleEnd: this.descentScale,
      pixelRatio: this.descentStartPixelRatio,
      pixelRatioEnd: this.renderer.getPixelRatio(),
      canvasWidth: this.descentStartCanvasWidth,
      canvasHeight: this.descentStartCanvasHeight,
      canvasWidthEnd: this.renderer.domElement.width,
      canvasHeightEnd: this.renderer.domElement.height,
      shadowMapEnabled: this.descentStartShadowMapEnabled,
      shadowMapEnabledEnd: this.renderer.shadowMap.enabled,
      floraDensityRatio: this.descentStartFloraDensityRatio,
      floraDensityRatioEnd: this.floraDensityRatio,
      floraViewRatio: this.descentStartFloraViewRatio,
      floraViewRatioEnd: this.floraViewRatio,
    };

    return {
      id: this.descentRuns.length + 1,
      key: stepDef.key === 'warmup' ? 'default' : stepDef.key,
      label: stepDef.label,
      samples,
      summary,
    };
  }

  private finishDescentBenchmark(
    cancelled: boolean,
    errorMessage?: string,
  ): void {
    this.descentBenchmarkActive = false;
    this.hasPendingDescentFrame = false;
    this.descentScaleEnabled = true;
    this.descentScale = 1.0;
    this.descentScaleLowSpeedTimer = 0;
    this.descentScaleCooldown = 0;
    this.particleSystem.root.visible = true;
    this.physics.setForceHideHoverShadow(false);
    this.setDiagnostics({ ...DEFAULT_DIAGNOSTICS });
    this.callbacks.onDiagnosticsRestored?.({ ...DEFAULT_DIAGNOSTICS });
    this.qualityScaler.setEnabledSilent(this.descentInitialAutoEnabled);
    this.qualityScaler.forceLevel(this.descentInitialQualityLevel);
    this.scalerPausedByBenchmark = false;
    this.syncQualityScalerPause();
    this.applyEffectivePixelRatio(true);
    if (this.descentPrevCamMode) {
      this.cameraRig.setMode(
        this.descentPrevCamMode,
        this.physics.shipRoot.position,
      );
      this.descentPrevCamMode = null;
    }
    this.callbacks.onBenchmarkProgress?.(null);

    if (errorMessage) {
      this.callbacks.onDescentBenchmarkError?.(errorMessage);
    } else if (!cancelled && this.descentRuns.length > 0) {
      this.callbacks.onDescentBenchmarkComplete?.([...this.descentRuns]);
    }
    this.lastTelemetryEmit = -1;
  }

  public cancelBenchmark(): void {
    if (this.descentBenchmarkActive) {
      this.finishDescentBenchmark(true);
      return;
    }
    if (!this.benchmarkActive) return;
    this.finishBenchmark(true);
  }

  private beginBenchmarkStep(idx: number): void {
    this.benchmarkStepIdx = idx;
    this.benchmarkStepElapsed = 0;
    this.benchmarkMeasureFrames = 0;
    this.benchmarkMeasureDtSum = 0;
    this.benchmarkMeasureCpuSum = 0;
    this.benchmarkMeasureCallsSum = 0;
    this.benchmarkMeasureTrisSum = 0;
    this.benchmarkMeasureHitches = 0;
    this.benchmarkPoiUpdateSum = 0;
    this.benchmarkPoiUpdateWorst = 0;
    this.benchmarkPoiHudSum = 0;
    this.benchmarkPoiHudWorst = 0;
    this.benchmarkAutosaveSum = 0;
    this.benchmarkAutosaveWorst = 0;
    this.benchmark1sElapsed = 0;
    this.benchmark1sFrames = 0;
    this.benchmarkWorst1sFps = Infinity;
    this.benchmarkLastProgressEmit = -1;

    const stepDef = BENCHMARK_STEPS[idx];
    this.setDiagnostics(stepDef.flags);
    this.callbacks.onBenchmarkProgress?.({
      active: true,
      kind: 'static',
      stepIndex: idx,
      totalSteps: BENCHMARK_STEPS.length,
      label: stepDef.bannerLabel,
      remainingSec: BENCHMARK_STEP_DURATION,
    });
  }

  private finishBenchmark(cancelled: boolean): void {
    this.benchmarkActive = false;
    this.setDiagnostics({ ...DEFAULT_DIAGNOSTICS });
    this.callbacks.onDiagnosticsRestored?.({ ...DEFAULT_DIAGNOSTICS });
    this.scalerPausedByBenchmark = false;
    this.syncQualityScalerPause();
    this.cameraRig.setFrozen(false);
    this.callbacks.onBenchmarkProgress?.(null);
    if (!cancelled) {
      this.callbacks.onBenchmarkComplete?.([...this.benchmarkResults]);
    }
    this.lastTelemetryEmit = -1;
  }

  private applyQualityPreset(preset: QualityPreset): void {
    if (!this.diagnostics.halfResolution) {
      this.applyEffectivePixelRatio(true);
    }
    this.spaceBackground.setStarRatio(preset.starRatio);
    if (this.renderer.shadowMap.enabled !== preset.shadowsEnabled) {
      this.renderer.shadowMap.enabled = preset.shadowsEnabled;
      this.keyLight.castShadow = preset.shadowsEnabled;
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.particleRatio = preset.particleRatio;
    this.floraDensityRatio = preset.floraDensityRatio;
    this.floraViewRatio = preset.floraViewRatio;
    this.planetManager.setGrassDetail(
      preset.terrainDetailRatio,
      this.isSoftwareGl || this.isMobileDevice,
    );
    this.floraManager.setCastShadows(preset.shadowsEnabled);
    this.emitTelemetry();
  }

  private incrementPerfTag(tag: string): void {
    switch (tag) {
      case 'nave':
        this.otherBreakdown.nave++;
        break;
      case 'alvo':
        this.otherBreakdown.alvo++;
        break;
      case 'fundo':
        this.otherBreakdown.fundo++;
        break;
      case 'atmLua':
        this.otherBreakdown.atmLua++;
        break;
      case 'fx':
        this.otherBreakdown.fx++;
        break;
    }
  }

  private visitPerfObject(obj: THREE.Object3D, inheritedTag?: string): void {
    if (!obj.visible) return;
    const tag = (obj.userData?.perfTag as string | undefined) ?? inheritedTag;
    if (tag === 'flora') return;
    if (tag) {
      const inst = obj as THREE.InstancedMesh;
      const mesh = obj as THREE.Mesh;
      const pts = obj as THREE.Points;
      const line = obj as THREE.Line;
      if (inst.isInstancedMesh) {
        if (inst.count > 0) {
          this.incrementPerfTag(tag);
        }
      } else if (mesh.isMesh || pts.isPoints || line.isLine) {
        this.incrementPerfTag(tag);
      }
    }
    const children = obj.children;
    for (let i = 0; i < children.length; i++) {
      this.visitPerfObject(children[i], tag);
    }
  }

  private auditOtherDraws(): void {
    this.otherBreakdown.nave = 0;
    this.otherBreakdown.alvo = 0;
    this.otherBreakdown.fundo = 0;
    this.otherBreakdown.atmLua = 0;
    this.otherBreakdown.fx = 0;
    const roots = this.scene.children;
    for (let i = 0; i < roots.length; i++) {
      this.visitPerfObject(roots[i]);
    }
  }

  private initSunPhaseForSpot(spot: THREE.Vector3): void {
    const len = spot.length();
    if (len < 0.001) {
      this.sunPhaseOffset = 0.6;
      return;
    }
    const ux = spot.x / len;
    const uy = spot.y / len;
    const uz = spot.z / len;
    const peakTheta = Math.atan2(
      uy * Math.sin(SUN_ORBIT_TILT) + uz * Math.cos(SUN_ORBIT_TILT),
      ux,
    );
    // Start in bright morning/mid-morning moving toward noon -> sunset -> night
    this.sunPhaseOffset = peakTheta - 0.5;
  }

  private computeSunDir(elapsed: number, out: THREE.Vector3): THREE.Vector3 {
    const theta =
      this.sunPhaseOffset + elapsed * ((Math.PI * 2) / DAY_CYCLE_SECONDS);
    const sinT = Math.sin(theta);
    return out
      .set(
        Math.cos(theta),
        sinT * Math.sin(SUN_ORBIT_TILT),
        sinT * Math.cos(SUN_ORBIT_TILT),
      )
      .normalize();
  }

  private syncLandingClearing(): void {
    const curState = this.physics.landing.state;
    if (curState === this.prevLandingState) return;
    this.prevLandingState = curState;

    if (curState === 'landed') {
      this.lastLandingDir.copy(this.physics.landing.landedDir);
      this.lastLandingBody = this.physics.landing.landedBody;
      this.playerMode = 'character';
      this.shipModel.setPilotSeated(false);
      this.inputController.setPlayerMode('character');
      this.character.spawnNearShip(
        this.physics.shipRoot.position,
        this.physics.shipQuat,
        this.physics.landing.landedBody,
        this.planetManager,
      );
      if (this.config.cameraMode === 'orbit') {
        this.cameraRig.setMode('orbit', this.character.root.position);
      } else {
        this.cameraRig.updateCharacter(0.016, {
          shipOrbitMode: false,
          characterCamera: this.config.characterCamera,
          charPos: this.character.root.position,
          upDir: this.character.upDir,
          rightDir: this.character.rightDir,
          aimDir: this.character.aimDir,
          speed: 0,
          activeBody: this.character.activeBody,
          planetManager: this.planetManager,
        });
      }
    } else {
      if (this.playerMode !== 'ship') {
        this.playerMode = 'ship';
        this.shipModel.setPilotSeated(true);
        this.inputController.setPlayerMode('ship');
        this.character.setVisible(false);
        if (this.config.cameraMode === 'orbit') {
          this.cameraRig.setMode('orbit', this.physics.shipRoot.position);
        }
      }
    }

    if (
      (curState === 'landing' || curState === 'landed') &&
      this.physics.landing.landedBody === 'planet'
    ) {
      const pos = this.physics.shipRoot.position;
      const lenSq = pos.lengthSq();
      if (lenSq > 0.0001) {
        _clearingPos.copy(pos).divideScalar(Math.sqrt(lenSq));
      } else {
        _clearingPos.set(0, 1, 0);
      }
      const surfR = this.planetManager.getSurfaceRadiusAt(
        _clearingPos.x,
        _clearingPos.y,
        _clearingPos.z,
      );
      _clearingPos.multiplyScalar(surfR);
      this.floraManager.setClearing(_clearingPos, 8);
    } else if (curState === 'flying') {
      this.floraManager.setClearing(null, 8);
    }
  }

  public toggleJetpack(): void {
    if (
      this.benchmarkActive ||
      this.descentBenchmarkActive ||
      this.playerMode !== 'character'
    ) {
      return;
    }
    this.soundEngine.unlock();
    this.character.toggleJetpack();
    this.lastTelemetryEmit = -1;
  }

  public toggleDampeners(): void {
    if (
      this.benchmarkActive ||
      this.descentBenchmarkActive ||
      this.playerMode !== 'character'
    ) {
      return;
    }
    this.character.toggleDampeners();
    this.lastTelemetryEmit = -1;
  }

  public toggleCharacterCamera(): void {
    if (
      this.benchmarkActive ||
      this.descentBenchmarkActive ||
      this.playerMode !== 'character'
    ) {
      return;
    }
    const next: CharacterCameraMode =
      this.config.characterCamera === 'third' ? 'first' : 'third';
    this.config.characterCamera = next;
    this.callbacks.onCharacterCameraChange?.(next);
    this.lastTelemetryEmit = -1;
  }

  public toggleLanding(): void {
    if (this.benchmarkActive || this.descentBenchmarkActive) return;
    this.soundEngine.unlock();
    this.physics.landing.toggle(
      this.physics.shipRoot.position,
      this.physics.velocity,
      this.planetManager,
      this.landingHooks,
    );
    this.syncLandingClearing();
    this.lastTelemetryEmit = -1;
  }

  public landOnSurface(): void {
    if (this.benchmarkActive || this.descentBenchmarkActive) return;
    this.physics.landOnSurface(
      this.planetManager,
      _snapCamPos,
      _snapLookAt,
      _snapUp,
    );
    this.prevLandingState = 'flying';
    this.cameraRig.snapTo(_snapCamPos, _snapLookAt, _snapUp, true);
    this.syncLandingClearing();
    this.lastTelemetryEmit = -1;
  }

  public teleportToNearestPoi(): void {
    if (this.benchmarkActive || this.descentBenchmarkActive) return;
    const focusPos =
      this.playerMode === 'character'
        ? this.character.root.position
        : this.physics.shipRoot.position;
    const refPos =
      focusPos.length() > this.config.planet.planetRadius + 120
        ? _poiPos.set(0, this.config.planet.planetRadius, 0)
        : focusPos;

    const hit = this.poiManager.getNearestPlanetPoi(refPos, _poiPos, _poiNormal);
    if (!hit.found) {
      this.callbacks.onHudToast?.({
        text: 'Nenhum POI disponível no planeta',
        tone: 'warn',
      });
      return;
    }

    const poiLen = _poiPos.length();
    if (poiLen > 0.001) {
      _poiLandDir.copy(_poiPos).divideScalar(poiLen);
    } else {
      _poiLandDir.set(0, 1, 0);
    }

    if (Math.abs(_poiLandDir.y) < 0.9) {
      _poiTangA.set(0, 1, 0);
    } else {
      _poiTangA.set(1, 0, 0);
    }
    _poiTangA.crossVectors(_poiTangA, _poiLandDir).normalize();
    _poiTangB.crossVectors(_poiLandDir, _poiTangA).normalize();

    const theta = 18 / Math.max(this.config.planet.planetRadius, 30);
    let chosenDirSet = false;
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2;
      _benchDir
        .copy(_poiLandDir)
        .multiplyScalar(Math.cos(theta))
        .addScaledVector(_poiTangA, Math.sin(theta) * Math.cos(ang))
        .addScaledVector(_poiTangB, Math.sin(theta) * Math.sin(ang))
        .normalize();
      const rawNorm = this.planetManager.getRawHeightNormAt(
        _benchDir.x,
        _benchDir.y,
        _benchDir.z,
      );
      if (rawNorm > this.planetManager.getSeaLevel() + 0.02) {
        chosenDirSet = true;
        break;
      }
    }
    if (!chosenDirSet) {
      _benchDir
        .copy(_poiLandDir)
        .multiplyScalar(Math.cos(theta))
        .addScaledVector(_poiTangA, Math.sin(theta))
        .normalize();
    }

    this.physics.restoreToLandingSpot(
      _benchDir,
      'planet',
      this.planetManager,
      _snapCamPos,
      _snapLookAt,
      _snapUp,
    );
    this.prevLandingState = 'flying';
    this.syncLandingClearing();

    // Aim astronaut & camera directly toward the POI so POI + smoke + HUD marker are centered on screen
    if (this.playerMode === 'character') {
      _benchForward
        .subVectors(_poiPos, this.character.root.position)
        .addScaledVector(this.character.upDir, 0.8);
      const radialPart = _benchForward.dot(this.character.upDir);
      _benchForward.addScaledVector(this.character.upDir, -radialPart);
      if (_benchForward.lengthSq() > 0.0001) {
        _benchForward.normalize();
        this.character.forwardDir.copy(_benchForward);
        this.character.rightDir
          .crossVectors(_benchForward, this.character.upDir)
          .normalize();
        this.character.aimDir.copy(_benchForward);
        this.character.lookPitchRad = -0.05;
        _benchBack.copy(_benchForward).negate();
        _benchBasis.makeBasis(
          this.character.rightDir,
          this.character.upDir,
          _benchBack,
        );
        this.character.model.group.quaternion.setFromRotationMatrix(_benchBasis);
      }
      _snapCamPos
        .copy(this.character.root.position)
        .addScaledVector(this.character.upDir, 2.2)
        .addScaledVector(this.character.forwardDir, -4.6)
        .addScaledVector(this.character.rightDir, 0.75);
      _snapLookAt
        .copy(_poiPos)
        .addScaledVector(_poiNormal, 0.9);
      this.cameraRig.snapTo(
        _snapCamPos,
        _snapLookAt,
        this.character.upDir,
        true,
      );
    }

    this.callbacks.onHudToast?.({
      text: `Teleportado próximo a ${hit.label}`,
      tone: 'info',
    });
    this.lastTelemetryEmit = -1;
  }

  public launchToOrbit(): void {
    if (this.benchmarkActive || this.descentBenchmarkActive) return;
    this.physics.launchToOrbit(
      this.config.planet,
      _snapCamPos,
      _snapLookAt,
      _snapUp,
    );
    this.prevLandingState = 'landed';
    this.cameraRig.snapTo(_snapCamPos, _snapLookAt, _snapUp, false);
    this.syncLandingClearing();
    this.lastTelemetryEmit = -1;
  }

  public relocateTarget(
    mode: 'surface' | 'orbit' | 'moon' | 'alternate' = 'alternate',
  ): void {
    if (this.benchmarkActive || this.descentBenchmarkActive) return;
    this.beaconController.relocateTarget(
      mode,
      this.physics.shipRoot.position,
      this.config.planet,
      this.planetManager,
    );
  }

  private handleHullFailureFlow(): void {
    const res = this.playerState.handleHullFailure();
    this.physics.restoreToLandingSpot(
      this.lastLandingDir,
      this.lastLandingBody,
      this.planetManager,
      _snapCamPos,
      _snapLookAt,
      _snapUp,
    );
    this.prevLandingState = 'flying';
    this.cameraRig.snapTo(
      _snapCamPos,
      _snapLookAt,
      _snapUp,
      this.lastLandingBody === 'planet',
    );
    this.syncLandingClearing();
    this.callbacks.onHudToast?.({
      text: `Casco destruído! Nave recuperada no último pouso (-${res.lostCredits} Créditos, casco ${Math.round(res.hullRestored)}%)`,
      tone: 'danger',
    });
    this.lastTelemetryEmit = -1;
  }

  public sellResource(id: ResourceId, amount?: number): void {
    const res = this.playerState.sellResource(id, amount);
    if (res.sold > 0) {
      this.soundEngine.playCollect('crystal');
      this.callbacks.onHudToast?.({
        text: `Vendido ${res.sold}× ${RESOURCES[id].name} (+${res.earned} Créditos)`,
        tone: 'success',
      });
      this.emitTelemetry();
    }
  }

  public sellAllResources(): void {
    const res = this.playerState.sellAllResources();
    if (res.soldTotal > 0) {
      this.soundEngine.playCollect('ruin');
      this.callbacks.onHudToast?.({
        text: `Carga vendida: +${res.earned} Créditos (${res.soldTotal} itens)`,
        tone: 'success',
      });
      this.emitTelemetry();
    }
  }

  public useCrystalForFuel(): void {
    if (
      this.playerMode !== 'ship' &&
      this.physics.landing.state !== 'landed'
    ) {
      this.callbacks.onHudToast?.({
        text: 'Aproxime ou pouse a nave para reabastecer',
        tone: 'warn',
      });
      return;
    }
    const res = this.playerState.useCrystalForFuel();
    if (res.ok) {
      this.reserveToastShown = false;
      this.soundEngine.playCollect('crystal');
      this.callbacks.onHudToast?.({
        text: `Combustível recarregado (+${res.gained || CRYSTAL_FUEL_REFILL}%)`,
        tone: 'success',
      });
      this.emitTelemetry();
    }
  }

  public repairHullWithScrap(): void {
    const res = this.playerState.repairHullWithScrap();
    if (res.ok) {
      this.soundEngine.playCollect('wreck');
      this.callbacks.onHudToast?.({
        text: `Casco reparado (+${res.repaired || SCRAP_HULL_REPAIR}%)`,
        tone: 'success',
      });
      this.emitTelemetry();
    }
  }

  public resetNewGame(): void {
    this.playerState.resetNewGame();
    this.poiManager.resetAllPois();
    this.reserveToastShown = false;
    this.collectTimer = 0;
    this.collectTargetKind = 'none';
    this.landOnSurface();
    this.lastLandingDir.copy(this.physics.landing.landedDir);
    this.lastLandingBody = this.physics.landing.landedBody;
    this.callbacks.onHudToast?.({
      text: 'Novo jogo iniciado · Progresso zerado',
      tone: 'info',
    });
    this.emitTelemetry();
  }

  public debugAddCredits(): void {
    this.playerState.addCredits(100);
    this.callbacks.onHudToast?.({
      text: '+100 Créditos adicionados (diagnóstico)',
      tone: 'info',
    });
    this.emitTelemetry();
  }

  public debugFillInventory(): void {
    const added = this.playerState.fillInventoryDebug();
    this.callbacks.onHudToast?.({
      text:
        added > 0
          ? `Inventário preenchido (+${added} itens)`
          : 'Inventário já está cheio (40/40)',
      tone: added > 0 ? 'info' : 'warn',
    });
    this.emitTelemetry();
  }

  public debugDamageHull(): void {
    this.cameraRig.triggerImpactShake(0.8);
    this.soundEngine.playImpact(0.8);
    const res = this.playerState.applyHullDamage(30);
    if (res.failed) {
      this.handleHullFailureFlow();
    } else {
      this.callbacks.onHudToast?.({
        text: `Dano de 30 aplicado ao casco (${Math.round(res.hull)}%)`,
        tone: 'warn',
      });
      this.emitTelemetry();
    }
  }

  private resetCollectState(): void {
    this.collectTargetKind = 'none';
    this.collectTargetPoiId = -1;
    this.collectTargetFloraGroupId = -1;
    this.collectTargetFloraMemberIdx = -1;
    this.collectTimer = 0;
    this.collectHudState.available = false;
    this.collectHudState.collecting = false;
    this.collectHudState.progress = 0;
    this.collectHudState.inventoryFull = false;
  }

  private updateOnFootCollection(
    dt: number,
    elapsed: number,
    collectHeld: boolean,
  ): void {
    if (!collectHeld) {
      this.collectCompletedHold = false;
      this.collectFullNotifiedThisPress = false;
      this.collectTimer = 0;
    }

    const charPos = this.character.root.position;
    this.poiManager.queryNearestCollectible(
      charPos,
      POI_INTERACT_RADIUS,
      elapsed,
      this.poiQuery,
    );

    if (this.poiQuery.found) {
      if (
        this.collectTargetKind !== 'poi' ||
        this.collectTargetPoiId !== this.poiQuery.id
      ) {
        this.collectTargetKind = 'poi';
        this.collectTargetPoiId = this.poiQuery.id;
        this.collectTimer = 0;
      }

      const full =
        this.playerState.getInventoryCount() >= this.playerState.getCapacity();
      this.collectHudState.available = true;
      this.collectHudState.label = this.poiQuery.label;
      this.collectHudState.kind = this.poiQuery.type;
      this.collectHudState.inventoryFull = full;

      if (full) {
        this.collectHudState.collecting = false;
        this.collectHudState.progress = 0;
        if (collectHeld && !this.collectFullNotifiedThisPress) {
          this.collectFullNotifiedThisPress = true;
          this.callbacks.onHudToast?.({
            text: 'Inventário cheio (40/40)',
            tone: 'warn',
          });
        }
        return;
      }

      if (collectHeld && !this.collectCompletedHold) {
        this.collectTimer += dt;
        const progress = Math.min(1, this.collectTimer / POI_COLLECT_DURATION_SEC);
        this.collectHudState.collecting = true;
        this.collectHudState.progress = progress;

        if (this.collectTimer >= POI_COLLECT_DURATION_SEC) {
          this.collectCompletedHold = true;
          this.collectTimer = 0;
          const yielded = this.poiManager.collectPoi(this.poiQuery.id, elapsed);
          if (yielded) {
            this.soundEngine.playCollect(this.poiQuery.type);
            let overflowed = false;
            const parts: string[] = [];

            if (yielded.crystal > 0) {
              const r = this.playerState.addResource('crystal', yielded.crystal);
              if (r.added > 0) parts.push(`+${r.added} Cristal`);
              if (r.overflow > 0) overflowed = true;
            }
            if (yielded.scrap > 0) {
              const r = this.playerState.addResource('scrap', yielded.scrap);
              if (r.added > 0) parts.push(`+${r.added} Sucata`);
              if (r.overflow > 0) overflowed = true;
            }
            if (yielded.relic > 0) {
              const r = this.playerState.addResource('relic', yielded.relic);
              if (r.added > 0) parts.push(`+${r.added} Relíquia`);
              if (r.overflow > 0) overflowed = true;
            }

            if (parts.length > 0) {
              this.callbacks.onHudToast?.({
                text: overflowed
                  ? `${parts.join(' · ')} (Mochila cheia!)`
                  : parts.join(' · '),
                tone: overflowed ? 'warn' : 'success',
              });
            } else if (overflowed) {
              this.callbacks.onHudToast?.({
                text: 'Inventário cheio (40/40)',
                tone: 'warn',
              });
            }
            this.lastTelemetryEmit = -1;
          }
        }
      } else {
        this.collectHudState.collecting = false;
        this.collectHudState.progress = 0;
      }
      return;
    }

    if (this.config.flora.enabled && !this.diagnostics.noFlora) {
      this.floraManager.queryNearestHarvestableFlora(
        charPos,
        FLORA_INTERACT_RADIUS,
        this.floraHarvestQuery,
      );
    } else {
      this.floraHarvestQuery.found = false;
    }

    if (this.floraHarvestQuery.found) {
      if (
        this.collectTargetKind !== 'flora' ||
        this.collectTargetFloraGroupId !== this.floraHarvestQuery.groupId ||
        this.collectTargetFloraMemberIdx !== this.floraHarvestQuery.memberIdx
      ) {
        this.collectTargetKind = 'flora';
        this.collectTargetFloraGroupId = this.floraHarvestQuery.groupId;
        this.collectTargetFloraMemberIdx = this.floraHarvestQuery.memberIdx;
        this.collectTimer = 0;
      }

      const full =
        this.playerState.getInventoryCount() >= this.playerState.getCapacity();
      this.collectHudState.available = true;
      this.collectHudState.label = `${this.floraHarvestQuery.label} (Fibra)`;
      this.collectHudState.kind = 'flora';
      this.collectHudState.inventoryFull = full;

      if (full) {
        this.collectHudState.collecting = false;
        this.collectHudState.progress = 0;
        if (collectHeld && !this.collectFullNotifiedThisPress) {
          this.collectFullNotifiedThisPress = true;
          this.callbacks.onHudToast?.({
            text: 'Inventário cheio (40/40)',
            tone: 'warn',
          });
        }
        return;
      }

      if (collectHeld && !this.collectCompletedHold) {
        this.collectTimer += dt;
        const progress = Math.min(1, this.collectTimer / FLORA_COLLECT_DURATION_SEC);
        this.collectHudState.collecting = true;
        this.collectHudState.progress = progress;

        if (this.collectTimer >= FLORA_COLLECT_DURATION_SEC) {
          this.collectCompletedHold = true;
          this.collectTimer = 0;
          const harvested = this.floraManager.harvestMember(
            this.floraHarvestQuery.groupId,
            this.floraHarvestQuery.memberIdx,
          );
          if (harvested) {
            const r = this.playerState.addResource('fiber', 1);
            this.soundEngine.playCollect('flora');
            if (r.added > 0) {
              this.callbacks.onHudToast?.({
                text: r.isFull
                  ? '+1 Fibra Vegetal (Mochila 40/40)'
                  : '+1 Fibra Vegetal',
                tone: r.isFull ? 'warn' : 'success',
              });
            }
            this.lastTelemetryEmit = -1;
          }
        }
      } else {
        this.collectHudState.collecting = false;
        this.collectHudState.progress = 0;
      }
      return;
    }

    this.resetCollectState();
  }

  private handleResize(): void {
    if (this.disposed) return;
    const w = Math.max(this.container.clientWidth, 1);
    const h = Math.max(this.container.clientHeight, 1);
    this.lastViewportW = w;
    this.lastViewportH = h;
    this.cameraRig.setAspect(w, h);
    this.applyEffectivePixelRatio(true);
  }

  private afterDraw(cb: FrameRequestCallback): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(() => cb(performance.now()), 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private formatWorstFrameCulprit(): string {
    let maxName = 'física';
    let maxVal = this.pendingTPhysics;
    if (this.pendingTTerrain > maxVal) {
      maxVal = this.pendingTTerrain;
      maxName = 'terreno';
    }
    if (this.pendingTFlora > maxVal) {
      maxVal = this.pendingTFlora;
      maxName = 'flora';
    }
    if (this.pendingTParticles > maxVal) {
      maxVal = this.pendingTParticles;
      maxName = 'partículas';
    }
    if (this.pendingTCharacter > maxVal) {
      maxVal = this.pendingTCharacter;
      maxName = 'personagem';
    }
    if (this.pendingTCamHud > maxVal) {
      maxVal = this.pendingTCamHud;
      maxName = 'câmera/HUD';
    }
    if (this.pendingTRender > maxVal) {
      maxVal = this.pendingTRender;
      maxName = 'render';
    }
    const msStr = maxVal >= 10 ? String(Math.round(maxVal)) : maxVal.toFixed(1);
    if (maxName === 'render') {
      if (this.pendingProgBefore !== this.pendingProgAfter) {
        return `render ${msStr} ms (prog ${this.pendingProgBefore}→${this.pendingProgAfter})`;
      }
      return `render ${msStr} ms (prog ${this.pendingProgAfter})`;
    }
    return `${maxName} ${msStr} ms`;
  }

  private commitPendingDescentFrame(rawDt: number): void {
    this.hasPendingDescentFrame = false;
    this.descentElapsed += rawDt;
    const frameMs = rawDt * 1000;
    this.descentBucketDt += rawDt;
    this.descentBucketFrames += 1;
    this.descentBucketCpuSum += this.pendingCpuMs;
    if (frameMs > 40) {
      this.descentBucketHitches += 1;
    }
    this.descentBucketCallsSum += this.pendingCalls;
    this.descentBucketTrisSum += this.pendingTris;
    this.descentBucketParticlesSum += this.pendingParticles;

    if (this.pendingGroundHover) {
      this.descentGroundElapsed += rawDt;
      this.descentGroundDt += rawDt;
      this.descentGroundFrames += 1;
    }

    if (this.pendingDescentScale < this.descentRunMinScale) {
      this.descentRunMinScale = this.pendingDescentScale;
    }

    if (this.pendingReentry > this.descentBucketMaxReentry) {
      this.descentBucketMaxReentry = this.pendingReentry;
    }
    if (this.pendingGlowActive) {
      this.descentBucketGlowActive = true;
    }
    if (this.pendingBannerActive) {
      this.descentBucketBannerActive = true;
    }
    if (this.pendingParticlesActive) {
      this.descentBucketParticlesActive = true;
    }

    if (frameMs >= this.descentBucketWorstMs) {
      this.descentBucketWorstMs = frameMs;
      const culprit = this.formatWorstFrameCulprit();
      this.descentBucketWorstCulprit = culprit;
      this.descentBucketWorstBreakdown = `fís ${this.pendingTPhysics.toFixed(1)}ms | ter ${this.pendingTTerrain.toFixed(1)}ms | flo ${this.pendingTFlora.toFixed(1)}ms | part ${this.pendingTParticles.toFixed(1)}ms | pers ${this.pendingTCharacter.toFixed(1)}ms | cam ${this.pendingTCamHud.toFixed(1)}ms | ren ${this.pendingTRender.toFixed(1)}ms (prog ${this.pendingProgBefore}->${this.pendingProgAfter})`;
      if (frameMs >= this.descentRunWorstMs) {
        this.descentRunWorstMs = frameMs;
        this.descentRunWorstCulprit = culprit;
      }
    }

    if (this.descentBucketDt >= 0.5) {
      this.flushDescentSample(
        this.pendingAlt,
        this.pendingSpeed,
        this.pendingAtmoPct,
      );
    }

    if (
      !this.descentStallChecked &&
      !this.descentGroundHoverActive &&
      this.descentElapsed >= 3.0
    ) {
      this.descentStallChecked = true;
      const altDrop = this.descentStartAlt - this.pendingAlt;
      if (altDrop < 20) {
        this.finishDescentBenchmark(
          true,
          `Piloto automático não conseguiu descer: altitude ${Math.round(this.pendingAlt)} m, velocidade ${Math.round(this.pendingSpeed)} m/s`,
        );
        return;
      }
    }

    const stepDone =
      (this.descentGroundHoverActive &&
        this.descentGroundElapsed >= DESCENT_GROUND_HOVER_SECONDS &&
        this.descentElapsed >= 10.0) ||
      this.descentElapsed >= 25.0;
    if (stepDone) {
      if (this.descentBucketDt >= 0.15 && this.descentBucketFrames > 0) {
        this.flushDescentSample(
          this.pendingAlt,
          this.pendingSpeed,
          this.pendingAtmoPct,
        );
      }
      const stepDef = DESCENT_BENCHMARK_STEPS[this.descentStepIdx];
      if (!stepDef.isWarmup) {
        this.descentRuns.push(this.buildCurrentDescentRun());
      }
      if (this.descentStepIdx + 1 < DESCENT_BENCHMARK_STEPS.length) {
        this.beginDescentStep(this.descentStepIdx + 1);
      } else {
        this.finishDescentBenchmark(false);
      }
    } else if (
      this.descentLastProgressEmit < 0 ||
      this.descentElapsed - this.descentLastProgressEmit >= 0.25
    ) {
      this.descentLastProgressEmit = this.descentElapsed;
      const stepDef = DESCENT_BENCHMARK_STEPS[this.descentStepIdx];
      const phaseSuffix = this.descentGroundHoverActive ? ' · chão 5s' : '';
      this.callbacks.onBenchmarkProgress?.({
        active: true,
        kind: 'descent',
        stepIndex: this.descentStepIdx,
        totalSteps: DESCENT_BENCHMARK_STEPS.length,
        label: `${stepDef.bannerLabel}${phaseSuffix}`,
        remainingSec: Math.max(0, 18 - this.descentElapsed),
        altitude: this.pendingAlt,
      });
    }
  }

  private tick = (timestamp: number): void => {
    if (this.disposed) return;
    const cpuStart = performance.now();

    this.timer.update(timestamp);
    const rawDt = this.timer.getDelta();

    if (this.warmupActive) {
      if (this.isSoftwareGl) {
        this.frameId = window.setTimeout(() => this.tick(performance.now()), 16);
      } else {
        this.frameId = requestAnimationFrame(this.tick);
      }
      return;
    }

    this.qualityScaler.update(rawDt, document.hidden);
    const validFrameSample =
      Number.isFinite(rawDt) && rawDt > 0 && rawDt < 0.5 && !document.hidden;

    if (
      validFrameSample &&
      this.descentBenchmarkActive
    ) {
      if (this.descentPhase === 'wait') {
        this.descentWaitElapsed += rawDt;
        if (this.descentWaitElapsed >= DESCENT_ORBIT_WAIT_SECONDS) {
          this.descentPhase = 'descent';
          this.resetDescentRunAccumulators();
          const stepDef = DESCENT_BENCHMARK_STEPS[this.descentStepIdx];
          if (stepDef.key === 'autoQuality') {
            this.qualityScaler.setEnabledSilent(true);
            this.qualityScaler.prepareForAutoBenchmark();
            this.scalerPausedByBenchmark = false;
            this.syncQualityScalerPause();
          }
          this.snapshotDescentStartGraphicsState();
          this.callbacks.onBenchmarkProgress?.({
            active: true,
            kind: 'descent',
            stepIndex: this.descentStepIdx,
            totalSteps: DESCENT_BENCHMARK_STEPS.length,
            label: stepDef.bannerLabel,
            remainingSec: 16,
            altitude: this.physics.shipAltitude,
          });
        } else if (
          this.descentLastProgressEmit < 0 ||
          this.descentWaitElapsed - this.descentLastProgressEmit >= 0.25
        ) {
          this.descentLastProgressEmit = this.descentWaitElapsed;
          const stepDef = DESCENT_BENCHMARK_STEPS[this.descentStepIdx];
          this.callbacks.onBenchmarkProgress?.({
            active: true,
            kind: 'descent',
            stepIndex: this.descentStepIdx,
            totalSteps: DESCENT_BENCHMARK_STEPS.length,
            label: `${stepDef.bannerLabel} (órbita ${(DESCENT_ORBIT_WAIT_SECONDS - this.descentWaitElapsed).toFixed(1)}s)`,
            remainingSec: 18 - this.descentWaitElapsed,
            altitude: this.descentStartAlt,
          });
        }
      } else if (this.hasPendingDescentFrame) {
        // Commit previous frame now that its exact wall-clock rawDt is known
        this.commitPendingDescentFrame(rawDt);
        if (this.disposed) return;
      }
    }

    if (validFrameSample) {
      this.fpsBucketElapsed += rawDt;
      this.fpsBucketFrames += 1;
      if (this.fpsBucketElapsed >= 1.0) {
        const bucketFps = this.fpsBucketFrames / this.fpsBucketElapsed;
        this.fpsHistory1s[this.fpsHistoryIdx] = bucketFps;
        this.fpsHistoryIdx = (this.fpsHistoryIdx + 1) % 10;
        if (this.fpsHistoryCount < 10) {
          this.fpsHistoryCount++;
        }
        this.fpsBucketElapsed = 0;
        this.fpsBucketFrames = 0;
      }
    }
    const dt = Math.min(rawDt, 0.05);
    const elapsed = this.timer.getElapsed();

    let tTerrain = 0;
    let tPhysics = 0;
    let tCharacter = 0;
    let tParticles = 0;
    let tFlora = 0;
    let tCamHud = 0;

    let tMark = performance.now();
    this.computeSunDir(elapsed, _sunDir);
    this.planetManager.update(elapsed, _sunDir);
    tTerrain += performance.now() - tMark;

    const isCharMode = this.playerMode === 'character';
    let physSpeed = this.physics.velocity.length();
    let physThrustPower = 0;
    let physAtmoRatio = this.physics.atmospherePct / 100;
    let isThrustInput = false;

    if (this.benchmarkActive) {
      this.wantsFire = false;
      this.isThrusting = false;
      this.isBoosting = false;
      isThrustInput = false;
    } else if (this.descentBenchmarkActive && this.descentPhase === 'wait') {
      // Hold ship stationary at exact initial orbit pose while rendering 2s settle frames
      tMark = performance.now();
      this.physics.prepareDescentState(
        this.descentOrbitPos,
        this.descentOrbitQuat,
        this.descentStartAlt,
        this.config.planet.atmosphereHeight,
      );
      const physOut = this.physics.step(dt, elapsed, {
        inputs: IDLE_FLIGHT_INPUTS,
        ship: this.config.ship,
        planet: this.config.planet,
        planetManager: this.planetManager,
        beaconPos: this.beaconController.position,
        targetLocked: false,
        shadowMapEnabled: this.renderer.shadowMap.enabled,
        landingHooks: this.landingHooks,
        floraManager: this.floraManager,
        floraEnabled: this.config.flora.enabled,
        cameraMode:
          this.config.cameraMode === 'orbit' ? 'chase' : this.config.cameraMode,
        disableHorizonLeveling: true,
        autopilotMaxSpeed: 0,
      });
      this.physics.prepareDescentState(
        this.descentOrbitPos,
        this.descentOrbitQuat,
        this.descentStartAlt,
        this.config.planet.atmosphereHeight,
      );
      tPhysics += performance.now() - tMark;
      physSpeed = 0;
      physThrustPower = 0;
      physAtmoRatio = physOut.atmoRatio;
      this.wantsFire = false;
      this.isThrusting = false;
      this.isBoosting = false;
      isThrustInput = false;
    } else {
      tMark = performance.now();
      let shipInputs: FlightInputSample;
      if (this.descentBenchmarkActive) {
        this.applyDescentAutopilotInputs();
        shipInputs = AUTOPILOT_INPUTS;
      } else {
        shipInputs = isCharMode
          ? IDLE_FLIGHT_INPUTS
          : this.inputController.sampleFlightInputs(
              this.config.ship.invertPitch,
            );
      }
      const landingControlled = this.physics.landing.isControlling;

      const physOut = this.physics.step(dt, elapsed, {
        inputs: shipInputs,
        ship: this.config.ship,
        planet: this.config.planet,
        planetManager: this.planetManager,
        beaconPos: this.beaconController.position,
        targetLocked:
          isCharMode || landingControlled || this.descentBenchmarkActive
            ? false
            : this.targetLocked,
        shadowMapEnabled: this.renderer.shadowMap.enabled,
        landingHooks: this.landingHooks,
        floraManager: this.floraManager,
        floraEnabled: this.config.flora.enabled,
        cameraMode: isCharMode
          ? 'chase'
          : this.descentBenchmarkActive && this.config.cameraMode === 'orbit'
            ? 'chase'
            : this.config.cameraMode,
        disableHorizonLeveling:
          this.descentBenchmarkActive && !this.descentGroundHoverActive,
        autopilotMaxSpeed: this.descentBenchmarkActive
          ? this.descentAutopilotMaxSpeed
          : undefined,
        reserveMode: this.descentBenchmarkActive
          ? false
          : this.playerState.isReserveMode(),
      });
      this.syncLandingClearing();

      if (!this.descentBenchmarkActive) {
        if (!landingControlled && !isCharMode) {
          const prevFuel = this.playerState.fuel;
          this.playerState.consumeFuel(
            dt,
            shipInputs.isThrusting,
            physOut.isBoosting,
          );
          if (this.playerState.fuel > 0.001) {
            this.reserveToastShown = false;
          } else if (prevFuel > 0 && !this.reserveToastShown) {
            this.reserveToastShown = true;
            this.callbacks.onHudToast?.({
              text: 'Combustível esgotado · Modo reserva (15%)',
              tone: 'warn',
            });
            this.lastTelemetryEmit = -1;
          }
        }

        if (physOut.impactDamage > 0) {
          this.cameraRig.triggerImpactShake(physOut.impactSeverity);
          this.soundEngine.playImpact(physOut.impactSeverity);
          const dmgRes = this.playerState.applyHullDamage(physOut.impactDamage);
          if (dmgRes.failed) {
            this.handleHullFailureFlow();
          } else {
            this.callbacks.onHudToast?.({
              text: `Impacto no casco (-${Math.round(physOut.impactDamage)}%)`,
              tone: 'warn',
            });
            this.lastTelemetryEmit = -1;
          }
        }
      }

      if (
        this.descentBenchmarkActive &&
        this.descentPhase === 'descent' &&
        !this.descentGroundHoverActive &&
        this.descentBraking &&
        this.physics.shipAltitude <= 10.5
      ) {
        this.descentGroundHoverActive = true;
        this.descentGroundElapsed = 0;
        this.descentGroundDt = 0;
        this.descentGroundFrames = 0;
      }

      if (this.descentBenchmarkActive && this.descentGroundHoverActive) {
        _localUp.copy(this.physics.shipRoot.position).normalize();
        const hoverSurfR = this.planetManager.getRenderedSurfaceRadiusAt(
          _localUp.x,
          _localUp.y,
          _localUp.z,
        );
        this.physics.shipRoot.position
          .copy(_localUp)
          .multiplyScalar(hoverSurfR + 10.0);
        this.physics.velocity.set(0, 0, 0);
        this.physics.shipAltitude = 10.0;
        this.physics.reentryIntensity = 0;
        physOut.speed = 0;
      }
      tPhysics += performance.now() - tMark;

      physSpeed = physOut.speed;
      physThrustPower = physOut.thrustPower;
      physAtmoRatio = physOut.atmoRatio;
      this.wantsFire =
        isCharMode || landingControlled || this.descentBenchmarkActive
          ? false
          : shipInputs.wantsFire;
      this.isThrusting =
        isCharMode || landingControlled ? false : shipInputs.isThrusting;
      this.isBoosting =
        isCharMode || landingControlled ? false : physOut.isBoosting;
      isThrustInput =
        isCharMode || landingControlled ? false : shipInputs.thrust > 0.05;

      if (this.playerMode === 'character' && !this.descentBenchmarkActive) {
        tMark = performance.now();
        const charInputs = this.inputController.sampleCharacterInputs();
        _shipWorldQuat
          .copy(this.physics.shipQuat)
          .multiply(this.shipModel.group.quaternion);
        this.character.step(dt, elapsed, {
          inputs: charInputs,
          cameraMode: this.config.characterCamera,
          planet: this.config.planet,
          planetManager: this.planetManager,
          floraManager: this.floraManager,
          floraEnabled: this.config.flora.enabled,
          shipPos: this.physics.shipRoot.position,
          shipQuat: _shipWorldQuat,
          shipColliders: this.shipModel.colliders,
          shipGearActive: this.physics.landing.gearT > 0.2,
        });
        this.updateOnFootCollection(dt, elapsed, charInputs.collectHeld);
        tCharacter += performance.now() - tMark;
      } else {
        this.resetCollectState();
      }
    }

    const focusPos =
      this.playerMode === 'character'
        ? this.character.root.position
        : this.physics.shipRoot.position;

    tMark = performance.now();
    this.soundEngine.updateAtmosphereEntry(this.physics.reentryIntensity);
    this.particleSystem.update(dt, {
      shipPos: this.physics.shipRoot.position,
      shipQuat: this.physics.shipQuat,
      shipVisualQuat: this.shipModel.group.quaternion,
      shipVelocity: this.physics.velocity,
      isThrusting: isThrustInput,
      isBoosting: this.isBoosting,
      thrustPower: physThrustPower,
      atmoRatio: physAtmoRatio,
      speed: physSpeed,
      reentryIntensity: this.physics.reentryIntensity,
      particleRatio: this.particleRatio,
      disableReentryParticles: this.diagnostics.noReentryParticles,
    });
    tParticles += performance.now() - tMark;

    // Global rotating Sun DirectionalLight anchored around focusPos for crisp shadows & planetary/lunar day-night cycle
    this.keyLight.position.copy(focusPos).addScaledVector(_sunDir, 320);
    this.keyLight.target.position.copy(focusPos);

    const focusAlt =
      this.playerMode === 'character'
        ? this.character.altitude
        : this.physics.shipAltitude;

    const isLandingOrLanded =
      this.playerMode === 'character' ||
      this.physics.landing.state !== 'flying';

    tMark = performance.now();
    this.floraManager.update(
      dt,
      focusPos,
      focusAlt,
      this.planetManager,
      this.config.planet,
      this.config.flora,
      {
        floraDensityRatio: this.floraDensityRatio,
        floraViewRatio: this.floraViewRatio,
        qualityLevel: this.qualityScaler.getLevel(),
      },
      _sunDir,
      this.cameraRig.camera,
      isLandingOrLanded,
      this.playerMode === 'ship' ? this.physics.velocity : undefined,
    );
    tFlora += performance.now() - tMark;

    const tPoiStart = performance.now();
    this.poiManager.update(
      elapsed,
      focusPos,
      this.planetManager,
      this.config.planet,
    );
    const tPoiUpdate = performance.now() - tPoiStart;
    tFlora += tPoiUpdate;

    if (
      !this.benchmarkActive &&
      !this.descentBenchmarkActive &&
      focusPos.distanceTo(this.beaconController.position) <
        (this.playerMode === 'character' ? 5.5 : 8.5)
    ) {
      this.waypointsCaptured += 1;
      this.callbacks.onWaypointCaptured(this.waypointsCaptured);
      this.relocateTarget('alternate');
    }

    if (!this.benchmarkActive && !this.descentBenchmarkActive) {
      this.weaponsSystem.update(dt, {
        wantsFire: this.wantsFire,
        targetLocked:
          isCharMode || this.physics.landing.isControlling
            ? false
            : this.targetLocked,
        cameraMode: this.config.cameraMode,
        camera: this.cameraRig.camera,
        shipPos: this.physics.shipRoot.position,
        shipQuat: this.physics.shipQuat,
        shipVelocityLen: physSpeed,
        beaconPos: this.beaconController.position,
        planetManager: this.planetManager,
        onBeaconHit: () => {
          this.waypointsCaptured += 1;
          this.callbacks.onWaypointCaptured(this.waypointsCaptured);
          this.relocateTarget('alternate');
        },
        onHitmarker: this.callbacks.onHitmarker,
      });

      this.beaconController.update(elapsed, dt, this.planetManager);
    }

    tMark = performance.now();
    // Day/Night atmosphere & lighting modulation at player/ship location
    const moon = this.planetManager.getMoonState();
    const nearMoon =
      this.playerMode === 'character'
        ? this.character.activeBody === 'moon'
        : this.physics.landing.state === 'landed' &&
          this.physics.landing.landedBody === 'moon';
    if (nearMoon) {
      _localUp.subVectors(focusPos, moon.center);
    } else {
      _localUp.copy(focusPos);
    }
    if (_localUp.lengthSq() > 0.0001) {
      _localUp.normalize();
    } else {
      _localUp.set(0, 1, 0);
    }
    const sunDot = _localUp.dot(_sunDir);
    const dayFactor = THREE.MathUtils.smoothstep(sunDot, -0.22, 0.3);
    const sunsetFactor = Math.exp(-Math.pow((sunDot - 0.02) * 4.5, 2));

    const atmoT = nearMoon ? 0 : this.physics.atmospherePct / 100;
    const atmoDayCover =
      atmoT * THREE.MathUtils.smoothstep(dayFactor, 0.05, 0.45);
    const skyVisibility =
      1 - THREE.MathUtils.smoothstep(atmoDayCover, 0.15, 0.55);
    this.spaceBackground.setSkyVisibility(skyVisibility);

    this.keyLight.color
      .copy(_daySunColor)
      .lerp(_sunsetSunColor, sunsetFactor * atmoT * 0.72);
    this.hemiLight.intensity = THREE.MathUtils.lerp(
      0.2,
      THREE.MathUtils.lerp(0.14, 1.05, dayFactor),
      atmoT,
    );
    this.rimLight.intensity = THREE.MathUtils.lerp(0.14, 0.26, dayFactor);

    _skyTmpColor
      .copy(_nightAtmoBgColor)
      .lerp(_dayAtmoBgColor, dayFactor)
      .lerp(_sunsetAtmoBgColor, sunsetFactor * 0.65);
    _blendedBgColor.lerpColors(_spaceBgColor, _skyTmpColor, atmoT);
    (this.scene.background as THREE.Color).copy(_blendedBgColor);
    this.fog.color.copy(_blendedBgColor);
    this.fog.density = THREE.MathUtils.lerp(
      0.00018,
      THREE.MathUtils.lerp(0.0009, 0.0017, dayFactor),
      atmoT,
    );

    if (!this.benchmarkActive) {
      if (this.playerMode === 'character') {
        this.cameraRig.updateCharacter(dt, {
          shipOrbitMode: this.config.cameraMode === 'orbit',
          characterCamera: this.config.characterCamera,
          charPos: this.character.root.position,
          upDir: this.character.upDir,
          rightDir: this.character.rightDir,
          aimDir: this.character.aimDir,
          speed: this.character.speed,
          activeBody: this.character.activeBody,
          planetManager: this.planetManager,
        });
      } else {
        this.cameraRig.update(dt, elapsed, {
          mode:
            this.descentBenchmarkActive && this.config.cameraMode === 'orbit'
              ? 'chase'
              : this.config.cameraMode,
          shipPos: this.physics.shipRoot.position,
          shipQuat: this.physics.shipQuat,
          speed: physSpeed,
          maxSpeed: this.config.ship.maxSpeed,
          reentryIntensity: this.physics.reentryIntensity,
          landingState: this.physics.landing.state,
        });
      }
    }

    this.spaceBackground.update(elapsed, this.cameraRig.camera.position);
    tCamHud += performance.now() - tMark;

    tMark = performance.now();
    const camDist = this.cameraRig.camera.position.length();
    const baseR =
      this.config.planet.planetRadius +
      this.config.planet.seaLevel * this.config.planet.maxHeight;
    const tangentDist = Math.sqrt(Math.max(0, camDist * camDist - baseR * baseR));
    const mountainRim = Math.sqrt(
      Math.max(0, 2 * baseR * Math.max(1, this.config.planet.maxHeight)),
    );
    const radiusScale = this.config.planet.planetRadius / 360;
    const horizonDist = Math.max(
      155 * radiusScale,
      tangentDist + mountainRim * 0.95,
    );
    const fogFar = horizonDist;
    const fogNear = fogFar * 0.55;
    const fogStrength =
      nearMoon ||
      this.diagnostics.noAtmosphere ||
      this.diagnostics.terrainNoSkyAtmo
        ? 0
        : THREE.MathUtils.smoothstep(atmoT, 0.02, 0.55);
    _blendedBgColor.getRGB(_horizonFogRgb, THREE.SRGBColorSpace);
    this.planetManager.setHorizonFog(
      _horizonFogRgb.r,
      _horizonFogRgb.g,
      _horizonFogRgb.b,
      fogNear,
      fogFar,
      fogStrength,
    );
    this.planetManager.setMorphRange(
      Math.max(45 * radiusScale, horizonDist * 0.34),
      Math.max(115 * radiusScale, horizonDist * 0.85),
    );

    this.planetManager.updateHorizonCulling(
      this.cameraRig.camera.position,
      this.cameraRig.camera,
      focusPos,
    );
    tTerrain += performance.now() - tMark;

    if (elapsed - this.lastOtherAudit >= 1.0) {
      this.lastOtherAudit = elapsed;
      this.auditOtherDraws();
    }

    if (this.diagnostics.showColliders) {
      this.shipCollidersDebugGroup.quaternion.copy(this.shipModel.group.quaternion);
      const gearVisible = this.physics.landing.gearT > 0.2;
      for (let i = 0; i < this.shipGearDebugLines.length; i++) {
        this.shipGearDebugLines[i].visible = gearVisible;
      }

      const treeCount =
        this.config.flora.enabled && !this.diagnostics.noFlora
          ? this.floraManager.queryTrees(focusPos, this.debugTrees)
          : 0;
      const limit = Math.min(treeCount, this.treeColliderPool.length);
      for (let i = 0; i < limit; i++) {
        const tree = this.debugTrees[i];
        const line = this.treeColliderPool[i];
        line.visible = true;
        line.position.set(
          tree.x + tree.nx * tree.height * 0.5,
          tree.y + tree.ny * tree.height * 0.5,
          tree.z + tree.nz * tree.height * 0.5,
        );
        _debugTreeDir.set(tree.nx, tree.ny, tree.nz);
        line.quaternion.setFromUnitVectors(_debugTreeUp, _debugTreeDir);
        line.scale.set(1, tree.height, 1);
      }
      for (let i = limit; i < this.treeColliderPool.length; i++) {
        this.treeColliderPool[i].visible = false;
      }
    }

    this.updateDescentScale(dt);
    this.applyEffectivePixelRatio();

    const progBefore = this.renderer.info.programs
      ? this.renderer.info.programs.length
      : 0;
    tMark = performance.now();
    this.renderer.render(this.scene, this.cameraRig.camera);
    const tRender = performance.now() - tMark;
    const progAfter = this.renderer.info.programs
      ? this.renderer.info.programs.length
      : 0;

    tMark = performance.now();
    this.lastIndicator = computeOffScreenIndicator(
      this.cameraRig.camera,
      this.beaconController.position,
      this.lastViewportW,
      this.lastViewportH,
      this.config.backdrop.indicatorMargin,
    );
    this.callbacks.onIndicatorFrame?.(this.lastIndicator);

    let tPoiHud = 0;
    let tAutosave = 0;

    if (!this.descentBenchmarkActive) {
      const tPoiHudStart = performance.now();
      if (!this.diagnostics.noPoiHudMarkers && !this.diagnostics.noPois) {
        const candidates = this.poiManager.fillHudCandidates(focusPos, 400, elapsed);
        for (let i = 0; i < 3; i++) {
          const cand = candidates[i];
          const marker = this.poiHudMarkers[i];
          if (cand.id >= 0) {
            computeOffScreenIndicatorInto(
              this.cameraRig.camera,
              cand.worldPos,
              this.lastViewportW,
              this.lastViewportH,
              this.config.backdrop.indicatorMargin,
              marker,
              POI_COLORS[cand.type],
            );
            marker.type = cand.type;
            marker.label = POI_LABELS[cand.type];
          } else {
            marker.active = false;
          }
        }
      } else {
        for (let i = 0; i < 3; i++) {
          this.poiHudMarkers[i].active = false;
        }
      }
      this.callbacks.onPoiMarkersFrame?.(this.poiHudMarkers);
      tPoiHud = performance.now() - tPoiHudStart;

      if (!this.benchmarkActive) {
        this.callbacks.onCollectHudFrame?.(this.collectHudState);
      } else {
        this.resetCollectState();
        this.callbacks.onCollectHudFrame?.(this.collectHudState);
      }

      const tSaveStart = performance.now();
      if (!this.diagnostics.noAutosave) {
        this.autosaveTimer += dt;
        if (this.autosaveTimer >= 30) {
          this.autosaveTimer = 0;
          if (this.playerState.dirty) {
            this.playerState.save();
          }
        }
      }
      tAutosave = performance.now() - tSaveStart;
    } else {
      for (let i = 0; i < 3; i++) {
        this.poiHudMarkers[i].active = false;
      }
      this.callbacks.onPoiMarkersFrame?.(this.poiHudMarkers);
      this.resetCollectState();
      this.callbacks.onCollectHudFrame?.(this.collectHudState);
    }

    this.callbacks.onReentryFrame?.(
      this.physics.reentryIntensity,
      this.diagnostics.noReentryGlow,
    );

    if (this.callbacks.onHorizonFrame) {
      const camPos = this.cameraRig.camera.position;
      const camDist2 = camPos.length();
      let groundR = this.config.planet.planetRadius;
      if (camDist2 > 0.001 && camDist2 < this.config.planet.planetRadius + 25) {
        _shipDir.copy(camPos).divideScalar(camDist2);
        groundR = this.planetManager.getRenderedSurfaceRadiusAt(
          _shipDir.x,
          _shipDir.y,
          _shipDir.z,
        );
      }
      this.callbacks.onHorizonFrame(
        computeHorizonHud(
          this.cameraRig.camera,
          this.config.planet.planetRadius,
          groundR,
          this.config.planet.atmosphereHeight,
          this.playerMode === 'character' ? 'chase' : this.config.cameraMode,
          this.lastViewportW,
          this.lastViewportH,
        ),
      );
    }

    if (elapsed - this.lastTelemetryEmit >= 0.12) {
      this.lastTelemetryEmit = elapsed;
      this.emitTelemetry();
    }
    tCamHud += performance.now() - tMark;

    const cpuMs = performance.now() - cpuStart;
    if (validFrameSample) {
      if (!this.hasFpsSample) {
        this.avgFpsDt = rawDt;
        this.avgCpuMs = cpuMs;
        this.hasFpsSample = true;
      } else {
        const fpsAlpha = 1 - Math.exp(-rawDt / 1.0);
        this.avgFpsDt += (rawDt - this.avgFpsDt) * fpsAlpha;
        this.avgCpuMs += (cpuMs - this.avgCpuMs) * fpsAlpha;
      }

      if (this.benchmarkActive) {
        this.benchmarkStepElapsed += rawDt;
        if (this.benchmarkStepElapsed >= BENCHMARK_WARMUP) {
          this.benchmarkMeasureFrames += 1;
          this.benchmarkMeasureDtSum += rawDt;
          this.benchmarkMeasureCpuSum += cpuMs;
          this.benchmarkMeasureCallsSum += this.renderer.info.render.calls;
          this.benchmarkMeasureTrisSum += this.renderer.info.render.triangles;
          this.benchmarkPoiUpdateSum += tPoiUpdate;
          if (tPoiUpdate > this.benchmarkPoiUpdateWorst) {
            this.benchmarkPoiUpdateWorst = tPoiUpdate;
          }
          this.benchmarkPoiHudSum += tPoiHud;
          if (tPoiHud > this.benchmarkPoiHudWorst) {
            this.benchmarkPoiHudWorst = tPoiHud;
          }
          this.benchmarkAutosaveSum += tAutosave;
          if (tAutosave > this.benchmarkAutosaveWorst) {
            this.benchmarkAutosaveWorst = tAutosave;
          }
          if (rawDt * 1000 > 40) {
            this.benchmarkMeasureHitches += 1;
          }
          this.benchmark1sElapsed += rawDt;
          this.benchmark1sFrames += 1;
          if (this.benchmark1sElapsed >= 1.0) {
            const fps1s = this.benchmark1sFrames / this.benchmark1sElapsed;
            if (fps1s < this.benchmarkWorst1sFps) {
              this.benchmarkWorst1sFps = fps1s;
            }
            this.benchmark1sElapsed = 0;
            this.benchmark1sFrames = 0;
          }
        }

        if (this.benchmarkStepElapsed >= BENCHMARK_STEP_DURATION) {
          if (
            this.benchmark1sElapsed >= 0.4 &&
            this.benchmark1sFrames > 0
          ) {
            const tailFps = this.benchmark1sFrames / this.benchmark1sElapsed;
            if (tailFps < this.benchmarkWorst1sFps) {
              this.benchmarkWorst1sFps = tailFps;
            }
          }
          const avgFps =
            this.benchmarkMeasureDtSum > 0
              ? this.benchmarkMeasureFrames / this.benchmarkMeasureDtSum
              : 0;
          const worstFps = Number.isFinite(this.benchmarkWorst1sFps)
            ? this.benchmarkWorst1sFps
            : avgFps;
          const frames = Math.max(1, this.benchmarkMeasureFrames);
          const stepDef = BENCHMARK_STEPS[this.benchmarkStepIdx];
          this.benchmarkResults.push({
            stepNumber: this.benchmarkStepIdx + 1,
            key: stepDef.key,
            label: stepDef.label,
            avgFps,
            worstFps,
            avgCpuMs: this.benchmarkMeasureCpuSum / frames,
            poiUpdateAvgMs: this.benchmarkPoiUpdateSum / frames,
            poiUpdateWorstMs: this.benchmarkPoiUpdateWorst,
            poiHudAvgMs: this.benchmarkPoiHudSum / frames,
            poiHudWorstMs: this.benchmarkPoiHudWorst,
            autosaveAvgMs: this.benchmarkAutosaveSum / frames,
            autosaveWorstMs: this.benchmarkAutosaveWorst,
            drawCalls: Math.round(this.benchmarkMeasureCallsSum / frames),
            triangles: Math.round(this.benchmarkMeasureTrisSum / frames),
            hitches: this.benchmarkMeasureHitches,
            qualityLevel: this.qualityScaler.getLevel(),
            qualityPaused: this.qualityScaler.isPaused(),
            descentScale: this.descentScale,
            pixelRatio: this.renderer.getPixelRatio(),
            canvasWidth: this.renderer.domElement.width,
            canvasHeight: this.renderer.domElement.height,
            shadowMapEnabled: this.renderer.shadowMap.enabled,
            floraDensityRatio: this.floraDensityRatio,
            floraViewRatio: this.floraViewRatio,
          });
          if (this.benchmarkStepIdx + 1 < BENCHMARK_STEPS.length) {
            this.beginBenchmarkStep(this.benchmarkStepIdx + 1);
          } else {
            this.finishBenchmark(false);
          }
        } else if (
          this.benchmarkLastProgressEmit < 0 ||
          this.benchmarkStepElapsed - this.benchmarkLastProgressEmit >= 0.25
        ) {
          this.benchmarkLastProgressEmit = this.benchmarkStepElapsed;
          const stepDef = BENCHMARK_STEPS[this.benchmarkStepIdx];
          this.callbacks.onBenchmarkProgress?.({
            active: true,
            kind: 'static',
            stepIndex: this.benchmarkStepIdx,
            totalSteps: BENCHMARK_STEPS.length,
            label: stepDef.bannerLabel,
            remainingSec: Math.max(
              0,
              BENCHMARK_STEP_DURATION - this.benchmarkStepElapsed,
            ),
          });
        }
      }
    }

    if (
      this.descentBenchmarkActive &&
      this.descentPhase === 'descent' &&
      !document.hidden
    ) {
      const reentryVal = this.physics.reentryIntensity;
      this.hasPendingDescentFrame = true;
      this.pendingGroundHover = this.descentGroundHoverActive;
      this.pendingCpuMs = cpuMs;
      this.pendingCalls = this.renderer.info.render.calls;
      this.pendingTris = this.renderer.info.render.triangles;
      this.pendingParticles = this.particleSystem.getActiveCount();
      this.pendingAlt = this.physics.shipAltitude;
      this.pendingSpeed = physSpeed;
      this.pendingAtmoPct = this.physics.atmospherePct;
      this.pendingReentry = reentryVal;
      this.pendingGlowActive = !this.diagnostics.noReentryGlow && reentryVal >= 0.08;
      this.pendingBannerActive = reentryVal > 0.2;
      this.pendingParticlesActive =
        !this.diagnostics.noReentryParticles &&
        reentryVal > 0.14 &&
        this.particleRatio > 0;
      this.pendingTPhysics = tPhysics;
      this.pendingTTerrain = tTerrain;
      this.pendingTFlora = tFlora;
      this.pendingTParticles = tParticles;
      this.pendingTCharacter = tCharacter;
      this.pendingTCamHud = tCamHud;
      this.pendingTRender = tRender;
      this.pendingProgBefore = progBefore;
      this.pendingProgAfter = progAfter;
      this.pendingQualityLevel = this.qualityScaler.getLevel();
      this.pendingQualityPaused = this.qualityScaler.isPaused();
      this.pendingDescentScale = this.descentScale;
      this.pendingPixelRatio = this.renderer.getPixelRatio();
      this.pendingCanvasWidth = this.renderer.domElement.width;
      this.pendingCanvasHeight = this.renderer.domElement.height;
      this.pendingShadowMapEnabled = this.renderer.shadowMap.enabled;
      this.pendingFloraDensityRatio = this.floraDensityRatio;
      this.pendingFloraViewRatio = this.floraViewRatio;
    }

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private emitTelemetry(): void {
    const focusPos =
      this.playerMode === 'character'
        ? this.character.root.position
        : this.physics.shipRoot.position;
    const targetDist = focusPos.distanceTo(this.beaconController.position);
    if (this.playerMode === 'character') {
      _shipForward.copy(this.character.forwardDir);
    } else {
      _shipForward.set(0, 0, -1).applyQuaternion(this.physics.shipQuat);
    }
    const heading =
      ((THREE.MathUtils.radToDeg(Math.atan2(_shipForward.x, -_shipForward.z)) %
        360) +
        360) %
      360;

    let biome = '';
    if (!this.physics.inSpace) {
      const lenSq = focusPos.lengthSq();
      if (lenSq > 0.0001) {
        _shipDir.copy(focusPos).divideScalar(Math.sqrt(lenSq));
        const rawH = getPlanetTerrainHeight(
          _shipDir.x,
          _shipDir.y,
          _shipDir.z,
          this.config.planet.planetRadius,
          this.config.planet.noiseScale,
          this.config.planet.maxHeight,
        );
        const safeMaxH = Math.max(this.config.planet.maxHeight, 0.001);
        biome = getBiomeName(
          _shipDir.x,
          _shipDir.y,
          _shipDir.z,
          THREE.MathUtils.clamp(rawH / safeMaxH, -1, 1),
          this.config.planet.seaLevel,
        );
      }
    }

    const landingState = this.physics.landing.state;
    let canLand = false;
    let landHint = '';
    if (landingState === 'flying') {
      const evalRes = this.physics.landing.evaluate(
        this.physics.shipRoot.position,
        this.physics.velocity,
        this.planetManager,
      );
      canLand = evalRes.canLand;
      landHint = evalRes.hint;
    }

    const floraStats = this.floraManager.getStats();
    const renderCalls = this.renderer.info.render.calls;
    const terrainDraws = this.planetManager.getVisiblePatchCount();
    const floraDraws = floraStats.activeMeshes;
    const otherDraws = Math.max(0, renderCalls - terrainDraws - floraDraws);
    const fps = Math.round(1 / Math.max(this.avgFpsDt, 0.001));
    let worstFps = fps;
    if (this.fpsHistoryCount > 0) {
      let minFps1s = Infinity;
      for (let i = 0; i < this.fpsHistoryCount; i++) {
        if (this.fpsHistory1s[i] < minFps1s) {
          minFps1s = this.fpsHistory1s[i];
        }
      }
      if (Number.isFinite(minFps1s)) {
        worstFps = Math.round(minFps1s);
      }
    }
    const cpuFrameMs = this.avgCpuMs;

    const speed =
      this.playerMode === 'character'
        ? this.character.speed
        : this.physics.velocity.length();
    const altitude =
      this.playerMode === 'character'
        ? this.character.altitude
        : this.physics.shipAltitude;

    this.callbacks.onTelemetry({
      speed,
      altitude,
      headingDeg: heading,
      inSpace:
        this.playerMode === 'character' && this.character.activeBody === 'moon'
          ? true
          : this.physics.inSpace,
      atmospherePct:
        this.playerMode === 'character' && this.character.activeBody === 'moon'
          ? 0
          : this.physics.atmospherePct,
      biome,
      planetPatches: this.planetManager.patchCount,
      targetDistance: targetDist,
      targetZone: this.beaconController.targetZone,
      waypointsCaptured: this.waypointsCaptured,
      targetLocked: this.targetLocked,
      reentryIntensity: this.physics.reentryIntensity,
      isThrusting: this.isThrusting,
      isBoosting: this.isBoosting,
      turboCharge: this.physics.turboCharge,
      turboExhausted: this.physics.turboExhausted,
      playerMode: this.playerMode,
      characterCamera: this.config.characterCamera,
      jetpackEnabled: this.character.jetpackEnabled,
      dampenersEnabled: this.character.dampenersEnabled,
      qualityLevel: this.qualityScaler.getLevel(),
      fps,
      worstFps,
      cpuFrameMs,
      floraInstances: floraStats.instancesDrawn,
      floraGroups: floraStats.groupsActive,
      renderCalls,
      terrainDraws,
      floraDraws,
      otherDraws,
      otherBreakdown: { ...this.otherBreakdown },
      landingState,
      canLand,
      landHint,
      collectAvailable: this.collectHudState.available,
      collectLabel: this.collectHudState.label,
      player: this.playerState.createSnapshot(),
      indicator:
        this.lastIndicator ??
        computeOffScreenIndicator(
          this.cameraRig.camera,
          this.beaconController.position,
          this.lastViewportW,
          this.lastViewportH,
          this.config.backdrop.indicatorMargin,
        ),
    });
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.timer.disconnect();
    this.timer.dispose();

    window.removeEventListener('resize', this.boundOnResize);
    window.removeEventListener('orientationchange', this.boundOnResize);
    window.visualViewport?.removeEventListener('resize', this.boundOnResize);
    this.renderer.domElement.removeEventListener(
      'webglcontextlost',
      this.boundOnContextLost,
    );
    this.renderer.domElement.removeEventListener(
      'webglcontextrestored',
      this.boundOnContextRestored,
    );

    this.physics.shipRoot.remove(this.shipCollidersDebugGroup);
    this.scene.remove(this.treeCollidersDebugGroup);
    this.debugBoxEdgesGeo.dispose();
    this.debugTreeWireGeo.dispose();
    this.debugShipMat.dispose();
    this.debugGearMat.dispose();
    this.debugTreeMat.dispose();

    if (this.playerState.dirty) {
      this.playerState.save();
    }
    this.inputController.dispose();
    this.weaponsSystem.dispose();
    this.particleSystem.dispose();
    this.poiManager.dispose();
    this.floraManager.dispose();
    this.character.dispose();
    this.physics.dispose();
    this.beaconController.dispose();
    this.cameraRig.dispose();
    this.soundEngine.dispose();
    this.planetManager.dispose();
    this.spaceBackground.dispose();
    this.shipModel.dispose();
    this.envRT.dispose();
    this.renderer.dispose();

    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
