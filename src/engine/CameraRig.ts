import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CameraMode, LandingState } from '../types/simulation';

// Pre-allocated math helpers outside render loop (Zero GC)
const _shipForward = new THREE.Vector3();
const _shipUp = new THREE.Vector3();
const _desiredCamPos = new THREE.Vector3();
const _desiredLookAt = new THREE.Vector3();
const _currentLookAt = new THREE.Vector3();
const _camUp = new THREE.Vector3(0, 1, 0);
const _camOffset = new THREE.Vector3();
const _yawQuat = new THREE.Quaternion();

const _shipDelta = new THREE.Vector3();

/**
 * Manages PerspectiveCamera, OrbitControls, chase/tactical/cockpit/orbit views,
 * speed-driven FOV, relaxed landed chase framing, and atmospheric re-entry camera shake.
 */
export class CameraRig {
  public readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private userOrbiting = false;
  private landedCamBlend = 0;
  private hasPrevOrbitShipPos = false;
  private readonly prevOrbitShipPos = new THREE.Vector3();

  constructor(
    domElement: HTMLElement,
    width: number,
    height: number,
    initialMode: CameraMode,
    isSoftwareGl: boolean,
    initialPlanetRadius: number,
  ) {
    // Near plane raised to 0.6 outside cockpit to reduce depth fighting along planet borders
    this.camera = new THREE.PerspectiveCamera(
      62,
      width / height,
      initialMode === 'cockpit' ? 0.08 : 0.6,
      initialPlanetRadius * 12,
    );

    this.controls = new OrbitControls(this.camera, domElement);
    this.controls.enableDamping = !isSoftwareGl;
    this.controls.dampingFactor = 0.08;
    this.controls.maxDistance = 420;
    this.controls.minDistance = 5;
    this.controls.enabled = initialMode === 'orbit';
    this.controls.addEventListener('start', () => {
      this.userOrbiting = true;
    });
    this.controls.addEventListener('end', () => {
      this.userOrbiting = false;
    });
  }

  public setPlanetRadius(planetRadius: number): void {
    const nextFar = planetRadius * 12;
    if (this.camera.far !== nextFar) {
      this.camera.far = nextFar;
      this.camera.updateProjectionMatrix();
    }
  }

  public setMode(mode: CameraMode, shipPos: THREE.Vector3): void {
    const targetNear = mode === 'cockpit' ? 0.08 : 0.6;
    if (this.camera.near !== targetNear) {
      this.camera.near = targetNear;
      this.camera.updateProjectionMatrix();
    }

    this.controls.enabled = mode === 'orbit';
    this.hasPrevOrbitShipPos = false;
    if (mode === 'orbit') {
      this.controls.target.copy(shipPos);
      this.prevOrbitShipPos.copy(shipPos);
      this.hasPrevOrbitShipPos = true;
      this.controls.update();
    }
  }

