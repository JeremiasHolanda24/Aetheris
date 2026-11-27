import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PlanetParams, FloraParams, QualityLevel } from '../types/simulation';
import { BiomeId, BiomeSample, sampleBiome } from './biomes';
import { CUBE_FACES, PlanetTerrainManager } from './PlanetTerrainManager';
import {
  getPlanetTerrainHeight,
  simplex3,
  spherifyCubePoint,
} from './terrainMath';

type SpeciesId =
  | 'conifer'
  | 'broadleaf'
  | 'palm'
  | 'cactus'
  | 'shrub'
  | 'rock'
  | 'mushroom';

type FloraCategory = 'tree' | 'small';

export interface TreeCollider {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  height: number;
}

export interface FloraHarvestQuery {
  found: boolean;
  groupId: number;
  memberIdx: number;
  species: 'shrub' | 'mushroom';
  label: string;
  distance: number;
}

interface SpeciesSpec {
  id: SpeciesId;
  category: FloraCategory;
  maxDist: number;
  minAboveSea: number;
  maxRawNorm: number;
}

interface BiomeFloraEntry {
  species: SpeciesId;
  weight: number;
  minT?: number;
  maxRawNorm?: number;
}

interface BiomeFloraProfile {
  density: number;
  foliageHex: number;
  entries: BiomeFloraEntry[];
}

const SEED_FIXA = 0x4f7a9c2b;
const VARIANTS_PER_SPECIES = 3;
const GROUP_CACHE_LIMIT = 400;
const TIME_BUDGET_MS = 2.0;
const MAX_GROUP_MEMBERS = 256;
const COS_8_DEG = Math.cos(THREE.MathUtils.degToRad(8));
const COS_24_DEG = Math.cos(THREE.MathUtils.degToRad(24));
const COS_32_DEG = Math.cos(THREE.MathUtils.degToRad(32));
const MAX_ROCK_TILT_RAD = THREE.MathUtils.degToRad(12);

const SPECIES_LIST: SpeciesSpec[] = [
  { id: 'conifer', category: 'tree', maxDist: 230, minAboveSea: 0.04, maxRawNorm: 0.55 },
  { id: 'broadleaf', category: 'tree', maxDist: 230, minAboveSea: 0.04, maxRawNorm: 0.48 },
  { id: 'palm', category: 'tree', maxDist: 230, minAboveSea: 0.0, maxRawNorm: 0.28 },
  { id: 'cactus', category: 'small', maxDist: 150, minAboveSea: 0.04, maxRawNorm: 0.46 },
  { id: 'shrub', category: 'small', maxDist: 150, minAboveSea: 0.04, maxRawNorm: 0.52 },
  { id: 'rock', category: 'small', maxDist: 150, minAboveSea: 0.02, maxRawNorm: 0.9 },
  { id: 'mushroom', category: 'small', maxDist: 150, minAboveSea: 0.04, maxRawNorm: 0.48 },
];

const SPECIES_INDEX: Record<SpeciesId, number> = {
  conifer: 0,
  broadleaf: 1,
  palm: 2,
  cactus: 3,
  shrub: 4,
  rock: 5,
  mushroom: 6,
};

interface GroupSpec {
  minCount: number;
  maxCount: number;
  areaPerMember: number;
  minDist: number;
  slopeLimitCos: number;
  lod0Dist: number;
  lod1Dist: number;
}

const SPECIES_GROUP_SPEC: Record<SpeciesId, GroupSpec> = {
  conifer: {
    minCount: 40,
    maxCount: 80,
    areaPerMember: 22,
    minDist: 2.5,
    slopeLimitCos: COS_24_DEG,
    lod0Dist: 110,
    lod1Dist: 230,
  },
  broadleaf: {
    minCount: 40,
    maxCount: 80,
    areaPerMember: 22,
    minDist: 2.5,
    slopeLimitCos: COS_24_DEG,
    lod0Dist: 110,
    lod1Dist: 230,
  },
  palm: {
    minCount: 12,
    maxCount: 30,
    areaPerMember: 30,
    minDist: 3.5,
    slopeLimitCos: COS_24_DEG,
    lod0Dist: 110,
    lod1Dist: 230,
  },
  cactus: {
    minCount: 15,
    maxCount: 35,
    areaPerMember: 30,
    minDist: 3.0,
    slopeLimitCos: COS_24_DEG,
    lod0Dist: 70,
    lod1Dist: 150,
  },
  shrub: {
    minCount: 30,
    maxCount: 60,
    areaPerMember: 9,
    minDist: 1.4,
    slopeLimitCos: COS_32_DEG,
    lod0Dist: 70,
    lod1Dist: 150,
  },
  rock: {
    minCount: 12,
    maxCount: 30,
    areaPerMember: 14,
    minDist: 1.5,
    slopeLimitCos: COS_32_DEG,
    lod0Dist: 70,
    lod1Dist: 150,
  },
  mushroom: {
    minCount: 25,
    maxCount: 50,
    areaPerMember: 2.5,
    minDist: 0.35,
    slopeLimitCos: COS_32_DEG,
    lod0Dist: 70,
    lod1Dist: 150,
  },
};

export interface FloraStats {
  groupsActive: number;
  groupsLod0: number;
  groupsLod1: number;
  instancesDrawn: number;
  activeMeshes: number;
}

interface FloraGroupRecord {
  id: number;
  cellIdx: number;
  faceIdx: number;
  u: number;
  v: number;
  cx: number;
  cy: number;
  cz: number;
  nx: number;
  ny: number;
  nz: number;
  speciesIdx: number;
  tintR: number;
  tintG: number;
  tintB: number;
  baseCount: number;
  baseRadius: number;
  radius: number;
  seed: number;
  maxAllowedNorm: number;
  lodState: -1 | 0 | 1 | 2;
  priorityScore: number;
}

interface GeneratedGroup {
  count: number;
  matrices: Float32Array;
  colors: Float32Array;
  variants: Uint8Array;
  harvested: Uint8Array;
}

interface VisibleGroupEntry {
  group: FloraGroupRecord;
  lod: 0 | 1;
  sortDist: number;
}

// Editable biome -> species table
const BIOME_FLORA_TABLE: Record<BiomeId, BiomeFloraProfile> = {
  desert: {
    density: 0.5,
    foliageHex: 0x7f914e,
    entries: [
      { species: 'cactus', weight: 45 },
      { species: 'rock', weight: 35 },
      { species: 'shrub', weight: 20 },
    ],
  },
  grassland: {
    density: 0.8,
    foliageHex: 0x68ba45,
    entries: [
      { species: 'shrub', weight: 35 },
      { species: 'broadleaf', weight: 40 },
      { species: 'rock', weight: 10 },
      { species: 'mushroom', weight: 15 },
    ],
  },
  forest: {
    density: 1.3,
    foliageHex: 0x2da64b,
    entries: [
      { species: 'broadleaf', weight: 50 },
      { species: 'palm', weight: 10, minT: 0.7 },
      { species: 'shrub', weight: 20 },
      { species: 'mushroom', weight: 12 },
      { species: 'rock', weight: 8 },
    ],
  },
  taiga: {
    density: 1.0,
    foliageHex: 0x225235,
    entries: [
      { species: 'conifer', weight: 65 },
      { species: 'shrub', weight: 15 },
      { species: 'rock', weight: 10 },
      { species: 'mushroom', weight: 10 },
    ],
  },
  tundra: {
    density: 0.5,
    foliageHex: 0x7a8050,
    entries: [
      { species: 'shrub', weight: 40 },
      { species: 'rock', weight: 40 },
      { species: 'conifer', weight: 20 },
    ],
  },
  mountain: {
    density: 0.4,
    foliageHex: 0x29593e,
    entries: [
      { species: 'rock', weight: 75 },
      { species: 'conifer', weight: 25, maxRawNorm: 0.55 },
    ],
  },
  beach: {
    density: 0.15,
    foliageHex: 0x4aad43,
    entries: [{ species: 'palm', weight: 100, minT: 0.55 }],
  },
  ocean: {
    density: 0,
    foliageHex: 0x4a7c59,
    entries: [],
  },
  ice: {
    density: 0,
    foliageHex: 0x4a7c59,
    entries: [],
  },
};

const MAX_BIOME_DENSITY = 1.3;

// Pre-allocated scratch helpers (Zero GC during update/streaming/queries)
const _shipDir = new THREE.Vector3();
const _candDir = new THREE.Vector3();
const _candNormal = new THREE.Vector3();
const _memDir = new THREE.Vector3();
const _memNormal = new THREE.Vector3();
const _memRadial = new THREE.Vector3();
const _meshPt = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _camForward = new THREE.Vector3();
const _velDir = new THREE.Vector3();
const _trajDir = new THREE.Vector3();
const _toGroup = new THREE.Vector3();
const _instPos = new THREE.Vector3();
const _instUp = new THREE.Vector3();
const _instScale = new THREE.Vector3();
const _instQuat = new THREE.Quaternion();
const _alignQuat = new THREE.Quaternion();
const _yawQuat = new THREE.Quaternion();
const _tiltQuat = new THREE.Quaternion();
const _tiltAxis = new THREE.Vector3();
const _unitY = new THREE.Vector3(0, 1, 0);
const _instMatrix = new THREE.Matrix4();
const _instColor = new THREE.Color();
const _baseTintColor = new THREE.Color();
const _partColor = new THREE.Color();
const _cullCamera = new THREE.PerspectiveCamera();
const _projScreenMatrix = new THREE.Matrix4();
const _frustum = new THREE.Frustum();
const _groupSphere = new THREE.Sphere();
const _biomeSample: BiomeSample = { biome: 'ocean', T: 0.5, M: 0.5 };
const _eligibleWeights = new Float32Array(10);
const _eligibleIndices = new Int32Array(10);
const _eligibleMaxNorm = new Float32Array(10);

// Pre-allocated temporary buffers for lazy group generation (Zero GC)
const _genMat = new Float32Array(MAX_GROUP_MEMBERS * 16);
const _genCol = new Float32Array(MAX_GROUP_MEMBERS * 3);
const _genVar = new Uint8Array(MAX_GROUP_MEMBERS);
const _genRank = new Float32Array(MAX_GROUP_MEMBERS);
const _genOrder = new Int32Array(MAX_GROUP_MEMBERS);
const _placedX = new Float32Array(MAX_GROUP_MEMBERS);
const _placedY = new Float32Array(MAX_GROUP_MEMBERS);
const _gridHead = new Int32Array(1024);
const _gridNext = new Int32Array(MAX_GROUP_MEMBERS);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashCell(face: number, i: number, j: number, seed: number): number {
  let h = seed ^ Math.imul(face + 1, 0x9e3779b1);
  h = Math.imul(h ^ (i + 0x85ebca6b), 0xc2b2ae35);
  h = Math.imul(h ^ (j + 0x27d4eb2f), 0x165667b1);
  return (h ^ (h >>> 15)) >>> 0;
}

