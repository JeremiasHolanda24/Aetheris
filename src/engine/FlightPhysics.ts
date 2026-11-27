import * as THREE from 'three';
import { CameraMode, PlanetParams, ShipParams } from '../types/simulation';
import {
  IMPACT_DAMAGE_SCALE,
  IMPACT_MAX_DAMAGE,
  IMPACT_MIN_SPEED,
  RESERVE_THRUST_FACTOR,
} from './economy';
import { FloraManager, TreeCollider } from './FloraManager';
import { FlightInputSample } from './InputController';
import {
  GEAR_REST_HEIGHT,
  LandingBody,
  LandingController,
  LandingHooks,
} from './LandingController';
import { PlanetTerrainManager } from './PlanetTerrainManager';
import { ShipModelHandle } from './proceduralModels';

// Pre-allocated math helpers outside render loop (Zero GC)
const _shipForward = new THREE.Vector3();
const _shipUp = new THREE.Vector3();
const _shipRight = new THREE.Vector3();
const _radialUp = new THREE.Vector3();
const _surfNormal = new THREE.Vector3();
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
const _toTarget = new THREE.Vector3();
const _moonToShip = new THREE.Vector3();
const _shipBack = new THREE.Vector3();
const _basisMat = new THREE.Matrix4();
const _treeDiff = new THREE.Vector3();
const _treeAxis = new THREE.Vector3();
const _treeRadial = new THREE.Vector3();

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

export interface PhysicsStepResult {
  speed: number;
  atmoRatio: number;
  thrustPower: number;
  isBoosting: boolean;
  impactDamage: number;
  impactSeverity: number;
}

/**
 * Handles 3D quaternion flight dynamics, atmospheric horizon leveling,
 * planet & moon collision spheres, fallback contact shadow, and re-entry heating.
 */
export class FlightPhysics {
  public readonly shipRoot = new THREE.Group();
  public readonly shipQuat = new THREE.Quaternion();
  public readonly velocity = new THREE.Vector3(0, 0, 0);
  public readonly landing = new LandingController();

  public shipAltitude = 12;
  public atmospherePct = 100;
  public inSpace = false;
  public reentryIntensity = 0;
  public turboCharge = 1.0;
  public turboExhausted = false;
  private turboRechargeDelay = 0;
  private impactCooldown = 0;

  private readonly scene: THREE.Scene;
  private readonly shipModel: ShipModelHandle;
  private readonly hoverShadowMesh: THREE.Mesh;
  private readonly hoverShadowGeo: THREE.PlaneGeometry;
  private readonly hoverShadowMat: THREE.MeshBasicMaterial;
  private readonly hoverShadowTex: THREE.CanvasTexture;

  private bankRad = 0;
  private pitchVisualRad = 0;
  private readonly nearbyTrees: TreeCollider[] = [];

  private readonly stepOut: PhysicsStepResult = {
    speed: 0,
    atmoRatio: 1,
    thrustPower: 0,
    isBoosting: false,
    impactDamage: 0,
    impactSeverity: 0,
  };

  constructor(scene: THREE.Scene, shipModel: ShipModelHandle) {
    this.scene = scene;
    this.shipModel = shipModel;
    this.shipRoot.userData.perfTag = 'nave';
    this.shipRoot.add(this.shipModel.group);
    this.scene.add(this.shipRoot);

    this.hoverShadowTex = createSoftShadowTexture();
    this.hoverShadowGeo = new THREE.PlaneGeometry(8.5, 8.5);
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
    this.hoverShadowMesh.userData.perfTag = 'nave';
    this.scene.add(this.hoverShadowMesh);
  }

  private warmupSavedHoverShadowVisible = false;
  private forceHideHoverShadow = false;
  private readonly warmupSavedShipVisibles = new Map<THREE.Object3D, boolean>();

  public setForceHideHoverShadow(hidden: boolean): void {
    this.forceHideHoverShadow = hidden;
    if (hidden) {
      this.hoverShadowMesh.visible = false;
    }
  }

  public prepareForShaderWarmup(): void {
    this.warmupSavedHoverShadowVisible = this.hoverShadowMesh.visible;
    this.hoverShadowMesh.visible = true;
    this.warmupSavedShipVisibles.clear();
    this.shipRoot.traverse((obj) => {
      this.warmupSavedShipVisibles.set(obj, obj.visible);
      obj.visible = true;
    });
  }