  public setAspect(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  public snapTo(
    camPos: THREE.Vector3,
    lookAt: THREE.Vector3,
    up: THREE.Vector3,
    isLanded = false,
  ): void {
    this.landedCamBlend = isLanded ? 1 : 0;
    _camUp.copy(up);
    this.camera.up.copy(_camUp);
    this.camera.position.copy(camPos);
    _currentLookAt.copy(lookAt);
    this.camera.lookAt(_currentLookAt);
  }

  public update(
    dt: number,
    elapsed: number,
    params: {
      mode: CameraMode;
      shipPos: THREE.Vector3;
      shipQuat: THREE.Quaternion;
      speed: number;
      maxSpeed: number;
      reentryIntensity: number;
      landingState: LandingState;
    },
  ): void {
    const {
      mode,
      shipPos,
      shipQuat,
      speed,
      maxSpeed,
      reentryIntensity,
      landingState,
    } = params;

    const targetLandedBlend = landingState === 'landed' ? 1 : 0;
    this.landedCamBlend = THREE.MathUtils.damp(
      this.landedCamBlend,
      targetLandedBlend,
      targetLandedBlend > 0.5 ? 2.2 : 2.8,
      dt,
    );

    if (mode === 'orbit') {
      if (this.hasPrevOrbitShipPos) {
        _shipDelta.subVectors(shipPos, this.prevOrbitShipPos);
        this.camera.position.add(_shipDelta);
        this.controls.target.add(_shipDelta);
      } else if (!this.userOrbiting) {
        this.controls.target.copy(shipPos);
      }
      this.prevOrbitShipPos.copy(shipPos);
      this.hasPrevOrbitShipPos = true;
      this.controls.update();
      return;
    }
    this.hasPrevOrbitShipPos = false;

    const desiredNear = mode === 'cockpit' ? 0.08 : 0.6;
    if (this.camera.near !== desiredNear) {
      this.camera.near = desiredNear;
      this.camera.updateProjectionMatrix();
    }

    _shipForward.set(0, 0, -1).applyQuaternion(shipQuat);
    _shipUp.set(0, 1, 0).applyQuaternion(shipQuat);

    if (mode === 'chase') {
      const chaseBack = 12.5 * (1 + 0.25 * this.landedCamBlend);
      const chaseUp = 3.4 + 1.4 * this.landedCamBlend;
      const yawSway =
        THREE.MathUtils.degToRad(6) *
        Math.sin(elapsed * ((Math.PI * 2) / 14)) *
        this.landedCamBlend;

      _camOffset.copy(_shipForward).multiplyScalar(-chaseBack);
      if (Math.abs(yawSway) > 0.00001) {
        _yawQuat.setFromAxisAngle(_shipUp, yawSway);
        _camOffset.applyQuaternion(_yawQuat);
      }
      _desiredCamPos
        .copy(shipPos)
        .add(_camOffset)
        .addScaledVector(_shipUp, chaseUp);

      const lookForward = THREE.MathUtils.lerp(135, 4, this.landedCamBlend);
      _desiredLookAt
        .copy(shipPos)
        .addScaledVector(_shipForward, lookForward)
        .addScaledVector(_shipUp, 0.6 * this.landedCamBlend);
    } else if (mode === 'tactical') {
      _desiredCamPos
        .copy(shipPos)
        .addScaledVector(_shipForward, -10)
        .addScaledVector(_shipUp, 38);
      _desiredLookAt.copy(shipPos).addScaledVector(_shipForward, 6);
    } else {
      // cockpit: fixed inside the bubble canopy at pilot eye height
      _desiredCamPos
        .copy(shipPos)
        .addScaledVector(_shipForward, 0.16)
        .addScaledVector(_shipUp, 0.43);
      _desiredLookAt
        .copy(shipPos)
        .addScaledVector(_shipForward, 140)
        .addScaledVector(_shipUp, 0.43);
    }

    // Rigidly anchor camera to ship frame so high speed or sharp turns never lose the ship
    this.camera.position.copy(_desiredCamPos);

    if (reentryIntensity > 0.04 && mode !== 'tactical') {
      const shake = reentryIntensity * (mode === 'cockpit' ? 0.05 : 0.12);
      this.camera.position.x += Math.sin(elapsed * 53) * shake;
      this.camera.position.y += Math.cos(elapsed * 61) * shake;
    }

    _camUp.copy(_shipUp);
    this.camera.up.copy(_camUp);

    _currentLookAt.copy(_desiredLookAt);
    this.camera.lookAt(_currentLookAt);

    const speedRatio = THREE.MathUtils.clamp(
      speed / Math.max(maxSpeed, 1),
      0,
      1.3,
    );
    const targetFov =
      mode === 'tactical'
        ? 54
        : mode === 'cockpit'
          ? 66 + speedRatio * 8 + reentryIntensity * 3.5
          : 60 + speedRatio * 10 + reentryIntensity * 4.5;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 5, dt);
      this.camera.updateProjectionMatrix();
    }
  }

  public dispose(): void {
    this.controls.dispose();
  }
}
