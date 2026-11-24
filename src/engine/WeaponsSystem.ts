import * as THREE from 'three';
import { CameraMode } from '../types/simulation';
import { PlanetTerrainManager } from './PlanetTerrainManager';
import { SoundEngine } from './SoundEngine';

// Pre-allocated math helpers outside render loop (Zero GC)
const _shipForward = new THREE.Vector3();
const _shipUp = new THREE.Vector3();
const _shipRight = new THREE.Vector3();
const _radialUp = new THREE.Vector3();
const _unitY = new THREE.Vector3(0, 1, 0);
const _aimPoint = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _boltStart = new THREE.Vector3();
const _boltVel = new THREE.Vector3();
const _segVec = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _closestPt = new THREE.Vector3();

const MAX_BOLTS = 24;
const MAX_BURSTS = 12;

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

export interface WeaponsStepParams {
  wantsFire: boolean;
  targetLocked: boolean;
  cameraMode: CameraMode;
  camera: THREE.Camera;
  shipPos: THREE.Vector3;
  shipQuat: THREE.Quaternion;
  shipVelocityLen: number;
  beaconPos: THREE.Vector3;
  planetManager: PlanetTerrainManager;
  onBeaconHit: () => void;
  onHitmarker?: (kind: 'beacon' | 'terrain') => void;
}

/**
 * Pooled laser projectile and impact-burst system with homing target lock
 * and collision checks against beacon, planet terrain, and moon.
 */
export class WeaponsSystem {
  private readonly scene: THREE.Scene;
  private readonly soundEngine: SoundEngine;

  private readonly boltGeo: THREE.CylinderGeometry;
  private readonly boltCyanMat: THREE.MeshBasicMaterial;
  private readonly boltVioletMat: THREE.MeshBasicMaterial;
  private readonly bolts: LaserBolt[] = [];
  private readonly burstGeo: THREE.SphereGeometry;
  private readonly bursts: ImpactBurst[] = [];

  private fireCooldown = 0;
  private fireAlternator = 0;

  constructor(scene: THREE.Scene, soundEngine: SoundEngine) {
    this.scene = scene;
    this.soundEngine = soundEngine;

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
  }

  public update(dt: number, params: WeaponsStepParams): void {
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);

    if (params.wantsFire && this.fireCooldown <= 0) {
      this.fireCooldown = 0.13;
      this.spawnWingBolt(params);
    }

    const beaconPos = params.beaconPos;
    const beaconHitRadiusSq = 10.5 * 10.5;
    const { center: moonCenter, radius: moonRadius } =
      params.planetManager.getMoonState();
    const moonHitRadiusSq = moonRadius * moonRadius;

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
      if (params.targetLocked) {
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
        params.onHitmarker?.('beacon');
        params.onBeaconHit();
        continue;
      }

      // Check planet surface collision
      const distFromCenter = bolt.pos.length();
      if (distFromCenter > 1) {
        _radialUp.copy(bolt.pos).divideScalar(distFromCenter);
        const surfR = params.planetManager.getSurfaceRadiusAt(
          _radialUp.x,
          _radialUp.y,
          _radialUp.z,
        );
        if (distFromCenter <= surfR) {
          bolt.active = false;
          bolt.mesh.visible = false;
          _closestPt.copy(_radialUp).multiplyScalar(surfR + 0.35);
          this.spawnBurst(_closestPt, 0x38bdf8, 5.5);
          params.onHitmarker?.('terrain');
          continue;
        }
      }

      // Check moon surface collision
      _toTarget.subVectors(bolt.pos, moonCenter);
      const moonDistSq = _toTarget.lengthSq();
      if (moonDistSq <= moonHitRadiusSq) {
        bolt.active = false;
        bolt.mesh.visible = false;
        const moonDist = Math.sqrt(moonDistSq);
        if (moonDist > 0.0001) {
          _toTarget.divideScalar(moonDist);
        } else {
          _toTarget.copy(_unitY);
        }
        _closestPt.copy(moonCenter).addScaledVector(_toTarget, moonRadius + 0.35);
        this.spawnBurst(_closestPt, 0x38bdf8, 5.5);
        params.onHitmarker?.('terrain');
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

  private spawnWingBolt(params: WeaponsStepParams): void {
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

    _shipForward.set(0, 0, -1).applyQuaternion(params.shipQuat);
    _shipUp.set(0, 1, 0).applyQuaternion(params.shipQuat);
    _shipRight.set(1, 0, 0).applyQuaternion(params.shipQuat);

    if (params.targetLocked) {
      _toTarget.subVectors(params.beaconPos, params.shipPos);
      if (
        _toTarget.lengthSq() > 4 &&
        _toTarget.normalize().dot(_shipForward) > 0.35
      ) {
        _aimPoint.copy(params.beaconPos);
      } else if (
        params.cameraMode === 'chase' ||
        params.cameraMode === 'cockpit'
      ) {
        params.camera.getWorldDirection(_camDir);
        _aimPoint.copy(params.camera.position).addScaledVector(_camDir, 145);
      } else {
        _aimPoint.copy(params.shipPos).addScaledVector(_shipForward, 145);
      }
    } else if (
      params.cameraMode === 'chase' ||
      params.cameraMode === 'cockpit'
    ) {
      params.camera.getWorldDirection(_camDir);
      _aimPoint.copy(params.camera.position).addScaledVector(_camDir, 145);
    } else {
      _aimPoint.copy(params.shipPos).addScaledVector(_shipForward, 145);
    }

    _boltStart
      .copy(params.shipPos)
      .addScaledVector(_shipRight, wingSide * 1.9)
      .addScaledVector(_shipUp, 0.05)
      .addScaledVector(_shipForward, 1.4);

    _boltVel.subVectors(_aimPoint, _boltStart).normalize();
    const speed = 290 + params.shipVelocityLen;

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

  public dispose(): void {
    for (const bolt of this.bolts) {
      this.scene.remove(bolt.mesh);
    }
    for (const burst of this.bursts) {
      this.scene.remove(burst.mesh);
      burst.material.dispose();
    }
    this.boltGeo.dispose();
    this.boltCyanMat.dispose();
    this.boltVioletMat.dispose();
    this.burstGeo.dispose();
  }
}
