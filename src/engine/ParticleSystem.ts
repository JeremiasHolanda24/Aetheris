import * as THREE from 'three';

// Pre-allocated math helpers outside render loop (Zero GC)
const _shipForward = new THREE.Vector3();
const _shipUp = new THREE.Vector3();
const _shipRight = new THREE.Vector3();
const _worldQuatTemp = new THREE.Quaternion();
const _nozzleOffset = new THREE.Vector3();
const _particleColor = new THREE.Color();
const _particleStartCol = new THREE.Color();
const _particleEndCol = new THREE.Color();
const _dummyObj = new THREE.Object3D();

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

export interface ParticleStepParams {
  shipPos: THREE.Vector3;
  shipQuat: THREE.Quaternion;
  shipVisualQuat: THREE.Quaternion;
  shipVelocity: THREE.Vector3;
  isThrusting: boolean;
  isBoosting: boolean;
  thrustPower: number;
  atmoRatio: number;
  speed: number;
  reentryIntensity: number;
  particleRatio: number;
  disableReentryParticles?: boolean;
}

/**
 * InstancedMesh pooled particle system for thruster exhaust plumes
 * and atmospheric slipstream / re-entry thermal ember streaks.
 */
export class ParticleSystem {
  public readonly root = new THREE.Group();
  private readonly scene: THREE.Scene;

  private readonly exhaustGeo: THREE.IcosahedronGeometry;
  private readonly exhaustMat: THREE.MeshBasicMaterial;
  private readonly exhaustMesh: THREE.InstancedMesh;
  private readonly exhaustParticles: ExhaustParticle[] = [];
  private exhaustSpawnAccum = 0;
  private exhaustAlternator = 0;