  public restoreAfterShaderWarmup(): void {
    this.hoverShadowMesh.visible = this.warmupSavedHoverShadowVisible;
    this.warmupSavedShipVisibles.forEach((vis, obj) => {
      obj.visible = vis;
    });
    this.warmupSavedShipVisibles.clear();
  }

  public landOnSurface(
    planetManager: PlanetTerrainManager,
    outCamPos: THREE.Vector3,
    outLookAt: THREE.Vector3,
    outUp: THREE.Vector3,
  ): void {
    planetManager.findLandDirection(0, _radialUp);
    const surfR = planetManager.getRenderedSupportRadiusAt(
      _radialUp.x,
      _radialUp.y,
      _radialUp.z,
    );
    this.shipRoot.position
      .copy(_radialUp)
      .multiplyScalar(surfR + GEAR_REST_HEIGHT);

    planetManager.getSurfaceNormalAt(
      _radialUp.x,
      _radialUp.y,
      _radialUp.z,
      _surfNormal,
    );
    _shipRight.crossVectors(_unitY, _surfNormal);
    if (_shipRight.lengthSq() < 0.0001) {
      _shipRight.set(1, 0, 0);
    } else {
      _shipRight.normalize();
    }
    _shipForward.crossVectors(_surfNormal, _shipRight).normalize();
    _shipBack.copy(_shipForward).negate();
    _basisMat.makeBasis(_shipRight, _surfNormal, _shipBack);

    this.shipQuat.setFromRotationMatrix(_basisMat).normalize();
    this.shipRoot.quaternion.copy(this.shipQuat);
    this.shipModel.group.quaternion.identity();
    this.velocity.set(0, 0, 0);
    this.bankRad = 0;
    this.pitchVisualRad = 0;
    this.reentryIntensity = 0;
    this.turboCharge = 1.0;
    this.turboExhausted = false;
    this.turboRechargeDelay = 0;

    this.landing.forceLanded(_radialUp, planetManager);
    this.shipModel.setGearExtension(this.landing.gearT);
    this.shipModel.updateCockpit(
      0.1,
      0,
      GEAR_REST_HEIGHT,
      false,
      false,
      0,
      0,
      0,
      0,
      0,
      0,
    );

    outUp.copy(_surfNormal);
    outCamPos
      .copy(this.shipRoot.position)
      .addScaledVector(_shipForward, -20.0)
      .addScaledVector(_surfNormal, 5.7);
    outLookAt
      .copy(this.shipRoot.position)
      .addScaledVector(_shipForward, 5)
      .addScaledVector(_surfNormal, 0.7);
  }

  public restoreToLandingSpot(
    dir: THREE.Vector3,
    body: LandingBody,
    planetManager: PlanetTerrainManager,
    outCamPos: THREE.Vector3,
    outLookAt: THREE.Vector3,
    outUp: THREE.Vector3,
  ): void {
    if (body === 'moon') {
      const moon = planetManager.getMoonState();
      _radialUp.copy(dir).applyQuaternion(moon.moonQuat).normalize();
      this.shipRoot.position
        .copy(moon.center)
        .addScaledVector(_radialUp, moon.radius + GEAR_REST_HEIGHT);
      _surfNormal.copy(_radialUp);
    } else {
      _radialUp.copy(dir).normalize();
      const surfR = planetManager.getRenderedSupportRadiusAt(
        _radialUp.x,
        _radialUp.y,
        _radialUp.z,
      );
      this.shipRoot.position
        .copy(_radialUp)
        .multiplyScalar(surfR + GEAR_REST_HEIGHT);
      planetManager.getSurfaceNormalAt(
        _radialUp.x,
        _radialUp.y,
        _radialUp.z,
        _surfNormal,
      );
    }

    _shipRight.crossVectors(_unitY, _surfNormal);
    if (_shipRight.lengthSq() < 0.0001) {
      _shipRight.set(1, 0, 0);
    } else {
      _shipRight.normalize();
    }
    _shipForward.crossVectors(_surfNormal, _shipRight).normalize();
    _shipBack.copy(_shipForward).negate();
    _basisMat.makeBasis(_shipRight, _surfNormal, _shipBack);

    this.shipQuat.setFromRotationMatrix(_basisMat).normalize();
    this.shipRoot.quaternion.copy(this.shipQuat);
    this.shipModel.group.quaternion.identity();
    this.velocity.set(0, 0, 0);
    this.bankRad = 0;
    this.pitchVisualRad = 0;
    this.reentryIntensity = 0;
    this.impactCooldown = 0.8;

    this.landing.forceLanded(dir, planetManager, body);
    this.shipModel.setGearExtension(this.landing.gearT);
    this.shipModel.updateCockpit(
      0.1,
      0,
      GEAR_REST_HEIGHT,
      body === 'moon',
      false,
      0,
      0,
      0,
      0,
      0,
      0,
    );

    outUp.copy(_surfNormal);
    outCamPos
      .copy(this.shipRoot.position)
      .addScaledVector(_shipForward, -20.0)
      .addScaledVector(_surfNormal, 5.7);
    outLookAt
      .copy(this.shipRoot.position)
      .addScaledVector(_shipForward, 5)
      .addScaledVector(_surfNormal, 0.7);
  }

