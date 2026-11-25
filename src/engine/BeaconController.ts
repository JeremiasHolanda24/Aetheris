import * as THREE from 'three';
import { PlanetParams } from '../types/simulation';
import { PlanetTerrainManager } from './PlanetTerrainManager';
import { BeaconModelHandle, createBeaconModel } from './proceduralModels';

// Pre-allocated math helpers outside render loop (Zero GC)
const _radialUp = new THREE.Vector3();
const _unitY = new THREE.Vector3(0, 1, 0);
const _toTarget = new THREE.Vector3();

export type TargetZone = 'surface' | 'orbit' | 'moon';

/**
 * Manages the waypoint beacon mesh, surface/orbit/moon target placement,
 * and continuous tracking of beacons attached to the orbiting moon.
 */
export class BeaconController {
  public readonly model: BeaconModelHandle;
  public targetZone: TargetZone = 'surface';

  private readonly scene: THREE.Scene;
  private readonly moonBeaconDir = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.model = createBeaconModel();
    this.scene.add(this.model.group);
  }

  public get position(): THREE.Vector3 {
    return this.model.group.position;
  }

  public relocateTarget(
    mode: TargetZone | 'alternate',
    shipPos: THREE.Vector3,
    planetParams: PlanetParams,
    planetManager: PlanetTerrainManager,
  ): void {
    const zone: TargetZone =
      mode === 'alternate'
        ? this.targetZone === 'surface'
          ? 'orbit'
          : this.targetZone === 'orbit'
            ? 'moon'
            : 'surface'
        : mode;

    if (zone === 'moon') {
      this.targetZone = 'moon';
      this.moonBeaconDir.set(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5,
      );
      if (this.moonBeaconDir.lengthSq() < 0.0001) {
        this.moonBeaconDir.set(0, 1, 0);
      } else {
        this.moonBeaconDir.normalize();
      }
      this.syncMoonBeaconPosition(planetManager);
      return;
    }

    _radialUp.copy(shipPos).normalize();

    if (zone === 'surface') {
      let foundLand = false;
      const minLandNorm = planetParams.seaLevel + 0.03;

      for (let attempt = 0; attempt < 30; attempt++) {
        _toTarget.set(
          Math.random() - 0.5,
          Math.random() - 0.5,
          Math.random() - 0.5,
        );
        if (_toTarget.lengthSq() < 0.0001) continue;
        _toTarget.normalize();
        if (_toTarget.dot(_radialUp) > 0.85) {
          _toTarget.negate();
        }
        if (
          planetManager.getRawHeightNormAt(
            _toTarget.x,
            _toTarget.y,
            _toTarget.z,
          ) > minLandNorm
        ) {
          foundLand = true;
          break;
        }
      }

      if (!foundLand) {
        planetManager.findLandDirection(
          Math.floor(Math.random() * 512),
          _toTarget,
        );
      }

      const theta = Math.atan2(_toTarget.z, _toTarget.x);
      const phi = Math.acos(THREE.MathUtils.clamp(_toTarget.y, -1, 1));
      this.placeAtAngle(theta, phi, zone, planetParams, planetManager);
      return;
    }

    const randDir = _toTarget
      .set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
      .normalize();
    if (randDir.dot(_radialUp) > 0.85) {
      randDir.negate();
    }
    const theta = Math.atan2(randDir.z, randDir.x);
    const phi = Math.acos(THREE.MathUtils.clamp(randDir.y, -0.92, 0.92));
    this.placeAtAngle(theta, phi, zone, planetParams, planetManager);
  }

  public placeAtAngle(
    theta: number,
    phi: number,
    zone: TargetZone,
    planetParams: PlanetParams,
    planetManager: PlanetTerrainManager,
  ): void {
    this.targetZone = zone;
    const nx = Math.sin(phi) * Math.cos(theta);
    const ny = Math.cos(phi);
    const nz = Math.sin(phi) * Math.sin(theta);

    if (zone === 'moon') {
      this.moonBeaconDir.set(nx, ny, nz).normalize();
      this.syncMoonBeaconPosition(planetManager);
      return;
    }

    let radius: number;
    if (zone === 'orbit') {
      const { planetRadius, atmosphereHeight } = planetParams;
      radius = planetRadius + atmosphereHeight + 45 + Math.random() * 55;
    } else {
      radius = planetManager.getSurfaceRadiusAt(nx, ny, nz) + 5.5;
    }

    this.model.group.position.set(nx * radius, ny * radius, nz * radius);
    _radialUp.set(nx, ny, nz);
    this.model.group.quaternion.setFromUnitVectors(_unitY, _radialUp);
  }

  public syncMoonBeaconPosition(planetManager: PlanetTerrainManager): void {
    const { center, radius } = planetManager.getMoonState();
    const beaconR = radius + 5.5;
    this.model.group.position
      .copy(center)
      .addScaledVector(this.moonBeaconDir, beaconR);
    this.model.group.quaternion.setFromUnitVectors(_unitY, this.moonBeaconDir);
  }

  public update(
    elapsed: number,
    dt: number,
    _planetManager?: PlanetTerrainManager,
  ): void {
    this.model.update(elapsed, dt);
  }

  public dispose(): void {
    this.scene.remove(this.model.group);
    this.model.dispose();
  }
}
