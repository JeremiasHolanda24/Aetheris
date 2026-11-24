import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  OffScreenIndicatorState,
  SimulationConfig,
  TelemetrySnapshot,
} from '../types/simulation';
import { BeaconController } from './BeaconController';
import { getBiomeName } from './biomes';
import { CameraRig } from './CameraRig';
import { FlightPhysics } from './FlightPhysics';
import { InputController, VirtualInputs } from './InputController';
import { LandingHooks } from './LandingController';
import { computeOffScreenIndicator } from './OffScreenIndicator';
import { ParticleSystem } from './ParticleSystem';
import { PlanetTerrainManager } from './PlanetTerrainManager';
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
const _snapCamPos = new THREE.Vector3();
const _snapLookAt = new THREE.Vector3();
const _snapUp = new THREE.Vector3();
const _keyLightOffset = new THREE.Vector3(260, 320, 180);

const _spaceBgColor = new THREE.Color(0x05050d);
const _atmoBgColor = new THREE.Color(0x0b1d38);
const _blendedBgColor = new THREE.Color();

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

  private keyLight: THREE.DirectionalLight;
  private shipModel: ShipModelHandle;
  private planetManager: PlanetTerrainManager;
  private spaceBackground: SpaceBackground;

  // Extracted engine subsystems
  private soundEngine = new SoundEngine();
  private qualityScaler: QualityScaler;
  private inputController: InputController;
  private cameraRig: CameraRig;
  private physics: FlightPhysics;
  private beaconController: BeaconController;
  private weaponsSystem: WeaponsSystem;
  private particleSystem: ParticleSystem;
  private particleRatio = 1.0;

  // Mission & input state
  private waypointsCaptured = 0;
  private targetLocked = false;
  private wantsFire = false;
  private isThrusting = false;
  private isBoosting = false;

  // Loop & lifecycle
  private timer = new THREE.Timer();
  private frameId = 0;
  private disposed = false;
  private lastTelemetryEmit = -1;
  private lastViewportW = 1;
  private lastViewportH = 1;
  private lastIndicator: OffScreenIndicatorState | null = null;
  private readonly landingHooks: LandingHooks;

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
    this.fog = new THREE.FogExp2(0x0b1d38, 0.0017);
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

    // 5. Three-Point Solar Lighting Rig
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

    // 6. Subsystems
    this.spaceBackground = new SpaceBackground(this.config.backdrop);
    this.spaceBackground.setPixelRatio(pixelRatio);
    this.scene.add(this.spaceBackground.root);

    this.qualityScaler = new QualityScaler({
      isSoftwareGl: this.isSoftwareGl,
      basePixelRatio: pixelRatio,
      baseShadowsEnabled: enableShadowMap,
      onLevelApplied: (preset) => this.applyQualityPreset(preset),
    });

    this.planetManager = new PlanetTerrainManager(this.config.planet);
    this.scene.add(this.planetManager.root);

    this.shipModel = createShipModel(this.isSoftwareGl || this.isMobileDevice);
    this.physics = new FlightPhysics(this.scene, this.shipModel);
    this.beaconController = new BeaconController(this.scene);

    this.weaponsSystem = new WeaponsSystem(this.scene, this.soundEngine);
    this.particleSystem = new ParticleSystem(this.scene);

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
    });

    this.landOnSurface();
    this.beaconController.relocateTarget(
      'surface',
      this.physics.shipRoot.position,
      this.config.planet,
      this.planetManager,
    );

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.cameraRig.camera);
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
    this.config = structuredClone(next);
    this.planetManager.updateParams(next.planet);
    this.cameraRig.setPlanetRadius(next.planet.planetRadius);
    this.spaceBackground.updateParams(next.backdrop);

    if (prevMode !== next.cameraMode) {
      if (next.cameraMode === 'orbit') {
        this.inputController.clearFirePointers();
      }
      this.cameraRig.setMode(next.cameraMode, this.physics.shipRoot.position);
    }
  }

  public setVirtualInputs(inputs: VirtualInputs): void {
    this.inputController.setVirtualInputs(inputs);
  }

  public setTargetLocked(locked: boolean): void {
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

  private applyQualityPreset(preset: QualityPreset): void {
    this.renderer.setPixelRatio(preset.pixelRatio);
    this.renderer.setSize(this.lastViewportW, this.lastViewportH);
    this.spaceBackground.setPixelRatio(preset.pixelRatio);
    this.spaceBackground.setStarRatio(preset.starRatio);
    if (this.renderer.shadowMap.enabled !== preset.shadowsEnabled) {
      this.renderer.shadowMap.enabled = preset.shadowsEnabled;
      this.keyLight.castShadow = preset.shadowsEnabled;
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.particleRatio = preset.particleRatio;
    this.emitTelemetry();
  }

  public toggleLanding(): void {
    this.soundEngine.unlock();
    this.physics.landing.toggle(
      this.physics.shipRoot.position,
      this.physics.velocity,
      this.planetManager,
      this.landingHooks,
    );
    this.lastTelemetryEmit = -1;
  }

  public landOnSurface(): void {
    this.physics.landOnSurface(
      this.planetManager,
      _snapCamPos,
      _snapLookAt,
      _snapUp,
    );
    this.cameraRig.snapTo(_snapCamPos, _snapLookAt, _snapUp, true);
    this.lastTelemetryEmit = -1;
  }

  public launchToOrbit(): void {
    this.physics.launchToOrbit(
      this.config.planet,
      _snapCamPos,
      _snapLookAt,
      _snapUp,
    );
    this.cameraRig.snapTo(_snapCamPos, _snapLookAt, _snapUp, false);
    this.lastTelemetryEmit = -1;
  }

  public relocateTarget(
    mode: 'surface' | 'orbit' | 'moon' | 'alternate' = 'alternate',
  ): void {
    this.beaconController.relocateTarget(
      mode,
      this.physics.shipRoot.position,
      this.config.planet,
      this.planetManager,
    );
  }

  private handleResize(): void {
    if (this.disposed) return;
    const w = Math.max(this.container.clientWidth, 1);
    const h = Math.max(this.container.clientHeight, 1);
    this.lastViewportW = w;
    this.lastViewportH = h;
    this.cameraRig.setAspect(w, h);
    this.renderer.setSize(w, h);
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
    this.qualityScaler.update(rawDt, document.hidden);
    const dt = Math.min(rawDt, 0.05);
    const elapsed = this.timer.getElapsed();

    this.planetManager.update(elapsed, this.cameraRig.camera.position, dt);
    if (this.beaconController.targetZone === 'moon') {
      this.beaconController.syncMoonBeaconPosition(this.planetManager);
    }

    const inputs = this.inputController.sampleFlightInputs(
      this.config.ship.invertPitch,
    );
    const landingControlled = this.physics.landing.isControlling;
    this.wantsFire = landingControlled ? false : inputs.wantsFire;
    this.isThrusting = landingControlled ? false : inputs.isThrusting;
    this.isBoosting = landingControlled ? false : inputs.isBoosting;

    const physOut = this.physics.step(dt, elapsed, {
      inputs,
      ship: this.config.ship,
      planet: this.config.planet,
      planetManager: this.planetManager,
      beaconPos: this.beaconController.position,
      targetLocked: landingControlled ? false : this.targetLocked,
      shadowMapEnabled: this.renderer.shadowMap.enabled,
      landingHooks: this.landingHooks,
    });

    this.soundEngine.updateAtmosphereEntry(this.physics.reentryIntensity);
    this.particleSystem.update(dt, {
      shipPos: this.physics.shipRoot.position,
      shipQuat: this.physics.shipQuat,
      shipVisualQuat: this.shipModel.group.quaternion,
      shipVelocity: this.physics.velocity,
      isThrusting: landingControlled ? false : inputs.thrust > 0.05,
      isBoosting: this.isBoosting,
      thrustPower: physOut.thrustPower,
      atmoRatio: physOut.atmoRatio,
      speed: physOut.speed,
      reentryIntensity: this.physics.reentryIntensity,
      particleRatio: this.particleRatio,
    });

    if (
      this.physics.shipRoot.position.distanceTo(
        this.beaconController.position,
      ) < 8.5
    ) {
      this.waypointsCaptured += 1;
      this.callbacks.onWaypointCaptured(this.waypointsCaptured);
      this.relocateTarget('alternate');
    }

    this.keyLight.position
      .copy(this.physics.shipRoot.position)
      .add(_keyLightOffset);
    this.keyLight.target.position.copy(this.physics.shipRoot.position);

    this.weaponsSystem.update(dt, {
      wantsFire: this.wantsFire,
      targetLocked: landingControlled ? false : this.targetLocked,
      cameraMode: this.config.cameraMode,
      camera: this.cameraRig.camera,
      shipPos: this.physics.shipRoot.position,
      shipQuat: this.physics.shipQuat,
      shipVelocityLen: physOut.speed,
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

    const atmoT = this.physics.atmospherePct / 100;
    _blendedBgColor.lerpColors(_spaceBgColor, _atmoBgColor, atmoT);
    (this.scene.background as THREE.Color).copy(_blendedBgColor);
    this.fog.color.copy(_blendedBgColor);
    this.fog.density = THREE.MathUtils.lerp(0.0002, 0.0017, atmoT);

    this.cameraRig.update(dt, elapsed, {
      mode: this.config.cameraMode,
      shipPos: this.physics.shipRoot.position,
      shipQuat: this.physics.shipQuat,
      speed: physOut.speed,
      maxSpeed: this.config.ship.maxSpeed,
      reentryIntensity: this.physics.reentryIntensity,
      landingState: this.physics.landing.state,
    });

    this.spaceBackground.update(elapsed, this.cameraRig.camera.position);
    this.planetManager.updateHorizonCulling(this.cameraRig.camera.position);

    this.renderer.render(this.scene, this.cameraRig.camera);

    this.lastIndicator = computeOffScreenIndicator(
      this.cameraRig.camera,
      this.beaconController.position,
      this.lastViewportW,
      this.lastViewportH,
      this.config.backdrop.indicatorMargin,
    );
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

  private emitTelemetry(): void {
    const targetDist = this.physics.shipRoot.position.distanceTo(
      this.beaconController.position,
    );
    _shipForward.set(0, 0, -1).applyQuaternion(this.physics.shipQuat);
    const heading =
      ((THREE.MathUtils.radToDeg(Math.atan2(_shipForward.x, -_shipForward.z)) %
        360) +
        360) %
      360;

    let biome = '';
    if (!this.physics.inSpace) {
      const lenSq = this.physics.shipRoot.position.lengthSq();
      if (lenSq > 0.0001) {
        _shipDir
          .copy(this.physics.shipRoot.position)
          .divideScalar(Math.sqrt(lenSq));
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

    this.callbacks.onTelemetry({
      speed: this.physics.velocity.length(),
      altitude: this.physics.shipAltitude,
      headingDeg: heading,
      inSpace: this.physics.inSpace,
      atmospherePct: this.physics.atmospherePct,
      biome,
      planetPatches: this.planetManager.patchCount,
      targetDistance: targetDist,
      targetZone: this.beaconController.targetZone,
      waypointsCaptured: this.waypointsCaptured,
      targetLocked: this.targetLocked,
      reentryIntensity: this.physics.reentryIntensity,
      isThrusting: this.isThrusting,
      isBoosting: this.isBoosting,
      qualityLevel: this.qualityScaler.getLevel(),
      landingState,
      canLand,
      landHint,
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

    this.inputController.dispose();
    this.weaponsSystem.dispose();
    this.particleSystem.dispose();
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
