import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  CameraMode,
  OffScreenIndicatorState,
  SimulationConfig,
  TelemetrySnapshot,
} from '../types/simulation';
import { PlanetTerrainManager } from './PlanetTerrainManager';
import {
  BeaconModelHandle,
  createBeaconModel,
  createShipModel,
  ShipModelHandle,
} from './proceduralModels';
import { SpaceBackground } from './SpaceBackground';
import { SoundEngine } from './SoundEngine';

// Pre-allocated math helpers outside render loop (Zero GC)
const _shipForward = new THREE.Vector3();
const _shipUp = new THREE.Vector3();
const _shipRight = new THREE.Vector3();
const _radialUp = new THREE.Vector3();
const _targetRight = new THREE.Vector3();
const _targetUp = new THREE.Vector3();
const _rotQuat = new THREE.Quaternion();
const _alignQuat = new THREE.Quaternion();
const _visualQuat = new THREE.Quaternion();
const _bankQuat = new THREE.Quaternion();
const _pitchQuat = new THREE.Quaternion();
const _unitY = new THREE.Vector3(0, 1, 0);
const _unitZ = new THREE.Vector3(0, 0, 1);
const _unitX = new THREE.Vector3(1, 0, 0);

const _desiredCamPos = new THREE.Vector3();
const _desiredLookAt = new THREE.Vector3();
const _currentLookAt = new THREE.Vector3();
const _camUp = new THREE.Vector3(0, 1, 0);
const _projVec = new THREE.Vector3();
const _viewPos = new THREE.Vector3();

const _aimPoint = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _boltStart = new THREE.Vector3();
const _boltVel = new THREE.Vector3();
const _segVec = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _closestPt = new THREE.Vector3();
const _worldQuatTemp = new THREE.Quaternion();
const _nozzleOffset = new THREE.Vector3();
const _particleColor = new THREE.Color();
const _particleStartCol = new THREE.Color();
const _particleEndCol = new THREE.Color();
const _dummyObj = new THREE.Object3D();
const _keyLightOffset = new THREE.Vector3(260, 320, 180);

const _spaceBgColor = new THREE.Color(0x05050d);
const _atmoBgColor = new THREE.Color(0x0b1d38);
const _blendedBgColor = new THREE.Color();

const _nearColor = new THREE.Color(0xfacc15);
const _farColor = new THREE.Color(0xef4444);
const _indColor = new THREE.Color();

const MAX_BOLTS = 24;
const MAX_BURSTS = 12;
const MAX_EXHAUST = 48;
const MAX_STREAKS = 42;

interface ExhaustParticle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  maxAge: number;
  baseScale: number;
  boosting: boolean;
  active: boolean;
}

interface StreakParticle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  maxAge: number;
  reentry: boolean;
  active: boolean;
}

interface LaserBolt {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  prevPos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  active: boolean;
}

interface ImpactBurst {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  age: number;
  maxAge: number;
  maxScale: number;
  active: boolean;
}

export interface VirtualInputs {
  thrust: number; // -0.5..1
  turn: number;   // -1..1
  pitch: number;  // -1..1 (climb/dive)
  boost: boolean;
  firing: boolean;
}