function hashGroupSeed(groupId: number, seed: number): number {
  let h = seed ^ Math.imul(groupId + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function uploadAttribute(
  attr: THREE.InstancedBufferAttribute,
  count: number,
): void {
  const ext = attr as THREE.InstancedBufferAttribute & {
    addUpdateRange?: (start: number, count: number) => void;
    clearUpdateRanges?: () => void;
  };
  if (typeof ext.addUpdateRange === 'function') {
    ext.clearUpdateRanges?.();
    ext.addUpdateRange(0, count * attr.itemSize);
  }
  attr.needsUpdate = true;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function prepPartHex(
  geo: THREE.BufferGeometry,
  hex: number,
  tint: number,
  shade = 1,
  deform?: (pos: THREE.BufferAttribute) => void,
): THREE.BufferGeometry {
  _partColor.setHex(hex).multiplyScalar(shade);
  return prepPart(
    geo,
    _partColor.r,
    _partColor.g,
    _partColor.b,
    tint,
    deform,
  );
}

function prepPart(
  geo: THREE.BufferGeometry,
  r: number,
  g: number,
  b: number,
  tint: number,
  deform?: (pos: THREE.BufferAttribute) => void,
): THREE.BufferGeometry {
  const nonIdx = geo.index ? geo.toNonIndexed() : geo;
  if (geo.index) geo.dispose();
  if (nonIdx.hasAttribute('uv')) {
    nonIdx.deleteAttribute('uv');
  }
  const posAttr = nonIdx.getAttribute('position') as THREE.BufferAttribute;
  if (deform) {
    deform(posAttr);
    posAttr.needsUpdate = true;
  }
  nonIdx.computeVertexNormals();

  const count = posAttr.count;
  const colors = new Float32Array(count * 3);
  const tints = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
    tints[i] = tint;
  }
  nonIdx.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  nonIdx.setAttribute('aTint', new THREE.BufferAttribute(tints, 1));
  return nonIdx;
}

function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (let i = 0; i < parts.length; i++) {
    parts[i].dispose();
  }
  if (!merged) {
    throw new Error('Failed to merge procedural flora geometry parts');
  }
  merged.computeBoundingBox();
  merged.computeBoundingSphere();

  const posAttr = merged.getAttribute('position') as THREE.BufferAttribute;
  const maxY = Math.max(merged.boundingBox?.max.y ?? 1, 0.001);
  const normHeights = new Float32Array(posAttr.count);
  for (let i = 0; i < posAttr.count; i++) {
    normHeights[i] = THREE.MathUtils.clamp(posAttr.getY(i) / maxY, 0, 1);
  }
  merged.setAttribute('aWindH', new THREE.BufferAttribute(normHeights, 1));
  return merged;
}

function getSpeciesTrunkRadius(species: SpeciesId, variantIdx: number): number {
  switch (species) {
    case 'conifer':
      return 0.34 + variantIdx * 0.07;
    case 'broadleaf':
      return 0.36 + variantIdx * 0.08;
    case 'palm':
      return 0.38;
    case 'cactus':
      return 0.38 + variantIdx * 0.05;
    default:
      return 0;
  }
}

function buildConiferVariant(variantIdx: number): THREE.BufferGeometry {
  const rng = mulberry32(0x10101 + variantIdx * 977);
  const layers = 3 + variantIdx; // 3, 4, 5 cones
  const totalHeight = 8.4 + variantIdx * 2.4 + rng() * 1.1; // ~8.4 .. 14.3
  const trunkH = totalHeight * (0.28 + rng() * 0.06);
  const trunkR = 0.34 + variantIdx * 0.07;

  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(trunkR * 0.65, trunkR, trunkH + 0.9, 6);
  trunk.translate(0, (trunkH - 0.9) * 0.5, 0);
  parts.push(prepPartHex(trunk, 0x5b3a24, 0));

  const rootFlare = new THREE.CylinderGeometry(trunkR * 0.95, trunkR * 1.6, 0.5, 6);
  rootFlare.translate(0, 0.25, 0);
  parts.push(prepPartHex(rootFlare, 0x5b3a24, 0, 0.92));

  const rootBuried = new THREE.CylinderGeometry(trunkR * 1.6, trunkR * 1.35, 0.9, 6);
  rootBuried.translate(0, -0.45, 0);
  parts.push(prepPartHex(rootBuried, 0x5b3a24, 0, 0.85));

  const crownSpan = totalHeight - trunkH * 0.55;
  for (let l = 0; l < layers; l++) {
    const t = l / layers;
    const coneR = THREE.MathUtils.lerp(2.3 + variantIdx * 0.35, 0.85, t);
    const coneH = (crownSpan / layers) * 1.55;
    const coneY = trunkH * 0.58 + t * crownSpan + coneH * 0.42;
    const cone = new THREE.ConeGeometry(coneR, coneH, 6 + (l % 2));
    cone.rotateY(rng() * Math.PI);
    cone.translate(0, coneY, 0);
    const shade = 0.88 + t * 0.14;
    parts.push(prepPart(cone, shade * 0.94, shade, shade * 0.94, 1));
  }

  return mergeParts(parts);
}

function buildBroadleafVariant(variantIdx: number): THREE.BufferGeometry {
  const rng = mulberry32(0x20202 + variantIdx * 991);
  const puffs = 2 + variantIdx; // 2, 3, 4 canopy puffs
  const totalHeight = 7.2 + variantIdx * 2.1 + rng() * 0.8; // ~7.2 .. 12.2
  const trunkH = totalHeight * 0.48;
  const trunkR = 0.36 + variantIdx * 0.08;

  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(trunkR * 0.68, trunkR * 1.15, trunkH + 0.9, 6);
  trunk.translate(0, (trunkH - 0.9) * 0.5, 0);
  parts.push(prepPartHex(trunk, 0x6a4429, 0));

  const rootFlare = new THREE.CylinderGeometry(trunkR * 1.05, trunkR * 1.6, 0.5, 6);
  rootFlare.translate(0, 0.25, 0);
  parts.push(prepPartHex(rootFlare, 0x6a4429, 0, 0.92));

  const rootBuried = new THREE.CylinderGeometry(trunkR * 1.6, trunkR * 1.35, 0.9, 6);
  rootBuried.translate(0, -0.45, 0);
  parts.push(prepPartHex(rootBuried, 0x6a4429, 0, 0.85));

  for (let p = 0; p < puffs; p++) {
    const angle = (p / puffs) * Math.PI * 2 + rng() * 0.5;
    const isMain = p === 0;
    const rad = isMain
      ? 2.2 + variantIdx * 0.45
      : 1.5 + rng() * 0.75;
    const offsetDist = isMain ? 0 : 1.0 + rng() * 0.9;
    const puffY =
      trunkH + rad * (isMain ? 0.62 : 0.42 + rng() * 0.35);
    const ox = Math.cos(angle) * offsetDist;
    const oz = Math.sin(angle) * offsetDist;

    if (!isMain && offsetDist > 0.6) {
      const branch = new THREE.CylinderGeometry(0.11, 0.2, offsetDist * 1.1, 5);
      branch.rotateZ(-Math.PI * 0.32);
      branch.rotateY(-angle);
      branch.translate(ox * 0.48, trunkH * 0.86, oz * 0.48);
      parts.push(prepPartHex(branch, 0x6a4429, 0));
    }

    const puff = new THREE.IcosahedronGeometry(rad, 0);
    puff.scale(1.0 + rng() * 0.15, 0.68 + rng() * 0.12, 1.0 + rng() * 0.15);
    puff.rotateY(rng() * Math.PI);
    puff.translate(ox, puffY, oz);
    const lum = 0.88 + rng() * 0.14;
    parts.push(prepPart(puff, lum * 0.95, lum, lum * 0.93, 1));
  }

  return mergeParts(parts);
}

function buildPalmVariant(variantIdx: number): THREE.BufferGeometry {
  const rng = mulberry32(0x30303 + variantIdx * 953);
  const frondCount = 6 + variantIdx; // 6, 7, 8 fronds
  const trunkH = 7.2 + variantIdx * 1.6 + rng() * 0.8; // ~7.2 .. 11.2
  const segments = 5;
  const segH = trunkH / segments;
  const leanDirAngle = rng() * Math.PI * 2;
  const leanX = Math.cos(leanDirAngle);
  const leanZ = Math.sin(leanDirAngle);
  const curveAmp = 1.1 + variantIdx * 0.35;
  const baseR = 0.38;

  const parts: THREE.BufferGeometry[] = [];
  const rootFlare = new THREE.CylinderGeometry(baseR * 0.95, baseR * 1.6, 0.5, 6);
  rootFlare.translate(0, 0.25, 0);
  parts.push(prepPartHex(rootFlare, 0x6f5236, 0));

  const rootBuried = new THREE.CylinderGeometry(baseR * 1.6, baseR * 1.35, 0.9, 6);
  rootBuried.translate(0, -0.45, 0);
  parts.push(prepPartHex(rootBuried, 0x6f5236, 0));

  let curX = 0;
  let curY = 0;
  let curZ = 0;

  for (let s = 0; s < segments; s++) {
    const t0 = s / segments;
    const t1 = (s + 1) / segments;
    const nextX = leanX * curveAmp * t1 * t1;
    const nextY = t1 * trunkH;
    const nextZ = leanZ * curveAmp * t1 * t1;

    const rBot = THREE.MathUtils.lerp(baseR, 0.22, t0);
    const rTop = THREE.MathUtils.lerp(baseR, 0.22, t1);
    const seg = new THREE.CylinderGeometry(rTop, rBot, segH * 1.08, 6);

    const dx = nextX - curX;
    const dy = nextY - curY;
    const dz = nextZ - curZ;
    const dir = new THREE.Vector3(dx, dy, dz).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir,
    );
    seg.applyQuaternion(q);
    seg.translate((curX + nextX) * 0.5, (curY + nextY) * 0.5, (curZ + nextZ) * 0.5);
    parts.push(prepPartHex(seg, s % 2 === 0 ? 0x8a6a45 : 0x6f5236, 0));

    curX = nextX;
    curY = nextY;
    curZ = nextZ;
  }

  for (let f = 0; f < frondCount; f++) {
    const a = (f / frondCount) * Math.PI * 2 + (rng() - 0.5) * 0.22;
    const frondLen = 2.6 + variantIdx * 0.35 + rng() * 0.5;
    const frond = new THREE.ConeGeometry(0.48, frondLen, 4);
    frond.scale(1.1, 1.0, 0.16);
    frond.translate(0, frondLen * 0.5, 0);
    frond.rotateX(Math.PI * (0.48 + rng() * 0.16));
    frond.rotateY(a);
    frond.translate(curX, curY - 0.08, curZ);
    const shade = 0.88 + rng() * 0.16;
    parts.push(prepPart(frond, shade * 0.94, shade, shade * 0.9, 1));
  }

  return mergeParts(parts);
}

function buildCactusVariant(variantIdx: number): THREE.BufferGeometry {
  const rng = mulberry32(0x40404 + variantIdx * 941);
  const armCount = variantIdx;
  const height = 3.2 + variantIdx * 1.15 + rng() * 0.4; // ~3.2 .. 5.9
  const rad = 0.38 + variantIdx * 0.05;

  const parts: THREE.BufferGeometry[] = [];
  const buriedRoot = new THREE.CylinderGeometry(rad * 0.96, rad * 0.9, 0.98, 7);
  buriedRoot.translate(0, -0.42, 0);
  parts.push(prepPartHex(buriedRoot, 0x4f7a3a, 0, 0.92));

  const body = new THREE.CapsuleGeometry(rad, Math.max(1.2, height - rad * 2), 4, 7);
  body.translate(0, height * 0.5, 0);
  parts.push(prepPartHex(body, 0x4f7a3a, 0));

  const actualArms = variantIdx === 0 ? 1 : armCount + 1;
  for (let a = 0; a < actualArms; a++) {
    const angle = (a / actualArms) * Math.PI * 2 + rng() * 0.6;
    const armY = height * (0.38 + a * 0.14 + rng() * 0.08);
    const armOut = 0.72 + rng() * 0.28;
    const armUp = 0.9 + rng() * 0.7;
    const armR = rad * 0.72;

    const horiz = new THREE.CylinderGeometry(armR, armR, armOut, 6);
    horiz.rotateZ(-Math.PI * 0.5);
    horiz.translate(armOut * 0.5, 0, 0);
    horiz.rotateY(angle);
    horiz.translate(0, armY, 0);
    parts.push(prepPartHex(horiz, 0x4f7a3a, 0, 0.96));

    const vert = new THREE.CapsuleGeometry(armR * 0.95, armUp, 3, 6);
    vert.translate(armOut, armUp * 0.5, 0);
    vert.rotateY(angle);
    vert.translate(0, armY, 0);
    parts.push(prepPartHex(vert, 0x4f7a3a, 0, 1.04));
  }

  return mergeParts(parts);
}

function buildShrubVariant(variantIdx: number): THREE.BufferGeometry {
  const rng = mulberry32(0x50505 + variantIdx * 919);
  const puffs = 2 + (variantIdx % 2);
  const baseH = 1.2 + variantIdx * 0.38;

  const parts: THREE.BufferGeometry[] = [];
  const buriedBase = new THREE.CylinderGeometry(baseH * 0.42, baseH * 0.32, 1.05, 6);
  buriedBase.translate(0, -0.38, 0);
  parts.push(prepPart(buriedBase, 0.72, 0.78, 0.68, 1));

  for (let p = 0; p < puffs; p++) {
    const r = baseH * (0.55 + rng() * 0.2);
    const geo = new THREE.IcosahedronGeometry(r, 0);
    geo.scale(1.15 + rng() * 0.2, 0.68 + rng() * 0.14, 1.15 + rng() * 0.2);
    geo.rotateY(rng() * Math.PI);
    const spread = p === 0 ? 0 : baseH * 0.45;
    const a = p * 2.2 + rng();
    geo.translate(
      Math.cos(a) * spread,
      r * 0.52 + (p === 0 ? 0.15 : 0),
      Math.sin(a) * spread,
    );
    const shade = 0.86 + rng() * 0.16;
    parts.push(prepPart(geo, shade * 0.92, shade, shade * 0.88, 1));
  }

  return mergeParts(parts);
}

