import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PlanetParams } from '../types/simulation';
import { POI_RESPAWN_SECONDS } from './economy';
import { PlanetTerrainManager } from './PlanetTerrainManager';
import { getPlanetTerrainHeight } from './terrainMath';

export type PoiType = 'crystal' | 'wreck' | 'ruin';

export interface PoiRecord {
  id: number;
  type: PoiType;
  body: 'planet' | 'moon';
  dirX: number;
  dirY: number;
  dirZ: number;
  yaw: number;
  tiltX: number;
  tiltZ: number;
  scale: number;
  shardCount: number;
  wx: number;
  wy: number;
  wz: number;
  nx: number;
  ny: number;
  nz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  depletedUntil: number;
  seed: number;
}

export interface PoiHudCandidate {
  id: number;
  type: PoiType;
  distance: number;
  worldPos: THREE.Vector3;
}

export interface PoiQueryResult {
  found: boolean;
  id: number;
  type: PoiType;
  label: string;
  distance: number;
}

export interface PoiYield {
  crystal: number;
  scrap: number;
  relic: number;
}

const PLANET_POI_COUNT = 24;
const MOON_POI_COUNT = 6;
const TOTAL_POI_COUNT = PLANET_POI_COUNT + MOON_POI_COUNT;
const POI_VISIBILITY_RADIUS = 600;
const POI_VISIBILITY_RADIUS_SQ = POI_VISIBILITY_RADIUS * POI_VISIBILITY_RADIUS;
const SMOKE_VISIBILITY_RADIUS = 260;
const SMOKE_VISIBILITY_RADIUS_SQ = SMOKE_VISIBILITY_RADIUS * SMOKE_VISIBILITY_RADIUS;
const PUFFS_PER_WRECK = 4;
const MAX_SMOKE_INSTANCES = TOTAL_POI_COUNT * PUFFS_PER_WRECK;
const POI_SEED = 0x7e31c59a;

export const POI_LABELS: Record<PoiType, string> = {
  crystal: 'Cristais Etéreos',
  wreck: 'Nave Caída',
  ruin: 'Ruína Antiga',
};

export const POI_COLORS: Record<PoiType, string> = {
  crystal: '#22d3ee',
  wreck: '#fb923c',
  ruin: '#c084fc',
};

// Zero-GC scratch objects
const _dir = new THREE.Vector3();
const _landStartDir = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _worldPos = new THREE.Vector3();
const _unitY = new THREE.Vector3(0, 1, 0);
const _alignQuat = new THREE.Quaternion();
const _yawQuat = new THREE.Quaternion();
const _tiltQuat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _finalQuat = new THREE.Quaternion();
const _scaleVec = new THREE.Vector3();
const _mat = new THREE.Matrix4();
const _color = new THREE.Color();
const _refAxisA = new THREE.Vector3();
const _refAxisB = new THREE.Vector3();
const _smokePos = new THREE.Vector3();
const _smokeNorm = new THREE.Vector3();
const _smokeTangA = new THREE.Vector3();
const _smokeTangB = new THREE.Vector3();

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function prepColoredPart(
  geo: THREE.BufferGeometry,
  hex: number,
  shade = 1,
): THREE.BufferGeometry {
  const nonIdx = geo.index ? geo.toNonIndexed() : geo;
  if (geo.index) geo.dispose();
  if (nonIdx.hasAttribute('uv')) {
    nonIdx.deleteAttribute('uv');
  }
  nonIdx.computeVertexNormals();
  const posAttr = nonIdx.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(posAttr.count * 3);
  _color.setHex(hex).multiplyScalar(shade);
  for (let i = 0; i < posAttr.count; i++) {
    colors[i * 3] = _color.r;
    colors[i * 3 + 1] = _color.g;
    colors[i * 3 + 2] = _color.b;
  }
  nonIdx.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return nonIdx;
}

function mergeStaticParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (let i = 0; i < parts.length; i++) {
    parts[i].dispose();
  }
  if (!merged) {
    throw new Error('Failed to merge POI procedural geometry');
  }
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

