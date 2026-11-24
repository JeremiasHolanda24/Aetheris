import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CameraMode } from '../types/simulation';

// Pre-allocated math helpers outside render loop (Zero GC)
const _shipForward = new THREE.Vector3();
const _shipUp = new THREE.Vector3();
const _desiredCamPos = new THREE.Vector3();
const _desiredLookAt = new THREE.Vector3();
const _currentLookAt = new THREE.Vector3();
const _camUp = new THREE.Vector3(0, 1, 0);

/**
 * Manages PerspectiveCamera, OrbitControls, chase/tactical/cockpit/orbit views,
 * speed-driven FOV, and atmospheric re-entry camera shake.
 */
export class CameraRig {
  public readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private userOrbiting = false;

  constructor(
    domElement: HTMLElement,
    width: number,
    height: number,
    initialMode: CameraMode,
    isSoftwareGl: boolean,
  ) {
    // Near plane raised to 0.6 intentionally to reduce depth fighting along planet borders
    this.camera = new THREE.PerspectiveCamera(62, width / height, 0.6, 2800);

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

  public setMode(mode: CameraMode, shipPos: THREE.Vector3): void {
    this.controls.enabled = mode === 'orbit';
    if (mode === 'orbit') {
      this.controls.target.copy(shipPos);
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
  ): void {
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
    },
  ): void {
    const { mode, shipPos, shipQuat, speed, maxSpeed, reentryIntensity } = params;

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

    _shipForward.set(0, 0, -1).applyQuaternion(shipQuat);
    _shipUp.set(0, 1, 0).applyQuaternion(shipQuat);

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

    if (reentryIntensity > 0.04 && mode !== 'tactical') {
      const shake = reentryIntensity * 0.14;
      this.camera.position.x += Math.sin(elapsed * 53) * shake;
      this.camera.position.y += Math.cos(elapsed * 61) * shake;
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
      speed / Math.max(maxSpeed, 1),
      0,
      1.3,
    );
    const targetFov =
      mode === 'tactical' ? 54 : 60 + speedRatio * 10 + reentryIntensity * 4.5;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 5, dt);
      this.camera.updateProjectionMatrix();
    }
  }

  public dispose(): void {
    this.controls.dispose();
  }
}