function buildRockVariant(variantIdx: number): THREE.BufferGeometry {
  const rng = mulberry32(0x70707 + variantIdx * 863);
  const radius = 0.85 + variantIdx * 0.42;
  const seedOffX = rng() * 40;
  const seedOffY = rng() * 40;
  const seedOffZ = rng() * 40;

  const geo = new THREE.IcosahedronGeometry(radius, 1);
  geo.scale(1.15 + rng() * 0.3, 0.62 + rng() * 0.2, 0.95 + rng() * 0.35);

  const part = prepPart(geo, 0.5, 0.48, 0.45, 0, (pos) => {
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const n = simplex3(
        x * 0.8 + seedOffX,
        y * 0.8 + seedOffY,
        z * 0.8 + seedOffZ,
      );
      const disp = 1 + n * 0.28;
      const outY = y < -radius * 0.22
        ? -0.9
        : Math.max(-0.22, y * disp + radius * 0.25);
      pos.setXYZ(i, x * disp, outY, z * disp);
    }
  });

  const col = part.getAttribute('color') as THREE.BufferAttribute;
  const pos = part.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const hShift = THREE.MathUtils.clamp(0.82 + (pos.getY(i) / (radius * 2)) * 0.35, 0.72, 1.15);
    col.setXYZ(i, 0.5 * hShift, 0.48 * hShift, 0.46 * hShift);
  }
  col.needsUpdate = true;
  return mergeParts([part]);
}

function buildMushroomVariant(variantIdx: number): THREE.BufferGeometry {
  const rng = mulberry32(0x80808 + variantIdx * 839);
  const height = 0.55 + variantIdx * 0.25 + rng() * 0.15;
  const stalkH = height * 0.72;
  const stalkR = 0.05 + variantIdx * 0.02;
  const capR = 0.22 + variantIdx * 0.1 + rng() * 0.08;
  const capH = height * 0.38;

  const parts: THREE.BufferGeometry[] = [];
  const stalk = new THREE.CylinderGeometry(stalkR * 0.72, stalkR * 1.15, stalkH + 0.9, 6);
  stalk.translate(0, (stalkH - 0.9) * 0.5, 0);
  parts.push(prepPartHex(stalk, 0xe9e4d8, 0));

  const cap = new THREE.ConeGeometry(capR, capH, 7);
  cap.rotateY(rng() * Math.PI);
  cap.translate(0, stalkH + capH * 0.34, 0);
  parts.push(prepPart(cap, 0.98, 0.96, 1.0, 1));

  return mergeParts(parts);
}

function buildSpeciesGeometry(species: SpeciesId, variantIdx: number): THREE.BufferGeometry {
  switch (species) {
    case 'conifer':
      return buildConiferVariant(variantIdx);
    case 'broadleaf':
      return buildBroadleafVariant(variantIdx);
    case 'palm':
      return buildPalmVariant(variantIdx);
    case 'cactus':
      return buildCactusVariant(variantIdx);
    case 'shrub':
      return buildShrubVariant(variantIdx);
    case 'rock':
      return buildRockVariant(variantIdx);
    case 'mushroom':
      return buildMushroomVariant(variantIdx);
  }
}

function buildSimpleTreeLodGeometry(
  species: 'conifer' | 'broadleaf' | 'palm',
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  if (species === 'conifer') {
    const trunk = new THREE.CylinderGeometry(0.26, 0.42, 3.6, 4);
    trunk.translate(0, 1.4, 0);
    parts.push(prepPartHex(trunk, 0x5b3a24, 0));

    const crown = new THREE.ConeGeometry(2.55, 8.6, 5);
    crown.translate(0, 6.8, 0);
    parts.push(prepPart(crown, 0.94, 1.0, 0.94, 1));
    return mergeParts(parts);
  }

  if (species === 'broadleaf') {
    const trunk = new THREE.CylinderGeometry(0.28, 0.48, 4.6, 4);
    trunk.translate(0, 2.0, 0);
    parts.push(prepPartHex(trunk, 0x6a4429, 0));

    const crown = new THREE.IcosahedronGeometry(2.75, 0);
    crown.scale(1.12, 0.78, 1.12);
    crown.translate(0, 6.2, 0);
    parts.push(prepPart(crown, 0.94, 0.98, 0.92, 1));
    return mergeParts(parts);
  }

  const trunk = new THREE.CylinderGeometry(0.24, 0.42, 8.4, 4);
  trunk.rotateZ(0.1);
  trunk.translate(0.35, 3.9, 0);
  parts.push(prepPartHex(trunk, 0x7a5c3d, 0));

  const crown = new THREE.ConeGeometry(2.8, 1.35, 5);
  crown.translate(0.75, 8.2, 0);
  parts.push(prepPart(crown, 0.94, 0.98, 0.9, 1));
  return mergeParts(parts);
}

// All flora materials are 100% opaque (alphaTest = 0, no discard, no alpha blending)
// so distant LODs never generate transparent pixel overdraw.
function createFloraMaterial(options: {
  cacheKey: string;
  windAmplitude: number; // 0 for rocks, 0.04 for trees
  doubleSide?: boolean;
  glowing?: boolean;
  uTime: { value: number };
  uWind: { value: number };
  uSunDir: { value: THREE.Vector3 };
  uFadeStart: { value: number };
  uFadeEnd: { value: number };
  uHorizonFogColor: { value: THREE.Color };
  uHorizonFogParams: { value: THREE.Vector3 };
}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    flatShading: true,
    roughness: options.glowing ? 0.65 : 0.9,
    metalness: 0.02,
    vertexColors: true,
    side: options.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    emissive: options.glowing ? new THREE.Color(0xffffff) : new THREE.Color(0x000000),
    emissiveIntensity: options.glowing ? 1.0 : 0,
    fog: false,
  });

  mat.customProgramCacheKey = () => `${options.cacheKey}-hfog1`;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = options.uTime;
    shader.uniforms.uWind = options.uWind;
    shader.uniforms.uSunDir = options.uSunDir;
    shader.uniforms.uFadeStart = options.uFadeStart;
    shader.uniforms.uFadeEnd = options.uFadeEnd;
    shader.uniforms.uHorizonFogColor = options.uHorizonFogColor;
    shader.uniforms.uHorizonFogParams = options.uHorizonFogParams;

    const extraVertDecl = [
      'attribute float aTint;',
      'attribute float aWindH;',
      'uniform float uTime;',
      'uniform float uWind;',
      'uniform float uFadeStart;',
      'uniform float uFadeEnd;',
      'varying mediump float vHorizonCamDist;',
      options.glowing ? 'uniform vec3 uSunDir;' : '',
      options.glowing ? 'varying vec3 vFloraGlow;' : '',
    ]
      .filter(Boolean)
      .join('\n');

    const glowColorChunk = options.glowing
      ? `vFloraGlow = vec3( 0.0 );
    #ifdef USE_INSTANCING_COLOR
      vColor.rgb *= mix( vec3( 1.0 ), instanceColor.rgb, aTint );
      float mPhase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].y * 0.53 + instanceMatrix[3].z * 0.41;
      float mPulse = 1.1 + 0.3 * sin(uTime * 2.0944 + mPhase);
      vec3 mInstNormal = normalize(instanceMatrix[1].xyz);
      float mNight = 1.0 + 1.5 * (1.0 - smoothstep(-0.3, 0.2, dot(mInstNormal, uSunDir)));
      vFloraGlow = instanceColor.rgb * aTint * mPulse * mNight;
    #endif`
      : `#ifdef USE_INSTANCING_COLOR
      vColor.rgb *= mix( vec3( 1.0 ), instanceColor.rgb, aTint );
    #endif`;

    const windSnippet =
      options.windAmplitude > 0
        ? `if (fadeScale > 0.001) {
              float windPhase = uTime * 1.6 + instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.27;
              float sway = sin(windPhase) * uWind * ${options.windAmplitude.toFixed(3)} * aWindH * aWindH;
              transformed.x += sway;
              transformed.z += sway * 0.7;
            }`
        : '';

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <color_pars_vertex>',
        `${extraVertDecl}\n#include <color_pars_vertex>`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float fadeDist = distance(instanceMatrix[3].xyz, cameraPosition);
          vHorizonCamDist = distance(cameraPosition, (instanceMatrix * vec4(transformed, 1.0)).xyz);
          float fadeScale = 1.0 - smoothstep(uFadeStart, uFadeEnd, fadeDist);
          ${windSnippet}
          transformed *= fadeScale;
        #else
          vHorizonCamDist = distance(cameraPosition, (modelMatrix * vec4(transformed, 1.0)).xyz);
        #endif`,
      )
      .replace(
        '#include <color_vertex>',
        `#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
      vColor = vec4( 1.0 );
    #endif
    #ifdef USE_COLOR_ALPHA
      vColor *= color;
    #elif defined( USE_COLOR )
      vColor.rgb *= color;
    #endif
    ${glowColorChunk}
    #ifdef USE_BATCHING_COLOR
      vColor *= getBatchingColor( getIndirectIndex( gl_DrawID ) );
    #endif
    /*flora-tint*/`,
      );

    if (!shader.vertexShader.includes('/*flora-tint*/')) {
      console.warn('Flora: tint shader não aplicado');
    }

    const fragCommonExtra = [
      'varying mediump float vHorizonCamDist;',
      'uniform mediump vec3 uHorizonFogColor;',
      'uniform mediump vec3 uHorizonFogParams;',
      options.glowing ? 'varying vec3 vFloraGlow;' : '',
    ]
      .filter(Boolean)
      .join('\n');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${fragCommonExtra}`)
      .replace(
        '#include <fog_fragment>',
        `#include <fog_fragment>
        mediump float hFogFactor = smoothstep(uHorizonFogParams.x, uHorizonFogParams.y, vHorizonCamDist) * uHorizonFogParams.z;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uHorizonFogColor, hFogFactor);`,
      );

    if (options.glowing) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance *= vFloraGlow;`,
      );
    }
  };

  return mat;
}

/**
 * Deterministic Cube-Sphere procedural horde-based flora system with lazy
 * Poisson-sampled groups, precomputed matrix/color buffers, expanded frustum +
 * horizon culling, LOD hysteresis, 2ms time-budget queue, and LRU cache.
 */
export class FloraManager {
  private readonly scene: THREE.Scene;
  private readonly isMobileOrSoftware: boolean;
  private castShadows: boolean;

  private readonly uTime = { value: 0 };
  private readonly uWind = { value: 1 };
  private readonly uSunDir = { value: new THREE.Vector3(0.58, 0.71, 0.4) };
  private readonly uTreeFadeStart = { value: 230 * 0.82 };
  private readonly uTreeFadeEnd = { value: 230 };
  private readonly uSmallFadeStart = { value: 150 * 0.82 };
  private readonly uSmallFadeEnd = { value: 150 };

  private readonly treeMat: THREE.MeshStandardMaterial;
  private readonly smallPlantMat: THREE.MeshStandardMaterial;
  private readonly rockMat: THREE.MeshStandardMaterial;
  private readonly mushroomMat: THREE.MeshStandardMaterial;

  // Primary meshes [speciesIdx * 3 + variantIdx] (trees here are LOD0 shadow-eligible)
  private readonly primaryMeshes: THREE.InstancedMesh[] = [];
  private readonly primaryCapacities: number[] = [];
  private readonly primaryCounts = new Int32Array(
    SPECIES_LIST.length * VARIANTS_PER_SPECIES,
  );

  // Simplified merged opaque LOD1/LOD2 meshes per tree species [0..2]
  private readonly treeLod1Meshes: THREE.InstancedMesh[] = [];
  private readonly treeLod1Capacities: number[] = [];
  private readonly treeLod1Counts = new Int32Array(3);

