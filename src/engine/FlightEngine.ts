import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  CharacterCameraMode,
  HorizonHudState,
  LandingState,
  OffScreenIndicatorState,
  PlayerMode,
  SimulationConfig,
  TelemetrySnapshot,
} from '../types/simulation';
import { BeaconController } from './BeaconController';
import { getBiomeName } from './biomes';
import { CameraRig } from './CameraRig';
import { CharacterController } from './CharacterController';
import { FlightPhysics } from './FlightPhysics';
import { FloraManager } from './FloraManager';
import {
  FlightInputSample,
  InputController,
  VirtualInputs,
} from './InputController';
import { LandingHooks } from './LandingController';
import {
  computeHorizonHud,
  computeOffScreenIndicator,
} from './OffScreenIndicator';
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
const _localUp = new THREE.Vector3();
const _snapCamPos = new THREE.Vector3();
const _snapLookAt = new THREE.Vector3();
const _snapUp = new THREE.Vector3();
const _sunDir = new THREE.Vector3();
const _clearingPos = new THREE.Vector3();

const _spaceBgColor = new THREE.Color(0x03040a);
const _dayAtmoBgColor = new THREE.Color(0x0e2547);
const _nightAtmoBgColor = new THREE.Color(0x040712);
const _sunsetAtmoBgColor = new THREE.Color(0x3a1e32);
const _daySunColor = new THREE.Color(0xfff1d6);
const _sunsetSunColor = new THREE.Color(0xff9f5a);
const _skyTmpColor = new THREE.Color();
const _blendedBgColor = new THREE.Color();

const DAY_CYCLE_SECONDS = 180;
const SUN_ORBIT_TILT = 0.36;

const IDLE_FLIGHT_INPUTS: FlightInputSample = {
  turn: 0,
  pitch: 0,
  thrust: 0,
  isThrusting: false,
  isBoosting: false,
  wantsFire: false,
};

export interface FlightEngineCallbacks {
  onTelemetry: (snapshot: TelemetrySnapshot) => void;
  onCharacterCameraChange?: (mode: CharacterCameraMode) => void;
  onIndicatorFrame?: (indicator: OffScreenIndicatorState) => void;
  onHorizonFrame?: (horizon: HorizonHudState) => void;
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
  private particleRatio = 1.0;
  private floraDensityRatio = 1.0;
  private floraViewRatio = 1.0;

  // Mission & input state
  private playerMode: PlayerMode = 'ship';
  private waypointsCaptured = 0;
  private targetLocked = false;
  private wantsFire = false;
  private isThrusting = false;
  private isBoosting = false;
  private sunPhaseOffset = 0;

  // Loop & lifecycle
  private timer = new THREE.Timer();
  private frameId = 0;
  private disposed = false;
  private lastTelemetryEmit = -1;
  private lastViewportW = 1;
  private lastViewportH = 1;
  private avgFpsDt = 1 / 60;
  private hasFpsSample = false;
  private lastIndicator: OffScreenIndicatorState | null = null;
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

    this.rimLight = new THREE.DirectionalLight(0x6366f1, 0.25);
    this.rimLight.position.set(-240, -140, -220);
    this.scene.add(this.rimLight);

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
    this.planetManager.setGrassDetail(
      this.qualityScaler.getCurrentPreset().terrainDetailRatio *
        (this.isSoftwareGl || this.isMobileDevice ? 0.7 : 1.0),
    );
    this.scene.add(this.planetManager.root);

    const lowSpec = this.isSoftwareGl || this.isMobileDevice;
    this.shipModel = createShipModel(lowSpec);
    this.physics = new FlightPhysics(this.scene, this.shipModel);
    this.character = new CharacterController(this.scene, lowSpec);
    this.beaconController = new BeaconController(this.scene);