function buildCrystalClusterGeometry(): THREE.BufferGeometry {
  const rng = mulberry32(0x11a2b3);
  const parts: THREE.BufferGeometry[] = [];

  // Dark mineral base
  const baseRock = new THREE.DodecahedronGeometry(1.05, 0);
  baseRock.scale(1.25, 0.36, 1.15);
  baseRock.translate(0, 0.1, 0);
  parts.push(prepColoredPart(baseRock, 0x263142, 0.95));

  // 5 angled prism crystal shards (covers 3..7 visual cluster feel cleanly in 1 draw call)
  const shardSpecs = [
    { x: 0, z: 0, h: 2.35, r: 0.34, rx: 0.08, rz: -0.06, hex: 0x38bdf8 },
    { x: 0.52, z: 0.28, h: 1.75, r: 0.26, rx: 0.24, rz: -0.34, hex: 0x22d3ee },
    { x: -0.48, z: 0.34, h: 1.55, r: 0.24, rx: 0.28, rz: 0.32, hex: 0x67e8f9 },
    { x: 0.22, z: -0.56, h: 1.85, r: 0.27, rx: -0.3, rz: -0.18, hex: 0x818cf8 },
    { x: -0.42, z: -0.42, h: 1.32, r: 0.21, rx: -0.26, rz: 0.36, hex: 0x2dd4bf },
  ];

  for (let i = 0; i < shardSpecs.length; i++) {
    const s = shardSpecs[i];
    const shard = new THREE.ConeGeometry(s.r, s.h, 5);
    shard.translate(0, s.h * 0.45, 0);
    shard.rotateX(s.rx);
    shard.rotateZ(s.rz);
    shard.rotateY(rng() * Math.PI);
    shard.translate(s.x, 0.12, s.z);
    parts.push(prepColoredPart(shard, s.hex, 1.0));
  }

  return mergeStaticParts(parts);
}

function buildWreckGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Impact mound
  const mound = new THREE.CylinderGeometry(1.75, 2.2, 0.42, 7);
  mound.scale(1.3, 1, 0.95);
  mound.translate(0, 0.06, 0);
  parts.push(prepColoredPart(mound, 0x3f3632, 0.9));

  // Crooked crashed hull fuselage
  const hull = new THREE.CylinderGeometry(0.42, 0.72, 3.6, 6);
  hull.rotateX(Math.PI * 0.5);
  hull.rotateZ(0.28);
  hull.rotateX(-0.18);
  hull.rotateY(0.32);
  hull.translate(0.15, 0.62, 0);
  parts.push(prepColoredPart(hull, 0x9a4b2a, 1.0));

  // Broken wing slab sticking out
  const wing = new THREE.BoxGeometry(2.6, 0.14, 1.15);
  wing.rotateZ(-0.42);
  wing.rotateY(0.45);
  wing.translate(-0.7, 0.85, 0.3);
  parts.push(prepColoredPart(wing, 0x64748b, 0.92));

  // Scorched cockpit canopy frame
  const canopy = new THREE.IcosahedronGeometry(0.44, 0);
  canopy.scale(0.85, 0.55, 1.45);
  canopy.rotateZ(0.24);
  canopy.rotateY(0.32);
  canopy.translate(0.35, 1.02, -0.45);
  parts.push(prepColoredPart(canopy, 0x1e293b, 1.0));

  // Exposed orange/amber core spar
  const engine = new THREE.CylinderGeometry(0.38, 0.46, 0.9, 6);
  engine.rotateX(Math.PI * 0.5 - 0.16);
  engine.rotateY(0.32);
  engine.translate(-0.1, 0.42, 1.45);
  parts.push(prepColoredPart(engine, 0xf97316, 0.95));

  return mergeStaticParts(parts);
}

function buildRuinGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Stepped stone plinth
  const plinth = new THREE.CylinderGeometry(1.9, 2.25, 0.44, 6);
  plinth.translate(0, 0.14, 0);
  parts.push(prepColoredPart(plinth, 0x475569, 0.9));

  // Left & right monolith pillars
  const pillarL = new THREE.BoxGeometry(0.62, 3.1, 0.62);
  pillarL.rotateZ(0.05);
  pillarL.translate(-1.12, 1.65, 0);
  parts.push(prepColoredPart(pillarL, 0x64748b, 1.0));

  const pillarR = new THREE.BoxGeometry(0.62, 2.9, 0.62);
  pillarR.rotateZ(-0.07);
  pillarR.translate(1.12, 1.55, 0);
  parts.push(prepColoredPart(pillarR, 0x64748b, 0.95));

  // Top stone arch / lintel
  const arch = new THREE.BoxGeometry(3.2, 0.56, 0.82);
  arch.rotateZ(-0.04);
  arch.translate(0, 3.18, 0);
  parts.push(prepColoredPart(arch, 0x7c8ca3, 1.0));

  // Broken side obelisk + glowing purple relic glyph core
  const obelisk = new THREE.BoxGeometry(0.45, 1.45, 0.45);
  obelisk.rotateZ(0.32);
  obelisk.translate(0.15, 0.88, 0.85);
  parts.push(prepColoredPart(obelisk, 0x526075, 0.92));

  const glyph = new THREE.OctahedronGeometry(0.36, 0);
  glyph.translate(0, 1.62, 0);
  parts.push(prepColoredPart(glyph, 0xc084fc, 1.15));

  return mergeStaticParts(parts);
}

function buildDepletedGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const base = new THREE.DodecahedronGeometry(1.0, 0);
  base.scale(1.25, 0.3, 1.15);
  base.translate(0, 0.08, 0);
  parts.push(prepColoredPart(base, 0x1f2937, 0.85));

  const nub1 = new THREE.ConeGeometry(0.22, 0.55, 5);
  nub1.rotateZ(0.25);
  nub1.translate(0.3, 0.25, 0.15);
  parts.push(prepColoredPart(nub1, 0x334155, 0.7));

  const nub2 = new THREE.ConeGeometry(0.18, 0.45, 5);
  nub2.rotateX(-0.3);
  nub2.translate(-0.28, 0.22, -0.2);
  parts.push(prepColoredPart(nub2, 0x334155, 0.7));

  return mergeStaticParts(parts);
}

export class PoiManager {
  private readonly scene: THREE.Scene;
  private readonly pois: PoiRecord[] = [];
  private readonly hudCandidates: PoiHudCandidate[] = [
    { id: -1, type: 'crystal', distance: 0, worldPos: new THREE.Vector3() },
    { id: -1, type: 'crystal', distance: 0, worldPos: new THREE.Vector3() },
    { id: -1, type: 'crystal', distance: 0, worldPos: new THREE.Vector3() },
  ];

  private readonly crystalGeo: THREE.BufferGeometry;
  private readonly wreckGeo: THREE.BufferGeometry;
  private readonly ruinGeo: THREE.BufferGeometry;
  private readonly depletedGeo: THREE.BufferGeometry;
  private readonly smokeGeo: THREE.BufferGeometry;

  private readonly crystalMat: THREE.MeshStandardMaterial;
  private readonly wreckMat: THREE.MeshStandardMaterial;
  private readonly ruinMat: THREE.MeshStandardMaterial;
  private readonly depletedMat: THREE.MeshStandardMaterial;
  private readonly smokeMat: THREE.MeshBasicMaterial;

  private readonly crystalMesh: THREE.InstancedMesh;
  private readonly wreckMesh: THREE.InstancedMesh;
  private readonly ruinMesh: THREE.InstancedMesh;
  private readonly depletedMesh: THREE.InstancedMesh;
  private readonly smokeMesh: THREE.InstancedMesh;

  private readonly allMeshes: THREE.InstancedMesh[] = [];
  private readonly warmupSavedVisible: boolean[] = [];
  private readonly warmupSavedCount: number[] = [];
  private readonly warmupDummyMat = new THREE.Matrix4();

  private planetSig = '';
  private instancesDirty = true;
  private forceDisabled = false;
  private effectsDisabled = false;
  private lastGameElapsed = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    this.crystalGeo = buildCrystalClusterGeometry();
    this.wreckGeo = buildWreckGeometry();
    this.ruinGeo = buildRuinGeometry();
    this.depletedGeo = buildDepletedGeometry();
    this.smokeGeo = new THREE.IcosahedronGeometry(0.42, 0);