  private readonly allMeshes: THREE.InstancedMesh[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly meshHeights: number[] = [];
  private readonly speciesMaxHeights = new Float32Array(SPECIES_LIST.length);

  // Cube-sphere cell grid & group registry (at most 1 group per cell, built incrementally under 2ms budget)
  private cachedPlanetSig = '';
  private cachedPlanetRadius = -1;
  private cellGridN = 0;
  private cellCount = 0;
  private cellCenters = new Float32Array(0);
  private cellAngRadii = new Float32Array(0);
  private cellGroups: (FloraGroupRecord | null)[] = [];
  private registryCellCursor = 0;
  private registryReady = false;
  private registryBuildMaxR = 24;
  private registryDensitySqrt = 1;
  private maxGroupRadius = 24;
  private registryInvalidated = true;

  // Lazy group cache (LRU up to 400 generated groups) & 2ms budget queue
  private readonly groupCache = new Map<number, GeneratedGroup>();
  private readonly visibleGroups: VisibleGroupEntry[] = [];
  private readonly activeCellList: number[] = [];
  private readonly genQueue: FloraGroupRecord[] = [];
  private readonly queuedSet = new Set<number>();

  // Landing clearing state & plant harvesting
  private clearingActive = false;
  private readonly clearingPos = new THREE.Vector3();
  private clearingRadiusSq = 0;
  private clearingDirty = false;
  private harvestVersion = 0;
  private harvestDirty = false;

  // Pending staggered GPU buffer uploads (avoids uploading 20+ InstancedMeshes in 1 frame)
  private readonly primaryDirty = new Uint8Array(
    SPECIES_LIST.length * VARIANTS_PER_SPECIES,
  );
  private readonly treeLod1Dirty = new Uint8Array(3);
  private hasPendingUploads = false;
  private readonly lastPrewarmDir = new THREE.Vector3(0, 1, 0);
  private prewarmCompletedForSpot = false;

  // Visibility, stats & rebuild throttling
  private activeInstanceCount = 0;
  private activeMeshCount = 0;
  private statsGroupsActive = 0;
  private statsGroupsLod0 = 0;
  private statsGroupsLod1 = 0;
  private wasVisible = false;
  private timeSinceFill = 99;
  private lastFillSignature = 0;
  private readonly lastEvalShipPos = new THREE.Vector3(1e9, 1e9, 1e9);
  private readonly lastEvalCamForward = new THREE.Vector3(0, 0, -1);
  private lastUserDensity = -1;
  private lastFadeViewRatio = -1;
  private lastHighAltMode = false;
  private lastLowDetailMode = false;
  private lastFadeSpeedFloor = 0;
  private appliedTreeShadows: boolean;
  private forceDisabled = false;
  // Counts real flora work performed since last sample:
  // +1 per uncached cell generated by generateGroupData(),
  // +1 per InstancedMesh whose instanceMatrix/instanceColor buffers are uploaded with needsUpdate = true.
  private builtCellCounter = 0;

  public consumeBuiltCellCount(): number {
    const count = this.builtCellCounter;
    this.builtCellCounter = 0;
    return count;
  }

  private readonly warmupSavedVisible: boolean[] = [];
  private readonly warmupSavedCount: number[] = [];
  private readonly warmupSavedCastShadow: boolean[] = [];
  private readonly warmupDummyMat = new THREE.Matrix4();

  public prepareForShaderWarmup(shadowsEnabled: boolean): void {
    this.warmupSavedVisible.length = 0;
    this.warmupSavedCount.length = 0;
    this.warmupSavedCastShadow.length = 0;

    for (let i = 0; i < this.allMeshes.length; i++) {
      const mesh = this.allMeshes[i];
      this.warmupSavedVisible.push(mesh.visible);
      this.warmupSavedCount.push(mesh.count);
      this.warmupSavedCastShadow.push(mesh.castShadow);

      if (mesh.count === 0) {
        mesh.setMatrixAt(0, this.warmupDummyMat);
        mesh.setColorAt(0, _instColor.setHex(0xffffff));
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.count = 1;
      }
      mesh.visible = true;
    }

    for (let s = 0; s < 3; s++) {
      for (let v = 0; v < VARIANTS_PER_SPECIES; v++) {
        this.primaryMeshes[s * VARIANTS_PER_SPECIES + v].castShadow = shadowsEnabled;
      }
    }
  }

  public restoreAfterShaderWarmup(): void {
    for (let i = 0; i < this.allMeshes.length; i++) {
      const mesh = this.allMeshes[i];
      if (i < this.warmupSavedVisible.length) {
        mesh.visible = this.warmupSavedVisible[i];
        mesh.count = this.warmupSavedCount[i];
        mesh.castShadow = this.warmupSavedCastShadow[i];
      }
    }
  }

  constructor(
    scene: THREE.Scene,
    options: {
      castShadows: boolean;
      isMobileOrSoftware: boolean;
      horizonFogColor: { value: THREE.Color };
      horizonFogParams: { value: THREE.Vector3 };
    },
  ) {
    this.scene = scene;
    this.castShadows = options.castShadows;
    this.appliedTreeShadows = options.castShadows;
    this.isMobileOrSoftware = options.isMobileOrSoftware;

    this.treeMat = createFloraMaterial({
      cacheKey: 'flora-tree',
      windAmplitude: 0.04,
      uTime: this.uTime,
      uWind: this.uWind,
      uSunDir: this.uSunDir,
      uFadeStart: this.uTreeFadeStart,
      uFadeEnd: this.uTreeFadeEnd,
      uHorizonFogColor: options.horizonFogColor,
      uHorizonFogParams: options.horizonFogParams,
    });
    this.smallPlantMat = createFloraMaterial({
      cacheKey: 'flora-small',
      windAmplitude: 0.07,
      uTime: this.uTime,
      uWind: this.uWind,
      uSunDir: this.uSunDir,
      uFadeStart: this.uSmallFadeStart,
      uFadeEnd: this.uSmallFadeEnd,
      uHorizonFogColor: options.horizonFogColor,
      uHorizonFogParams: options.horizonFogParams,
    });
    this.rockMat = createFloraMaterial({
      cacheKey: 'flora-rock',
      windAmplitude: 0,
      uTime: this.uTime,
      uWind: this.uWind,
      uSunDir: this.uSunDir,
      uFadeStart: this.uSmallFadeStart,
      uFadeEnd: this.uSmallFadeEnd,
      uHorizonFogColor: options.horizonFogColor,
      uHorizonFogParams: options.horizonFogParams,
    });
    this.mushroomMat = createFloraMaterial({
      cacheKey: 'flora-mushroom',
      windAmplitude: 0.06,
      glowing: true,
      uTime: this.uTime,
      uWind: this.uWind,
      uSunDir: this.uSunDir,
      uFadeStart: this.uSmallFadeStart,
      uFadeEnd: this.uSmallFadeEnd,
      uHorizonFogColor: options.horizonFogColor,
      uHorizonFogParams: options.horizonFogParams,
    });

    for (let s = 0; s < SPECIES_LIST.length; s++) {
      const spec = SPECIES_LIST[s];
      const mat =
        spec.id === 'mushroom'
          ? this.mushroomMat
          : spec.id === 'rock'
            ? this.rockMat
            : spec.category === 'tree'
              ? this.treeMat
              : this.smallPlantMat;

      const capacity =
        spec.category === 'tree'
          ? this.isMobileOrSoftware
            ? 2500
            : 6000
          : this.isMobileOrSoftware
            ? 5000
            : 6000;

      let spMaxH = 0.5;
      for (let v = 0; v < VARIANTS_PER_SPECIES; v++) {
        const geo = buildSpeciesGeometry(spec.id, v);
        const height = Math.max(geo.boundingBox?.max.y ?? 1, 0.1);
        if (height > spMaxH) spMaxH = height;

        const mesh = new THREE.InstancedMesh(geo, mat, capacity);
        mesh.frustumCulled = false;
        mesh.castShadow = spec.category === 'tree' ? this.castShadows : false;
        mesh.receiveShadow = false;
        mesh.count = 0;
        mesh.visible = false;
        mesh.userData.perfTag = 'flora';
        mesh.setColorAt(0, _instColor.setHex(0xffffff));

        this.scene.add(mesh);
        this.geometries.push(geo);
        this.primaryMeshes.push(mesh);
        this.primaryCapacities.push(capacity);
        this.allMeshes.push(mesh);
        this.meshHeights.push(height);
      }

      if (spec.category === 'tree') {
        const lodGeo = buildSimpleTreeLodGeometry(
          spec.id as 'conifer' | 'broadleaf' | 'palm',
        );
        const lodCapacity = this.isMobileOrSoftware ? 3500 : 8000;
        const lod1Mesh = new THREE.InstancedMesh(lodGeo, mat, lodCapacity);
        lod1Mesh.frustumCulled = false;
        lod1Mesh.castShadow = false;
        lod1Mesh.receiveShadow = false;
        lod1Mesh.count = 0;
        lod1Mesh.visible = false;
        lod1Mesh.userData.perfTag = 'flora';
        lod1Mesh.setColorAt(0, _instColor.setHex(0xffffff));

        this.scene.add(lod1Mesh);
        this.geometries.push(lodGeo);
        this.treeLod1Meshes.push(lod1Mesh);
        this.treeLod1Capacities.push(lodCapacity);
        this.allMeshes.push(lod1Mesh);
      }
      this.speciesMaxHeights[s] = spMaxH * 1.25;
    }
  }

  public getActiveInstanceCount(): number {
    return this.activeInstanceCount;
  }

  public getStats(): FloraStats {
    if (this.forceDisabled) {
      return {
        groupsActive: 0,
        groupsLod0: 0,
        groupsLod1: 0,
        instancesDrawn: 0,
        activeMeshes: 0,
      };
    }
    return {
      groupsActive: this.statsGroupsActive,
      groupsLod0: this.statsGroupsLod0,
      groupsLod1: this.statsGroupsLod1,
      instancesDrawn: this.activeInstanceCount,
      activeMeshes: this.activeMeshCount,
    };
  }

  public setClearing(position: THREE.Vector3 | null, radius = 8): void {
    if (position === null) {
      if (this.clearingActive) {
        this.clearingActive = false;
        this.clearingRadiusSq = 0;
        this.clearingDirty = true;
      }
      return;
    }
    this.clearingActive = true;
    this.clearingPos.copy(position);
    this.clearingRadiusSq = radius * radius;
    this.clearingDirty = true;
  }

  public setCastShadows(enabled: boolean): void {
    this.castShadows = enabled;
    this.syncTreeCastShadows(enabled && !this.lastHighAltMode);
  }

  private syncTreeCastShadows(enabled: boolean): void {
    if (this.appliedTreeShadows === enabled) return;
    this.appliedTreeShadows = enabled;
    for (let s = 0; s < 3; s++) {
      for (let v = 0; v < VARIANTS_PER_SPECIES; v++) {
        this.primaryMeshes[s * VARIANTS_PER_SPECIES + v].castShadow = enabled;
      }
    }
  }

  public setForceDisabled(disabled: boolean): void {
    if (this.forceDisabled === disabled) return;
    this.forceDisabled = disabled;
    if (disabled) {
      for (let i = 0; i < this.allMeshes.length; i++) {
        this.allMeshes[i].visible = false;
      }
    } else if (this.wasVisible) {
      for (let i = 0; i < this.allMeshes.length; i++) {
        this.allMeshes[i].visible = this.allMeshes[i].count > 0;
      }
    }
  }

  public invalidate(): void {
    this.groupCache.clear();
    this.genQueue.length = 0;
    this.queuedSet.clear();
    this.visibleGroups.length = 0;
    this.activeCellList.length = 0;
    this.registryInvalidated = true;
    this.registryReady = false;
    this.registryCellCursor = 0;
    this.lastFillSignature = 0;
    this.timeSinceFill = 99;
    this.prewarmCompletedForSpot = false;
    this.hideAllMeshes();
  }

  private hideAllMeshes(): void {
    for (let i = 0; i < this.allMeshes.length; i++) {
      this.allMeshes[i].count = 0;
      this.allMeshes[i].visible = false;
    }
    this.primaryDirty.fill(0);
    this.treeLod1Dirty.fill(0);
    this.hasPendingUploads = false;
    this.activeInstanceCount = 0;
    this.activeMeshCount = 0;
    this.statsGroupsActive = 0;
    this.statsGroupsLod0 = 0;
    this.statsGroupsLod1 = 0;
    this.wasVisible = false;
  }

  private stepGroupRegistry(
    planetManager: PlanetTerrainManager,
    planet: PlanetParams,
    userDensityFactor: number,
    budgetStartMs: number,
  ): boolean {
    const sig = `${planet.planetRadius}|${planet.noiseScale}|${planet.maxHeight}|${planet.seaLevel}`;
    if (this.registryInvalidated || sig !== this.cachedPlanetSig) {
      this.cachedPlanetSig = sig;
      this.cachedPlanetRadius = planet.planetRadius;
      this.registryInvalidated = false;

      const n = Math.max(8, Math.round((planet.planetRadius * (Math.PI * 0.5)) / 32));
      this.cellGridN = n;
      this.cellCount = 6 * n * n;
      this.cellCenters = new Float32Array(this.cellCount * 3);
      this.cellAngRadii = new Float32Array(this.cellCount);
      this.cellGroups = new Array<FloraGroupRecord | null>(this.cellCount).fill(null);
      this.registryCellCursor = 0;
      this.registryReady = false;
      this.registryBuildMaxR = 24;
      this.registryDensitySqrt = Math.sqrt(Math.max(0.05, userDensityFactor));
      this.lastUserDensity = userDensityFactor;
      this.groupCache.clear();
      this.genQueue.length = 0;
      this.queuedSet.clear();
      this.visibleGroups.length = 0;
      this.lastFillSignature = 0;
    }

    if (this.registryReady) {
      return false;
    }

    const n = this.cellGridN;
    const perFace = n * n;
    const step = 2 / n;
    const safeMaxH = Math.max(planet.maxHeight, 0.001);
    const densitySqrt = this.registryDensitySqrt;
    let processed = 0;

    while (this.registryCellCursor < this.cellCount) {
      const cellIdx = this.registryCellCursor;
      const f = Math.floor(cellIdx / perFace);
      const rem = cellIdx - f * perFace;
      const j = Math.floor(rem / n);
      const i = rem - j * n;
      const face = CUBE_FACES[f];

      const v0 = -1 + j * step;
      const v1 = v0 + step;
      const vMid = v0 + step * 0.5;
      const u0 = -1 + i * step;
      const u1 = u0 + step;
      const uMid = u0 + step * 0.5;

      const c = spherifyCubePoint(
        face.normal[0] + uMid * face.uAxis[0] + vMid * face.vAxis[0],
        face.normal[1] + uMid * face.uAxis[1] + vMid * face.vAxis[1],
        face.normal[2] + uMid * face.uAxis[2] + vMid * face.vAxis[2],
      );
      const cLen = Math.hypot(c.nx, c.ny, c.nz) || 1;
      const cx = c.nx / cLen;
      const cy = c.ny / cLen;
      const cz = c.nz / cLen;

      this.cellCenters[cellIdx * 3] = cx;
      this.cellCenters[cellIdx * 3 + 1] = cy;
      this.cellCenters[cellIdx * 3 + 2] = cz;

      let maxAng = 0;
      for (let cv = 0; cv < 2; cv++) {
        const vc = cv === 0 ? v0 : v1;
        for (let cu = 0; cu < 2; cu++) {
          const uc = cu === 0 ? u0 : u1;
          const p = spherifyCubePoint(
            face.normal[0] + uc * face.uAxis[0] + vc * face.vAxis[0],
            face.normal[1] + uc * face.uAxis[1] + vc * face.vAxis[1],
            face.normal[2] + uc * face.uAxis[2] + vc * face.vAxis[2],
          );
          const dot = THREE.MathUtils.clamp(
            cx * p.nx + cy * p.ny + cz * p.nz,
            -1,
            1,
          );
          const ang = Math.acos(dot);
          if (ang > maxAng) maxAng = ang;
        }
      }
      this.cellAngRadii[cellIdx] = maxAng;

      const seed = hashCell(f, i, j, SEED_FIXA);
      const rng = mulberry32(seed ^ 0x13579bdf);
      const u = u0 + rng() * step;
      const v = v0 + rng() * step;

      const gp = spherifyCubePoint(
        face.normal[0] + u * face.uAxis[0] + v * face.vAxis[0],
        face.normal[1] + u * face.uAxis[1] + v * face.vAxis[1],
        face.normal[2] + u * face.uAxis[2] + v * face.vAxis[2],
      );
      _candDir.set(gp.nx, gp.ny, gp.nz).normalize();

      const rawH = getPlanetTerrainHeight(
        _candDir.x,
        _candDir.y,
        _candDir.z,
        planet.planetRadius,
        planet.noiseScale,
        planet.maxHeight,
      );
      const rawNorm = THREE.MathUtils.clamp(rawH / safeMaxH, -1, 1);
      sampleBiome(
        _candDir.x,
        _candDir.y,
        _candDir.z,
        rawNorm,
        planet.seaLevel,
        _biomeSample,
      );

      const biome = _biomeSample.biome;
      const profile = BIOME_FLORA_TABLE[biome];

      if (
        biome !== 'ocean' &&
        biome !== 'ice' &&
        profile.density > 0 &&
        profile.entries.length > 0
      ) {
        const patchNoise = simplex3(
          _candDir.x * 5 + 17,
          _candDir.y * 5,
          _candDir.z * 5,
        );
        const patchMask = THREE.MathUtils.lerp(
          0.15,
          1,
          smoothstep(-0.2, 0.4, patchNoise),
        );
        if (rng() <= (profile.density / MAX_BIOME_DENSITY) * patchMask) {
          planetManager.getSurfaceNormalAt(
            _candDir.x,
            _candDir.y,
            _candDir.z,
            _candNormal,
          );
          const seedCosSlope = _candNormal.dot(_candDir);
          if (seedCosSlope >= COS_32_DEG) {
            let eligibleCount = 0;
            let totalWeight = 0;

            for (let e = 0; e < profile.entries.length; e++) {
              const entry = profile.entries[e];
              if (entry.minT !== undefined && _biomeSample.T <= entry.minT) {
                continue;
              }
              if (
                entry.maxRawNorm !== undefined &&
                rawNorm >= entry.maxRawNorm
              ) {
                continue;
              }

              const spIdx = SPECIES_INDEX[entry.species];
              const spec = SPECIES_LIST[spIdx];
              const grp = SPECIES_GROUP_SPEC[spec.id];
              if (seedCosSlope < grp.slopeLimitCos) continue;
              if (
                rawNorm <= planet.seaLevel + spec.minAboveSea ||
                rawNorm >= spec.maxRawNorm
              ) {
                continue;
              }

              _eligibleIndices[eligibleCount] = spIdx;
              _eligibleWeights[eligibleCount] = entry.weight;
              _eligibleMaxNorm[eligibleCount] =
                entry.maxRawNorm !== undefined
                  ? Math.min(spec.maxRawNorm, entry.maxRawNorm)
                  : spec.maxRawNorm;
              totalWeight += entry.weight;
              eligibleCount++;
            }

            if (eligibleCount > 0 && totalWeight > 0) {
              let pick = rng() * totalWeight;
              let chosenSpIdx = _eligibleIndices[0];
              let maxAllowedNorm = _eligibleMaxNorm[0];
              for (let e = 0; e < eligibleCount; e++) {
                pick -= _eligibleWeights[e];
                if (pick <= 0) {
                  chosenSpIdx = _eligibleIndices[e];
                  maxAllowedNorm = _eligibleMaxNorm[e];
                  break;
                }
              }

              const chosenId = SPECIES_LIST[chosenSpIdx].id;
              const grpSpec = SPECIES_GROUP_SPEC[chosenId];
              const baseCount =
                grpSpec.minCount +
                Math.floor(rng() * (grpSpec.maxCount - grpSpec.minCount + 1));
              const baseRadius = Math.sqrt(
                (baseCount * grpSpec.areaPerMember) / Math.PI,
              );
              const radius = baseRadius * densitySqrt;
              if (radius > this.registryBuildMaxR) {
                this.registryBuildMaxR = radius;
              }

              if (chosenId === 'mushroom') {
                _baseTintColor.setHex(
                  biome === 'grassland'
                    ? rng() < 0.5
                      ? 0xf472b6
                      : 0x38bdf8
                    : rng() < 0.5
                      ? 0x22d3ee
                      : 0xe879f9,
                );
              } else {
                _baseTintColor.setHex(profile.foliageHex);
              }

              planetManager.getMeshPointAtCubeUV(f, u, v, _meshPt);
              const mLen = _meshPt.length() || 1;

              this.cellGroups[cellIdx] = {
                id: cellIdx,
                cellIdx,
                faceIdx: f,
                u,
                v,
                cx: _meshPt.x,
                cy: _meshPt.y,
                cz: _meshPt.z,
                nx: _meshPt.x / mLen,
                ny: _meshPt.y / mLen,
                nz: _meshPt.z / mLen,
                speciesIdx: chosenSpIdx,
                tintR: _baseTintColor.r,
                tintG: _baseTintColor.g,
                tintB: _baseTintColor.b,
                baseCount,
                baseRadius,
                radius,
                seed,
                maxAllowedNorm,
                lodState: -1,
                priorityScore: 0,
              };
            }
          }
        }
      }

      this.registryCellCursor++;
      processed++;
      if (processed >= 1 && performance.now() - budgetStartMs >= TIME_BUDGET_MS) {
        break;
      }
    }

    if (this.registryCellCursor >= this.cellCount) {
      this.registryReady = true;
      this.maxGroupRadius = this.registryBuildMaxR;
    }
    return processed > 0;
  }

  private setCachedGroup(groupId: number, data: GeneratedGroup): void {
    if (this.groupCache.has(groupId)) {
      this.groupCache.delete(groupId);
    }
    this.groupCache.set(groupId, data);
    while (this.groupCache.size > GROUP_CACHE_LIMIT) {
      const oldest = this.groupCache.keys().next().value;
      if (oldest === undefined) break;
      this.groupCache.delete(oldest);
    }
  }

  private generateGroupData(
    group: FloraGroupRecord,
    planetManager: PlanetTerrainManager,
    planet: PlanetParams,
    userDensityFactor: number,
  ): GeneratedGroup {
    const spIdx = group.speciesIdx;
    const spec = SPECIES_LIST[spIdx];
    const spId = spec.id;
    const grpSpec = SPECIES_GROUP_SPEC[spId];
    const face = CUBE_FACES[group.faceIdx];

    const rng = mulberry32(hashGroupSeed(group.id, SEED_FIXA));
    const targetCount = Math.min(
      MAX_GROUP_MEMBERS,
      Math.max(1, Math.round(group.baseCount * userDensityFactor)),
    );
    const radius = group.radius;
    const minDist = grpSpec.minDist;
    const minDistSq = minDist * minDist;
    const invGridStep = 1 / Math.max(minDist, 0.05);
    const safeMaxH = Math.max(planet.maxHeight, 0.001);
    const invFaceScale = 1 / Math.max(planet.planetRadius * 0.785, 1);

    _gridHead.fill(-1);
    let placed = 0;

    for (let m = 0; m < targetCount; m++) {
      const maxAttempts = m === 0 ? 1 : 6;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        let dxWorld = 0;
        let dyWorld = 0;
        let mu = group.u;
        let mv = group.v;

        if (m > 0) {
          const distFrac = Math.sqrt(rng());
          const falloffProb = 1 - smoothstep(0.55, 1.0, distFrac);
          if (rng() > falloffProb) continue;

          const ang = rng() * Math.PI * 2;
          const radWorld = distFrac * radius;
          dxWorld = Math.cos(ang) * radWorld;
          dyWorld = Math.sin(ang) * radWorld;
          mu = group.u + dxWorld * invFaceScale;
          mv = group.v + dyWorld * invFaceScale;
          if (mu < -1 || mu > 1 || mv < -1 || mv > 1) continue;

          // Spatial grid Poisson check in 3x3 cells around candidate
          const gx = Math.floor((dxWorld + radius) * invGridStep);
          const gy = Math.floor((dyWorld + radius) * invGridStep);
          let tooClose = false;
          for (let oy = -1; oy <= 1 && !tooClose; oy++) {
            const cy = gy + oy;
            for (let ox = -1; ox <= 1; ox++) {
              const cx = gx + ox;
              const bucket = ((Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663)) >>> 0) & 1023;
              let idx = _gridHead[bucket];
              while (idx !== -1) {
                const pdx = dxWorld - _placedX[idx];
                const pdy = dyWorld - _placedY[idx];
                if (pdx * pdx + pdy * pdy < minDistSq) {
                  tooClose = true;
                  break;
                }
                idx = _gridNext[idx];
              }
              if (tooClose) break;
            }
          }
          if (tooClose) continue;
        }

        const mp = spherifyCubePoint(
          face.normal[0] + mu * face.uAxis[0] + mv * face.vAxis[0],
          face.normal[1] + mu * face.uAxis[1] + mv * face.vAxis[1],
          face.normal[2] + mu * face.uAxis[2] + mv * face.vAxis[2],
        );
        _memDir.set(mp.nx, mp.ny, mp.nz).normalize();

        if (m > 0) {
          const memRawH = getPlanetTerrainHeight(
            _memDir.x,
            _memDir.y,
            _memDir.z,
            planet.planetRadius,
            planet.noiseScale,
            planet.maxHeight,
          );
          const memRawNorm = THREE.MathUtils.clamp(memRawH / safeMaxH, -1, 1);
          if (
            memRawNorm <= planet.seaLevel + spec.minAboveSea ||
            memRawNorm >= group.maxAllowedNorm
          ) {
            continue;
          }
        }

        planetManager.getSurfaceNormalAt(
          _memDir.x,
          _memDir.y,
          _memDir.z,
          _memNormal,
        );
        if (m > 0 && _memNormal.dot(_memDir) < grpSpec.slopeLimitCos) {
          continue;
        }

        planetManager.getMeshPointAtCubeUV(group.faceIdx, mu, mv, _meshPt);

        const variantIdx = Math.floor(rng() * VARIANTS_PER_SPECIES);
        const scale =
          m === 0
            ? 1.05 + rng() * 0.15
            : spId === 'rock'
              ? 0.55 + rng() * 0.5
              : 0.7 + rng() * 0.45;
        const yaw = rng() * Math.PI * 2;
        const lum = 0.9 + rng() * 0.2;

        _memRadial.copy(_meshPt).normalize();
        const c = THREE.MathUtils.clamp(_memNormal.dot(_memRadial), 0.01, 1);
        const tanSlope = Math.sqrt(1 - c * c) / c;
        const trunkR = getSpeciesTrunkRadius(spId, variantIdx);
        _meshPt.addScaledVector(
          _memRadial,
          -(0.2 * scale + trunkR * scale * tanSlope),
        );

        if (
          spId === 'conifer' ||
          spId === 'broadleaf' ||
          spId === 'palm' ||
          spId === 'cactus'
        ) {
          _instUp.copy(_memRadial);
        } else if (spId === 'rock') {
          _instUp.copy(_memNormal);
        } else {
          _instUp
            .copy(_memRadial)
            .multiplyScalar(0.7)
            .addScaledVector(_memNormal, 0.3)
            .normalize();
        }

        _alignQuat.setFromUnitVectors(_unitY, _instUp);
        _yawQuat.setFromAxisAngle(_unitY, yaw);

        if (spId === 'rock') {
          const tiltFrac = Math.abs(
            Math.sin(yaw * 17.31 + _meshPt.x * 0.13 + _meshPt.z * 0.17),
          );
          const tiltAz = Math.cos(yaw * 29.17 + _meshPt.y * 0.19) * Math.PI;
          _tiltAxis.set(Math.cos(tiltAz), 0, Math.sin(tiltAz));
          _tiltQuat.setFromAxisAngle(_tiltAxis, tiltFrac * MAX_ROCK_TILT_RAD);
          _instQuat.copy(_alignQuat).multiply(_tiltQuat).multiply(_yawQuat);
        } else {
          _instQuat.copy(_alignQuat).multiply(_yawQuat);
        }

        _instPos.copy(_meshPt);
        _instScale.setScalar(scale);
        _instMatrix.compose(_instPos, _instQuat, _instScale);

        const mOff = placed * 16;
        const elems = _instMatrix.elements;
        for (let e = 0; e < 16; e++) {
          _genMat[mOff + e] = elems[e];
        }

        const cOff = placed * 3;
        _genCol[cOff] = group.tintR * lum;
        _genCol[cOff + 1] = group.tintG * lum;
        _genCol[cOff + 2] = group.tintB * lum;
        _genVar[placed] = variantIdx;
        _genRank[placed] = m === 0 ? -1 : rng();
        _genOrder[placed] = placed;

        // Register in spatial hash grid
        _placedX[placed] = dxWorld;
        _placedY[placed] = dyWorld;
        const gx = Math.floor((dxWorld + radius) * invGridStep);
        const gy = Math.floor((dyWorld + radius) * invGridStep);
        const bucket = ((Math.imul(gx, 73856093) ^ Math.imul(gy, 19349663)) >>> 0) & 1023;
        _gridNext[placed] = _gridHead[bucket];
        _gridHead[bucket] = placed;

        placed++;
        break;
      }
    }

