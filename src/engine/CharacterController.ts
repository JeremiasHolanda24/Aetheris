import * as THREE from 'three';
import { CharacterCameraMode, PlanetParams } from '../types/simulation';
import { CharacterModelHandle, createCharacterModel } from './CharacterModel';
import { FloraManager, TreeCollider } from './FloraManager';
import { CharacterInputSample } from './InputController';
import { LandingBody } from './LandingController';
import { PlanetTerrainManager } from './PlanetTerrainManager';
import { ShipColliderBox } from './proceduralModels';

const CHAR_COLLIDER_RADIUS = 0.35;
const CHAR_COLLIDER_HEIGHT = 1.66;
const SHIP_STEP_HEIGHT = 0.4;

// Pre-allocated scratch helpers (Zero GC)
const _shipFwd = new THREE.Vector3();
const _shipRight = new THREE.Vector3();
const _bodyCenter = new THREE.Vector3();
const _radial = new THREE.Vector3();
const _delta = new THREE.Vector3();
const _wishDir = new THREE.Vector3();
const _relVel = new THREE.Vector3();
const _vertVel = new THREE.Vector3();
const _horizVel = new THREE.Vector3();
const _yawQuat = new THREE.Quaternion();
const _rotDelta = new THREE.Quaternion();
const _invPrevQuat = new THREE.Quaternion();
const _invShipQuat = new THREE.Quaternion();
const _basisMat = new THREE.Matrix4();
const _backDir = new THREE.Vector3();
const _localPos = new THREE.Vector3();
const _localVel = new THREE.Vector3();
const _treeDiff = new THREE.Vector3();
const _treeAxis = new THREE.Vector3();
const _treeRadial = new THREE.Vector3();
const _unitX = new THREE.Vector3(1, 0, 0);
const _unitY = new THREE.Vector3(0, 1, 0);

export class CharacterController {
  public readonly root = new THREE.Group();
  public readonly model: CharacterModelHandle;

  public readonly velocity = new THREE.Vector3();
  public readonly forwardDir = new THREE.Vector3(0, 0, -1);
  public readonly upDir = new THREE.Vector3(0, 1, 0);
  public readonly rightDir = new THREE.Vector3(1, 0, 0);
  public readonly aimDir = new THREE.Vector3(0, 0, -1);

  public activeBody: LandingBody = 'planet';
  public lookPitchRad = -0.05;
  public jetpackEnabled = false;
  public dampenersEnabled = true;
  public grounded = true;
  public speed = 0;
  public altitude = 0;

  private readonly scene: THREE.Scene;
  private readonly nearbyTrees: TreeCollider[] = [];
  private readonly prevMoonPos = new THREE.Vector3();
  private readonly prevMoonQuat = new THREE.Quaternion();
  private hasMoonTrack = false;
  private isVisible = false;
  private forceHidden = false;

  constructor(scene: THREE.Scene, isMobileOrSoftware: boolean) {
    this.scene = scene;
    this.model = createCharacterModel(isMobileOrSoftware);
    this.root.add(this.model.group);
    this.root.visible = false;
    this.scene.add(this.root);
  }

  public get visible(): boolean {
    return this.isVisible;
  }

  public setForceHidden(hidden: boolean): void {
    this.forceHidden = hidden;
    this.root.visible = this.isVisible && !this.forceHidden;
  }

  private readonly warmupSavedVisibles = new Map<THREE.Object3D, boolean>();

  public prepareForShaderWarmup(): void {
    this.warmupSavedVisibles.clear();
    this.root.traverse((obj) => {
      this.warmupSavedVisibles.set(obj, obj.visible);
      obj.visible = true;
    });
  }

  public restoreAfterShaderWarmup(): void {
    this.warmupSavedVisibles.forEach((vis, obj) => {
      obj.visible = vis;
    });
    this.warmupSavedVisibles.clear();
  }

  public setVisible(visible: boolean): void {
    this.isVisible = visible;
    this.root.visible = visible && !this.forceHidden;
    if (!visible) {
      this.hasMoonTrack = false;
      this.velocity.set(0, 0, 0);
    }
  }