  private readonly streakGeo: THREE.BoxGeometry;
  private readonly streakMat: THREE.MeshBasicMaterial;
  private readonly streakMesh: THREE.InstancedMesh;
  private readonly streakParticles: StreakParticle[] = [];
  private streakSpawnAccum = 0;
  private activeParticleTotal = 0;
  private prevActiveStreaks = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.root.userData.perfTag = 'fx';
    this.scene.add(this.root);

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
    this.exhaustMesh.visible = false;
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
    this.root.add(this.exhaustMesh);

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
    this.streakMesh.visible = false;
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
    this.root.add(this.streakMesh);
  }

  private warmupSavedExhaustVisible = false;
  private warmupSavedStreakVisible = false;

  public prepareForShaderWarmup(): void {
    this.warmupSavedExhaustVisible = this.exhaustMesh.visible;
    this.warmupSavedStreakVisible = this.streakMesh.visible;
    this.exhaustMesh.visible = true;
    this.streakMesh.visible = true;
  }

  public restoreAfterShaderWarmup(): void {
    this.exhaustMesh.visible = this.warmupSavedExhaustVisible;
    this.streakMesh.visible = this.warmupSavedStreakVisible;
  }

  public getActiveCount(): number {
    return this.activeParticleTotal;
  }

  public update(dt: number, params: ParticleStepParams): void {
    const {
      shipPos,
      shipQuat,
      shipVisualQuat,
      shipVelocity,
      isThrusting,
      isBoosting,
      thrustPower,
      atmoRatio,
      speed,
      reentryIntensity,
      particleRatio,
      disableReentryParticles,
    } = params;

    const isReentryActive = reentryIntensity > 0.14;
    const reentryTotalCap = 60;

    // 1. Thruster Exhaust Particles
    _shipForward.set(0, 0, -1).applyQuaternion(shipQuat);
    _shipUp.set(0, 1, 0).applyQuaternion(shipQuat);
    _shipRight.set(1, 0, 0).applyQuaternion(shipQuat);
    _worldQuatTemp.copy(shipQuat).multiply(shipVisualQuat);

    const rawExhaustCap = Math.max(
      1,
      Math.floor(MAX_EXHAUST * particleRatio),
    );
    const maxExhaustActive = isReentryActive
      ? Math.min(rawExhaustCap, 24)
      : rawExhaustCap;
    const exhaustRate = isThrusting
      ? isBoosting
        ? 90
        : 58
      : speed > 18
        ? 16
        : 0;
    this.exhaustSpawnAccum += dt * exhaustRate;
    while (this.exhaustSpawnAccum >= 1) {
      this.exhaustSpawnAccum -= 1;
      let slot: ExhaustParticle | null = null;
      let curActive = 0;
      for (let i = 0; i < MAX_EXHAUST; i++) {
        if (this.exhaustParticles[i].active) {
          curActive++;
        } else if (!slot && i < maxExhaustActive) {
          slot = this.exhaustParticles[i];
        }
      }
      if (
        !slot ||
        curActive >= maxExhaustActive ||
        (isReentryActive && curActive + this.prevActiveStreaks >= reentryTotalCap)
      ) {
        break;
      }

      this.exhaustAlternator = (this.exhaustAlternator + 1) % 3;
      const side =
        this.exhaustAlternator === 0
          ? -1.44
          : this.exhaustAlternator === 1
            ? 1.44
            : 0;
      const nozzleZ = this.exhaustAlternator === 2 ? 3.45 : 2.8;
      const nozzleY = this.exhaustAlternator === 2 ? 0.06 : 0.03;
      _nozzleOffset
        .set(side, nozzleY, nozzleZ)
        .applyQuaternion(_worldQuatTemp)
        .add(shipPos);

      slot.active = true;
      slot.age = 0;
      slot.maxAge = isBoosting ? 0.42 : 0.32;
      slot.baseScale = isBoosting ? 1.35 : 0.75 + thrustPower * 0.35;
      slot.boosting = isBoosting;
      slot.pos.copy(_nozzleOffset);
      slot.vel
        .copy(shipVelocity)
        .multiplyScalar(0.35)
        .addScaledVector(_shipForward, -(14 + thrustPower * 16));
      slot.vel.x += (Math.random() - 0.5) * 2.2;
      slot.vel.y += (Math.random() - 0.5) * 2.2;
      slot.vel.z += (Math.random() - 0.5) * 2.2;
    }

    let activeExhaust = 0;
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
      if (t >= 1 || (isReentryActive && activeExhaust >= maxExhaustActive)) {
        p.active = false;
        _dummyObj.scale.set(0, 0, 0);
        _dummyObj.updateMatrix();
        this.exhaustMesh.setMatrixAt(i, _dummyObj.matrix);
        continue;
      }

      activeExhaust++;
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
    this.exhaustMesh.visible = activeExhaust > 0;
    if (activeExhaust > 0) {
      this.exhaustMesh.instanceMatrix.needsUpdate = true;
      if (this.exhaustMesh.instanceColor) {
        this.exhaustMesh.instanceColor.needsUpdate = true;
      }
    }

    // 2. Atmospheric Slipstream & Re-Entry Thermal Ember Streaks
    const pauseReentrySpawn = Boolean(disableReentryParticles && isReentryActive);
    const streakRate = pauseReentrySpawn
      ? 0
      : isReentryActive
        ? 35 + reentryIntensity * 65
        : atmoRatio > 0.05 && speed > 18
          ? Math.min(36, (speed - 16) * 0.85 * atmoRatio)
          : 0;

    const rawStreakCap = Math.max(
      1,
      Math.floor(MAX_STREAKS * particleRatio),
    );
    const maxStreakActive = isReentryActive
      ? Math.min(rawStreakCap, Math.max(0, reentryTotalCap - activeExhaust))
      : rawStreakCap;
    if (pauseReentrySpawn) {
      this.streakSpawnAccum = 0;
    } else {
      this.streakSpawnAccum += dt * streakRate;
    }
    while (this.streakSpawnAccum >= 1) {
      this.streakSpawnAccum -= 1;
      let slot: StreakParticle | null = null;
      let curActive = 0;
      for (let i = 0; i < MAX_STREAKS; i++) {
        if (this.streakParticles[i].active) {
          curActive++;
        } else if (!slot && i < maxStreakActive) {
          slot = this.streakParticles[i];
        }
      }
      if (!slot || curActive >= maxStreakActive) break;

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
        .copy(shipPos)
        .addScaledVector(_shipForward, aheadDist)
        .addScaledVector(_shipRight, Math.cos(angle) * radialDist)
        .addScaledVector(_shipUp, Math.sin(angle) * radialDist);

      const backSpeed = isReentryActive ? 68 + speed * 0.75 : 48 + speed * 0.5;
      slot.vel.copy(_shipForward).multiplyScalar(-backSpeed);
    }

    let activeStreaks = 0;
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
      if (t >= 1 || (isReentryActive && activeExhaust + activeStreaks >= reentryTotalCap)) {
        s.active = false;
        _dummyObj.scale.set(0, 0, 0);
        _dummyObj.updateMatrix();
        this.streakMesh.setMatrixAt(i, _dummyObj.matrix);
        continue;
      }

      activeStreaks++;
      s.pos.addScaledVector(s.vel, dt);
      _dummyObj.position.copy(s.pos);
      _dummyObj.quaternion.copy(shipQuat);
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
    this.streakMesh.visible = activeStreaks > 0;
    if (activeStreaks > 0) {
      this.streakMesh.instanceMatrix.needsUpdate = true;
      if (this.streakMesh.instanceColor) {
        this.streakMesh.instanceColor.needsUpdate = true;
      }
    }

    this.prevActiveStreaks = activeStreaks;
    this.activeParticleTotal = activeExhaust + activeStreaks;
  }

  public dispose(): void {
    this.root.remove(this.exhaustMesh);
    this.root.remove(this.streakMesh);
    this.scene.remove(this.root);
    this.exhaustGeo.dispose();
    this.exhaustMat.dispose();
    this.exhaustMesh.dispose();
    this.streakGeo.dispose();
    this.streakMat.dispose();
    this.streakMesh.dispose();
  }
}
