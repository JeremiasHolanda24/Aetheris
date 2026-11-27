import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  CameraMode,
  CharacterCameraMode,
  LandingState,
} from '../types/simulation';
import { PlanetTerrainManager } from './PlanetTerrainManager';

// Pre-allocated math helpers outside render loop (Zero GC)
const _shipForward = new THREE.Vector3();
const _shipUp = new THREE.Vector3();
const _desiredCamPos = new THREE.Vector3();
const _desiredLookAt = new THREE.Vector3();
const _currentLookAt = new THREE.Vector3();
const _camUp = new THREE.Vector3(0, 1, 0);
const _camOffset = new THREE.Vector3();
const _yawQuat = new THREE.Quaternion();
const _charPivot = new THREE.Vector3();
const _camRadial = new THREE.Vector3();
const _shipDelta = new THREE.Vector3();

/**
 * Manages PerspectiveCamera, OrbitControls, ship chase/cockpit/orbit views,
 * No Man's Sky 3rd-person & 1st-person character views, and speed-driven FOV.
 */
export class CameraRig {
  public readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private currentMode: CameraMode;
  private frozen = false;
  private userOrbiting = false;
  private landedCamBlend = 0;
  private hasPrevOrbitShipPos = false;
  private readonly prevOrbitShipPos = new THREE.Vector3();
  private impactShake = 0;

  constructor(
    domElement: HTMLElement,
    width: number,
    height: number,
    initialMode: CameraMode,
    isSoftwareGl: boolean,
    initialPlanetRadius: number,
  ) {
    this.currentMode = initialMode;
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
    this.controls.minDistance = 2.2;
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

  public triggerImpactShake(intensity: number): void {
    this.impactShake = Math.max(
      this.impactShake,
      THREE.MathUtils.clamp(intensity, 0, 1.5),
    );
  }

  public setFrozen(frozen: boolean): void {
    this.frozen = frozen;
    this.controls.enabled = !frozen && this.currentMode === 'orbit';
  }

  public setMode(mode: CameraMode, focusPos: THREE.Vector3): void {
    this.currentMode = mode;
    const targetNear = mode === 'cockpit' ? 0.08 : 0.6;
    if (this.camera.near !== targetNear) {
      this.camera.near = targetNear;
      this.camera.updateProjectionMatrix();
    }

    this.controls.enabled = !this.frozen && mode === 'orbit';
    this.hasPrevOrbitShipPos = false;
    if (mode === 'orbit') {
      this.controls.target.copy(focusPos);
      this.prevOrbitShipPos.copy(focusPos);
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
      const chaseBack = 16.0 * (1 + 0.25 * this.landedCamBlend);
      const chaseUp = 4.2 + 1.5 * this.landedCamBlend;
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

      const lookForward = THREE.MathUtils.lerp(135, 5, this.landedCamBlend);
      _desiredLookAt
        .copy(shipPos)
        .addScaledVector(_shipForward, lookForward)
        .addScaledVector(_shipUp, 0.7 * this.landedCamBlend);
    } else {
      // cockpit: seated inside bubble canopy (0, 0.50, -0.14) framing HUD glass and legible MFDs
      _desiredCamPos
        .copy(shipPos)
        .addScaledVector(_shipForward, 0.14)
        .addScaledVector(_shipUp, 0.50);
      _desiredLookAt
        .copy(shipPos)
        .addScaledVector(_shipForward, 140)
        .addScaledVector(_shipUp, 0.48);
    }

    // Rigidly anchor camera to ship frame so high speed or sharp turns never lose the ship
    this.camera.position.copy(_desiredCamPos);

    if (reentryIntensity > 0.04) {
      const shake = reentryIntensity * (mode === 'cockpit' ? 0.05 : 0.12);
      this.camera.position.x += Math.sin(elapsed * 53) * shake;
      this.camera.position.y += Math.cos(elapsed * 61) * shake;
    }

    if (this.impactShake > 0.005) {
      const impAmp = this.impactShake * (mode === 'cockpit' ? 0.22 : 0.48);
      this.camera.position.x += Math.sin(elapsed * 79) * impAmp;
      this.camera.position.y += Math.cos(elapsed * 97) * impAmp;
      this.camera.position.z += Math.sin(elapsed * 67) * impAmp * 0.6;
      this.impactShake = Math.max(0, this.impactShake - dt * 2.9);
    } else {
      this.impactShake = 0;
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
      mode === 'cockpit'
        ? 64 + speedRatio * 6 + reentryIntensity * 2.5
        : 60 + speedRatio * 10 + reentryIntensity * 4.5;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 5, dt);
      this.camera.updateProjectionMatrix();
    }
  }