  public toggleJetpack(): boolean {
    this.jetpackEnabled = !this.jetpackEnabled;
    if (this.jetpackEnabled && this.grounded) {
      // Gentle liftoff kick like Space Engineers
      this.velocity.addScaledVector(this.upDir, 1.8);
      this.grounded = false;
    }
    return this.jetpackEnabled;
  }

  public toggleDampeners(): boolean {
    this.dampenersEnabled = !this.dampenersEnabled;
    return this.dampenersEnabled;
  }

  public spawnNearShip(
    shipPos: THREE.Vector3,
    shipQuat: THREE.Quaternion,
    body: LandingBody,
    planetManager: PlanetTerrainManager,
  ): void {
    this.activeBody = body;
    this.jetpackEnabled = false;
    this.dampenersEnabled = true;
    this.grounded = true;
    this.lookPitchRad = -0.06;

    _shipFwd.set(0, 0, -1).applyQuaternion(shipQuat);
    _shipRight.set(1, 0, 0).applyQuaternion(shipQuat);

    // Spawn on port side of the 1.6x landed starfighter
    this.root.position
      .copy(shipPos)
      .addScaledVector(_shipRight, -3.6)
      .addScaledVector(_shipFwd, 0.3);

    if (body === 'moon') {
      const moon = planetManager.getMoonState();
      this.prevMoonPos.copy(moon.center);
      this.prevMoonQuat.copy(moon.moonQuat);
      this.hasMoonTrack = true;

      _radial.subVectors(this.root.position, moon.center).normalize();
      this.root.position
        .copy(moon.center)
        .addScaledVector(_radial, moon.radius);
      this.upDir.copy(_radial);
      this.velocity.copy(moon.moonVelocity);
    } else {
      this.hasMoonTrack = false;
      const dist = this.root.position.length();
      if (dist > 0.0001) {
        _radial.copy(this.root.position).divideScalar(dist);
      } else {
        _radial.copy(_unitY);
      }
      const surfR = planetManager.getRenderedSurfaceRadiusAt(
        _radial.x,
        _radial.y,
        _radial.z,
      );
      this.root.position.copy(_radial).multiplyScalar(surfR);
      this.upDir.copy(_radial);
      this.velocity.set(0, 0, 0);
    }

    this.forwardDir
      .copy(_shipFwd)
      .addScaledVector(this.upDir, -_shipFwd.dot(this.upDir));
    if (this.forwardDir.lengthSq() < 0.0001) {
      this.forwardDir
        .crossVectors(Math.abs(this.upDir.y) < 0.9 ? _unitY : _unitX, this.upDir)
        .normalize();
    } else {
      this.forwardDir.normalize();
    }

    this.rightDir.crossVectors(this.forwardDir, this.upDir).normalize();
    this.aimDir
      .copy(this.forwardDir)
      .multiplyScalar(Math.cos(this.lookPitchRad))
      .addScaledVector(this.upDir, Math.sin(this.lookPitchRad))
      .normalize();

    _backDir.copy(this.forwardDir).negate();
    _basisMat.makeBasis(this.rightDir, this.upDir, _backDir);
    this.root.quaternion.setFromRotationMatrix(_basisMat).normalize();

    this.speed = 0;
    this.altitude = 0;
    this.setVisible(true);
  }

