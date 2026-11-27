import * as THREE from 'three';
import { LandingState } from '../types/simulation';
import { PlanetTerrainManager } from './PlanetTerrainManager';

export const GEAR_REST_HEIGHT = 1.08;
export const MAX_LAND_ALTITUDE = 45;
export const MAX_LAND_SPEED = 30;
export const MAX_SLOPE_DEG = 28;

export type LandingBody = 'planet' | 'moon';

// Pre-allocated scratch math objects (Zero GC per frame)
const _radialDir = new THREE.Vector3();
const _moonOffset = new THREE.Vector3();
const _surfNormal = new THREE.Vector3();
const _shipForward = new THREE.Vector3();
const _targetForward = new THREE.Vector3();
const _shipRight = new THREE.Vector3();
const _shipBack = new THREE.Vector3();
const _horizVel = new THREE.Vector3();
const _relVel = new THREE.Vector3();
const _worldDir = new THREE.Vector3();
const _worldFwd = new THREE.Vector3();
const _unitY = new THREE.Vector3(0, 1, 0);
const _unitX = new THREE.Vector3(1, 0, 0);
const _basisMat = new THREE.Matrix4();
const _targetQuat = new THREE.Quaternion();
const _invMoonQuat = new THREE.Quaternion();

export interface LandingEvaluation {
  canLand: boolean;
  hint: string;
}

export interface LandingHooks {
  spawnDust: (pos: THREE.Vector3, normal: THREE.Vector3, count: number) => void;
  onTouchdown: () => void;
  onGear: (extending: boolean) => void;
}

export interface LandingShipRef {
  root: THREE.Object3D;
  quat: THREE.Quaternion;
  velocity: THREE.Vector3;
}

/**
 * Manages No Man's Sky style automated landing, surface rest with suspension settle,
 * and vertical takeoff for both the planet terrain and the orbiting moon with zero GC allocations.
 */
export class LandingController {
  public state: LandingState = 'flying';
  public landedBody: LandingBody = 'planet';
  public gearT = 0;
  public stateTime = 0;
  public readonly landedDir = new THREE.Vector3(0, 1, 0);
  private readonly landedForwardLocal = new THREE.Vector3(0, 0, -1);

  private pendingTakeoffHooks = false;
  private readonly evalResult: LandingEvaluation = {
    canLand: false,
    hint: '',
  };

  public get isControlling(): boolean {
    return this.state !== 'flying';
  }

  private pickClosestBody(
    shipPos: THREE.Vector3,
    planetManager: PlanetTerrainManager,
  ): LandingBody {
    const planetDist = shipPos.length();
    if (planetDist > 0.0001) {
      _radialDir.copy(shipPos).divideScalar(planetDist);
    } else {
      _radialDir.copy(_unitY);
    }
    const planetSurfR = planetManager.getRenderedSupportRadiusAt(
      _radialDir.x,
      _radialDir.y,
      _radialDir.z,
    );
    const planetAlt = planetDist - planetSurfR;

    const moon = planetManager.getMoonState();
    _moonOffset.subVectors(shipPos, moon.center);
    const moonAlt = _moonOffset.length() - moon.radius;

    return moonAlt < planetAlt ? 'moon' : 'planet';
  }

  public evaluate(
    shipPos: THREE.Vector3,
    velocity: THREE.Vector3,
    planetManager: PlanetTerrainManager,
  ): LandingEvaluation {
    const body = this.pickClosestBody(shipPos, planetManager);

    let altitude: number;
    let speed: number;
    let slopeDeg: number;
    let isWater: boolean;

    if (body === 'moon') {
      const moon = planetManager.getMoonState();
      _moonOffset.subVectors(shipPos, moon.center);
      altitude = _moonOffset.length() - moon.radius;
      _relVel.subVectors(velocity, moon.moonVelocity);
      speed = _relVel.length();
      slopeDeg = 0;
      isWater = false;
    } else {
      const dist = shipPos.length();
      if (dist > 0.0001) {
        _radialDir.copy(shipPos).divideScalar(dist);
      } else {
        _radialDir.copy(_unitY);
      }

      const surfR = planetManager.getRenderedSupportRadiusAt(
        _radialDir.x,
        _radialDir.y,
        _radialDir.z,
      );
      altitude = dist - surfR;
      speed = velocity.length();

      planetManager.getSurfaceNormalAt(
        _radialDir.x,
        _radialDir.y,
        _radialDir.z,
        _surfNormal,
      );
      const slopeDot = THREE.MathUtils.clamp(_surfNormal.dot(_radialDir), -1, 1);
      slopeDeg = THREE.MathUtils.radToDeg(Math.acos(slopeDot));
      isWater =
        planetManager.getRawHeightNormAt(
          _radialDir.x,
          _radialDir.y,
          _radialDir.z,
        ) <= planetManager.getSeaLevel();
    }

    if (altitude > MAX_LAND_ALTITUDE) {
      this.evalResult.canLand = false;
      this.evalResult.hint = 'Aproxime-se do solo';
    } else if (speed > MAX_LAND_SPEED) {
      this.evalResult.canLand = false;
      this.evalResult.hint = 'Reduza a velocidade';
    } else if (slopeDeg > MAX_SLOPE_DEG) {
      this.evalResult.canLand = false;
      this.evalResult.hint = 'Terreno muito inclinado';
    } else if (isWater) {
      this.evalResult.canLand = false;
      this.evalResult.hint = 'Pouso na água indisponível';
    } else {
      this.evalResult.canLand = true;
      this.evalResult.hint = '';
    }

    return this.evalResult;
  }