    this.weaponsSystem = new WeaponsSystem(this.scene, this.soundEngine);
    this.particleSystem = new ParticleSystem(this.scene);
    this.floraManager = new FloraManager(this.scene, {
      castShadows: enableShadowMap,
      isMobileOrSoftware: lowSpec,
    });

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
    this.initSunPhaseForSpot(this.physics.shipRoot.position);
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
    this.floraDensityRatio = preset.floraDensityRatio;
    this.floraViewRatio = preset.floraViewRatio;
    this.planetManager.setGrassDetail(
      preset.terrainDetailRatio *
        (this.isSoftwareGl || this.isMobileDevice ? 0.7 : 1.0),
    );
    this.floraManager.setCastShadows(preset.shadowsEnabled);
    this.emitTelemetry();
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
    if (this.playerMode !== 'character') return;
    this.soundEngine.unlock();
    this.character.toggleJetpack();
    this.lastTelemetryEmit = -1;
  }

  public toggleDampeners(): void {
    if (this.playerMode !== 'character') return;
    this.character.toggleDampeners();
    this.lastTelemetryEmit = -1;
  }

  public toggleCharacterCamera(): void {
    if (this.playerMode !== 'character') return;
    const next: CharacterCameraMode =
      this.config.characterCamera === 'third' ? 'first' : 'third';
    this.config.characterCamera = next;
    this.callbacks.onCharacterCameraChange?.(next);
    this.lastTelemetryEmit = -1;
  }

  public toggleLanding(): void {
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

  public launchToOrbit(): void {
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
    if (Number.isFinite(rawDt) && rawDt > 0 && rawDt < 0.5 && !document.hidden) {
      if (!this.hasFpsSample) {
        this.avgFpsDt = rawDt;
        this.hasFpsSample = true;
      } else {
        const fpsAlpha = 1 - Math.exp(-rawDt / 1.0);
        this.avgFpsDt += (rawDt - this.avgFpsDt) * fpsAlpha;
      }
    }
    const dt = Math.min(rawDt, 0.05);
    const elapsed = this.timer.getElapsed();

    this.computeSunDir(elapsed, _sunDir);
    this.planetManager.update(elapsed, _sunDir);

    const isCharMode = this.playerMode === 'character';
    const shipInputs = isCharMode
      ? IDLE_FLIGHT_INPUTS
      : this.inputController.sampleFlightInputs(this.config.ship.invertPitch);
    const landingControlled = this.physics.landing.isControlling;

    const physOut = this.physics.step(dt, elapsed, {
      inputs: shipInputs,
      ship: this.config.ship,
      planet: this.config.planet,
      planetManager: this.planetManager,
      beaconPos: this.beaconController.position,
      targetLocked: isCharMode || landingControlled ? false : this.targetLocked,
      shadowMapEnabled: this.renderer.shadowMap.enabled,
      landingHooks: this.landingHooks,
      floraManager: this.floraManager,
      floraEnabled: this.config.flora.enabled,
      cameraMode: isCharMode ? 'chase' : this.config.cameraMode,
    });
    this.syncLandingClearing();

    this.wantsFire = isCharMode || landingControlled ? false : shipInputs.wantsFire;
    this.isThrusting = isCharMode || landingControlled ? false : shipInputs.isThrusting;
    this.isBoosting = isCharMode || landingControlled ? false : physOut.isBoosting;

    if (this.playerMode === 'character') {
      const charInputs = this.inputController.sampleCharacterInputs();
      this.character.step(dt, elapsed, {
        inputs: charInputs,
        cameraMode: this.config.characterCamera,
        planet: this.config.planet,
        planetManager: this.planetManager,
        floraManager: this.floraManager,
        floraEnabled: this.config.flora.enabled,
        shipPos: this.physics.shipRoot.position,
      });
    }

    const focusPos =
      this.playerMode === 'character'
        ? this.character.root.position
        : this.physics.shipRoot.position;

    this.soundEngine.updateAtmosphereEntry(this.physics.reentryIntensity);
    this.particleSystem.update(dt, {
      shipPos: this.physics.shipRoot.position,
      shipQuat: this.physics.shipQuat,
      shipVisualQuat: this.shipModel.group.quaternion,
      shipVelocity: this.physics.velocity,
      isThrusting:
        isCharMode || landingControlled ? false : shipInputs.thrust > 0.05,
      isBoosting: this.isBoosting,
      thrustPower: physOut.thrustPower,
      atmoRatio: physOut.atmoRatio,
      speed: physOut.speed,
      reentryIntensity: this.physics.reentryIntensity,
      particleRatio: this.particleRatio,
    });

    // Global rotating Sun DirectionalLight anchored around focusPos for crisp shadows & planetary/lunar day-night cycle
    this.keyLight.position.copy(focusPos).addScaledVector(_sunDir, 320);
    this.keyLight.target.position.copy(focusPos);

    const focusAlt =
      this.playerMode === 'character'
        ? this.character.altitude
        : this.physics.shipAltitude;

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
    );

    if (
      focusPos.distanceTo(this.beaconController.position) <
      (this.playerMode === 'character' ? 5.5 : 8.5)
    ) {
      this.waypointsCaptured += 1;
      this.callbacks.onWaypointCaptured(this.waypointsCaptured);
      this.relocateTarget('alternate');
    }

    this.weaponsSystem.update(dt, {
      wantsFire: this.wantsFire,
      targetLocked: isCharMode || landingControlled ? false : this.targetLocked,
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
        mode: this.config.cameraMode,
        shipPos: this.physics.shipRoot.position,
        shipQuat: this.physics.shipQuat,
        speed: physOut.speed,
        maxSpeed: this.config.ship.maxSpeed,
        reentryIntensity: this.physics.reentryIntensity,
        landingState: this.physics.landing.state,
      });
    }

    this.spaceBackground.update(elapsed, this.cameraRig.camera.position);
    this.planetManager.updateHorizonCulling(
      this.cameraRig.camera.position,
      this.cameraRig.camera,
    );

    this.renderer.render(this.scene, this.cameraRig.camera);

    this.lastIndicator = computeOffScreenIndicator(
      this.cameraRig.camera,
      this.beaconController.position,
      this.lastViewportW,
      this.lastViewportH,
      this.config.backdrop.indicatorMargin,
    );
    this.callbacks.onIndicatorFrame?.(this.lastIndicator);

    if (this.callbacks.onHorizonFrame) {
      const camPos = this.cameraRig.camera.position;
      const camDist = camPos.length();
      let groundR = this.config.planet.planetRadius;
      if (camDist > 0.001 && camDist < this.config.planet.planetRadius + 25) {
        _shipDir.copy(camPos).divideScalar(camDist);
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
      floraInstances: floraStats.instancesDrawn,
      floraGroups: floraStats.groupsActive,
      renderCalls,
      terrainDraws,
      floraDraws,
      otherDraws,
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