    this.crystalMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.28,
      metalness: 0.15,
      emissive: new THREE.Color(0x0ea5e9),
      emissiveIntensity: 0.55,
    });

    this.wreckMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.72,
      metalness: 0.45,
    });

    this.ruinMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.85,
      metalness: 0.12,
      emissive: new THREE.Color(0x581c87),
      emissiveIntensity: 0.22,
    });

    this.depletedMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.94,
      metalness: 0.05,
    });

    this.smokeMat = new THREE.MeshBasicMaterial({
      color: 0x94a3b8,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
    });

    this.crystalMesh = new THREE.InstancedMesh(
      this.crystalGeo,
      this.crystalMat,
      TOTAL_POI_COUNT,
    );
    this.wreckMesh = new THREE.InstancedMesh(
      this.wreckGeo,
      this.wreckMat,
      TOTAL_POI_COUNT,
    );
    this.ruinMesh = new THREE.InstancedMesh(
      this.ruinGeo,
      this.ruinMat,
      TOTAL_POI_COUNT,
    );
    this.depletedMesh = new THREE.InstancedMesh(
      this.depletedGeo,
      this.depletedMat,
      TOTAL_POI_COUNT,
    );
    this.smokeMesh = new THREE.InstancedMesh(
      this.smokeGeo,
      this.smokeMat,
      MAX_SMOKE_INSTANCES,
    );

    this.allMeshes.push(
      this.crystalMesh,
      this.wreckMesh,
      this.ruinMesh,
      this.depletedMesh,
      this.smokeMesh,
    );

    for (let i = 0; i < this.allMeshes.length; i++) {
      const mesh = this.allMeshes[i];
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.count = 0;
      mesh.visible = false;
      mesh.userData.perfTag = 'alvo';
      this.scene.add(mesh);
    }
  }

  public setForceDisabled(disabled: boolean): void {
    if (this.forceDisabled === disabled) return;
    this.forceDisabled = disabled;
    if (disabled) {
      for (let i = 0; i < this.allMeshes.length; i++) {
        this.allMeshes[i].visible = false;
      }
    } else {
      this.instancesDirty = true;
    }
  }

  public setEffectsDisabled(disabled: boolean): void {
    if (this.effectsDisabled === disabled) return;
    this.effectsDisabled = disabled;
    if (disabled) {
      this.smokeMesh.visible = false;
      this.smokeMesh.count = 0;
    } else {
      this.instancesDirty = true;
    }
  }

  public getNearestPlanetPoi(
    fromPos: THREE.Vector3,
    outPos: THREE.Vector3,
    outNormal: THREE.Vector3,
  ): { found: boolean; id: number; type: PoiType; label: string } {
    let bestPoi: PoiRecord | null = null;
    let bestDistSq = Infinity;
    for (let i = 0; i < this.pois.length; i++) {
      const p = this.pois[i];
      if (p.body !== 'planet') continue;
      if (p.depletedUntil > this.lastGameElapsed) continue;
      const dx = p.wx - fromPos.x;
      const dy = p.wy - fromPos.y;
      const dz = p.wz - fromPos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        bestPoi = p;
      }
    }
    if (!bestPoi) {
      return { found: false, id: -1, type: 'crystal', label: '' };
    }
    outPos.set(bestPoi.wx, bestPoi.wy, bestPoi.wz);
    outNormal.set(bestPoi.nx, bestPoi.ny, bestPoi.nz);
    return {
      found: true,
      id: bestPoi.id,
      type: bestPoi.type,
      label: POI_LABELS[bestPoi.type],
    };
  }

  public prepareForShaderWarmup(): void {
    this.warmupSavedVisible.length = 0;
    this.warmupSavedCount.length = 0;
    for (let i = 0; i < this.allMeshes.length; i++) {
      const mesh = this.allMeshes[i];
      this.warmupSavedVisible.push(mesh.visible);
      this.warmupSavedCount.push(mesh.count);
      if (mesh.count === 0) {
        mesh.setMatrixAt(0, this.warmupDummyMat);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.count = 1;
      }
      mesh.visible = true;
    }
  }

  public restoreAfterShaderWarmup(): void {
    for (let i = 0; i < this.allMeshes.length; i++) {
      const mesh = this.allMeshes[i];
      if (i < this.warmupSavedVisible.length) {
        mesh.visible = this.warmupSavedVisible[i];
        mesh.count = this.warmupSavedCount[i];
      }
    }
  }

  public resetAllPois(): void {
    for (let i = 0; i < this.pois.length; i++) {
      this.pois[i].depletedUntil = -1;
    }
    this.instancesDirty = true;
  }

  public rebuildIfNeeded(
    planetManager: PlanetTerrainManager,
    planet: PlanetParams,
  ): void {
    const sig = `${planet.planetRadius.toFixed(1)}_${planet.maxHeight.toFixed(2)}_${planet.noiseScale.toFixed(4)}_${planet.seaLevel.toFixed(3)}`;
    if (sig === this.planetSig && this.pois.length > 0) return;

    const prevDepleted = new Map<number, number>();
    for (let i = 0; i < this.pois.length; i++) {
      if (this.pois[i].depletedUntil > this.lastGameElapsed) {
        prevDepleted.set(this.pois[i].id, this.pois[i].depletedUntil);
      }
    }

    this.planetSig = sig;
    this.pois.length = 0;

    const rng = mulberry32(POI_SEED);
    planetManager.findLandDirection(0, _landStartDir);
    const types: PoiType[] = ['crystal', 'wreck', 'ruin'];

    // Tangent basis around initial landing direction for 3 nearby starter POIs
    if (Math.abs(_landStartDir.y) < 0.9) {
      _refAxisA.set(0, 1, 0);
    } else {
      _refAxisA.set(1, 0, 0);
    }
    _refAxisA.crossVectors(_refAxisA, _landStartDir).normalize();
    _refAxisB.crossVectors(_landStartDir, _refAxisA).normalize();

    const safeMaxH = Math.max(planet.maxHeight, 0.001);
    const minLandingDot = Math.cos(35 / Math.max(planet.planetRadius, 30));
    const minSpacingDot = Math.cos(40 / Math.max(planet.planetRadius, 30));

    let nextId = 0;

    // 1. Place 24 planet POIs (first 3 within ~95..240 m of initial landing spot so player always finds one nearby,
    //    remainder spread deterministically over dry land across the globe)
    for (let targetIdx = 0; targetIdx < PLANET_POI_COUNT; targetIdx++) {
      const isStarter = targetIdx < 3;
      const poiType = types[targetIdx % types.length];

      let chosen = false;
      for (let attempt = 0; attempt < 220; attempt++) {
        if (isStarter && attempt < 110) {
          const arcDist = 90 + rng() * 165;
          const ang = (targetIdx * 2.1) + rng() * 1.1;
          const theta = arcDist / Math.max(planet.planetRadius, 30);
          _dir
            .copy(_landStartDir)
            .multiplyScalar(Math.cos(theta))
            .addScaledVector(_refAxisA, Math.sin(theta) * Math.cos(ang))
            .addScaledVector(_refAxisB, Math.sin(theta) * Math.sin(ang))
            .normalize();
        } else {
          // Uniform sphere sampling
          const u = rng() * 2 - 1;
          const phi = rng() * Math.PI * 2;
          const sinTheta = Math.sqrt(Math.max(0, 1 - u * u));
          _dir.set(
            sinTheta * Math.cos(phi),
            u,
            sinTheta * Math.sin(phi),
          );
        }

        // Never on initial landing spot
        if (_dir.dot(_landStartDir) > minLandingDot) continue;

        // Check height above sea level
        const rawH = getPlanetTerrainHeight(
          _dir.x,
          _dir.y,
          _dir.z,
          planet.planetRadius,
          planet.noiseScale,
          planet.maxHeight,
        );
        const rawNorm = THREE.MathUtils.clamp(rawH / safeMaxH, -1, 1);
        if (rawNorm <= planet.seaLevel + 0.05) continue;

        // Avoid steep cliffs
        planetManager.getSurfaceNormalAt(_dir.x, _dir.y, _dir.z, _normal);
        if (_normal.dot(_dir) < 0.87) continue;

        // Avoid stacking POIs on top of each other
        let tooClose = false;
        for (let k = 0; k < this.pois.length; k++) {
          const other = this.pois[k];
          if (other.body !== 'planet') continue;
          const dot =
            other.dirX * _dir.x + other.dirY * _dir.y + other.dirZ * _dir.z;
          if (dot > minSpacingDot) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;

        const surfR = planetManager.getRenderedSurfaceRadiusAt(
          _dir.x,
          _dir.y,
          _dir.z,
        );
        _worldPos.copy(_dir).multiplyScalar(surfR - 0.08);
        _alignQuat.setFromUnitVectors(
          _unitY,
          poiType === 'ruin' ? _dir : _normal,
        );
        const yaw = rng() * Math.PI * 2;
        const tiltX = poiType === 'wreck' ? (rng() - 0.5) * 0.16 : 0;
        const tiltZ = poiType === 'wreck' ? (rng() - 0.5) * 0.16 : 0;
        _yawQuat.setFromAxisAngle(_unitY, yaw);
        _euler.set(tiltX, 0, tiltZ);
        _tiltQuat.setFromEuler(_euler);
        _finalQuat.copy(_alignQuat).multiply(_yawQuat).multiply(_tiltQuat);

        this.pois.push({
          id: nextId,
          type: poiType,
          body: 'planet',
          dirX: _dir.x,
          dirY: _dir.y,
          dirZ: _dir.z,
          yaw,
          tiltX,
          tiltZ,
          scale: 0.92 + rng() * 0.24,
          shardCount: 3 + Math.floor(rng() * 5),
          wx: _worldPos.x,
          wy: _worldPos.y,
          wz: _worldPos.z,
          nx: _normal.x,
          ny: _normal.y,
          nz: _normal.z,
          qx: _finalQuat.x,
          qy: _finalQuat.y,
          qz: _finalQuat.z,
          qw: _finalQuat.w,
          depletedUntil: prevDepleted.get(nextId) ?? -1,
          seed: Math.floor(rng() * 0xffffffff),
        });
        nextId++;
        chosen = true;
        break;
      }

      if (!chosen) {
        // Guaranteed dry fallback near landing ring if strict slope missed
        planetManager.findLandDirection(targetIdx * 13.7 + 2.1, _dir);
        const surfR = planetManager.getRenderedSurfaceRadiusAt(
          _dir.x,
          _dir.y,
          _dir.z,
        );
        planetManager.getSurfaceNormalAt(_dir.x, _dir.y, _dir.z, _normal);
        _worldPos.copy(_dir).multiplyScalar(surfR - 0.08);
        _alignQuat.setFromUnitVectors(_unitY, _normal);
        const yaw = rng() * Math.PI * 2;
        _yawQuat.setFromAxisAngle(_unitY, yaw);
        _finalQuat.copy(_alignQuat).multiply(_yawQuat);
        this.pois.push({
          id: nextId,
          type: poiType,
          body: 'planet',
          dirX: _dir.x,
          dirY: _dir.y,
          dirZ: _dir.z,
          yaw,
          tiltX: 0,
          tiltZ: 0,
          scale: 1.0,
          shardCount: 4,
          wx: _worldPos.x,
          wy: _worldPos.y,
          wz: _worldPos.z,
          nx: _normal.x,
          ny: _normal.y,
          nz: _normal.z,
          qx: _finalQuat.x,
          qy: _finalQuat.y,
          qz: _finalQuat.z,
          qw: _finalQuat.w,
          depletedUntil: prevDepleted.get(nextId) ?? -1,
          seed: Math.floor(rng() * 0xffffffff),
        });
        nextId++;
      }
    }

    // 2. Place 6 POIs across the Moon
    const moonMinDot = Math.cos(25 / Math.max(planet.planetRadius * 0.145, 10));
    for (let m = 0; m < MOON_POI_COUNT; m++) {
      const poiType = types[(m + 1) % types.length];
      let dirSet = false;
      for (let attempt = 0; attempt < 80; attempt++) {
        const u = rng() * 2 - 1;
        const phi = rng() * Math.PI * 2;
        const sinTheta = Math.sqrt(Math.max(0, 1 - u * u));
        _dir.set(sinTheta * Math.cos(phi), u, sinTheta * Math.sin(phi));

        let tooClose = false;
        for (let k = PLANET_POI_COUNT; k < this.pois.length; k++) {
          const other = this.pois[k];
          const dot =
            other.dirX * _dir.x + other.dirY * _dir.y + other.dirZ * _dir.z;
          if (dot > moonMinDot) {
            tooClose = true;
            break;
          }
        }
        if (!tooClose) {
          dirSet = true;
          break;
        }
      }
      if (!dirSet) {
        const phi = (m / MOON_POI_COUNT) * Math.PI * 2;
        _dir.set(Math.cos(phi) * 0.85, (m % 2 === 0 ? 1 : -1) * 0.45, Math.sin(phi) * 0.85).normalize();
      }

      this.pois.push({
        id: nextId,
        type: poiType,
        body: 'moon',
        dirX: _dir.x,
        dirY: _dir.y,
        dirZ: _dir.z,
        yaw: rng() * Math.PI * 2,
        tiltX: poiType === 'wreck' ? (rng() - 0.5) * 0.16 : 0,
        tiltZ: poiType === 'wreck' ? (rng() - 0.5) * 0.16 : 0,
        scale: 0.9 + rng() * 0.2,
        shardCount: 3 + Math.floor(rng() * 5),
        wx: 0,
        wy: 0,
        wz: 0,
        nx: _dir.x,
        ny: _dir.y,
        nz: _dir.z,
        qx: 0,
        qy: 0,
        qz: 0,
        qw: 1,
        depletedUntil: prevDepleted.get(nextId) ?? -1,
        seed: Math.floor(rng() * 0xffffffff),
      });
      nextId++;
    }

    this.syncMoonPoiTransforms(planetManager);
    this.instancesDirty = true;
  }

  private syncMoonPoiTransforms(planetManager: PlanetTerrainManager): void {
    const moon = planetManager.getMoonState();
    const moonR = moon.radius - 0.08;
    for (let i = 0; i < this.pois.length; i++) {
      const p = this.pois[i];
      if (p.body !== 'moon') continue;

      _normal.set(p.dirX, p.dirY, p.dirZ).applyQuaternion(moon.moonQuat).normalize();
      _worldPos.copy(moon.center).addScaledVector(_normal, moonR);

      _alignQuat.setFromUnitVectors(_unitY, _normal);
      _yawQuat.setFromAxisAngle(_unitY, p.yaw);
      _euler.set(p.tiltX, 0, p.tiltZ);
      _tiltQuat.setFromEuler(_euler);
      _finalQuat.copy(_alignQuat).multiply(_yawQuat).multiply(_tiltQuat);

      p.wx = _worldPos.x;
      p.wy = _worldPos.y;
      p.wz = _worldPos.z;
      p.nx = _normal.x;
      p.ny = _normal.y;
      p.nz = _normal.z;
      p.qx = _finalQuat.x;
      p.qy = _finalQuat.y;
      p.qz = _finalQuat.z;
      p.qw = _finalQuat.w;
    }
  }

  public update(
    gameElapsed: number,
    focusPos: THREE.Vector3,
    planetManager: PlanetTerrainManager,
    planet: PlanetParams,
  ): void {
    this.lastGameElapsed = gameElapsed;
    this.rebuildIfNeeded(planetManager, planet);

    if (this.forceDisabled) return;

    this.syncMoonPoiTransforms(planetManager);

    let crystalCount = 0;
    let wreckCount = 0;
    let ruinCount = 0;
    let depletedCount = 0;
    let smokeCount = 0;

    for (let i = 0; i < this.pois.length; i++) {
      const p = this.pois[i];
      const dx = p.wx - focusPos.x;
      const dy = p.wy - focusPos.y;
      const dz = p.wz - focusPos.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq > POI_VISIBILITY_RADIUS_SQ) continue;

      const isDepleted = p.depletedUntil > gameElapsed;
      _worldPos.set(p.wx, p.wy, p.wz);
      _finalQuat.set(p.qx, p.qy, p.qz, p.qw);
      _scaleVec.setScalar(p.scale);
      _mat.compose(_worldPos, _finalQuat, _scaleVec);

      if (isDepleted) {
        if (depletedCount < TOTAL_POI_COUNT) {
          this.depletedMesh.setMatrixAt(depletedCount, _mat);
          depletedCount++;
        }
        continue;
      }

      if (p.type === 'crystal') {
        if (crystalCount < TOTAL_POI_COUNT) {
          this.crystalMesh.setMatrixAt(crystalCount, _mat);
          crystalCount++;
        }
      } else if (p.type === 'wreck') {
        if (wreckCount < TOTAL_POI_COUNT) {
          this.wreckMesh.setMatrixAt(wreckCount, _mat);
          wreckCount++;
        }

        // Light rising smoke puffs above active wreck POIs when nearby
        if (!this.effectsDisabled && distSq <= SMOKE_VISIBILITY_RADIUS_SQ) {
          _smokeNorm.set(p.nx, p.ny, p.nz);
          if (Math.abs(_smokeNorm.y) < 0.9) {
            _smokeTangA.set(0, 1, 0);
          } else {
            _smokeTangA.set(1, 0, 0);
          }
          _smokeTangA.crossVectors(_smokeTangA, _smokeNorm).normalize();
          _smokeTangB.crossVectors(_smokeNorm, _smokeTangA).normalize();

          for (let k = 0; k < PUFFS_PER_WRECK; k++) {
            if (smokeCount >= MAX_SMOKE_INSTANCES) break;
            const phase = ((gameElapsed * 0.28 + k / PUFFS_PER_WRECK + (p.id % 5) * 0.13) % 1 + 1) % 1;
            const rise = 0.75 + phase * 4.2;
            const sway = Math.sin(gameElapsed * 1.4 + k * 1.9 + p.id) * (0.2 + phase * 0.5);
            const swayB = Math.cos(gameElapsed * 1.1 + k * 2.3) * (0.15 + phase * 0.35);
            _smokePos
              .set(p.wx, p.wy, p.wz)
              .addScaledVector(_smokeNorm, rise)
              .addScaledVector(_smokeTangA, sway)
              .addScaledVector(_smokeTangB, swayB);
            const puffScale = (0.45 + phase * 0.85) * (1 - phase * 0.45) * p.scale;
            _scaleVec.setScalar(Math.max(0.05, puffScale));
            _mat.compose(_smokePos, _finalQuat, _scaleVec);
            this.smokeMesh.setMatrixAt(smokeCount, _mat);
            smokeCount++;
          }
        }
      } else {
        if (ruinCount < TOTAL_POI_COUNT) {
          this.ruinMesh.setMatrixAt(ruinCount, _mat);
          ruinCount++;
        }
      }
    }

    this.crystalMesh.count = crystalCount;
    this.crystalMesh.visible = crystalCount > 0;
    if (crystalCount > 0) this.crystalMesh.instanceMatrix.needsUpdate = true;

    this.wreckMesh.count = wreckCount;
    this.wreckMesh.visible = wreckCount > 0;
    if (wreckCount > 0) this.wreckMesh.instanceMatrix.needsUpdate = true;

    this.ruinMesh.count = ruinCount;
    this.ruinMesh.visible = ruinCount > 0;
    if (ruinCount > 0) this.ruinMesh.instanceMatrix.needsUpdate = true;

    this.depletedMesh.count = depletedCount;
    this.depletedMesh.visible = depletedCount > 0;
    if (depletedCount > 0) this.depletedMesh.instanceMatrix.needsUpdate = true;

    this.smokeMesh.count = smokeCount;
    this.smokeMesh.visible = smokeCount > 0;
    if (smokeCount > 0) this.smokeMesh.instanceMatrix.needsUpdate = true;

    this.instancesDirty = false;
  }

  public queryNearestCollectible(
    pos: THREE.Vector3,
    maxDist: number,
    gameElapsed: number,
    out: PoiQueryResult,
  ): void {
    const maxDistSq = maxDist * maxDist;
    let bestId = -1;
    let bestType: PoiType = 'crystal';
    let bestDistSq = maxDistSq;

    for (let i = 0; i < this.pois.length; i++) {
      const p = this.pois[i];
      if (p.depletedUntil > gameElapsed) continue;
      const dx = p.wx - pos.x;
      const dy = p.wy - pos.y;
      const dz = p.wz - pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 <= bestDistSq) {
        bestDistSq = d2;
        bestId = p.id;
        bestType = p.type;
      }
    }

    if (bestId >= 0) {
      out.found = true;
      out.id = bestId;
      out.type = bestType;
      out.label = POI_LABELS[bestType];
      out.distance = Math.sqrt(bestDistSq);
    } else {
      out.found = false;
      out.id = -1;
      out.distance = Infinity;
    }
  }

  public collectPoi(id: number, gameElapsed: number): PoiYield | null {
    const poi = this.pois.find((item) => item.id === id);
    if (!poi || poi.depletedUntil > gameElapsed) return null;

    poi.depletedUntil = gameElapsed + POI_RESPAWN_SECONDS;
    this.instancesDirty = true;

    const roll = ((Math.sin(poi.seed * 0.001 + gameElapsed) + 1) * 0.5);
    const amount = 2 + Math.min(3, Math.floor(roll * 4)); // 2..5

    if (poi.type === 'crystal') {
      return { crystal: amount, scrap: 0, relic: 0 };
    }
    if (poi.type === 'wreck') {
      return { crystal: 0, scrap: amount, relic: 0 };
    }
    // Ruin: 2..5 scrap + 1 rare relic
    return { crystal: 0, scrap: amount, relic: 1 };
  }

  public fillHudCandidates(
    pos: THREE.Vector3,
    maxDist: number,
    gameElapsed: number,
  ): readonly PoiHudCandidate[] {
    const maxDistSq = maxDist * maxDist;
    for (let i = 0; i < 3; i++) {
      this.hudCandidates[i].id = -1;
      this.hudCandidates[i].distance = Infinity;
    }

    for (let i = 0; i < this.pois.length; i++) {
      const p = this.pois[i];
      if (p.depletedUntil > gameElapsed) continue;
      const dx = p.wx - pos.x;
      const dy = p.wy - pos.y;
      const dz = p.wz - pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > maxDistSq) continue;

      const d = Math.sqrt(d2);
      if (d < this.hudCandidates[0].distance) {
        this.copySlot(1, 2);
        this.copySlot(0, 1);
        this.setSlot(0, p, d);
      } else if (d < this.hudCandidates[1].distance) {
        this.copySlot(1, 2);
        this.setSlot(1, p, d);
      } else if (d < this.hudCandidates[2].distance) {
        this.setSlot(2, p, d);
      }
    }

    return this.hudCandidates;
  }

  private copySlot(fromIdx: number, toIdx: number): void {
    const src = this.hudCandidates[fromIdx];
    const dst = this.hudCandidates[toIdx];
    dst.id = src.id;
    dst.type = src.type;
    dst.distance = src.distance;
    dst.worldPos.copy(src.worldPos);
  }

  private setSlot(idx: number, p: PoiRecord, dist: number): void {
    const slot = this.hudCandidates[idx];
    slot.id = p.id;
    slot.type = p.type;
    slot.distance = dist;
    slot.worldPos.set(p.wx, p.wy + 1.6, p.wz);
  }

  public isDirty(): boolean {
    return this.instancesDirty;
  }

  public dispose(): void {
    for (let i = 0; i < this.allMeshes.length; i++) {
      this.scene.remove(this.allMeshes[i]);
      this.allMeshes[i].dispose();
    }
    this.allMeshes.length = 0;
    this.crystalGeo.dispose();
    this.wreckGeo.dispose();
    this.ruinGeo.dispose();
    this.depletedGeo.dispose();
    this.smokeGeo.dispose();
    this.crystalMat.dispose();
    this.wreckMat.dispose();
    this.ruinMat.dispose();
    this.depletedMat.dispose();
    this.smokeMat.dispose();
  }
}