  public toggle(
    shipPos: THREE.Vector3,
    velocity: THREE.Vector3,
    planetManager: PlanetTerrainManager,
    hooks?: Pick<LandingHooks, 'onGear'>,
  ): void {
    if (this.state === 'flying') {
      const check = this.evaluate(shipPos, velocity, planetManager);
      if (check.canLand) {
        this.landedBody = this.pickClosestBody(shipPos, planetManager);
        this.state = 'landing';
        this.stateTime = 0;
        hooks?.onGear(true);
      }
    } else if (this.state === 'landing') {
      this.state = 'flying';
      this.stateTime = 0;
      hooks?.onGear(false);
    } else if (this.state === 'landed') {
      this.state = 'takeoff';
      this.stateTime = 0;
      this.pendingTakeoffHooks = true;
    }
    // Ignore when state === 'takeoff'
  }

  public forceLanded(
    dir: THREE.Vector3,
    _planetManager: PlanetTerrainManager,
    body: LandingBody = 'planet',
  ): void {
    this.state = 'landed';
    this.landedBody = body;
    this.gearT = 1;
    this.stateTime = 1.0;
    this.pendingTakeoffHooks = false;
    this.landedDir.copy(dir).normalize();
  }

  public forceFlying(): void {
    this.state = 'flying';
    this.landedBody = 'planet';
    this.gearT = 0;
    this.stateTime = 0;
    this.pendingTakeoffHooks = false;
  }

  public stepFlyingGear(dt: number): void {
    if (this.gearT > 0) {
      this.gearT = Math.max(0, this.gearT - dt / 0.9);
    }
  }