  public step(
    dt: number,
    elapsed: number,
    params: {
      inputs: CharacterInputSample;
      cameraMode: CharacterCameraMode;
      planet: PlanetParams;
      planetManager: PlanetTerrainManager;
      floraManager?: FloraManager;
      floraEnabled?: boolean;
      shipPos: THREE.Vector3;
      shipQuat: THREE.Quaternion;
      shipColliders: readonly ShipColliderBox[];
      shipGearActive: boolean;
    },
  ): void {
    if (!this.isVisible) return;

    const {
      inputs,
      cameraMode,
      planet,
      planetManager,
      floraManager,
      floraEnabled,
      shipPos,
      shipQuat,
      shipColliders,
      shipGearActive,
    } = params;

    const wasGrounded = this.grounded;

    const moon = planetManager.getMoonState();

    // Determine dominant gravitational body (planet vs moon)
    const distToPlanet = this.root.position.length();
    const distToMoon = this.root.position.distanceTo(moon.center);
    const planetAltEst = distToPlanet - planet.planetRadius;
    const moonAltEst = distToMoon - moon.radius;
    const onMoon = moonAltEst < planetAltEst && moonAltEst < 120;
    this.activeBody = onMoon ? 'moon' : 'planet';

    if (onMoon) {
      if (this.hasMoonTrack) {
        // Carry character along with moon orbital translation & rotation when grounded or hovering with dampeners
        if (this.grounded || (this.jetpackEnabled && this.dampenersEnabled)) {
          _delta.subVectors(this.root.position, this.prevMoonPos);
          _invPrevQuat.copy(this.prevMoonQuat).invert();
          _rotDelta.copy(moon.moonQuat).multiply(_invPrevQuat);
          _delta.applyQuaternion(_rotDelta);
          this.root.position.copy(moon.center).add(_delta);
          this.forwardDir.applyQuaternion(_rotDelta);
        }
      }
      this.prevMoonPos.copy(moon.center);
      this.prevMoonQuat.copy(moon.moonQuat);
      this.hasMoonTrack = true;
      _bodyCenter.copy(moon.center);
    } else {
      this.hasMoonTrack = false;
      _bodyCenter.set(0, 0, 0);
    }

    // Update local spherical up basis
    this.upDir.subVectors(this.root.position, _bodyCenter);
    const bodyDist = this.upDir.length();
    if (bodyDist > 0.0001) {
      this.upDir.divideScalar(bodyDist);
    } else {
      this.upDir.copy(_unitY);
    }

    // Look yaw & pitch (mouse/touch drag + optional arrow keys)
    const deltaYaw = -inputs.lookDeltaX * 0.0045 + inputs.keyYaw * 2.1 * dt;
    const deltaPitch = -inputs.lookDeltaY * 0.004 + inputs.keyPitch * 1.6 * dt;

    this.lookPitchRad = THREE.MathUtils.clamp(
      this.lookPitchRad + deltaPitch,
      -1.32,
      1.32,
    );

    if (Math.abs(deltaYaw) > 1e-6) {
      _yawQuat.setFromAxisAngle(this.upDir, deltaYaw);
      this.forwardDir.applyQuaternion(_yawQuat);
    }

    // Parallel-transport forwardDir onto local tangent plane
    this.forwardDir.addScaledVector(
      this.upDir,
      -this.forwardDir.dot(this.upDir),
    );
    if (this.forwardDir.lengthSq() < 0.0001) {
      this.forwardDir
        .crossVectors(Math.abs(this.upDir.y) < 0.9 ? _unitY : _unitX, this.upDir)
        .normalize();
    } else {
      this.forwardDir.normalize();
    }
    this.rightDir.crossVectors(this.forwardDir, this.upDir).normalize();
    this.aimDir
      .copy(this.forwardDir)
      .multiplyScalar(Math.cos(this.lookPitchRad))
      .addScaledVector(this.upDir, Math.sin(this.lookPitchRad))
      .normalize();

    // Surface-relative velocity
    if (onMoon) {
      _relVel.subVectors(this.velocity, moon.moonVelocity);
    } else {
      _relVel.copy(this.velocity);
    }

    let thrustStrength = 0;

    if (this.jetpackEnabled) {
      // Space Engineers 6-DOF Jetpack
      const accel = inputs.sprint ? 34 : 20;
      const maxJetSpeed = inputs.sprint ? 30 : 18;

      _wishDir.set(0, 0, 0);
      if (Math.abs(inputs.forward) > 0.01) {
        _wishDir.addScaledVector(this.aimDir, inputs.forward);
      }
      if (Math.abs(inputs.strafe) > 0.01) {
        _wishDir.addScaledVector(this.rightDir, inputs.strafe);
      }
      if (inputs.up) {
        _wishDir.addScaledVector(this.upDir, 1);
      }
      if (inputs.down) {
        _wishDir.addScaledVector(this.upDir, -1);
      }

      const wishLen = _wishDir.length();
      if (wishLen > 0.01) {
        _wishDir.divideScalar(wishLen);
        _relVel.addScaledVector(_wishDir, accel * dt);
        thrustStrength = inputs.sprint ? 1.0 : 0.72;
      }

      if (this.dampenersEnabled) {
        // Space Engineers inertial dampeners brake motion cleanly when no input on an axis
        const dampRate = wishLen > 0.01 ? 1.8 : 5.2;
        _relVel.multiplyScalar(Math.exp(-dampRate * dt));
        if (wishLen <= 0.01 && _relVel.lengthSq() < 0.0025) {
          _relVel.set(0, 0, 0);
        }
      } else {
        // Dampeners off: planetary gravity pulls character while coasting
        const grav = onMoon ? 5.6 : 14.5;
        _relVel.addScaledVector(this.upDir, -grav * dt);
        _relVel.multiplyScalar(Math.exp(-0.08 * dt));
      }

      const relSpeed = _relVel.length();
      if (relSpeed > maxJetSpeed) {
        _relVel.multiplyScalar(maxJetSpeed / relSpeed);
      }
    } else {
      // Ground / Walking mode
      const vRadial = _relVel.dot(this.upDir);
      _vertVel.copy(this.upDir).multiplyScalar(vRadial);
      _horizVel.copy(_relVel).sub(_vertVel);

      _wishDir.set(0, 0, 0);
      if (Math.abs(inputs.forward) > 0.01) {
        _wishDir.addScaledVector(this.forwardDir, inputs.forward);
      }
      if (Math.abs(inputs.strafe) > 0.01) {
        _wishDir.addScaledVector(this.rightDir, inputs.strafe);
      }

      const targetSpeed = inputs.down
        ? 2.8
        : inputs.sprint
          ? 9.4
          : 5.2;
      const wishLen = _wishDir.length();
      if (wishLen > 0.01) {
        _wishDir.divideScalar(wishLen);
        const accel = this.grounded ? 42 : 12;
        _horizVel.addScaledVector(_wishDir, accel * dt);
        const hLen = _horizVel.length();
        if (hLen > targetSpeed * Math.min(1, wishLen)) {
          _horizVel.multiplyScalar((targetSpeed * Math.min(1, wishLen)) / hLen);
        }
      } else {
        const friction = this.grounded ? 14 : 1.5;
        _horizVel.multiplyScalar(Math.exp(-friction * dt));
      }

      if (inputs.jumpEdge && this.grounded) {
        _vertVel.copy(this.upDir).multiplyScalar(onMoon ? 6.2 : 7.8);
        this.grounded = false;
      }

      const grav = onMoon ? 5.8 : 15.5;
      _vertVel.addScaledVector(this.upDir, -grav * dt);
      _relVel.copy(_horizVel).add(_vertVel);
    }

    if (onMoon) {
      this.velocity.copy(moon.moonVelocity).add(_relVel);
      this.root.position.addScaledVector(_relVel, dt);
    } else {
      this.velocity.copy(_relVel);
      this.root.position.addScaledVector(this.velocity, dt);
    }

    // Terrain / Moon ground collision
    this.upDir.subVectors(this.root.position, _bodyCenter);
    const newDist = this.upDir.length();
    if (newDist > 0.0001) {
      this.upDir.divideScalar(newDist);
    } else {
      this.upDir.copy(_unitY);
    }

    const groundR = onMoon
      ? moon.radius
      : planetManager.getRenderedSurfaceRadiusAt(
          this.upDir.x,
          this.upDir.y,
          this.upDir.z,
        );
    const alt = newDist - groundR;

    if (alt <= 0.02) {
      this.root.position.copy(_bodyCenter).addScaledVector(this.upDir, groundR);
      const radialVel = _relVel.dot(this.upDir);
      if (radialVel < 0) {
        _relVel.addScaledVector(this.upDir, -radialVel);
      }
      this.grounded = true;
      this.altitude = 0;
    } else {
      this.grounded = false;
      this.altitude = alt;
    }

    // Ship local-space OBB collisions (cylinder radius 0.35, height 1.66 + 0.40 step-up)
    if (
      shipColliders.length > 0 &&
      this.root.position.distanceToSquared(shipPos) < 81
    ) {
      _invShipQuat.copy(shipQuat).invert();
      _localPos
        .subVectors(this.root.position, shipPos)
        .applyQuaternion(_invShipQuat);
      _localVel.copy(_relVel).applyQuaternion(_invShipQuat);

      let landedOnShip = false;
      const radSqLimit = CHAR_COLLIDER_RADIUS * CHAR_COLLIDER_RADIUS;

      for (let iter = 0; iter < 2; iter++) {
        for (let i = 0; i < shipColliders.length; i++) {
          const box = shipColliders[i];
          if (box.requiresGear && !shipGearActive) continue;

          const cx = THREE.MathUtils.clamp(_localPos.x, box.min.x, box.max.x);
          const cz = THREE.MathUtils.clamp(_localPos.z, box.min.z, box.max.z);
          const dx = _localPos.x - cx;
          const dz = _localPos.z - cz;
          const distXZSq = dx * dx + dz * dz;
          if (distXZSq >= radSqLimit) continue;

          const charMinY = _localPos.y;
          const charMaxY = charMinY + CHAR_COLLIDER_HEIGHT;

          // 1. Standing on top or stepping up (< 0.40) onto ship surface
          const stepDiff = box.max.y - charMinY;
          if (
            charMinY >= box.max.y - 0.04 &&
            charMinY <= box.max.y + 0.03 &&
            _localVel.y <= 0.1
          ) {
            _localPos.y = box.max.y;
            if (_localVel.y < 0) _localVel.y = 0;
            landedOnShip = true;
            continue;
          }

          let penXZ: number;
          let pushX = 0;
          let pushZ = 0;
          if (distXZSq > 1e-10) {
            const distXZ = Math.sqrt(distXZSq);
            penXZ = CHAR_COLLIDER_RADIUS - distXZ;
            pushX = dx / distXZ;
            pushZ = dz / distXZ;
          } else {
            const toMinX = _localPos.x - box.min.x + CHAR_COLLIDER_RADIUS;
            const toMaxX = box.max.x - _localPos.x + CHAR_COLLIDER_RADIUS;
            const toMinZ = _localPos.z - box.min.z + CHAR_COLLIDER_RADIUS;
            const toMaxZ = box.max.z - _localPos.z + CHAR_COLLIDER_RADIUS;
            penXZ = toMinX;
            pushX = -1;
            pushZ = 0;
            if (toMaxX < penXZ) {
              penXZ = toMaxX;
              pushX = 1;
              pushZ = 0;
            }
            if (toMinZ < penXZ) {
              penXZ = toMinZ;
              pushX = 0;
              pushZ = -1;
            }
            if (toMaxZ < penXZ) {
              penXZ = toMaxZ;
              pushX = 0;
              pushZ = 1;
            }
          }

          if (
            stepDiff > 0 &&
            stepDiff < SHIP_STEP_HEIGHT &&
            charMinY >= box.min.y - 0.05 &&
            (wasGrounded ||
              (!this.jetpackEnabled && _localVel.y <= 1.2) ||
              penXZ >= stepDiff)
          ) {
            _localPos.y = box.max.y;
            if (_localVel.y < 0) _localVel.y = 0;
            landedOnShip = true;
            continue;
          }

          if (charMaxY <= box.min.y || charMinY >= box.max.y) continue;

          // 2. Underside head bump vs lateral wall push (never teleport up if stepDiff >= 0.40)
          const penDown = charMaxY - box.min.y;
          if (
            charMinY < box.min.y &&
            penDown < penXZ &&
            (_localVel.y > 0.05 || penDown < 0.35)
          ) {
            _localPos.y -= penDown;
            if (_localVel.y > 0) _localVel.y = 0;
          } else {
            _localPos.x += pushX * penXZ;
            _localPos.z += pushZ * penXZ;
            const inward = _localVel.x * pushX + _localVel.z * pushZ;
            if (inward < 0) {
              _localVel.x -= pushX * inward;
              _localVel.z -= pushZ * inward;
            }
          }
        }
      }

      this.root.position.copy(_localPos).applyQuaternion(shipQuat).add(shipPos);
      _relVel.copy(_localVel).applyQuaternion(shipQuat);

      if (landedOnShip) {
        this.grounded = true;
        this.upDir.subVectors(this.root.position, _bodyCenter);
        const shipSurfDist = this.upDir.length();
        if (shipSurfDist > 0.0001) {
          this.upDir.divideScalar(shipSurfDist);
        } else {
          this.upDir.copy(_unitY);
        }
        const localGroundR = onMoon
          ? moon.radius
          : planetManager.getRenderedSurfaceRadiusAt(
              this.upDir.x,
              this.upDir.y,
              this.upDir.z,
            );
        this.altitude = Math.max(0, shipSurfDist - localGroundR);
      }
    }

    // Tree trunk collisions on planet
    if (!onMoon && floraManager && floraEnabled && this.altitude < 24) {
      const treeCount = floraManager.queryTrees(
        this.root.position,
        this.nearbyTrees,
      );
      const minTreeDist = 0.72;
      const minTreeDistSq = minTreeDist * minTreeDist;
      for (let t = 0; t < treeCount; t++) {
        const tree = this.nearbyTrees[t];
        _treeDiff.set(
          this.root.position.x - tree.x,
          this.root.position.y - tree.y,
          this.root.position.z - tree.z,
        );
        _treeAxis.set(tree.nx, tree.ny, tree.nz);
        const axial = _treeDiff.dot(_treeAxis);
        if (axial < -1.0 || axial >= tree.height) continue;
        _treeRadial.copy(_treeDiff).addScaledVector(_treeAxis, -axial);
        const radSq = _treeRadial.lengthSq();
        if (radSq >= minTreeDistSq) continue;
        const radDist = Math.sqrt(radSq);
        if (radDist > 0.0001) {
          _treeRadial.divideScalar(radDist);
        } else {
          _treeRadial.copy(this.rightDir);
        }
        this.root.position.addScaledVector(_treeRadial, minTreeDist - radDist);
        const inwardTree = _relVel.dot(_treeRadial);
        if (inwardTree < 0) {
          _relVel.addScaledVector(_treeRadial, -inwardTree);
        }
      }
    }

    if (onMoon) {
      this.velocity.copy(moon.moonVelocity).add(_relVel);
    } else {
      this.velocity.copy(_relVel);
    }

    // Re-sync orientation basis
    this.forwardDir.addScaledVector(
      this.upDir,
      -this.forwardDir.dot(this.upDir),
    );
    if (this.forwardDir.lengthSq() < 0.0001) {
      this.forwardDir
        .crossVectors(Math.abs(this.upDir.y) < 0.9 ? _unitY : _unitX, this.upDir)
        .normalize();
    } else {
      this.forwardDir.normalize();
    }
    this.rightDir.crossVectors(this.forwardDir, this.upDir).normalize();
    this.aimDir
      .copy(this.forwardDir)
      .multiplyScalar(Math.cos(this.lookPitchRad))
      .addScaledVector(this.upDir, Math.sin(this.lookPitchRad))
      .normalize();

    _backDir.copy(this.forwardDir).negate();
    _basisMat.makeBasis(this.rightDir, this.upDir, _backDir);
    this.root.quaternion.setFromRotationMatrix(_basisMat).normalize();

    this.speed = _relVel.length();

    this.model.setFirstPerson(cameraMode === 'first');
    this.model.animate(dt, elapsed, {
      moveSpeed: this.speed,
      grounded: this.grounded,
      jetpackActive: this.jetpackEnabled,
      thrustStrength,
      crouching: !this.jetpackEnabled && inputs.down,
      lookPitchRad: this.lookPitchRad,
    });
  }

  public dispose(): void {
    this.scene.remove(this.root);
    this.model.dispose();
  }
}