    // Sort members by fixed random ranking so LOD1 keeps the first ceil(0.35 * N)
    const orderView = _genOrder.subarray(0, placed);
    orderView.sort((a, b) => _genRank[a] - _genRank[b]);

    const matrices = new Float32Array(placed * 16);
    const colors = new Float32Array(placed * 3);
    const variants = new Uint8Array(placed);
    const harvested = new Uint8Array(placed);

    for (let i = 0; i < placed; i++) {
      const srcIdx = _genOrder[i];
      matrices.set(_genMat.subarray(srcIdx * 16, srcIdx * 16 + 16), i * 16);
      colors.set(_genCol.subarray(srcIdx * 3, srcIdx * 3 + 3), i * 3);
      variants[i] = _genVar[srcIdx];
    }

    return { count: placed, matrices, colors, variants, harvested };
  }

  public queryNearestHarvestableFlora(
    pos: THREE.Vector3,
    maxDist: number,
    out: FloraHarvestQuery,
  ): void {
    out.found = false;
    out.groupId = -1;
    out.memberIdx = -1;
    out.distance = Infinity;
    if (this.cellCount === 0 || this.cachedPlanetRadius <= 0 || this.forceDisabled) {
      return;
    }

    let bestDistSq = maxDist * maxDist;
    const shrubIdx = SPECIES_INDEX.shrub;
    const mushroomIdx = SPECIES_INDEX.mushroom;

    for (let g = 0; g < this.visibleGroups.length; g++) {
      const group = this.visibleGroups[g].group;
      if (group.speciesIdx !== shrubIdx && group.speciesIdx !== mushroomIdx) {
        continue;
      }
      const maxReach = maxDist + group.radius + 2;
      const gdx = group.cx - pos.x;
      const gdy = group.cy - pos.y;
      const gdz = group.cz - pos.z;
      if (gdx * gdx + gdy * gdy + gdz * gdz > maxReach * maxReach) continue;

      const gen = this.groupCache.get(group.id);
      if (!gen) continue;

      const mat = gen.matrices;
      const harv = gen.harvested;
      for (let m = 0; m < gen.count; m++) {
        if (harv[m] !== 0) continue;
        const mOff = m * 16;
        const px = mat[mOff + 12];
        const py = mat[mOff + 13];
        const pz = mat[mOff + 14];

        if (this.clearingActive) {
          const cdx = px - this.clearingPos.x;
          const cdy = py - this.clearingPos.y;
          const cdz = pz - this.clearingPos.z;
          if (cdx * cdx + cdy * cdy + cdz * cdz < this.clearingRadiusSq) {
            continue;
          }
        }

        const dx = px - pos.x;
        const dy = py - pos.y;
        const dz = pz - pos.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 <= bestDistSq) {
          bestDistSq = d2;
          out.found = true;
          out.groupId = group.id;
          out.memberIdx = m;
          out.species = group.speciesIdx === mushroomIdx ? 'mushroom' : 'shrub';
          out.label =
            group.speciesIdx === mushroomIdx ? 'Cogumelo' : 'Arbusto';
          out.distance = Math.sqrt(d2);
        }
      }
    }
  }

  public harvestMember(groupId: number, memberIdx: number): boolean {
    const gen = this.groupCache.get(groupId);
    if (!gen || memberIdx < 0 || memberIdx >= gen.count) return false;
    if (gen.harvested[memberIdx] !== 0) return false;
    gen.harvested[memberIdx] = 1;
    this.harvestVersion = (this.harvestVersion + 1) | 0;
    this.harvestDirty = true;
    return true;
  }

  public queryTrees(pos: THREE.Vector3, out: TreeCollider[]): number {
    if (this.cellCount === 0 || this.cachedPlanetRadius <= 0) return 0;

    let count = 0;
    for (let g = 0; g < this.visibleGroups.length; g++) {
      const entry = this.visibleGroups[g];
      if (entry.lod !== 0) continue;

      const group = entry.group;
      if (SPECIES_LIST[group.speciesIdx].category !== 'tree') continue;

      const maxReach = 60 + group.radius;
      const gdx = group.cx - pos.x;
      const gdy = group.cy - pos.y;
      const gdz = group.cz - pos.z;
      if (gdx * gdx + gdy * gdy + gdz * gdz > maxReach * maxReach) continue;

      const gen = this.groupCache.get(group.id);
      if (!gen) continue;

      const mat = gen.matrices;
      const vars = gen.variants;
      const spBase = group.speciesIdx * VARIANTS_PER_SPECIES;

      for (let m = 0; m < gen.count; m++) {
        const mOff = m * 16;
        const px = mat[mOff + 12];
        const py = mat[mOff + 13];
        const pz = mat[mOff + 14];

        if (this.clearingActive) {
          const cdx = px - this.clearingPos.x;
          const cdy = py - this.clearingPos.y;
          const cdz = pz - this.clearingPos.z;
          if (cdx * cdx + cdy * cdy + cdz * cdz < this.clearingRadiusSq) {
            continue;
          }
        }

        const scale = Math.hypot(mat[mOff], mat[mOff + 1], mat[mOff + 2]);
        const height = this.meshHeights[spBase + vars[m]] * scale;
        const pLen = Math.hypot(px, py, pz) || 1;
        const rnx = px / pLen;
        const rny = py / pLen;
        const rnz = pz / pLen;

        if (count < out.length) {
          const item = out[count];
          item.x = px;
          item.y = py;
          item.z = pz;
          item.nx = rnx;
          item.ny = rny;
          item.nz = rnz;
          item.height = height;
        } else {
          out.push({
            x: px,
            y: py,
            z: pz,
            nx: rnx,
            ny: rny,
            nz: rnz,
            height,
          });
        }
        count++;
      }
    }

    return count;
  }

  public update(
    dt: number,
    shipPos: THREE.Vector3,
    surfaceAltitude: number,
    planetManager: PlanetTerrainManager,
    planet: PlanetParams,
    flora: FloraParams,
    quality: {
      floraDensityRatio: number;
      floraViewRatio: number;
      qualityLevel: QualityLevel;
    },
    sunDir?: THREE.Vector3,
    camera?: THREE.Camera,
    isLandingOrLanded = true,
    shipVelocity?: THREE.Vector3,
  ): void {
    if (this.forceDisabled) {
      return;
    }

    const tFrameStart = performance.now();
    const userDensityFactor =
      flora.density * (this.isMobileOrSoftware ? 0.6 : 1.0);
    const registryStepped = this.stepGroupRegistry(
      planetManager,
      planet,
      userDensityFactor,
      tFrameStart,
    );

    const speed =
      !isLandingOrLanded && shipVelocity ? shipVelocity.length() : 0;
    const speedFactor = isLandingOrLanded
      ? 0
      : THREE.MathUtils.clamp((speed - 28) / 47, 0, 1);

    const highAltMode = !isLandingOrLanded && surfaceAltitude > 25;
    const lowDetailMode = highAltMode || speedFactor > 0.35;
    this.syncTreeCastShadows(
      this.castShadows && !highAltMode && speedFactor < 0.25,
    );

    this.uTime.value += dt;
    this.uWind.value =
      lowDetailMode || quality.qualityLevel >= 2 ? 0 : 1;
    if (sunDir) {
      this.uSunDir.value.copy(sunDir);
    }

    const baseViewRatio = highAltMode
      ? quality.floraViewRatio * 0.65
      : quality.floraViewRatio;
    const effectiveViewRatio =
      speedFactor > 0
        ? baseViewRatio * THREE.MathUtils.lerp(1.0, 0.55, speedFactor)
        : baseViewRatio;
    const effectiveDensityRatio =
      speedFactor > 0
        ? quality.floraDensityRatio * THREE.MathUtils.lerp(1.0, 0.45, speedFactor)
        : quality.floraDensityRatio;

    const fadeFloorScale =
      speedFactor > 0 ? THREE.MathUtils.lerp(1.0, 0.55, speedFactor) : 1.0;
    if (
      Math.abs(effectiveViewRatio - this.lastFadeViewRatio) > 0.015 ||
      Math.abs(fadeFloorScale - this.lastFadeSpeedFloor) > 0.03
    ) {
      this.lastFadeViewRatio = effectiveViewRatio;
      this.lastFadeSpeedFloor = fadeFloorScale;
      const treeMax = Math.max(120 * fadeFloorScale, 230 * effectiveViewRatio);
      this.uTreeFadeEnd.value = treeMax;
      this.uTreeFadeStart.value = treeMax * 0.82;
      const smallMax = Math.max(75 * fadeFloorScale, 150 * effectiveViewRatio);
      this.uSmallFadeEnd.value = smallMax;
      this.uSmallFadeStart.value = smallMax * 0.82;
    }

    const shipDist = shipPos.length();
    if (shipDist > 0.0001) {
      _shipDir.copy(shipPos).divideScalar(shipDist);
    } else {
      _shipDir.set(0, 1, 0);
    }
    const planetAltitude =
      shipDist - planet.planetRadius - planet.maxHeight * 0.5;

    if (this.forceDisabled || !flora.enabled || flora.density <= 0) {
      if (this.wasVisible) {
        this.hideAllMeshes();
      }
      return;
    }

    if (Math.abs(userDensityFactor - this.lastUserDensity) > 0.02) {
      this.lastUserDensity = userDensityFactor;
      const densitySqrt = Math.sqrt(Math.max(0.05, userDensityFactor));
      this.registryDensitySqrt = densitySqrt;
      for (let i = 0; i < this.cellGroups.length; i++) {
        const g = this.cellGroups[i];
        if (g) {
          g.radius = g.baseRadius * densitySqrt;
          g.lodState = -1;
          if (g.radius > this.maxGroupRadius) {
            this.maxGroupRadius = g.radius;
          }
        }
      }
      this.groupCache.clear();
      this.genQueue.length = 0;
      this.queuedSet.clear();
      this.lastFillSignature = 0;
      this.timeSinceFill = 99;
      this.prewarmCompletedForSpot = false;
    }

    if (planetAltitude >= 150) {
      if (this.wasVisible) {
        this.hideAllMeshes();
      }
      // Early space pre-generation (<= 1.5 ms budget): populate flora cache for the ground directly below the ship
      this.prewarmSurfaceTarget(
        _shipDir,
        planetManager,
        planet,
        userDensityFactor,
        tFrameStart,
      );
      return;
    }

    // Update camera culling helpers (15% padded FOV frustum + forward direction)
    let hasFrustum = false;
    if (camera) {
      camera.updateMatrixWorld();
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      camera.getWorldPosition(_camPos);
      camera.getWorldDirection(_camForward);

      if (camera instanceof THREE.PerspectiveCamera) {
        const targetFov = Math.min(165, camera.fov * 1.15);
        if (
          _cullCamera.fov !== targetFov ||
          _cullCamera.aspect !== camera.aspect ||
          _cullCamera.near !== camera.near ||
          _cullCamera.far !== camera.far
        ) {
          _cullCamera.fov = targetFov;
          _cullCamera.aspect = camera.aspect;
          _cullCamera.near = camera.near;
          _cullCamera.far = camera.far;
          _cullCamera.updateProjectionMatrix();
        }
        _projScreenMatrix.multiplyMatrices(
          _cullCamera.projectionMatrix,
          camera.matrixWorldInverse,
        );
        _frustum.setFromProjectionMatrix(_projScreenMatrix);
        hasFrustum = true;
      }
    } else {
      _camPos.copy(shipPos);
      _camForward.copy(_shipDir);
    }

    if (speed > 0.5 && shipVelocity) {
      _velDir.copy(shipVelocity).divideScalar(speed);
      _trajDir.copy(_velDir);
    } else {
      _velDir.copy(_camForward);
      _trajDir.copy(_camForward);
    }

    this.timeSinceFill += dt;
    const movedDistSq = this.lastEvalShipPos.distanceToSquared(shipPos);
    const camRotated = _camForward.dot(this.lastEvalCamForward) < COS_8_DEG;
    const highAltChanged =
      highAltMode !== this.lastHighAltMode ||
      lowDetailMode !== this.lastLowDetailMode;
    this.lastHighAltMode = highAltMode;
    this.lastLowDetailMode = lowDetailMode;

    const camLen = _camPos.length();
    if (camLen > 0.0001) {
      _camDir.copy(_camPos).divideScalar(camLen);
    } else {
      _camDir.set(0, 1, 0);
    }

    const shouldEvaluate =
      !this.wasVisible ||
      this.clearingDirty ||
      this.harvestDirty ||
      highAltChanged ||
      registryStepped ||
      this.timeSinceFill >= 0.15 ||
      movedDistSq > 144 ||
      camRotated;

    let generatedThisFrame = 0;

    if (shouldEvaluate) {
      this.evaluateVisibleGroups(
        shipPos,
        planet,
        effectiveViewRatio,
        hasFrustum,
        lowDetailMode,
        speed,
        fadeFloorScale,
      );
      this.lastEvalShipPos.copy(shipPos);
      this.lastEvalCamForward.copy(_camForward);
    }

    // Process lazy group generation queue within remaining 2ms frame budget
    if (
      this.genQueue.length > 0 &&
      performance.now() - tFrameStart < TIME_BUDGET_MS
    ) {
      while (this.genQueue.length > 0) {
        const group = this.genQueue.pop();
        if (!group) break;
        this.queuedSet.delete(group.id);
        if (!this.groupCache.has(group.id)) {
          const gen = this.generateGroupData(
            group,
            planetManager,
            planet,
            userDensityFactor,
          );
          this.setCachedGroup(group.id, gen);
          // Incremented whenever a previously uncached flora cell is generated via generateGroupData.
          this.builtCellCounter++;
          generatedThisFrame++;
        }
        if (performance.now() - tFrameStart >= TIME_BUDGET_MS) {
          break;
        }
      }
    } else if (
      highAltMode &&
      this.genQueue.length === 0 &&
      performance.now() - tFrameStart < 1.5
    ) {
      // While descending at > 25m, pre-cache ground-level species (rocks, mushrooms, LOD0 trees) within budget
      this.prewarmSurfaceTarget(
        _shipDir,
        planetManager,
        planet,
        userDensityFactor,
        tFrameStart,
      );
    }

    // Rebuild InstancedMesh CPU buffers when visible/LOD/cache signature changes,
    // then stagger GPU needsUpdate uploads across frames to prevent frame hitches.
    let flushedThisFrame = false;
    if (
      this.clearingDirty ||
      this.harvestDirty ||
      highAltChanged ||
      !this.wasVisible ||
      ((shouldEvaluate || generatedThisFrame > 0) && this.timeSinceFill >= 0.15)
    ) {
      const sig = this.computeSignature(effectiveDensityRatio, lowDetailMode);
      if (
        sig !== this.lastFillSignature ||
        this.clearingDirty ||
        this.harvestDirty ||
        highAltChanged ||
        !this.wasVisible
      ) {
        this.fillInstancedMeshes(effectiveDensityRatio, tFrameStart);
        this.lastFillSignature = sig;
        this.clearingDirty = false;
        this.harvestDirty = false;
        this.timeSinceFill = 0;
        flushedThisFrame = true;
      } else {
        this.timeSinceFill = 0;
      }
    }

    if (!flushedThisFrame && this.hasPendingUploads) {
      this.flushPendingUploads(tFrameStart, 3);
    }

    this.wasVisible = true;
  }

  private prewarmSurfaceTarget(
    targetDir: THREE.Vector3,
    planetManager: PlanetTerrainManager,
    planet: PlanetParams,
    userDensityFactor: number,
    budgetStartMs: number,
  ): void {
    if (this.cellCount === 0 || performance.now() - budgetStartMs >= 1.5) return;
    if (
      this.prewarmCompletedForSpot &&
      targetDir.dot(this.lastPrewarmDir) > 0.996
    ) {
      return;
    }

    const baseAngle = 175 / Math.max(planet.planetRadius, 1);
    const centers = this.cellCenters;
    const angRadii = this.cellAngRadii;
    let builtAny = false;
    let uncachedRemaining = false;

    for (let cellIdx = 0; cellIdx < this.cellCount; cellIdx++) {
      const group = this.cellGroups[cellIdx];
      if (!group) continue;
      if (this.groupCache.has(group.id)) continue;

      const maxAng = baseAngle + angRadii[cellIdx];
      if (maxAng < Math.PI) {
        const dot =
          centers[cellIdx * 3] * targetDir.x +
          centers[cellIdx * 3 + 1] * targetDir.y +
          centers[cellIdx * 3 + 2] * targetDir.z;
        if (dot <= Math.cos(maxAng)) continue;
      }

      if (performance.now() - budgetStartMs >= 1.5) {
        uncachedRemaining = true;
        break;
      }

      const gen = this.generateGroupData(
        group,
        planetManager,
        planet,
        userDensityFactor,
      );
      this.setCachedGroup(group.id, gen);
      this.builtCellCounter++;
      builtAny = true;
    }

    if (!uncachedRemaining) {
      this.lastPrewarmDir.copy(targetDir);
      this.prewarmCompletedForSpot = true;
    } else if (builtAny) {
      this.prewarmCompletedForSpot = false;
    }
  }

  private evaluateVisibleGroups(
    shipPos: THREE.Vector3,
    planet: PlanetParams,
    viewRatio: number,
    hasFrustum: boolean,
    lowDetailMode: boolean,
    shipSpeed: number,
    fadeFloorScale: number,
  ): void {
    this.visibleGroups.length = 0;
    this.activeCellList.length = 0;

    const maxTreeDist = Math.max(120 * fadeFloorScale, 230 * viewRatio);
    const maxSearchDist = maxTreeDist + Math.max(24, this.maxGroupRadius);
    const baseAngle = maxSearchDist / Math.max(planet.planetRadius, 1);

    const camLen = _camPos.length();
    const horizonR = Math.max(
      1,
      planet.planetRadius + Math.min(0, planet.seaLevel * planet.maxHeight) - 4,
    );
    const camHorizonAngle = Math.acos(
      THREE.MathUtils.clamp(horizonR / Math.max(camLen, horizonR), -1, 1),
    );

    const centers = this.cellCenters;
    const angRadii = this.cellAngRadii;
    const skipShortHorizonCells = shipSpeed > 25;
    let newlyQueued = false;

    for (let cellIdx = 0; cellIdx < this.cellCount; cellIdx++) {
      const maxAng = baseAngle + angRadii[cellIdx];
      if (maxAng < Math.PI) {
        const dot =
          centers[cellIdx * 3] * _shipDir.x +
          centers[cellIdx * 3 + 1] * _shipDir.y +
          centers[cellIdx * 3 + 2] * _shipDir.z;
        if (dot <= Math.cos(maxAng)) continue;
      }

      this.activeCellList.push(cellIdx);
      const group = this.cellGroups[cellIdx];
      if (!group) continue;

      const spIdx = group.speciesIdx;
      const spec = SPECIES_LIST[spIdx];
      if (lowDetailMode && (spec.id === 'rock' || spec.id === 'mushroom')) {
        continue;
      }

      const grpSpec = SPECIES_GROUP_SPEC[spec.id];
      const sphereR = group.radius + this.speciesMaxHeights[spIdx];

      const sdx = group.cx - shipPos.x;
      const sdy = group.cy - shipPos.y;
      const sdz = group.cz - shipPos.z;
      const shipDist = Math.sqrt(sdx * sdx + sdy * sdy + sdz * sdz);
      const edgeDist = Math.max(0, shipDist - group.radius);

      // LOD thresholds with ±8% hysteresis; lowDetailMode forces cheapest LOD1 on trees
      const isTree = spec.category === 'tree';
      const t0 = Math.max(
        (isTree ? 70 : 45) * fadeFloorScale,
        grpSpec.lod0Dist * viewRatio,
      );
      const t1 = Math.max(
        (isTree ? 120 : 75) * fadeFloorScale,
        grpSpec.lod1Dist * viewRatio,
      );
      let nextLod: 0 | 1 | 2;

      if (lowDetailMode && isTree) {
        nextLod = edgeDist <= t1 ? 1 : 2;
      } else if (group.lodState === -1) {
        if (edgeDist <= t0) nextLod = 0;
        else if (edgeDist <= t1) nextLod = 1;
        else nextLod = 2;
      } else if (group.lodState === 0) {
        if (edgeDist > t0 * 1.08) {
          nextLod = edgeDist <= t1 * 1.08 ? 1 : 2;
        } else {
          nextLod = 0;
        }
      } else if (group.lodState === 1) {
        if (edgeDist < t0 * 0.92) nextLod = 0;
        else if (edgeDist > t1 * 1.08) nextLod = 2;
        else nextLod = 1;
      } else {
        if (edgeDist < t0 * 0.92) nextLod = 0;
        else if (edgeDist < t1 * 0.92) nextLod = 1;
        else nextLod = 2;
      }
      group.lodState = nextLod;
      if (nextLod === 2) continue;

      // Planet horizon dot culling
      const grpR = Math.hypot(group.cx, group.cy, group.cz);
      const grpHorizonAngle = Math.acos(
        THREE.MathUtils.clamp(horizonR / Math.max(grpR, horizonR), -1, 1),
      );
      const maxVisAngle =
        camHorizonAngle + grpHorizonAngle + sphereR / horizonR;
      if (maxVisAngle < Math.PI) {
        const hDot =
          _camDir.x * group.nx +
          _camDir.y * group.ny +
          _camDir.z * group.nz;
        if (hDot < Math.cos(maxVisAngle)) continue;
      }

      // Strict camera frustum culling (no flora outside camera frustum is sent to GPU)
      if (hasFrustum) {
        _groupSphere.center.set(group.cx, group.cy, group.cz);
        _groupSphere.radius = sphereR;
        if (!_frustum.intersectsSphere(_groupSphere)) continue;
      }

      this.visibleGroups.push({
        group,
        lod: nextLod,
        sortDist: edgeDist,
      });

      if (!this.groupCache.has(group.id) && !this.queuedSet.has(group.id)) {
        // At high speed, skip generating uncached cells the ship is behind or will cross in < 1s
        if (skipShortHorizonCells) {
          const alongVel = sdx * _velDir.x + sdy * _velDir.y + sdz * _velDir.z;
          if (alongVel < shipSpeed * 1.0) {
            continue;
          }
        }
        const invShipDist = 1 / Math.max(shipDist, 1);
        _toGroup.set(sdx * invShipDist, sdy * invShipDist, sdz * invShipDist);
        const trajDot = THREE.MathUtils.clamp(_toGroup.dot(_trajDir), -1, 1);
        group.priorityScore = shipDist * (1.5 - 0.7 * trajDot);
        this.genQueue.push(group);
        this.queuedSet.add(group.id);
        newlyQueued = true;
      }
    }

    // Sort visible groups ascending by distance so overflow drops the farthest members first
    if (this.visibleGroups.length > 1) {
      this.visibleGroups.sort((a, b) => a.sortDist - b.sortDist);
    }

    // Sort queue descending by priorityScore so pop() gets closest & ahead-of-trajectory first
    if (newlyQueued && this.genQueue.length > 1) {
      this.genQueue.sort((a, b) => b.priorityScore - a.priorityScore);
    }
  }

  private computeSignature(
    densityRatio: number,
    highAltMode: boolean,
  ): number {
    let sig = 0x811c9dc5;
    sig = Math.imul(sig ^ Math.round(densityRatio * 100), 0x01000193);
    sig = Math.imul(sig ^ (this.clearingActive ? 1 : 0), 0x01000193);
    sig = Math.imul(sig ^ (highAltMode ? 1 : 0), 0x01000193);
    sig = Math.imul(sig ^ this.harvestVersion, 0x01000193);

    for (let i = 0; i < this.visibleGroups.length; i++) {
      const entry = this.visibleGroups[i];
      if (!this.groupCache.has(entry.group.id)) continue;
      sig = Math.imul(
        sig ^ (entry.group.id * 4 + entry.lod + 1),
        0x01000193,
      );
    }
    return sig >>> 0;
  }

  private fillInstancedMeshes(
    qualityDensityRatio: number,
    budgetStartMs: number,
  ): void {
    this.primaryCounts.fill(0);
    this.treeLod1Counts.fill(0);

    let groupsLod0 = 0;
    let groupsLod1 = 0;

    for (let g = 0; g < this.visibleGroups.length; g++) {
      const entry = this.visibleGroups[g];
      const group = entry.group;
      const gen = this.groupCache.get(group.id);
      if (!gen || gen.count === 0) continue;

      // Refresh LRU position
      this.groupCache.delete(group.id);
      this.groupCache.set(group.id, gen);

      if (entry.lod === 0) groupsLod0++;
      else groupsLod1++;

      const spIdx = group.speciesIdx;
      const isTreeLod1 =
        SPECIES_LIST[spIdx].category === 'tree' && entry.lod === 1;
      const baseSlot = spIdx * VARIANTS_PER_SPECIES;

      const rawDraw =
        qualityDensityRatio >= 0.999
          ? gen.count
          : Math.min(gen.count, Math.max(1, Math.ceil(gen.count * qualityDensityRatio)));
      const drawCount =
        entry.lod === 1
          ? Math.min(gen.count, Math.max(1, Math.ceil(rawDraw * 0.35)))
          : rawDraw;
      const applyLodScale = entry.lod === 1;

      const srcMats = gen.matrices;
      const srcCols = gen.colors;
      const srcVars = gen.variants;
      const srcHarvested = gen.harvested;

      for (let m = 0; m < drawCount; m++) {
        if (srcHarvested[m] !== 0) continue;
        const slot = isTreeLod1 ? spIdx : baseSlot + srcVars[m];
        const mesh = isTreeLod1
          ? this.treeLod1Meshes[slot]
          : this.primaryMeshes[slot];
        const cap = isTreeLod1
          ? this.treeLod1Capacities[slot]
          : this.primaryCapacities[slot];
        const outIdx = isTreeLod1
          ? this.treeLod1Counts[slot]
          : this.primaryCounts[slot];

        if (outIdx >= cap) continue;

        const matArr = mesh.instanceMatrix.array as Float32Array;
        const colArr = mesh.instanceColor!.array as Float32Array;
        const dstM = outIdx * 16;
        const dstC = outIdx * 3;
        const srcM = m * 16;
        const srcC = m * 3;

        matArr.set(srcMats.subarray(srcM, srcM + 16), dstM);
        colArr.set(srcCols.subarray(srcC, srcC + 3), dstC);

        let cleared = false;
        if (this.clearingActive) {
          const cdx = matArr[dstM + 12] - this.clearingPos.x;
          const cdy = matArr[dstM + 13] - this.clearingPos.y;
          const cdz = matArr[dstM + 14] - this.clearingPos.z;
          if (cdx * cdx + cdy * cdy + cdz * cdz < this.clearingRadiusSq) {
            for (let e = 0; e < 11; e++) {
              matArr[dstM + e] = 0;
            }
            cleared = true;
          }
        }

        if (!cleared && applyLodScale) {
          matArr[dstM] *= 1.25;
          matArr[dstM + 1] *= 1.25;
          matArr[dstM + 2] *= 1.25;
          matArr[dstM + 4] *= 1.25;
          matArr[dstM + 5] *= 1.25;
          matArr[dstM + 6] *= 1.25;
          matArr[dstM + 8] *= 1.25;
          matArr[dstM + 9] *= 1.25;
          matArr[dstM + 10] *= 1.25;
        }

        if (isTreeLod1) {
          this.treeLod1Counts[slot] = outIdx + 1;
        } else {
          this.primaryCounts[slot] = outIdx + 1;
        }
      }
    }

    this.hasPendingUploads = false;
    for (let i = 0; i < this.primaryMeshes.length; i++) {
      const mesh = this.primaryMeshes[i];
      const count = this.primaryCounts[i];
      if (count === 0) {
        mesh.count = 0;
        mesh.visible = false;
        this.primaryDirty[i] = 0;
      } else {
        this.primaryDirty[i] = 1;
        this.hasPendingUploads = true;
      }
    }

    for (let i = 0; i < this.treeLod1Meshes.length; i++) {
      const mesh = this.treeLod1Meshes[i];
      const count = this.treeLod1Counts[i];
      if (count === 0) {
        mesh.count = 0;
        mesh.visible = false;
        this.treeLod1Dirty[i] = 0;
      } else {
        this.treeLod1Dirty[i] = 1;
        this.hasPendingUploads = true;
      }
    }

    this.statsGroupsLod0 = groupsLod0;
    this.statsGroupsLod1 = groupsLod1;
    this.statsGroupsActive = groupsLod0 + groupsLod1;

    this.flushPendingUploads(budgetStartMs, 4);
  }

  private flushPendingUploads(
    budgetStartMs: number,
    maxUploadsPerFrame: number,
  ): void {
    let uploads = 0;
    let remainingDirty = false;

    // Prioritize tree LOD1 & primary trees first, then ground plants/rocks
    for (let i = 0; i < this.treeLod1Meshes.length; i++) {
      if (this.treeLod1Dirty[i] === 0) continue;
      if (
        uploads >= maxUploadsPerFrame ||
        (uploads >= 2 && performance.now() - budgetStartMs >= TIME_BUDGET_MS)
      ) {
        remainingDirty = true;
        break;
      }
      const mesh = this.treeLod1Meshes[i];
      const count = this.treeLod1Counts[i];
      mesh.count = count;
      mesh.visible = count > 0;
      if (count > 0) {
        uploadAttribute(mesh.instanceMatrix, count);
        if (mesh.instanceColor) {
          uploadAttribute(mesh.instanceColor, count);
        }
        // Counts actual InstancedMesh GPU buffer upload (needsUpdate = true)
        this.builtCellCounter++;
        uploads++;
      }
      this.treeLod1Dirty[i] = 0;
    }

    for (let i = 0; i < this.primaryMeshes.length; i++) {
      if (this.primaryDirty[i] === 0) continue;
      if (
        uploads >= maxUploadsPerFrame ||
        (uploads >= 2 && performance.now() - budgetStartMs >= TIME_BUDGET_MS)
      ) {
        remainingDirty = true;
        break;
      }
      const mesh = this.primaryMeshes[i];
      const count = this.primaryCounts[i];
      mesh.count = count;
      mesh.visible = count > 0;
      if (count > 0) {
        uploadAttribute(mesh.instanceMatrix, count);
        if (mesh.instanceColor) {
          uploadAttribute(mesh.instanceColor, count);
        }
        // Counts actual InstancedMesh GPU buffer upload (needsUpdate = true)
        this.builtCellCounter++;
        uploads++;
      }
      this.primaryDirty[i] = 0;
    }

    if (!remainingDirty) {
      for (let i = 0; i < this.treeLod1Dirty.length; i++) {
        if (this.treeLod1Dirty[i]) {
          remainingDirty = true;
          break;
        }
      }
    }
    this.hasPendingUploads = remainingDirty;

    let totalActive = 0;
    let activeMeshes = 0;
    for (let i = 0; i < this.allMeshes.length; i++) {
      const m = this.allMeshes[i];
      if (m.visible && m.count > 0) {
        totalActive += m.count;
        activeMeshes++;
      }
    }
    this.activeInstanceCount = totalActive;
    this.activeMeshCount = activeMeshes;
  }

  public dispose(): void {
    this.groupCache.clear();
    this.genQueue.length = 0;
    this.queuedSet.clear();
    this.visibleGroups.length = 0;
    this.activeCellList.length = 0;
    this.cellGroups.length = 0;

    for (let i = 0; i < this.allMeshes.length; i++) {
      this.scene.remove(this.allMeshes[i]);
      this.allMeshes[i].dispose();
    }
    this.allMeshes.length = 0;
    this.primaryMeshes.length = 0;
    this.treeLod1Meshes.length = 0;

    for (let i = 0; i < this.geometries.length; i++) {
      this.geometries[i].dispose();
    }
    this.geometries.length = 0;

    this.treeMat.dispose();
    this.smallPlantMat.dispose();
    this.rockMat.dispose();
    this.mushroomMat.dispose();
  }
}