  public launchToOrbit(
    planetParams: PlanetParams,
    outCamPos: THREE.Vector3,
    outLookAt: THREE.Vector3,
    outUp: THREE.Vector3,
  ): void {
    const { planetRadius, atmosphereHeight } = planetParams;
    const orbitDist = planetRadius + atmosphereHeight + 135;
    this.shipRoot.position.set(0, orbitDist * 0.68, orbitDist * 0.74);

    outLookAt.set(0, planetRadius * 0.35, 0);
    const m = new THREE.Matrix4().lookAt(
      this.shipRoot.position,
      outLookAt,
      _unitY,
    );
    this.shipQuat.setFromRotationMatrix(m);
    this.shipRoot.quaternion.copy(this.shipQuat);
    this.shipModel.group.quaternion.identity();
    this.velocity.set(0, 0, 0);
    this.bankRad = 0;
    this.pitchVisualRad = 0;
    this.reentryIntensity = 0;
    this.turboCharge = 1.0;
    this.turboExhausted = false;
    this.turboRechargeDelay = 0;

    this.landing.forceFlying();
    this.shipModel.setGearExtension(0);
    this.shipModel.updateCockpit(
      0.1,
      0,
      atmosphereHeight + 135,
      true,
      false,
      0,
      0,
      0,
      0,
      0,
      0,
    );

    _shipForward.set(0, 0, -1).applyQuaternion(this.shipQuat);
    outUp.set(0, 1, 0).applyQuaternion(this.shipQuat);
    outCamPos
      .copy(this.shipRoot.position)
      .addScaledVector(_shipForward, -16.0)
      .addScaledVector(outUp, 4.2);
    outLookAt.copy(this.shipRoot.position).addScaledVector(_shipForward, 135);
  }

  public prepareDescentState(
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
    startAltitude: number,
    atmosphereHeight: number,
  ): void {
    this.landing.forceFlying();
    this.shipModel.setGearExtension(0);

    this.shipRoot.position.copy(position);
    this.shipQuat.copy(quaternion).normalize();
    this.shipRoot.quaternion.copy(this.shipQuat);
    this.shipModel.group.quaternion.identity();

    this.velocity.set(0, 0, 0);
    this.bankRad = 0;
    this.pitchVisualRad = 0;
    this.reentryIntensity = 0;
    this.turboCharge = 1.0;
    this.turboExhausted = false;
    this.turboRechargeDelay = 0;
    this.shipAltitude = startAltitude;
    this.inSpace = startAltitude > atmosphereHeight;
    this.atmospherePct = Math.round(
      (1 - THREE.MathUtils.smoothstep(startAltitude, 0, atmosphereHeight)) * 100,
    );
  }

