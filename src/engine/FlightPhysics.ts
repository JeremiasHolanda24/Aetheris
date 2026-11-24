import * as THREE from 'three';
import { PlanetParams, ShipParams } from '../types/simulation';
import { FlightInputSample } from './InputController';
import {
  GEAR_REST_HEIGHT,
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

  private readonly scene: THREE.Scene;
  private readonly shipModel: ShipModelHandle;
  private readonly hoverShadowMesh: THREE.Mesh;
  private readonly hoverShadowGeo: THREE.PlaneGeometry;
  private readonly hoverShadowMat: THREE.MeshBasicMaterial;
  private readonly hoverShadowTex: THREE.CanvasTexture;

  private bankRad = 0;
  private pitchVisualRad = 0;

  private readonly stepOut: PhysicsStepResult = {
    speed: 0,
    atmoRatio: 1,
    thrustPower: 0,
  };

  constructor(scene: THREE.Scene, shipModel: ShipModelHandle) {
    this.scene = scene;
    this.shipModel = shipModel;
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
  }

  public landOnSurface(
    planetManager: PlanetTerrainManager,
    outCamPos: THREE.Vector3,
    outLookAt: THREE.Vector3,
    outUp: THREE.Vector3,
  ): void {
    planetManager.findLandDirection(0, _radialUp);
    const surfR = planetManager.getSurfaceRadiusAt(
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

    this.landing.forceLanded(_radialUp, planetManager);
    this.shipModel.setGearExtension(this.landing.gearT);

    outUp.copy(_surfNormal);
    outCamPos
      .copy(this.shipRoot.position)
      .addScaledVector(_shipForward, -13.5)
      .addScaledVector(_surfNormal, 3.8);
    outLookAt.copy(this.shipRoot.position).addScaledVector(_shipForward, 135);
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

    this.landing.forceFlying();
    this.shipModel.setGearExtension(0);

    _shipForward.set(0, 0, -1).applyQuaternion(this.shipQuat);
    outUp.set(0, 1, 0).applyQuaternion(this.shipQuat);
    outCamPos
      .copy(this.shipRoot.position)
      .addScaledVector(_shipForward, -13.5)
      .addScaledVector(outUp, 3.8);
    outLookAt.copy(this.shipRoot.position).addScaledVector(_shipForward, 135);
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
    } = params;
    const { rotationSpeed, thrustForce, maxSpeed, drag } = ship;
    const { planetRadius, atmosphereHeight } = planet;

    const turnInput = inputs.turn;
    const pitchInput = inputs.pitch;
    const thrustInput = inputs.thrust;
    const boostMult = inputs.isBoosting && thrustInput > 0 ? 1.85 : 1.0;

    // Radial normal & atmosphere ratio
    _radialUp.copy(this.shipRoot.position).normalize();
    const distFromCenter = this.shipRoot.position.length();
    const altitude = distFromCenter - planetRadius;
    const atmoRatio =
      1 - THREE.MathUtils.smoothstep(altitude, 0, atmosphereHeight);
    this.atmospherePct = Math.round(atmoRatio * 100);
    this.inSpace = altitude > atmosphereHeight;

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
      if (atmoRatio > 0.08 && Math.abs(_shipForward.dot(_radialUp)) < 0.85) {
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
          thrustInput * thrustForce * vacuumMult * boostMult * dt,
        );
      }

      const effectiveMax =
        maxSpeed * vacuumMult * (inputs.isBoosting ? 1.45 : 1.0);
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
      const newSurfR = planetManager.getSurfaceRadiusAt(
        _radialUp.x,
        _radialUp.y,
        _radialUp.z,
      );
      const minFlightR = newSurfR + 3.2;
      if (newDist < minFlightR) {
        this.shipRoot.position.copy(_radialUp).multiplyScalar(minFlightR);
        const inward = this.velocity.dot(_radialUp);
        if (inward < 0) {
          this.velocity.addScaledVector(_radialUp, -inward);
        }
      }

      // Moon Collision Sphere
      const { center: moonCenter, radius: moonRadius } =
        planetManager.getMoonState();
      _moonToShip.subVectors(this.shipRoot.position, moonCenter);
      const moonDist = _moonToShip.length();
      const minMoonR = moonRadius + 3.2;
      if (moonDist < minMoonR) {
        if (moonDist > 0.0001) {
          _moonToShip.divideScalar(moonDist);
        } else {
          _moonToShip.copy(_unitY);
        }
        this.shipRoot.position
          .copy(moonCenter)
          .addScaledVector(_moonToShip, minMoonR);
        const inwardMoon = this.velocity.dot(_moonToShip);
        if (inwardMoon < 0) {
          this.velocity.addScaledVector(_moonToShip, -inwardMoon);
        }
      }
    }

    _radialUp.copy(this.shipRoot.position).normalize();
    const curSurfR = planetManager.getSurfaceRadiusAt(
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
    const showShadow = !shadowMapEnabled && this.shipAltitude < 32;
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

    // Visual Banking & Pitch Tilt on Ship Mesh
    const landingControlled = this.landing.isControlling;
    const visualTurn = landingControlled ? 0 : turnInput;
    const visualPitch = landingControlled ? 0 : pitchInput;
    this.bankRad = THREE.MathUtils.damp(this.bankRad, visualTurn * 0.48, 8, dt);
    this.pitchVisualRad = THREE.MathUtils.damp(
      this.pitchVisualRad,
      visualPitch * 0.14,
      8,
      dt,
    );
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
              (0.55 + thrustInput * 0.45) * (inputs.isBoosting ? 1.45 : 1),
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
          inputs.isBoosting ? 0xf59e0b : 0x38bdf8,
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

    this.shipModel.updateEffects(
      elapsed,
      thrustPower,
      landingControlled ? false : inputs.isBoosting,
      this.reentryIntensity,
    );

    this.stepOut.speed = speed;
    this.stepOut.atmoRatio = atmoRatio;
    this.stepOut.thrustPower = thrustPower;
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