  public updateCharacter(
    dt: number,
    params: {
      shipOrbitMode: boolean;
      characterCamera: CharacterCameraMode;
      charPos: THREE.Vector3;
      upDir: THREE.Vector3;
      rightDir: THREE.Vector3;
      aimDir: THREE.Vector3;
      speed: number;
      activeBody: 'planet' | 'moon';
      planetManager: PlanetTerrainManager;
    },
  ): void {
    const {
      shipOrbitMode,
      characterCamera,
      charPos,
      upDir,
      rightDir,
      aimDir,
      speed,
      activeBody,
      planetManager,
    } = params;

    if (shipOrbitMode) {
      _charPivot.copy(charPos).addScaledVector(upDir, 1.1);
      if (this.hasPrevOrbitShipPos) {
        _shipDelta.subVectors(_charPivot, this.prevOrbitShipPos);
        this.camera.position.add(_shipDelta);
        this.controls.target.add(_shipDelta);
      } else if (!this.userOrbiting) {
        this.controls.target.copy(_charPivot);
      }
      this.prevOrbitShipPos.copy(_charPivot);
      this.hasPrevOrbitShipPos = true;
      this.controls.update();
      return;
    }
    this.hasPrevOrbitShipPos = false;

    const desiredNear = characterCamera === 'first' ? 0.06 : 0.14;
    if (this.camera.near !== desiredNear) {
      this.camera.near = desiredNear;
      this.camera.updateProjectionMatrix();
    }

    if (characterCamera === 'first') {
      // 1st-person view inside astronaut helmet eye level
      _desiredCamPos.copy(charPos).addScaledVector(upDir, 1.5);
      _desiredLookAt.copy(_desiredCamPos).addScaledVector(aimDir, 45);
    } else {
      // No Man's Sky style over-the-right-shoulder 3rd-person camera
      _charPivot.copy(charPos).addScaledVector(upDir, 1.44);
      _desiredCamPos
        .copy(_charPivot)
        .addScaledVector(aimDir, -2.9)
        .addScaledVector(rightDir, 0.52)
        .addScaledVector(upDir, 0.22);

      // Keep 3rd-person camera above terrain/moon surface
      if (activeBody === 'moon') {
        const moon = planetManager.getMoonState();
        _camRadial.subVectors(_desiredCamPos, moon.center);
        const camDist = _camRadial.length();
        const minR = moon.radius + 0.35;
        if (camDist < minR) {
          if (camDist > 0.0001) {
            _camRadial.divideScalar(camDist);
          } else {
            _camRadial.copy(upDir);
          }
          _desiredCamPos.copy(moon.center).addScaledVector(_camRadial, minR);
        }
      } else {
        const camDist = _desiredCamPos.length();
        if (camDist > 0.0001) {
          _camRadial.copy(_desiredCamPos).divideScalar(camDist);
          const surfR = planetManager.getRenderedSurfaceRadiusAt(
            _camRadial.x,
            _camRadial.y,
            _camRadial.z,
          );
          const minR = surfR + 0.35;
          if (camDist < minR) {
            _desiredCamPos.copy(_camRadial).multiplyScalar(minR);
          }
        }
      }

      _desiredLookAt.copy(_charPivot).addScaledVector(aimDir, 18);
    }

    this.camera.position.copy(_desiredCamPos);
    _camUp.copy(upDir);
    this.camera.up.copy(_camUp);
    _currentLookAt.copy(_desiredLookAt);
    this.camera.lookAt(_currentLookAt);

    const speedBoost = THREE.MathUtils.clamp(speed / 18, 0, 1);
    const targetFov =
      (characterCamera === 'first' ? 70 : 64) + speedBoost * 5;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 6, dt);
      this.camera.updateProjectionMatrix();
    }
  }

  public dispose(): void {
    this.controls.dispose();
  }
}