  public step(
    dt: number,
    elapsed: number,
    params: {
      inputs: FlightInputSample;
      ship: ShipParams;
      planet: PlanetParams;
      planetManager: PlanetTerrainManager;
      beaconPos: THREE.Vector3;
      targetLocked: boolean;
      shadowMapEnabled: boolean;
      landingHooks: LandingHooks;
      floraManager?: FloraManager;
      floraEnabled?: boolean;
      cameraMode?: CameraMode;
      disableHorizonLeveling?: boolean;
      autopilotMaxSpeed?: number;
      reserveMode?: boolean;
    },
  ): PhysicsStepResult {
    const {
      inputs,
      ship,
      planet,
      planetManager,
      beaconPos,
      targetLocked,
      shadowMapEnabled,
      landingHooks,
      floraManager,
      floraEnabled,
      cameraMode,
      disableHorizonLeveling,
      reserveMode = false,
    } = params;
    const { rotationSpeed, thrustForce, maxSpeed, drag } = ship;
    const { planetRadius, atmosphereHeight } = planet;

    this.impactCooldown = Math.max(0, this.impactCooldown - dt);

    const turnInput = inputs.turn;
    const pitchInput = inputs.pitch;
    const thrustInput = inputs.thrust;

    const wantsBoost =
      !reserveMode &&
      inputs.isBoosting &&
      thrustInput > 0.05 &&
      !this.landing.isControlling;
    let effectiveBoosting = false;
    if (wantsBoost && !this.turboExhausted && this.turboCharge > 0.001) {
      effectiveBoosting = true;
      this.turboCharge = Math.max(0, this.turboCharge - 0.26 * dt);
      this.turboRechargeDelay = 0.55;
      if (this.turboCharge <= 0.001) {
        this.turboCharge = 0;
        this.turboExhausted = true;
      }
    } else {
      if (this.turboRechargeDelay > 0) {
        this.turboRechargeDelay = Math.max(0, this.turboRechargeDelay - dt);
      } else {
        this.turboCharge = Math.min(1, this.turboCharge + 0.18 * dt);
      }
      if (this.turboExhausted && this.turboCharge >= 0.22) {
        this.turboExhausted = false;
      }
    }

    const boostMult = effectiveBoosting ? 1.85 : 1.0;
    const reserveScale = reserveMode ? RESERVE_THRUST_FACTOR : 1.0;

    // Radial normal & atmosphere ratio
    _radialUp.copy(this.shipRoot.position).normalize();
    const distFromCenter = this.shipRoot.position.length();
    const altitude = distFromCenter - planetRadius;
    const atmoRatio =
      1 - THREE.MathUtils.smoothstep(altitude, 0, atmosphereHeight);
    this.atmospherePct = Math.round(atmoRatio * 100);
    this.inSpace = altitude > atmosphereHeight;

    let maxImpactSpeed = 0;

    if (this.landing.isControlling) {
      this.landing.update(
        dt,
        {
          root: this.shipRoot,
          quat: this.shipQuat,
          velocity: this.velocity,
        },
        planetManager,
        { turn: turnInput, pitch: pitchInput, thrust: thrustInput },
        landingHooks,
      );
    } else {
      this.landing.stepFlyingGear(dt);

      // 3D Quaternion Yaw & Pitch
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

      // Target Lock (Travar Alvo)
      if (targetLocked) {
        _toTarget.subVectors(beaconPos, this.shipRoot.position);
        const distToBeaconLock = _toTarget.length();
        if (distToBeaconLock > 4) {
          _toTarget.divideScalar(distToBeaconLock);
          if (this.shipAltitude < 34 && _toTarget.dot(_radialUp) < 0.1) {
            _toTarget.addScaledVector(_radialUp, 0.42).normalize();
          }
          _shipForward.set(0, 0, -1).applyQuaternion(this.shipQuat);
          const manualMag = Math.min(1, Math.hypot(turnInput, pitchInput));
          const lockBlend =
            (1 - manualMag * 0.65) * THREE.MathUtils.clamp(dt * 3.4, 0, 1);
          _alignQuat.setFromUnitVectors(_shipForward, _toTarget);
          _rotQuat.copy(_alignQuat).multiply(this.shipQuat);
          this.shipQuat.slerp(_rotQuat, lockBlend);
        }
      }

      // Gentle planetary horizon roll-leveling inside atmosphere when not near vertical
      _shipForward.set(0, 0, -1).applyQuaternion(this.shipQuat);
      _shipUp.set(0, 1, 0).applyQuaternion(this.shipQuat);
      if (
        !disableHorizonLeveling &&
        atmoRatio > 0.08 &&
        Math.abs(_shipForward.dot(_radialUp)) < 0.85
      ) {
        _targetRight.crossVectors(_shipForward, _radialUp).normalize();
        _targetUp.crossVectors(_targetRight, _shipForward).normalize();
        _alignQuat.setFromUnitVectors(_shipUp, _targetUp);
        this.shipQuat.slerp(
          _alignQuat.multiply(this.shipQuat),
          THREE.MathUtils.clamp(dt * 2.4 * atmoRatio, 0, 1),
        );
      }
      this.shipQuat.normalize();
      this.shipRoot.quaternion.copy(this.shipQuat);

      // Thrust & Drag (1x inside atmosphere, smoothly scaled to planetRadius / 180 in vacuum)
      const spaceScale = planetRadius / 180;
      const vacuumMult = THREE.MathUtils.lerp(spaceScale, 1, atmoRatio);

      _shipForward.set(0, 0, -1).applyQuaternion(this.shipQuat);
      if (Math.abs(thrustInput) > 0.01) {
        this.velocity.addScaledVector(
          _shipForward,
          thrustInput * thrustForce * vacuumMult * boostMult * reserveScale * dt,
        );
      }

      let effectiveMax =
        maxSpeed *
        vacuumMult *
        (effectiveBoosting ? 1.45 : 1.0) *
        (reserveMode ? 0.45 : 1.0);
      if (params.autopilotMaxSpeed !== undefined) {
        effectiveMax = Math.min(effectiveMax, params.autopilotMaxSpeed);
      }
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

      // Spherical Terrain Collision Floor
      _radialUp.copy(this.shipRoot.position).normalize();
      const newDist = this.shipRoot.position.length();
      const newSurfR = planetManager.getRenderedSurfaceRadiusAt(
        _radialUp.x,
        _radialUp.y,
        _radialUp.z,
      );
      const minFlightR = newSurfR + 3.8;
      if (newDist < minFlightR) {
        this.shipRoot.position.copy(_radialUp).multiplyScalar(minFlightR);
        const inward = this.velocity.dot(_radialUp);
        if (inward < 0) {
          if (-inward > maxImpactSpeed) maxImpactSpeed = -inward;
          this.velocity.addScaledVector(_radialUp, -inward);
        }
      }

      // Moon Collision Sphere
      const { center: moonCenter, radius: moonRadius, moonVelocity } =
        planetManager.getMoonState();
      _moonToShip.subVectors(this.shipRoot.position, moonCenter);
      const moonDist = _moonToShip.length();
      const minMoonR = moonRadius + 3.8;
      if (moonDist < minMoonR) {
        if (moonDist > 0.0001) {
          _moonToShip.divideScalar(moonDist);
        } else {
          _moonToShip.copy(_unitY);
        }
        this.shipRoot.position
          .copy(moonCenter)
          .addScaledVector(_moonToShip, minMoonR);
        const relVx = this.velocity.x - moonVelocity.x;
        const relVy = this.velocity.y - moonVelocity.y;
        const relVz = this.velocity.z - moonVelocity.z;
        const relInward =
          relVx * _moonToShip.x + relVy * _moonToShip.y + relVz * _moonToShip.z;
        if (relInward < 0) {
          if (-relInward > maxImpactSpeed) maxImpactSpeed = -relInward;
        }
        const inwardMoon = this.velocity.dot(_moonToShip);
        if (inwardMoon < 0) {
          this.velocity.addScaledVector(_moonToShip, -inwardMoon);
        }
      }

      // Cylindrical Tree Collision (only when flying near planet ground)
      if (floraManager && floraEnabled && altitude <= 40) {
        const treeCount = floraManager.queryTrees(
          this.shipRoot.position,
          this.nearbyTrees,
        );
        const minTreeDist = 2.8;
        const minTreeDistSq = minTreeDist * minTreeDist;
        for (let t = 0; t < treeCount; t++) {
          const tree = this.nearbyTrees[t];
          _treeDiff.set(
            this.shipRoot.position.x - tree.x,
            this.shipRoot.position.y - tree.y,
            this.shipRoot.position.z - tree.z,
          );
          _treeAxis.set(tree.nx, tree.ny, tree.nz);
          const axial = _treeDiff.dot(_treeAxis);
          if (axial < -1.5 || axial >= tree.height) continue;

          _treeRadial.copy(_treeDiff).addScaledVector(_treeAxis, -axial);
          const radSq = _treeRadial.lengthSq();
          if (radSq >= minTreeDistSq) continue;

          const radDist = Math.sqrt(radSq);
          if (radDist > 0.0001) {
            _treeRadial.divideScalar(radDist);
          } else {
            _treeRadial.crossVectors(
              Math.abs(_treeAxis.y) < 0.9 ? _unitY : _unitX,
              _treeAxis,
            ).normalize();
          }

          this.shipRoot.position.addScaledVector(
            _treeRadial,
            minTreeDist - radDist,
          );
          const inwardTree = this.velocity.dot(_treeRadial);
          if (inwardTree < 0) {
            if (-inwardTree > maxImpactSpeed) maxImpactSpeed = -inwardTree;
            this.velocity.addScaledVector(_treeRadial, -inwardTree);
          }
        }
      }
    }

    _radialUp.copy(this.shipRoot.position).normalize();
    const curSurfR = planetManager.getRenderedSurfaceRadiusAt(
      _radialUp.x,
      _radialUp.y,
      _radialUp.z,
    );
    const curPlanetAlt = this.shipRoot.position.length() - curSurfR;

    const { center: curMoonCenter, radius: curMoonRadius } =
      planetManager.getMoonState();
    _moonToShip.subVectors(this.shipRoot.position, curMoonCenter);
    const curMoonDist = _moonToShip.length();
    const curMoonAlt = curMoonDist - curMoonRadius;
    const moonClosest = curMoonAlt < curPlanetAlt;

    this.shipAltitude = Math.max(0.5, moonClosest ? curMoonAlt : curPlanetAlt);

    // Spherical Ground Contact Shadow (fallback for mobile/software GPUs without shadowMap)
    const showShadow =
      !this.forceHideHoverShadow && !shadowMapEnabled && this.shipAltitude < 32;
    this.hoverShadowMesh.visible = showShadow;
    if (showShadow) {
      if (moonClosest) {
        if (curMoonDist > 0.0001) {
          _moonToShip.divideScalar(curMoonDist);
        } else {
          _moonToShip.copy(_unitY);
        }
        this.hoverShadowMesh.position
          .copy(curMoonCenter)
          .addScaledVector(_moonToShip, curMoonRadius + 0.18);
        this.hoverShadowMesh.quaternion.setFromUnitVectors(_unitY, _moonToShip);
      } else {
        this.hoverShadowMesh.position
          .copy(_radialUp)
          .multiplyScalar(curSurfR + 0.18);
        this.hoverShadowMesh.quaternion.setFromUnitVectors(_unitY, _radialUp);
      }
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

    // Landing gear animation
    this.shipModel.setGearExtension(this.landing.gearT);

    // Visual Banking & Pitch Tilt on Ship Mesh (keep level in cockpit mode so interior stays aligned with pilot POV)
    const landingControlled = this.landing.isControlling;
    if (cameraMode === 'cockpit') {
      this.bankRad = 0;
      this.pitchVisualRad = 0;
    } else {
      const visualTurn = landingControlled ? 0 : turnInput;
      const visualPitch = landingControlled ? 0 : pitchInput;
      this.bankRad = THREE.MathUtils.damp(this.bankRad, visualTurn * 0.48, 8, dt);
      this.pitchVisualRad = THREE.MathUtils.damp(
        this.pitchVisualRad,
        visualPitch * 0.14,
        8,
        dt,
      );
    }
    _bankQuat.setFromAxisAngle(_unitZ, this.bankRad);
    _pitchQuat.setFromAxisAngle(_unitX, this.pitchVisualRad);
    _visualQuat.copy(_pitchQuat).multiply(_bankQuat);
    this.shipModel.group.quaternion.copy(_visualQuat);

    // Thruster Plumes & Atmospheric Re-Entry Intensity
    const speed = this.velocity.length();
    const speedNorm = THREE.MathUtils.clamp(
      speed / Math.max(maxSpeed, 1),
      0,
      1.3,
    );
    let thrustPower = 0;
    if (landingControlled) {
      this.shipModel.leftFlame.visible = false;
      this.shipModel.rightFlame.visible = false;
      this.shipModel.flameMaterial.opacity = 0;
      if (this.shipModel.thrusterLight) {
        this.shipModel.thrusterLight.color.setHex(0x38bdf8);
        this.shipModel.thrusterLight.intensity = 0.2;
      }
    } else {
      this.shipModel.leftFlame.visible = true;
      this.shipModel.rightFlame.visible = true;
      thrustPower =
        thrustInput > 0.05
          ? THREE.MathUtils.clamp(
              (0.55 + thrustInput * 0.45) * (effectiveBoosting ? 1.45 : 1),
              0,
              1.5,
            )
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
          effectiveBoosting ? 0xf59e0b : 0x38bdf8,
        );
        this.shipModel.thrusterLight.intensity =
          thrustInput > 0.05 ? 3.5 * boostMult : 0.95;
      }
    }