export interface FlightEngineCallbacks {
  onTelemetry: (snapshot: TelemetrySnapshot) => void;
  onIndicatorFrame?: (indicator: OffScreenIndicatorState) => void;
  onWaypointCaptured: (count: number) => void;
  onHitmarker?: (kind: 'beacon' | 'terrain') => void;
  onContextLostChange: (lost: boolean) => void;
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

function createSoftShadowTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(
      size / 2,
      size / 2,
      2,
      size / 2,
      size / 2,
      size / 2,
    );
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.65)');
    grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.25)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
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
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private envRT: THREE.WebGLRenderTarget;

  private keyLight: THREE.DirectionalLight;
  private shipRoot = new THREE.Group();
  private shipQuat = new THREE.Quaternion();
  private shipModel: ShipModelHandle;
  private beaconModel: BeaconModelHandle;
  private planetManager: PlanetTerrainManager;
  private spaceBackground: SpaceBackground;

  private hoverShadowMesh: THREE.Mesh;
  private hoverShadowGeo: THREE.PlaneGeometry;
  private hoverShadowMat: THREE.MeshBasicMaterial;
  private hoverShadowTex: THREE.CanvasTexture;

  // Pooled Laser Projectiles & Impact Bursts (Zero GC)
  private boltGeo: THREE.CylinderGeometry;
  private boltCyanMat: THREE.MeshBasicMaterial;
  private boltVioletMat: THREE.MeshBasicMaterial;
  private bolts: LaserBolt[] = [];
  private burstGeo: THREE.SphereGeometry;
  private bursts: ImpactBurst[] = [];
  private fireCooldown = 0;
  private fireAlternator = 0;

  // Pooled Thruster Exhaust & Atmospheric Re-Entry Streaks (InstancedMesh, Zero GC)
  private exhaustGeo: THREE.IcosahedronGeometry;
  private exhaustMat: THREE.MeshBasicMaterial;
  private exhaustMesh: THREE.InstancedMesh;
  private exhaustParticles: ExhaustParticle[] = [];
  private exhaustSpawnAccum = 0;
  private exhaustAlternator = 0;

  private streakGeo: THREE.BoxGeometry;
  private streakMat: THREE.MeshBasicMaterial;
  private streakMesh: THREE.InstancedMesh;
  private streakParticles: StreakParticle[] = [];
  private streakSpawnAccum = 0;

  // Ship physics state
  private velocity = new THREE.Vector3(0, 0, 0);
  private bankRad = 0;
  private pitchVisualRad = 0;
  private shipAltitude = 12;
  private atmospherePct = 100;
  private inSpace = false;
  private reentryIntensity = 0;
  private targetZone: 'surface' | 'orbit' = 'surface';
  private waypointsCaptured = 0;
  private targetLocked = false;

  // Input state
  private keysDown = new Set<string>();
  private activeFirePointerIds = new Set<number>();
  private virtualInputs: VirtualInputs = {
    thrust: 0,
    turn: 0,
    pitch: 0,
    boost: false,
    firing: false,
  };

  // Loop & lifecycle
  private timer = new THREE.Timer();
  private frameId = 0;
  private disposed = false;
  private userOrbiting = false;
  private lastTelemetryEmit = 0;
  private lastViewportW = 1;
  private lastViewportH = 1;
  private lastIndicator: OffScreenIndicatorState | null = null;

  private boundOnResize: () => void;
  private boundOnKeyDown: (e: KeyboardEvent) => void;
  private boundOnKeyUp: (e: KeyboardEvent) => void;
  private boundOnPointerDown: (e: PointerEvent) => void;
  private boundOnPointerUp: (e: PointerEvent) => void;
  private boundUnlockAudio: () => void;
  private soundEngine = new SoundEngine();
  private boundOnBlur: () => void;
  private boundOnVisibilityChange: () => void;
  private boundOnContextMenu: (e: Event) => void;
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
    this.scene.background = _atmoBgColor.clone();
    this.fog = new THREE.FogExp2(0x0b1d38, 0.0024);
    this.scene.fog = this.fog;

    // 3. Studio RoomEnvironment map for metallic/glass reflections
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.envRT.texture;
    pmrem.dispose();

    // 4. Camera & OrbitControls
    this.camera = new THREE.PerspectiveCamera(62, width / height, 0.3, 2800);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !this.isSoftwareGl;
    this.controls.dampingFactor = 0.08;
    this.controls.maxDistance = 420;
    this.controls.minDistance = 5;
    this.controls.enabled = this.config.cameraMode === 'orbit';
    this.controls.addEventListener('start', () => {
      this.userOrbiting = true;
    });
    this.controls.addEventListener('end', () => {
      this.userOrbiting = false;
    });

    // 5. Three-Point Solar Lighting Rig (rich indigo/violet ambient fill prevents black shadows on planet)
    const hemiLight = new THREE.HemisphereLight(0xa5b4fc, 0x3b2d7a, 1.15);
    this.scene.add(hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xfff1d6, 2.35);
    this.keyLight.position.copy(_keyLightOffset);
    this.keyLight.castShadow = enableShadowMap;
    if (enableShadowMap) {
      this.keyLight.shadow.mapSize.set(512, 512);
      this.keyLight.shadow.camera.near = 10;
      this.keyLight.shadow.camera.far = 750;
      const d = 140;
      this.keyLight.shadow.camera.left = -d;
      this.keyLight.shadow.camera.right = d;
      this.keyLight.shadow.camera.top = d;
      this.keyLight.shadow.camera.bottom = -d;
      this.keyLight.shadow.bias = -0.0005;
      this.keyLight.shadow.normalBias = 0.02;
    }
    this.scene.add(this.keyLight);
    this.scene.add(this.keyLight.target);

    const rimLight = new THREE.DirectionalLight(0x6366f1, 1.25);
    rimLight.position.set(-240, -140, -220);
    this.scene.add(rimLight);

    // 6. Subsystems: SpaceBackground, 3D Spherical Planet, Ship, Ground Shadow, Beacon
    this.spaceBackground = new SpaceBackground(this.config.backdrop);
    this.spaceBackground.setPixelRatio(pixelRatio);
    this.scene.add(this.spaceBackground.root);

    this.planetManager = new PlanetTerrainManager(this.config.planet);
    this.scene.add(this.planetManager.root);

    this.shipModel = createShipModel(this.isSoftwareGl || this.isMobileDevice);
    this.shipRoot.add(this.shipModel.group);
    this.scene.add(this.shipRoot);

    this.hoverShadowTex = createSoftShadowTexture();
    this.hoverShadowGeo = new THREE.PlaneGeometry(5.5, 5.5);
    this.hoverShadowMat = new THREE.MeshBasicMaterial({
      map: this.hoverShadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.45,
    });
    this.hoverShadowMesh = new THREE.Mesh(
      this.hoverShadowGeo,
      this.hoverShadowMat,
    );
    this.scene.add(this.hoverShadowMesh);

    this.beaconModel = createBeaconModel();
    this.scene.add(this.beaconModel.group);

    // 6b. Pre-allocate Pooled Laser Projectiles & Impact Bursts
    this.boltGeo = new THREE.CylinderGeometry(0.11, 0.14, 3.6, 6);
    this.boltGeo.rotateX(Math.PI / 2);
    this.boltCyanMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    this.boltVioletMat = new THREE.MeshBasicMaterial({
      color: 0xc084fc,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    for (let i = 0; i < MAX_BOLTS; i++) {
      const mesh = new THREE.Mesh(
        this.boltGeo,
        i % 2 === 0 ? this.boltCyanMat : this.boltVioletMat,
      );
      mesh.visible = false;
      this.scene.add(mesh);
      this.bolts.push({
        mesh,
        pos: new THREE.Vector3(),
        prevPos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        active: false,
      });
    }

    this.burstGeo = new THREE.SphereGeometry(1, 10, 8);
    for (let i = 0; i < MAX_BURSTS; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xfacc15,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(this.burstGeo, material);
      mesh.visible = false;
      this.scene.add(mesh);
      this.bursts.push({
        mesh,
        material,
        age: 0,
        maxAge: 0.25,
        maxScale: 4,
        active: false,
      });
    }

    // 6c. Pre-allocate Pooled InstancedMesh for Thruster Exhaust & Atmospheric Re-Entry Streaks
    this.exhaustGeo = new THREE.IcosahedronGeometry(0.22, 0);
    this.exhaustMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.exhaustMesh = new THREE.InstancedMesh(
      this.exhaustGeo,
      this.exhaustMat,
      MAX_EXHAUST,
    );
    this.exhaustMesh.frustumCulled = false;
    this.exhaustMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    _dummyObj.scale.set(0, 0, 0);
    _dummyObj.updateMatrix();
    _particleColor.setHex(0x38bdf8);
    for (let i = 0; i < MAX_EXHAUST; i++) {
      this.exhaustMesh.setMatrixAt(i, _dummyObj.matrix);
      this.exhaustMesh.setColorAt(i, _particleColor);
      this.exhaustParticles.push({
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        age: 0,
        maxAge: 0.35,
        baseScale: 1,
        boosting: false,
        active: false,
      });
    }
    this.exhaustMesh.instanceMatrix.needsUpdate = true;
    if (this.exhaustMesh.instanceColor) {
      this.exhaustMesh.instanceColor.needsUpdate = true;
    }
    this.scene.add(this.exhaustMesh);

    this.streakGeo = new THREE.BoxGeometry(0.065, 0.065, 3.6);
    this.streakMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.streakMesh = new THREE.InstancedMesh(
      this.streakGeo,
      this.streakMat,
      MAX_STREAKS,
    );
    this.streakMesh.frustumCulled = false;
    this.streakMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    _particleColor.setHex(0x7dd3fc);
    for (let i = 0; i < MAX_STREAKS; i++) {
      this.streakMesh.setMatrixAt(i, _dummyObj.matrix);
      this.streakMesh.setColorAt(i, _particleColor);
      this.streakParticles.push({
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        age: 0,
        maxAge: 0.35,
        reentry: false,
        active: false,
      });
    }
    this.streakMesh.instanceMatrix.needsUpdate = true;
    if (this.streakMesh.instanceColor) {
      this.streakMesh.instanceColor.needsUpdate = true;
    }
    this.scene.add(this.streakMesh);

    this.landOnSurface();
    this.placeBeaconAtAngle(0.42, 0.25, 'surface');

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    // 7. Listeners
    this.boundOnResize = this.handleResize.bind(this);
    this.boundOnKeyDown = this.handleKeyDown.bind(this);
    this.boundOnKeyUp = this.handleKeyUp.bind(this);
    this.boundOnPointerDown = (e: PointerEvent) => {
      this.soundEngine.unlock();
      if (
        this.config.cameraMode !== 'orbit' &&
        (e.pointerType !== 'mouse' || e.button === 0)
      ) {
        this.activeFirePointerIds.add(e.pointerId);
      }
    };
    this.boundOnPointerUp = (e: PointerEvent) => {
      this.activeFirePointerIds.delete(e.pointerId);
    };
    this.boundUnlockAudio = () => {
      this.soundEngine.unlock();
    };
    this.boundOnContextMenu = (e: Event) => {
      e.preventDefault();
    };
    this.boundOnContextLost = (e: Event) => {
      e.preventDefault();
      this.callbacks.onContextLostChange(true);
    };
    this.boundOnContextRestored = () => {
      this.callbacks.onContextLostChange(false);
    };

    this.boundOnBlur = () => this.releaseAllInputs();
    this.boundOnVisibilityChange = () => {
      if (document.hidden) this.releaseAllInputs();
      this.soundEngine.setPaused(document.hidden);
    };
    window.addEventListener('blur', this.boundOnBlur);
    document.addEventListener('visibilitychange', this.boundOnVisibilityChange);
    window.addEventListener('resize', this.boundOnResize);
    window.addEventListener('orientationchange', this.boundOnResize);
    window.visualViewport?.addEventListener('resize', this.boundOnResize);
    window.addEventListener('keydown', this.boundOnKeyDown);
    window.addEventListener('keyup', this.boundOnKeyUp);
    window.addEventListener('pointerdown', this.boundUnlockAudio, { passive: true });
    window.addEventListener('keydown', this.boundUnlockAudio, { passive: true });
    window.addEventListener('pointerup', this.boundOnPointerUp);
    window.addEventListener('pointercancel', this.boundOnPointerUp);
    this.renderer.domElement.addEventListener(
      'pointerdown',
      this.boundOnPointerDown,
    );
    this.renderer.domElement.addEventListener(
      'contextmenu',
      this.boundOnContextMenu,
    );
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
    this.config = structuredClone(next);
    this.planetManager.updateParams(next.planet);
    this.spaceBackground.updateParams(next.backdrop);

    if (prevMode !== next.cameraMode) {
      this.controls.enabled = next.cameraMode === 'orbit';
      if (next.cameraMode === 'orbit') {
        this.activeFirePointerIds.clear();
        this.controls.target.copy(this.shipRoot.position);
        this.controls.update();
      }
    }
  }

  public setVirtualInputs(inputs: VirtualInputs): void {
    this.virtualInputs = { ...inputs };
  }

  public setTargetLocked(locked: boolean): void {
    this.targetLocked = locked;
  }

  public setMuted(muted: boolean): void {
    this.soundEngine.setMuted(muted);
  }

  public landOnSurface(): void {
    const surfR = this.planetManager.getSurfaceRadiusAt(0, 1, 0);
    this.shipRoot.position.set(0, surfR + 10, 0);
    this.shipQuat.identity();
    this.shipRoot.quaternion.copy(this.shipQuat);
    this.shipModel.group.quaternion.identity();
    this.velocity.set(0, 0, 0);
    this.bankRad = 0;
    this.pitchVisualRad = 0;

    this.camera.position.set(0, surfR + 13.8, 13.5);
    _camUp.set(0, 1, 0);
    this.camera.up.copy(_camUp);
    _currentLookAt.copy(this.shipRoot.position).add(new THREE.Vector3(0, 0, -135));
    this.camera.lookAt(_currentLookAt);
  }

  public launchToOrbit(): void {
    const { planetRadius, atmosphereHeight } = this.config.planet;
    const orbitDist = planetRadius + atmosphereHeight + 135;
    this.shipRoot.position.set(0, orbitDist * 0.68, orbitDist * 0.74);

    // Orient ship facing diagonally toward the planet horizon & space
    const lookTarget = new THREE.Vector3(0, planetRadius * 0.35, 0);
    const m = new THREE.Matrix4().lookAt(
      this.shipRoot.position,
      lookTarget,
      _unitY,
    );
    this.shipQuat.setFromRotationMatrix(m);
    this.shipRoot.quaternion.copy(this.shipQuat);
    this.shipModel.group.quaternion.identity();
    this.velocity.set(0, 0, 0);
    this.bankRad = 0;
    this.pitchVisualRad = 0;

    _shipForward.set(0, 0, -1).applyQuaternion(this.shipQuat);
    _shipUp.set(0, 1, 0).applyQuaternion(this.shipQuat);
    _camUp.copy(_shipUp);
    this.camera.up.copy(_camUp);
    this.camera.position
      .copy(this.shipRoot.position)
      .addScaledVector(_shipForward, -13.5)
      .addScaledVector(_shipUp, 3.8);
    _currentLookAt.copy(this.shipRoot.position).addScaledVector(_shipForward, 135);
    this.camera.lookAt(_currentLookAt);
  }

  public relocateTarget(mode: 'surface' | 'orbit' | 'alternate' = 'alternate'): void {
    const zone: 'surface' | 'orbit' =
      mode === 'alternate'
        ? this.targetZone === 'surface'
          ? 'orbit'
          : 'surface'
        : mode;

    // Pick a direction offset from ship's current radial position
    _radialUp.copy(this.shipRoot.position).normalize();
    const randDir = new THREE.Vector3(
      Math.random() - 0.5,
      Math.random() - 0.5,
      Math.random() - 0.5,
    ).normalize();
    // Blend away so target isn't right on top of ship
    if (randDir.dot(_radialUp) > 0.85) {
      randDir.negate();
    }
    const theta = Math.atan2(randDir.z, randDir.x);
    const phi = Math.acos(THREE.MathUtils.clamp(randDir.y, -0.92, 0.92));
    this.placeBeaconAtAngle(theta, phi, zone);
  }

  private placeBeaconAtAngle(
    theta: number,
    phi: number,
    zone: 'surface' | 'orbit',
  ): void {
    this.targetZone = zone;
    const nx = Math.sin(phi) * Math.cos(theta);
    const ny = Math.cos(phi);
    const nz = Math.sin(phi) * Math.sin(theta);

    let radius: number;
    if (zone === 'orbit') {
      const { planetRadius, atmosphereHeight } = this.config.planet;
      radius = planetRadius + atmosphereHeight + 45 + Math.random() * 55;
    } else {
      radius = this.planetManager.getSurfaceRadiusAt(nx, ny, nz) + 5.5;
    }

    this.beaconModel.group.position.set(nx * radius, ny * radius, nz * radius);
    // Align beacon radially outward from planet center
    _radialUp.set(nx, ny, nz);
    this.beaconModel.group.quaternion.setFromUnitVectors(_unitY, _radialUp);
  }

  private handleResize(): void {
    if (this.disposed) return;
    const w = Math.max(this.container.clientWidth, 1);
    const h = Math.max(this.container.clientHeight, 1);
    this.lastViewportW = w;
    this.lastViewportH = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private releaseAllInputs(): void {
    this.keysDown.clear();
    this.activeFirePointerIds.clear();
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const tag = document.activeElement?.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (tag === 'INPUT' && e.code.startsWith('Arrow')) return;

    if (
      ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(
        e.code,
      )
    ) {
      if (tag !== 'INPUT' && tag !== 'BUTTON') {
        e.preventDefault();
      }
    }
    this.keysDown.add(e.code);
  }

  private handleKeyUp(e: KeyboardEvent): void {
    this.keysDown.delete(e.code);
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

  private tick = (timestamp: number): void => {
    if (this.disposed) return;

    this.timer.update(timestamp);
    const rawDt = this.timer.getDelta();
    const dt = Math.min(rawDt, 0.05);
    const elapsed = this.timer.getElapsed();

    this.stepPhysics(dt, elapsed);
    this.keyLight.position.copy(this.shipRoot.position).add(_keyLightOffset);
    this.keyLight.target.position.copy(this.shipRoot.position);
    this.stepProjectiles(dt);
    this.planetManager.update(elapsed);
    this.spaceBackground.update(elapsed, this.shipRoot.position);
    this.beaconModel.update(elapsed, dt);

    this.updateAtmosphereAndCamera(dt);
    this.renderer.render(this.scene, this.camera);

    this.lastIndicator = this.computeOffScreenIndicator();
    this.callbacks.onIndicatorFrame?.(this.lastIndicator);

    if (elapsed - this.lastTelemetryEmit >= 0.1) {
      this.lastTelemetryEmit = elapsed;
      this.emitTelemetry();
    }

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private stepPhysics(dt: number, elapsed: number): void {
    const { rotationSpeed, thrustForce, maxSpeed, drag, invertPitch } =
      this.config.ship;
    const { planetRadius, atmosphereHeight } = this.config.planet;

    // 1. Gather Keyboard + Multi-Touch Virtual Inputs
    let turnInput = this.virtualInputs.turn;
    if (this.keysDown.has('KeyA') || this.keysDown.has('ArrowLeft')) turnInput += 1;
    if (this.keysDown.has('KeyD') || this.keysDown.has('ArrowRight')) turnInput -= 1;
    turnInput = THREE.MathUtils.clamp(turnInput, -1, 1);

    let pitchInput = this.virtualInputs.pitch;
    if (this.keysDown.has('KeyE') || this.keysDown.has('KeyR')) pitchInput += 1;
    if (this.keysDown.has('KeyQ') || this.keysDown.has('KeyC')) pitchInput -= 1;
    pitchInput = THREE.MathUtils.clamp(pitchInput, -1, 1);
    if (invertPitch) pitchInput = -pitchInput;

    let thrustInput = this.virtualInputs.thrust;
    if (this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp')) thrustInput += 1;
    if (this.keysDown.has('KeyS') || this.keysDown.has('ArrowDown')) thrustInput -= 0.45;
    thrustInput = THREE.MathUtils.clamp(thrustInput, -0.5, 1);

    const isBoosting =
      this.virtualInputs.boost ||
      this.keysDown.has('Space') ||
      this.keysDown.has('ShiftLeft');

    const boostMult = isBoosting && thrustInput > 0 ? 1.85 : 1.0;

    // 2. Compute radial normal & atmosphere ratio
    _radialUp.copy(this.shipRoot.position).normalize();
    const distFromCenter = this.shipRoot.position.length();
    const surfaceR = this.planetManager.getSurfaceRadiusAt(
      _radialUp.x,
      _radialUp.y,
      _radialUp.z,
    );
    const altitude = distFromCenter - planetRadius;
    const atmoRatio =
      1 - THREE.MathUtils.smoothstep(altitude, 0, atmosphereHeight);
    this.atmospherePct = Math.round(atmoRatio * 100);
    this.inSpace = altitude > atmosphereHeight;

    // 3. Apply 3D Quaternion Yaw & Pitch
    const rotStep = THREE.MathUtils.degToRad(rotationSpeed) * dt;

    if (Math.abs(turnInput) > 0.005) {
      _shipUp.set(0, 1, 0).applyQuaternion(this.shipQuat);
      _rotQuat.setFromAxisAngle(_shipUp, turnInput * rotStep);
      this.shipQuat.premultiply(_rotQuat);
    }

    if (Math.abs(pitchInput) > 0.005) {
      _shipRight.set(1, 0, 0).applyQuaternion(this.shipQuat);
      _rotQuat.setFromAxisAngle(_shipRight, pitchInput * rotStep * 0.85);
      this.shipQuat.premultiply(_rotQuat);
    }

    // Target Lock (Travar Alvo): smoothly track ship nose toward active Beacon
    if (this.targetLocked) {
      _toTarget.subVectors(
        this.beaconModel.group.position,
        this.shipRoot.position,
      );
      const distToBeaconLock = _toTarget.length();
      if (distToBeaconLock > 4) {
        _toTarget.divideScalar(distToBeaconLock);
        // If skimming close to surface and target is beyond horizon, lift guidance slightly over terrain
        if (this.shipAltitude < 34 && _toTarget.dot(_radialUp) < 0.1) {
          _toTarget.addScaledVector(_radialUp, 0.42).normalize();
        }
        _shipForward.set(0, 0, -1).applyQuaternion(this.shipQuat);
        const manualMag = Math.min(1, Math.hypot(turnInput, pitchInput));
        const lockBlend = (1 - manualMag * 0.65) * THREE.MathUtils.clamp(dt * 3.4, 0, 1);
        _alignQuat.setFromUnitVectors(_shipForward, _toTarget);
        _rotQuat.copy(_alignQuat).multiply(this.shipQuat);
        this.shipQuat.slerp(_rotQuat, lockBlend);
      }
    }

    // Gentle planetary horizon roll-leveling inside atmosphere when not near vertical
    _shipForward.set(0, 0, -1).applyQuaternion(this.shipQuat);
    _shipUp.set(0, 1, 0).applyQuaternion(this.shipQuat);
    if (atmoRatio > 0.08 && Math.abs(_shipForward.dot(_radialUp)) < 0.85) {
      _targetRight.crossVectors(_shipForward, _radialUp).normalize();
      _targetUp.crossVectors(_targetRight, _shipForward).normalize();
      _alignQuat.setFromUnitVectors(_shipUp, _targetUp);
      // Smoothly slerp ship's up axis toward planetary radial plane
      this.shipQuat.slerp(
        _alignQuat.multiply(this.shipQuat),
        THREE.MathUtils.clamp(dt * 2.4 * atmoRatio, 0, 1),
      );
    }
    this.shipQuat.normalize();
    this.shipRoot.quaternion.copy(this.shipQuat);

    // 4. Thrust & Drag (less drag in outer space for effortless orbital coasting)
    _shipForward.set(0, 0, -1).applyQuaternion(this.shipQuat);
    if (Math.abs(thrustInput) > 0.01) {
      this.velocity.addScaledVector(
        _shipForward,
        thrustInput * thrustForce * boostMult * dt,
      );
    }

    const spaceSpeedBonus = this.inSpace ? 1.55 : 1.0;
    const effectiveMax = maxSpeed * spaceSpeedBonus * (isBoosting ? 1.45 : 1.0);
    if (this.velocity.length() > effectiveMax) {
      this.velocity.setLength(effectiveMax);
    }

    const effectiveDrag = THREE.MathUtils.lerp(0.994, drag, atmoRatio);
    const dragFactor = Math.pow(
      THREE.MathUtils.clamp(effectiveDrag, 0.88, 0.998),
      dt * 60,
    );
    this.velocity.multiplyScalar(dragFactor);

    this.shipRoot.position.addScaledVector(this.velocity, dt);

    // 5. Spherical Terrain Collision Floor (allows skimming mountains & valleys safely)
    _radialUp.copy(this.shipRoot.position).normalize();
    const newDist = this.shipRoot.position.length();
    const newSurfR = this.planetManager.getSurfaceRadiusAt(
      _radialUp.x,
      _radialUp.y,
      _radialUp.z,
    );
    const minFlightR = newSurfR + 3.2;
    if (newDist < minFlightR) {
      this.shipRoot.position.copy(_radialUp).multiplyScalar(minFlightR);
      // Cancel inward radial velocity component
      const inward = this.velocity.dot(_radialUp);
      if (inward < 0) {
        this.velocity.addScaledVector(_radialUp, -inward);
      }
    }

    this.shipAltitude = Math.max(0.5, this.shipRoot.position.length() - surfaceR);

    // 6. Spherical Ground Contact Shadow (fallback for mobile/software GPUs without shadowMap)
    const showShadow = !this.renderer.shadowMap.enabled && this.shipAltitude < 32;
    this.hoverShadowMesh.visible = showShadow;
    if (showShadow) {
      this.hoverShadowMesh.position
        .copy(_radialUp)
        .multiplyScalar(newSurfR + 0.18);
      this.hoverShadowMesh.quaternion.setFromUnitVectors(_unitY, _radialUp);
      this.hoverShadowMesh.rotateX(-Math.PI / 2);
      const shadowScale = THREE.MathUtils.clamp(
        1.35 - this.shipAltitude * 0.03,
        0.5,
        1.35,
      );
      this.hoverShadowMesh.scale.setScalar(shadowScale);
      this.hoverShadowMat.opacity = THREE.MathUtils.clamp(
        0.52 - this.shipAltitude * 0.015,
        0.04,
        0.48,
      );
    }

    // 7. Visual Banking & Pitch Tilt on Ship Mesh
    this.bankRad = THREE.MathUtils.damp(this.bankRad, turnInput * 0.48, 8, dt);
    this.pitchVisualRad = THREE.MathUtils.damp(
      this.pitchVisualRad,
      pitchInput * 0.14,
      8,
      dt,
    );
    _bankQuat.setFromAxisAngle(_unitZ, this.bankRad);
    _pitchQuat.setFromAxisAngle(_unitX, this.pitchVisualRad);
    _visualQuat.copy(_pitchQuat).multiply(_bankQuat);
    this.shipModel.group.quaternion.copy(_visualQuat);

    // 8. Thruster Plumes, Exhaust Trail, & Atmospheric Re-Entry Intensity
    const speed = this.velocity.length();
    const speedNorm = THREE.MathUtils.clamp(
      speed / Math.max(maxSpeed, 1),
      0,
      1.3,
    );
    const thrustPower =
      thrustInput > 0.05
        ? THREE.MathUtils.clamp((0.55 + thrustInput * 0.45) * (isBoosting ? 1.45 : 1), 0, 1.5)
        : speedNorm * 0.3;

    const flameTarget =
      thrustInput > 0.05
        ? (0.78 + 0.55 * Math.sin(elapsed * 38) * 0.14) * boostMult
        : 0.18 + speedNorm * 0.22;
    this.shipModel.leftFlame.scale.set(
      0.85 + thrustPower * 0.22,
      0.85 + thrustPower * 0.22,
      flameTarget,
    );
    this.shipModel.rightFlame.scale.set(
      0.85 + thrustPower * 0.22,
      0.85 + thrustPower * 0.22,
      flameTarget,
    );
    this.shipModel.flameMaterial.opacity = thrustInput > 0.05 ? 0.94 : 0.38;
    if (this.shipModel.thrusterLight) {
      this.shipModel.thrusterLight.color.setHex(
        isBoosting ? 0xf59e0b : 0x38bdf8,
      );
      this.shipModel.thrusterLight.intensity =
        thrustInput > 0.05 ? 3.5 * boostMult : 0.95;
    }

    // Compute atmospheric re-entry intensity when descending or flying fast through upper/mid atmosphere
    const radialSpeedInward = -this.velocity.dot(_radialUp);
    const atmoEntryBand =
      THREE.MathUtils.smoothstep(altitude, 6, atmosphereHeight * 0.42) *
      (1 - THREE.MathUtils.smoothstep(altitude, atmosphereHeight * 0.88, atmosphereHeight * 1.25));
    const diveHeat = THREE.MathUtils.clamp((radialSpeedInward - 2.5) / 18, 0, 1);
    const speedHeat = THREE.MathUtils.clamp((speed - 22) / 30, 0, 1);
    const descending = THREE.MathUtils.clamp(radialSpeedInward / 6, 0, 1);
    const targetReentry =
      atmoEntryBand * Math.max(diveHeat, speedHeat * 0.65 * descending);
    this.reentryIntensity = THREE.MathUtils.damp(
      this.reentryIntensity,
      targetReentry,
      4.8,
      dt,
    );

    this.shipModel.updateEffects(
      elapsed,
      thrustPower,
      isBoosting,
      this.reentryIntensity,
    );
    this.soundEngine.updateAtmosphereEntry(this.reentryIntensity);
    this.stepAtmosphereAndExhaustParticles(
      dt,
      thrustInput > 0.05,
      isBoosting,
      thrustPower,
      atmoRatio,
      speed,
    );

    // 9. Waypoint Beacon Capture Check (3D distance)
    const distToBeacon = this.shipRoot.position.distanceTo(
      this.beaconModel.group.position,
    );
    if (distToBeacon < 8.5) {
      this.waypointsCaptured += 1;
      this.callbacks.onWaypointCaptured(this.waypointsCaptured);
      this.relocateTarget('alternate');
    }
  }

  private stepProjectiles(dt: number): void {
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    const wantsFire =
      this.virtualInputs.firing ||
      this.keysDown.has('KeyF') ||
      (this.activeFirePointerIds.size > 0 &&
        this.config.cameraMode !== 'orbit');

    if (wantsFire && this.fireCooldown <= 0) {
      this.fireCooldown = 0.13;
      this.spawnWingBolt();
    }

    const beaconPos = this.beaconModel.group.position;
    const beaconHitRadiusSq = 10.5 * 10.5;

    for (let i = 0; i < this.bolts.length; i++) {
      const bolt = this.bolts[i];
      if (!bolt.active) continue;

      bolt.life -= dt;
      if (bolt.life <= 0) {
        bolt.active = false;
        bolt.mesh.visible = false;
        continue;
      }

      // Guided homing trajectory when Target Lock is active
      if (this.targetLocked) {
        _toTarget.subVectors(beaconPos, bolt.pos);
        const dist = _toTarget.length();
        if (dist > 1 && dist < 340) {
          _toTarget.divideScalar(dist);
          const boltSpeed = bolt.vel.length();
          _boltVel.copy(bolt.vel).divideScalar(Math.max(boltSpeed, 0.001));
          if (_boltVel.dot(_toTarget) > 0.15) {
            _boltVel
              .lerp(_toTarget, THREE.MathUtils.clamp(dt * 7.5, 0, 1))
              .normalize();
            bolt.vel.copy(_boltVel).multiplyScalar(boltSpeed);
            _aimPoint.copy(bolt.pos).add(_boltVel);
            bolt.mesh.lookAt(_aimPoint);
          }
        }
      }

      bolt.prevPos.copy(bolt.pos);
      bolt.pos.addScaledVector(bolt.vel, dt);
      bolt.mesh.position.copy(bolt.pos);

      // Segment-to-beacon distance check so fast lasers never tunnel through target
      _segVec.subVectors(bolt.pos, bolt.prevPos);
      const segLenSq = _segVec.lengthSq();
      let projT = 0;
      if (segLenSq > 0.0001) {
        _toTarget.subVectors(beaconPos, bolt.prevPos);
        projT = THREE.MathUtils.clamp(_toTarget.dot(_segVec) / segLenSq, 0, 1);
      }
      _closestPt.copy(bolt.prevPos).addScaledVector(_segVec, projT);

      if (_closestPt.distanceToSquared(beaconPos) <= beaconHitRadiusSq) {
        bolt.active = false;
        bolt.mesh.visible = false;
        this.spawnBurst(beaconPos, 0xfacc15, 11);
        this.waypointsCaptured += 1;
        this.callbacks.onWaypointCaptured(this.waypointsCaptured);
        this.callbacks.onHitmarker?.('beacon');
        this.relocateTarget('alternate');
        continue;
      }

      // Check planet surface collision
      const distFromCenter = bolt.pos.length();
      if (distFromCenter > 1) {
        _radialUp.copy(bolt.pos).divideScalar(distFromCenter);
        const surfR = this.planetManager.getSurfaceRadiusAt(
          _radialUp.x,
          _radialUp.y,
          _radialUp.z,
        );
        if (distFromCenter <= surfR) {
          bolt.active = false;
          bolt.mesh.visible = false;
          _closestPt.copy(_radialUp).multiplyScalar(surfR + 0.35);
          this.spawnBurst(_closestPt, 0x38bdf8, 5.5);
          this.callbacks.onHitmarker?.('terrain');
        }
      }
    }

    for (let i = 0; i < this.bursts.length; i++) {
      const burst = this.bursts[i];
      if (!burst.active) continue;
      burst.age += dt;
      const t = burst.age / burst.maxAge;
      if (t >= 1) {
        burst.active = false;
        burst.mesh.visible = false;
        continue;
      }
      const scale = THREE.MathUtils.lerp(0.8, burst.maxScale, t);
      burst.mesh.scale.setScalar(scale);
      burst.material.opacity = (1 - t) * 0.92;
    }
  }

  private spawnWingBolt(): void {
    let slot: LaserBolt | null = null;
    for (let i = 0; i < this.bolts.length; i++) {
      if (!this.bolts[i].active) {
        slot = this.bolts[i];
        break;
      }
    }
    if (!slot) {
      slot = this.bolts[0];
    }

    this.soundEngine.playLaser();

    this.fireAlternator = (this.fireAlternator + 1) % 2;
    const wingSide = this.fireAlternator === 0 ? -1 : 1;

    _shipForward.set(0, 0, -1).applyQuaternion(this.shipQuat);
    _shipUp.set(0, 1, 0).applyQuaternion(this.shipQuat);
    _shipRight.set(1, 0, 0).applyQuaternion(this.shipQuat);

    // Compute world convergence point straight through the centered crosshair (or locked beacon)
    if (this.targetLocked) {
      _toTarget.subVectors(
        this.beaconModel.group.position,
        this.shipRoot.position,
      );
      if (
        _toTarget.lengthSq() > 4 &&
        _toTarget.normalize().dot(_shipForward) > 0.35
      ) {
        _aimPoint.copy(this.beaconModel.group.position);
      } else if (
        this.config.cameraMode === 'chase' ||
        this.config.cameraMode === 'cockpit'
      ) {
        this.camera.getWorldDirection(_camDir);
        _aimPoint.copy(this.camera.position).addScaledVector(_camDir, 145);
      } else {
        _aimPoint
          .copy(this.shipRoot.position)
          .addScaledVector(_shipForward, 145);
      }
    } else if (
      this.config.cameraMode === 'chase' ||
      this.config.cameraMode === 'cockpit'
    ) {
      this.camera.getWorldDirection(_camDir);
      _aimPoint.copy(this.camera.position).addScaledVector(_camDir, 145);
    } else {
      _aimPoint
        .copy(this.shipRoot.position)
        .addScaledVector(_shipForward, 145);
    }

    _boltStart
      .copy(this.shipRoot.position)
      .addScaledVector(_shipRight, wingSide * 1.9)
      .addScaledVector(_shipUp, 0.05)
      .addScaledVector(_shipForward, 1.4);

    _boltVel.subVectors(_aimPoint, _boltStart).normalize();
    const speed = 290 + this.velocity.length();

    slot.active = true;
    slot.life = 1.6;
    slot.pos.copy(_boltStart);
    slot.prevPos.copy(_boltStart);
    slot.vel.copy(_boltVel).multiplyScalar(speed);

    slot.mesh.position.copy(_boltStart);
    slot.mesh.lookAt(_aimPoint);
    slot.mesh.visible = true;
  }

  private spawnBurst(
    pos: THREE.Vector3,
    colorHex: number,
    maxScale: number,
  ): void {
    let slot: ImpactBurst | null = null;
    for (let i = 0; i < this.bursts.length; i++) {
      if (!this.bursts[i].active) {
        slot = this.bursts[i];
        break;
      }
    }
    if (!slot) {
      slot = this.bursts[0];
    }
    slot.active = true;
    slot.age = 0;
    slot.maxAge = 0.28;
    slot.maxScale = maxScale;
    slot.material.color.setHex(colorHex);
    slot.material.opacity = 0.95;
    slot.mesh.position.copy(pos);
    slot.mesh.scale.setScalar(0.8);
    slot.mesh.visible = true;
  }

  private stepAtmosphereAndExhaustParticles(
    dt: number,
    isThrusting: boolean,
    isBoosting: boolean,
    thrustPower: number,
    atmoRatio: number,
    speed: number,
  ): void {
    // 1. Thruster Exhaust Particles
    _shipForward.set(0, 0, -1).applyQuaternion(this.shipQuat);
    _shipUp.set(0, 1, 0).applyQuaternion(this.shipQuat);
    _shipRight.set(1, 0, 0).applyQuaternion(this.shipQuat);
    _worldQuatTemp
      .copy(this.shipQuat)
      .multiply(this.shipModel.group.quaternion);

    const exhaustRate = isThrusting ? (isBoosting ? 90 : 58) : speed > 18 ? 16 : 0;
    this.exhaustSpawnAccum += dt * exhaustRate;
    while (this.exhaustSpawnAccum >= 1) {
      this.exhaustSpawnAccum -= 1;
      let slot: ExhaustParticle | null = null;
      for (let i = 0; i < MAX_EXHAUST; i++) {
        if (!this.exhaustParticles[i].active) {
          slot = this.exhaustParticles[i];
          break;
        }
      }
      if (!slot) break;

      this.exhaustAlternator = (this.exhaustAlternator + 1) % 2;
      const side = this.exhaustAlternator === 0 ? -0.46 : 0.46;
      _nozzleOffset
        .set(side, 0.04, 1.95)
        .applyQuaternion(_worldQuatTemp)
        .add(this.shipRoot.position);

      slot.active = true;
      slot.age = 0;
      slot.maxAge = isBoosting ? 0.42 : 0.32;
      slot.baseScale = isBoosting ? 1.35 : 0.75 + thrustPower * 0.35;
      slot.boosting = isBoosting;
      slot.pos.copy(_nozzleOffset);
      slot.vel
        .copy(this.velocity)
        .multiplyScalar(0.35)
        .addScaledVector(_shipForward, -(14 + thrustPower * 16));
      slot.vel.x += (Math.random() - 0.5) * 2.2;
      slot.vel.y += (Math.random() - 0.5) * 2.2;
      slot.vel.z += (Math.random() - 0.5) * 2.2;
    }

    for (let i = 0; i < MAX_EXHAUST; i++) {
      const p = this.exhaustParticles[i];
      if (!p.active) {
        _dummyObj.scale.set(0, 0, 0);
        _dummyObj.updateMatrix();
        this.exhaustMesh.setMatrixAt(i, _dummyObj.matrix);
        continue;
      }

      p.age += dt;
      const t = p.age / p.maxAge;
      if (t >= 1) {
        p.active = false;
        _dummyObj.scale.set(0, 0, 0);
        _dummyObj.updateMatrix();
        this.exhaustMesh.setMatrixAt(i, _dummyObj.matrix);
        continue;
      }

      p.pos.addScaledVector(p.vel, dt);
      const scale = p.baseScale * (1 - t * 0.92);
      _dummyObj.position.copy(p.pos);
      _dummyObj.rotation.set(0, 0, 0);
      _dummyObj.scale.setScalar(scale);
      _dummyObj.updateMatrix();
      this.exhaustMesh.setMatrixAt(i, _dummyObj.matrix);

      if (p.boosting) {
        _particleStartCol.setHex(0xfef08a);
        _particleEndCol.setHex(0xea580c);
      } else {
        _particleStartCol.setHex(0x38bdf8);
        _particleEndCol.setHex(0x7c3aed);
      }
      _particleColor.lerpColors(_particleStartCol, _particleEndCol, t);
      this.exhaustMesh.setColorAt(i, _particleColor);
    }
    this.exhaustMesh.instanceMatrix.needsUpdate = true;
    if (this.exhaustMesh.instanceColor) {
      this.exhaustMesh.instanceColor.needsUpdate = true;
    }

    // 2. Atmospheric Slipstream & Re-Entry Thermal Ember Streaks
    const isReentryActive = this.reentryIntensity > 0.14;
    const streakRate = isReentryActive
      ? 35 + this.reentryIntensity * 65
      : atmoRatio > 0.05 && speed > 18
        ? Math.min(36, (speed - 16) * 0.85 * atmoRatio)
        : 0;

    this.streakSpawnAccum += dt * streakRate;
    while (this.streakSpawnAccum >= 1) {
      this.streakSpawnAccum -= 1;
      let slot: StreakParticle | null = null;
      for (let i = 0; i < MAX_STREAKS; i++) {
        if (!this.streakParticles[i].active) {
          slot = this.streakParticles[i];
          break;
        }
      }
      if (!slot) break;

      const angle = Math.random() * Math.PI * 2;
      const radialDist = isReentryActive
        ? 1.5 + Math.random() * 6.5
        : 3.0 + Math.random() * 9.0;
      const aheadDist = isReentryActive
        ? 6 + Math.random() * 14
        : 12 + Math.random() * 18;

      slot.active = true;
      slot.age = 0;
      slot.maxAge = isReentryActive ? 0.24 : 0.32;
      slot.reentry = isReentryActive;
      slot.pos
        .copy(this.shipRoot.position)
        .addScaledVector(_shipForward, aheadDist)
        .addScaledVector(_shipRight, Math.cos(angle) * radialDist)
        .addScaledVector(_shipUp, Math.sin(angle) * radialDist);

      const backSpeed = isReentryActive ? 68 + speed * 0.75 : 48 + speed * 0.5;
      slot.vel.copy(_shipForward).multiplyScalar(-backSpeed);
    }

    for (let i = 0; i < MAX_STREAKS; i++) {
      const s = this.streakParticles[i];
      if (!s.active) {
        _dummyObj.scale.set(0, 0, 0);
        _dummyObj.updateMatrix();
        this.streakMesh.setMatrixAt(i, _dummyObj.matrix);
        continue;
      }

      s.age += dt;
      const t = s.age / s.maxAge;
      if (t >= 1) {
        s.active = false;
        _dummyObj.scale.set(0, 0, 0);
        _dummyObj.updateMatrix();
        this.streakMesh.setMatrixAt(i, _dummyObj.matrix);
        continue;
      }

      s.pos.addScaledVector(s.vel, dt);
      _dummyObj.position.copy(s.pos);
      _dummyObj.quaternion.copy(this.shipQuat);
      const fade = Math.sin(t * Math.PI);
      _dummyObj.scale.set(
        s.reentry ? 1.45 * fade : 0.75 * fade,
        s.reentry ? 1.45 * fade : 0.75 * fade,
        s.reentry ? 1.55 : 1.0,
      );
      _dummyObj.updateMatrix();
      this.streakMesh.setMatrixAt(i, _dummyObj.matrix);

      if (s.reentry) {
        _particleStartCol.setHex(0xfef08a);
        _particleEndCol.setHex(0xd946ef);
        _particleColor.lerpColors(_particleStartCol, _particleEndCol, t);
      } else {
        _particleColor.setHex(0x7dd3fc);
      }
      this.streakMesh.setColorAt(i, _particleColor);
    }
    this.streakMesh.instanceMatrix.needsUpdate = true;
    if (this.streakMesh.instanceColor) {
      this.streakMesh.instanceColor.needsUpdate = true;
    }
  }

  private updateAtmosphereAndCamera(dt: number): void {
    // Smooth Sky & Fog Transition between Planetary Atmosphere and Deep Space
    const atmoT = this.atmospherePct / 100;
    _blendedBgColor.lerpColors(_spaceBgColor, _atmoBgColor, atmoT);
    (this.scene.background as THREE.Color).copy(_blendedBgColor);
    this.fog.color.copy(_blendedBgColor);
    this.fog.density = THREE.MathUtils.lerp(0.00028, 0.0024, atmoT);

    const mode: CameraMode = this.config.cameraMode;
    const shipPos = this.shipRoot.position;

    if (mode === 'orbit') {
      if (!this.userOrbiting) {
        this.controls.target.x = THREE.MathUtils.damp(
          this.controls.target.x,
          shipPos.x,
          6,
          dt,
        );
        this.controls.target.y = THREE.MathUtils.damp(
          this.controls.target.y,
          shipPos.y,
          6,
          dt,
        );
        this.controls.target.z = THREE.MathUtils.damp(
          this.controls.target.z,
          shipPos.z,
          6,
          dt,
        );
      }
      this.controls.update();
      return;
    }

    _shipForward.set(0, 0, -1).applyQuaternion(this.shipQuat);
    _shipUp.set(0, 1, 0).applyQuaternion(this.shipQuat);

    if (mode === 'chase') {
      // Positioned slightly above & behind the ship while converging forward at 135m
      // so the centered crosshair (50%, 50%) aligns cleanly above the starfighter silhouette
      _desiredCamPos
        .copy(shipPos)
        .addScaledVector(_shipForward, -13.5)
        .addScaledVector(_shipUp, 3.8);
      _desiredLookAt.copy(shipPos).addScaledVector(_shipForward, 135);
    } else if (mode === 'tactical') {
      _desiredCamPos
        .copy(shipPos)
        .addScaledVector(_shipForward, -10)
        .addScaledVector(_shipUp, 38);
      _desiredLookAt.copy(shipPos).addScaledVector(_shipForward, 6);
    } else {
      // cockpit
      _desiredCamPos
        .copy(shipPos)
        .addScaledVector(_shipForward, 0.25)
        .addScaledVector(_shipUp, 1.35);
      _desiredLookAt.copy(shipPos).addScaledVector(_shipForward, 140);
    }

    const lambda = mode === 'cockpit' ? 18 : 6.8;
    this.camera.position.x = THREE.MathUtils.damp(
      this.camera.position.x,
      _desiredCamPos.x,
      lambda,
      dt,
    );
    this.camera.position.y = THREE.MathUtils.damp(
      this.camera.position.y,
      _desiredCamPos.y,
      lambda,
      dt,
    );
    this.camera.position.z = THREE.MathUtils.damp(
      this.camera.position.z,
      _desiredCamPos.z,
      lambda,
      dt,
    );

    if (this.reentryIntensity > 0.04 && mode !== 'tactical') {
      const t = this.timer.getElapsed();
      const shake = this.reentryIntensity * 0.14;
      this.camera.position.x += Math.sin(t * 53) * shake;
      this.camera.position.y += Math.cos(t * 61) * shake;
    }

    _camUp.lerp(_shipUp, THREE.MathUtils.clamp(dt * 6.5, 0, 1)).normalize();
    this.camera.up.copy(_camUp);

    _currentLookAt.x = THREE.MathUtils.damp(
      _currentLookAt.x,
      _desiredLookAt.x,
      lambda * 1.2,
      dt,
    );
    _currentLookAt.y = THREE.MathUtils.damp(
      _currentLookAt.y,
      _desiredLookAt.y,
      lambda * 1.2,
      dt,
    );
    _currentLookAt.z = THREE.MathUtils.damp(
      _currentLookAt.z,
      _desiredLookAt.z,
      lambda * 1.2,
      dt,
    );
    this.camera.lookAt(_currentLookAt);

    const speedRatio = THREE.MathUtils.clamp(
      this.velocity.length() / Math.max(this.config.ship.maxSpeed, 1),
      0,
      1.3,
    );
    const targetFov =
      mode === 'tactical' ? 54 : 60 + speedRatio * 10 + this.reentryIntensity * 4.5;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 5, dt);
      this.camera.updateProjectionMatrix();
    }
  }

  private computeOffScreenIndicator(): OffScreenIndicatorState {
    const targetWorld = this.beaconModel.group.position;
    const w = this.lastViewportW;
    const h = this.lastViewportH;

    _viewPos.copy(targetWorld).applyMatrix4(this.camera.matrixWorldInverse);
    const isBehind = _viewPos.z > 0;

    _projVec.copy(targetWorld).project(this.camera);

    let sx = (_projVec.x * 0.5 + 0.5) * w;
    let sy = (-_projVec.y * 0.5 + 0.5) * h;

    if (isBehind) {
      sx = w - sx;
      sy = h - sy;
    }

    const onScreen =
      !isBehind && sx >= 12 && sx <= w - 12 && sy >= 12 && sy <= h - 12;

    const dist = this.camera.position.distanceTo(targetWorld);
    const t = THREE.MathUtils.clamp(dist / 220, 0, 1);
    _indColor.lerpColors(_nearColor, _farColor, t);
    const colorHex = `#${_indColor.getHexString()}`;

    if (onScreen) {
      return {
        active: true,
        onScreen: true,
        x: sx,
        y: sy,
        angleDeg: 0,
        distance: dist,
        color: colorHex,
      };
    }

    const cx = w * 0.5;
    const cy = h * 0.5;
    let dx = sx - cx;
    let dy = sy - cy;

    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
      dy = -1;
    }

    const margin = THREE.MathUtils.clamp(
      this.config.backdrop.indicatorMargin,
      0.03,
      0.3,
    );
    const halfW = w * 0.5 * (1 - margin);
    const halfH = h * 0.5 * (1 - margin);

    const scale = Math.min(
      halfW / (Math.abs(dx) + 0.001),
      halfH / (Math.abs(dy) + 0.001),
    );

    const edgeX = cx + dx * scale;
    const edgeY = cy + dy * scale;
    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;

    return {
      active: true,
      onScreen: false,
      x: edgeX,
      y: edgeY,
      angleDeg,
      distance: dist,
      color: colorHex,
    };
  }

  private emitTelemetry(): void {
    const targetDist = this.shipRoot.position.distanceTo(
      this.beaconModel.group.position,
    );
    _shipForward.set(0, 0, -1).applyQuaternion(this.shipQuat);
    const heading =
      ((THREE.MathUtils.radToDeg(Math.atan2(_shipForward.x, -_shipForward.z)) %
        360) +
        360) %
      360;

    const isThrusting =
      this.virtualInputs.thrust > 0.05 ||
      this.keysDown.has('KeyW') ||
      this.keysDown.has('ArrowUp');
    const isBoosting =
      this.virtualInputs.boost ||
      this.keysDown.has('Space') ||
      this.keysDown.has('ShiftLeft');

    this.callbacks.onTelemetry({
      speed: this.velocity.length(),
      altitude: this.shipAltitude,
      headingDeg: heading,
      inSpace: this.inSpace,
      atmospherePct: this.atmospherePct,
      planetPatches: this.planetManager.patchCount,
      targetDistance: targetDist,
      targetZone: this.targetZone,
      waypointsCaptured: this.waypointsCaptured,
      targetLocked: this.targetLocked,
      reentryIntensity: this.reentryIntensity,
      isThrusting,
      isBoosting,
      indicator: this.lastIndicator ?? this.computeOffScreenIndicator(),
    });
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.timer.disconnect();
    this.timer.dispose();

    window.removeEventListener('blur', this.boundOnBlur);
    document.removeEventListener(
      'visibilitychange',
      this.boundOnVisibilityChange,
    );
    window.removeEventListener('resize', this.boundOnResize);
    window.removeEventListener('orientationchange', this.boundOnResize);
    window.visualViewport?.removeEventListener('resize', this.boundOnResize);
    window.removeEventListener('keydown', this.boundOnKeyDown);
    window.removeEventListener('keyup', this.boundOnKeyUp);
    window.removeEventListener('pointerdown', this.boundUnlockAudio);
    window.removeEventListener('keydown', this.boundUnlockAudio);
    window.removeEventListener('pointerup', this.boundOnPointerUp);
    window.removeEventListener('pointercancel', this.boundOnPointerUp);
    this.renderer.domElement.removeEventListener(
      'pointerdown',
      this.boundOnPointerDown,
    );
    this.renderer.domElement.removeEventListener(
      'contextmenu',
      this.boundOnContextMenu,
    );
    this.renderer.domElement.removeEventListener(
      'webglcontextlost',
      this.boundOnContextLost,
    );
    this.renderer.domElement.removeEventListener(
      'webglcontextrestored',
      this.boundOnContextRestored,
    );

    this.soundEngine.dispose();
    this.controls.dispose();
    this.planetManager.dispose();
    this.spaceBackground.dispose();
    this.shipModel.dispose();
    this.beaconModel.dispose();
    this.boltGeo.dispose();
    this.boltCyanMat.dispose();
    this.boltVioletMat.dispose();
    this.burstGeo.dispose();
    for (const burst of this.bursts) {
      burst.material.dispose();
    }
    this.exhaustGeo.dispose();
    this.exhaustMat.dispose();
    this.exhaustMesh.dispose();
    this.streakGeo.dispose();
    this.streakMat.dispose();
    this.streakMesh.dispose();
    this.hoverShadowGeo.dispose();
    this.hoverShadowMat.dispose();
    this.hoverShadowTex.dispose();
    this.envRT.dispose();
    this.renderer.dispose();

    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