  public update(
    dt: number,
    ship: LandingShipRef,
    planetManager: PlanetTerrainManager,
    input: { turn: number; pitch: number; thrust: number },
    hooks: LandingHooks,
  ): void {
    this.stateTime += dt;

    if (this.state === 'landing') {
      if (
        Math.abs(input.turn) > 0.6 ||
        Math.abs(input.pitch) > 0.6 ||
        input.thrust > 0.5
      ) {
        this.state = 'flying';
        this.stateTime = 0;
        hooks.onGear(false);
        return;
      }

      this.gearT = Math.min(1, this.gearT + dt / 1.1);

      if (this.landedBody === 'moon') {
        const moon = planetManager.getMoonState();
        _radialDir.subVectors(ship.root.position, moon.center);
        const dist = _radialDir.length();
        if (dist > 0.0001) {
          _radialDir.divideScalar(dist);
        } else {
          _radialDir.copy(_unitY);
        }

        const altitude = dist - moon.radius;
        _surfNormal.copy(_radialDir);

        this.computeAlignedQuat(ship.quat, _surfNormal, _targetQuat);
        ship.quat
          .slerp(_targetQuat, THREE.MathUtils.clamp(2.4 * dt, 0, 1))
          .normalize();
        ship.root.quaternion.copy(ship.quat);

        _relVel.subVectors(ship.velocity, moon.moonVelocity);
        const vVert = _relVel.dot(_radialDir);
        _horizVel
          .copy(_relVel)
          .addScaledVector(_radialDir, -vVert)
          .multiplyScalar(Math.exp(-2.2 * dt));

        const holdAlt = GEAR_REST_HEIGHT + 1;
        let targetVVert: number;
        if (this.gearT < 0.9 && altitude <= holdAlt) {
          targetVVert = Math.max(0, (holdAlt - altitude) * 4);
        } else {
          targetVVert = -THREE.MathUtils.clamp(altitude * 0.55, 1.2, 10);
        }

        ship.velocity
          .copy(moon.moonVelocity)
          .add(_horizVel)
          .addScaledVector(_radialDir, targetVVert);
        ship.root.position.addScaledVector(ship.velocity, dt);

        _radialDir.subVectors(ship.root.position, moon.center);
        const newDist = _radialDir.length();
        if (newDist > 0.0001) {
          _radialDir.divideScalar(newDist);
        } else {
          _radialDir.copy(_unitY);
        }
        const newAlt = newDist - moon.radius;

        if (this.gearT >= 0.9 && newAlt <= GEAR_REST_HEIGHT + 0.05) {
          this.state = 'landed';
          this.stateTime = 0;
          this.gearT = 1;
          ship.velocity.set(0, 0, 0);

          _invMoonQuat.copy(moon.moonQuat).invert();
          this.landedDir.copy(_radialDir).applyQuaternion(_invMoonQuat).normalize();
          _shipForward.set(0, 0, -1).applyQuaternion(ship.quat);
          this.landedForwardLocal
            .copy(_shipForward)
            .applyQuaternion(_invMoonQuat)
            .normalize();

          ship.root.position
            .copy(moon.center)
            .addScaledVector(_radialDir, moon.radius + GEAR_REST_HEIGHT);
          hooks.onTouchdown();
          hooks.spawnDust(ship.root.position, _radialDir, 12);
        }
        return;
      }

      const dist = ship.root.position.length();
      if (dist > 0.0001) {
        _radialDir.copy(ship.root.position).divideScalar(dist);
      } else {
        _radialDir.copy(_unitY);
      }

      const surfR = planetManager.getRenderedSupportRadiusAt(
        _radialDir.x,
        _radialDir.y,
        _radialDir.z,
      );
      const altitude = dist - surfR;

      planetManager.getSurfaceNormalAt(
        _radialDir.x,
        _radialDir.y,
        _radialDir.z,
        _surfNormal,
      );

      this.computeAlignedQuat(ship.quat, _surfNormal, _targetQuat);
      ship.quat.slerp(_targetQuat, THREE.MathUtils.clamp(2.4 * dt, 0, 1)).normalize();
      ship.root.quaternion.copy(ship.quat);

      const vVert = ship.velocity.dot(_radialDir);
      _horizVel
        .copy(ship.velocity)
        .addScaledVector(_radialDir, -vVert)
        .multiplyScalar(Math.exp(-2.2 * dt));

      const holdAlt = GEAR_REST_HEIGHT + 1;
      let targetVVert: number;
      if (this.gearT < 0.9 && altitude <= holdAlt) {
        targetVVert = Math.max(0, (holdAlt - altitude) * 4);
      } else {
        targetVVert = -THREE.MathUtils.clamp(altitude * 0.55, 1.2, 10);
      }

      ship.velocity.copy(_horizVel).addScaledVector(_radialDir, targetVVert);
      ship.root.position.addScaledVector(ship.velocity, dt);

      const newDist = ship.root.position.length();
      if (newDist > 0.0001) {
        _radialDir.copy(ship.root.position).divideScalar(newDist);
      }
      const newSurfR = planetManager.getRenderedSupportRadiusAt(
        _radialDir.x,
        _radialDir.y,
        _radialDir.z,
      );
      const newAlt = newDist - newSurfR;

      if (this.gearT >= 0.9 && newAlt <= GEAR_REST_HEIGHT + 0.05) {
        this.state = 'landed';
        this.stateTime = 0;
        this.gearT = 1;
        ship.velocity.set(0, 0, 0);
        this.landedDir.copy(_radialDir);
        ship.root.position
          .copy(this.landedDir)
          .multiplyScalar(newSurfR + GEAR_REST_HEIGHT);
        planetManager.getSurfaceNormalAt(
          this.landedDir.x,
          this.landedDir.y,
          this.landedDir.z,
          _surfNormal,
        );
        hooks.onTouchdown();
        hooks.spawnDust(ship.root.position, _surfNormal, 12);
      }
      return;
    }

    if (this.state === 'landed') {
      this.gearT = 1;
      ship.velocity.set(0, 0, 0);

      const bounce =
        this.stateTime < 0.8
          ? 0.1 * Math.exp(-6 * this.stateTime) * Math.cos(18 * this.stateTime)
          : 0;

      if (this.landedBody === 'moon') {
        const moon = planetManager.getMoonState();
        _worldDir.copy(this.landedDir).applyQuaternion(moon.moonQuat).normalize();
        _worldFwd.copy(this.landedForwardLocal).applyQuaternion(moon.moonQuat);

        ship.root.position
          .copy(moon.center)
          .addScaledVector(_worldDir, moon.radius + GEAR_REST_HEIGHT + bounce);

        this.computeBasisFromForwardUp(_worldFwd, _worldDir, ship.quat);
        ship.root.quaternion.copy(ship.quat);
        return;
      }

      const surfR = planetManager.getRenderedSupportRadiusAt(
        this.landedDir.x,
        this.landedDir.y,
        this.landedDir.z,
      );
      planetManager.getSurfaceNormalAt(
        this.landedDir.x,
        this.landedDir.y,
        this.landedDir.z,
        _surfNormal,
      );

      ship.root.position
        .copy(this.landedDir)
        .multiplyScalar(surfR + GEAR_REST_HEIGHT);
      if (bounce !== 0) {
        ship.root.position.addScaledVector(_surfNormal, bounce);
      }

      this.computeAlignedQuat(ship.quat, _surfNormal, ship.quat);
      ship.root.quaternion.copy(ship.quat);
      return;
    }

    if (this.state === 'takeoff') {
      if (this.landedBody === 'moon') {
        const moon = planetManager.getMoonState();
        if (this.pendingTakeoffHooks) {
          this.pendingTakeoffHooks = false;
          _worldDir.copy(this.landedDir).applyQuaternion(moon.moonQuat).normalize();
          hooks.onGear(false);
          hooks.spawnDust(ship.root.position, _worldDir, 14);
        }

        this.gearT = Math.max(0, this.gearT - dt / 0.9);

        _radialDir.subVectors(ship.root.position, moon.center);
        const dist = _radialDir.length();
        if (dist > 0.0001) {
          _radialDir.divideScalar(dist);
        } else {
          _radialDir.copy(this.landedDir).applyQuaternion(moon.moonQuat).normalize();
        }
        _surfNormal.copy(_radialDir);

        const climbSpeed = THREE.MathUtils.clamp(this.stateTime / 1.2, 0, 1) * 9;
        ship.velocity.copy(_surfNormal).multiplyScalar(climbSpeed);
        ship.root.position.addScaledVector(ship.velocity, dt);
        ship.root.position.addScaledVector(moon.moonVelocity, dt);
        ship.root.quaternion.copy(ship.quat);

        const newDist = ship.root.position.distanceTo(moon.center);
        const altitude = newDist - moon.radius;

        if (altitude >= 12 || this.stateTime > 2.8) {
          ship.velocity.add(moon.moonVelocity);
          this.state = 'flying';
          this.stateTime = 0;
        }
        return;
      }

      if (this.pendingTakeoffHooks) {
        this.pendingTakeoffHooks = false;
        planetManager.getSurfaceNormalAt(
          this.landedDir.x,
          this.landedDir.y,
          this.landedDir.z,
          _surfNormal,
        );
        hooks.onGear(false);
        hooks.spawnDust(ship.root.position, _surfNormal, 14);
      }

      this.gearT = Math.max(0, this.gearT - dt / 0.9);

      const dist = ship.root.position.length();
      if (dist > 0.0001) {
        _radialDir.copy(ship.root.position).divideScalar(dist);
      } else {
        _radialDir.copy(this.landedDir);
      }
      planetManager.getSurfaceNormalAt(
        _radialDir.x,
        _radialDir.y,
        _radialDir.z,
        _surfNormal,
      );

      const climbSpeed = THREE.MathUtils.clamp(this.stateTime / 1.2, 0, 1) * 9;
      ship.velocity.copy(_surfNormal).multiplyScalar(climbSpeed);
      ship.root.position.addScaledVector(ship.velocity, dt);
      ship.root.quaternion.copy(ship.quat);

      const newDist = ship.root.position.length();
      if (newDist > 0.0001) {
        _radialDir.copy(ship.root.position).divideScalar(newDist);
      }
      const newSurfR = planetManager.getRenderedSupportRadiusAt(
        _radialDir.x,
        _radialDir.y,
        _radialDir.z,
      );
      const altitude = newDist - newSurfR;

      if (altitude >= 12 || this.stateTime > 2.8) {
        this.state = 'flying';
        this.stateTime = 0;
      }
    }
  }

  private computeAlignedQuat(
    currentQuat: THREE.Quaternion,
    upNormal: THREE.Vector3,
    out: THREE.Quaternion,
  ): void {
    _shipForward.set(0, 0, -1).applyQuaternion(currentQuat);
    this.computeBasisFromForwardUp(_shipForward, upNormal, out);
  }

  private computeBasisFromForwardUp(
    forwardHint: THREE.Vector3,
    upNormal: THREE.Vector3,
    out: THREE.Quaternion,
  ): void {
    _targetForward
      .copy(forwardHint)
      .addScaledVector(upNormal, -forwardHint.dot(upNormal));
    if (_targetForward.lengthSq() < 0.0001) {
      const ref = Math.abs(upNormal.y) < 0.9 ? _unitY : _unitX;
      _targetForward.crossVectors(ref, upNormal);
    }
    _targetForward.normalize();
    _shipRight.crossVectors(_targetForward, upNormal).normalize();
    _targetForward.crossVectors(upNormal, _shipRight).normalize();
    _shipBack.copy(_targetForward).negate();
    _basisMat.makeBasis(_shipRight, upNormal, _shipBack);
    out.setFromRotationMatrix(_basisMat).normalize();
  }
}