    const radialSpeedInward = -this.velocity.dot(_radialUp);
    const atmoEntryBand =
      THREE.MathUtils.smoothstep(altitude, 6, atmosphereHeight * 0.42) *
      (1 -
        THREE.MathUtils.smoothstep(
          altitude,
          atmosphereHeight * 0.88,
          atmosphereHeight * 1.25,
        ));
    const diveHeat = THREE.MathUtils.clamp((radialSpeedInward - 2.5) / 18, 0, 1);
    const speedHeat = THREE.MathUtils.clamp((speed - 22) / 30, 0, 1);
    const descending = THREE.MathUtils.clamp(radialSpeedInward / 6, 0, 1);
    const targetReentry = landingControlled
      ? 0
      : atmoEntryBand * Math.max(diveHeat, speedHeat * 0.65 * descending);
    this.reentryIntensity = THREE.MathUtils.damp(
      this.reentryIntensity,
      targetReentry,
      4.8,
      dt,
    );

    const isCockpit = cameraMode === 'cockpit';
    this.shipModel.setCockpitView(isCockpit);
    this.shipModel.updateEffects(
      elapsed,
      thrustPower,
      effectiveBoosting,
      this.reentryIntensity,
    );

    _shipForward.set(0, 0, -1).applyQuaternion(this.shipQuat);
    _shipRight.set(1, 0, 0).applyQuaternion(this.shipQuat);
    const cockpitPitchRad = Math.asin(
      THREE.MathUtils.clamp(_shipForward.dot(_radialUp), -1, 1),
    );
    const cockpitRollRad = Math.asin(
      THREE.MathUtils.clamp(-_shipRight.dot(_radialUp), -1, 1),
    );
    const cockpitHeadingDeg =
      ((THREE.MathUtils.radToDeg(Math.atan2(_shipForward.x, -_shipForward.z)) %
        360) +
        360) %
      360;
    _toTarget.subVectors(beaconPos, this.shipRoot.position);
    const targetBearingDeg =
      ((THREE.MathUtils.radToDeg(Math.atan2(_toTarget.x, -_toTarget.z)) % 360) +
        360) %
      360;

    this.shipModel.updateCockpit(
      dt,
      speed,
      this.shipAltitude,
      this.inSpace,
      effectiveBoosting,
      landingControlled ? 0 : turnInput,
      landingControlled ? 0 : pitchInput,
      cockpitPitchRad,
      cockpitRollRad,
      cockpitHeadingDeg,
      targetBearingDeg,
    );

    let impactDamage = 0;
    let impactSeverity = 0;
    if (maxImpactSpeed > IMPACT_MIN_SPEED && this.impactCooldown <= 0) {
      impactDamage = Math.min(
        IMPACT_MAX_DAMAGE,
        (maxImpactSpeed - IMPACT_MIN_SPEED) * IMPACT_DAMAGE_SCALE,
      );
      impactSeverity = THREE.MathUtils.clamp(
        (maxImpactSpeed - IMPACT_MIN_SPEED) / 25,
        0.25,
        1,
      );
      this.impactCooldown = 0.45;
    }

    this.stepOut.speed = speed;
    this.stepOut.atmoRatio = atmoRatio;
    this.stepOut.thrustPower = thrustPower;
    this.stepOut.isBoosting = effectiveBoosting;
    this.stepOut.impactDamage = impactDamage;
    this.stepOut.impactSeverity = impactSeverity;
    return this.stepOut;
  }

  public dispose(): void {
    this.scene.remove(this.shipRoot);
    this.scene.remove(this.hoverShadowMesh);
    this.hoverShadowGeo.dispose();
    this.hoverShadowMat.dispose();
    this.hoverShadowTex.dispose();
  }
}
