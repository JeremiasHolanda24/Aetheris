import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FloraParams, PlanetParams, QualityLevel } from '../types/simulation';
import { BiomeId, BiomeSample, sampleBiome } from './biomes';
import { PlanetTerrainManager } from './PlanetTerrainManager';
import {
  getPlanetSurfaceHeight,
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
  | 'grass'
  | 'rock'
  | 'mushroom';

type FloraCategory = 'tree' | 'small' | 'grass';

export interface TreeCollider {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  height: number;
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
  grassWeight: number;
  foliageHex: number;
  entries: BiomeFloraEntry[];
}

interface CubeFaceBasis {
  normal: [number, number, number];
  uAxis: [number, number, number];
  vAxis: [number, number, number];
}

// Same 6 cube-sphere faces as PlanetTerrainManager
const CUBE_FACES: CubeFaceBasis[] = [
  { normal: [0, 1, 0], uAxis: [1, 0, 0], vAxis: [0, 0, -1] },
  { normal: [0, -1, 0], uAxis: [1, 0, 0], vAxis: [0, 0, 1] },
  { normal: [1, 0, 0], uAxis: [0, 0, -1], vAxis: [0, 1, 0] },
  { normal: [-1, 0, 0], uAxis: [0, 0, 1], vAxis: [0, 1, 0] },
  { normal: [0, 0, 1], uAxis: [1, 0, 0], vAxis: [0, 1, 0] },
  { normal: [0, 0, -1], uAxis: [-1, 0, 0], vAxis: [0, 1, 0] },
];

const SEED_FIXA = 0x4f7a9c2b;
const VARIANTS_PER_SPECIES = 3;
const CELL_CACHE_LIMIT = 600;
const MAX_CELLS_PER_FRAME = 12;
const INSTANCE_STRIDE = 13; // px, py, pz, nx, ny, nz, yaw, scale, speciesIdx, variantIdx, r, g, b
const COS_32_DEG = Math.cos(THREE.MathUtils.degToRad(32));

const SPECIES_LIST: SpeciesSpec[] = [
  { id: 'conifer', category: 'tree', maxDist: 230, minAboveSea: 0.04, maxRawNorm: 0.55 },
  { id: 'broadleaf', category: 'tree', maxDist: 230, minAboveSea: 0.04, maxRawNorm: 0.48 },
  { id: 'palm', category: 'tree', maxDist: 230, minAboveSea: 0.0, maxRawNorm: 0.28 },
  { id: 'cactus', category: 'small', maxDist: 150, minAboveSea: 0.04, maxRawNorm: 0.46 },
  { id: 'shrub', category: 'small', maxDist: 150, minAboveSea: 0.04, maxRawNorm: 0.52 },
  { id: 'grass', category: 'grass', maxDist: 65, minAboveSea: 0.04, maxRawNorm: 0.5 },
  { id: 'rock', category: 'small', maxDist: 150, minAboveSea: 0.02, maxRawNorm: 0.9 },
  { id: 'mushroom', category: 'small', maxDist: 150, minAboveSea: 0.04, maxRawNorm: 0.48 },
];

const SPECIES_INDEX: Record<SpeciesId, number> = {
  conifer: 0,
  broadleaf: 1,
  palm: 2,
  cactus: 3,
  shrub: 4,
  grass: 5,
  rock: 6,
  mushroom: 7,
};

// Editable biome -> species table
const BIOME_FLORA_TABLE: Record<BiomeId, BiomeFloraProfile> = {
  desert: {
    density: 0.5,
    grassWeight: 0,
    foliageHex: 0x7f914e,
    entries: [
      { species: 'cactus', weight: 45 },
      { species: 'rock', weight: 35 },
      { species: 'shrub', weight: 20 },
    ],
  },
  grassland: {
    density: 0.8,
    grassWeight: 1,
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
    grassWeight: 1,
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
    grassWeight: 1,
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
    grassWeight: 1,
    foliageHex: 0x7a8050,
    entries: [
      { species: 'shrub', weight: 40 },
      { species: 'rock', weight: 40 },
      { species: 'conifer', weight: 20 },
    ],
  },
  mountain: {
    density: 0.4,
    grassWeight: 0,
    foliageHex: 0x29593e,
    entries: [
      { species: 'rock', weight: 75 },
      { species: 'conifer', weight: 25, maxRawNorm: 0.55 },
    ],
  },
  beach: {
    density: 0.15,
    grassWeight: 0,
    foliageHex: 0x4aad43,
    entries: [{ species: 'palm', weight: 100, minT: 0.55 }],
  },
  ocean: {
    density: 0,
    grassWeight: 0,
    foliageHex: 0x4a7c59,
    entries: [],
  },
  ice: {
    density: 0,
    grassWeight: 0,
    foliageHex: 0x4a7c59,
    entries: [],
  },
};

const MAX_BIOME_DENSITY = 1.3;

// Pre-allocated scratch helpers (Zero GC during update/streaming/queries)
const _shipDir = new THREE.Vector3();
const _queryDir = new THREE.Vector3();
const _candDir = new THREE.Vector3();
const _candNormal = new THREE.Vector3();
const _instPos = new THREE.Vector3();
const _instNormal = new THREE.Vector3();
const _instScale = new THREE.Vector3();
const _instQuat = new THREE.Quaternion();
const _alignQuat = new THREE.Quaternion();
const _yawQuat = new THREE.Quaternion();
const _unitY = new THREE.Vector3(0, 1, 0);
const _instMatrix = new THREE.Matrix4();
const _instColor = new THREE.Color();
const _baseTintColor = new THREE.Color();
const _biomeSample: BiomeSample = { biome: 'ocean', T: 0.5, M: 0.5 };
const _eligibleWeights = new Float32Array(8);
const _eligibleIndices = new Int32Array(8);

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

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
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

function buildConiferVariant(variantIdx: number): THREE.BufferGeometry {
  const rng = mulberry32(0x10101 + variantIdx * 977);
  const layers = 3 + variantIdx; // 3, 4, 5 cones
  const totalHeight = 8.4 + variantIdx * 2.4 + rng() * 1.1; // ~8.4 .. 14.3
  const trunkH = totalHeight * (0.28 + rng() * 0.06);
  const trunkR = 0.34 + variantIdx * 0.07;

  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(trunkR * 0.65, trunkR, trunkH, 6);
  trunk.translate(0, trunkH * 0.5, 0);
  parts.push(prepPart(trunk, 0.34, 0.22, 0.14, 0));

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
  const trunk = new THREE.CylinderGeometry(trunkR * 0.68, trunkR * 1.15, trunkH, 6);
  trunk.translate(0, trunkH * 0.5, 0);
  parts.push(prepPart(trunk, 0.38, 0.25, 0.16, 0));

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
      parts.push(prepPart(branch, 0.38, 0.25, 0.16, 0));
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

  const parts: THREE.BufferGeometry[] = [];
  let curX = 0;
  let curY = 0;
  let curZ = 0;

  for (let s = 0; s < segments; s++) {
    const t0 = s / segments;
    const t1 = (s + 1) / segments;
    const nextX = leanX * curveAmp * t1 * t1;
    const nextY = t1 * trunkH;
    const nextZ = leanZ * curveAmp * t1 * t1;

    const rBot = THREE.MathUtils.lerp(0.38, 0.22, t0);
    const rTop = THREE.MathUtils.lerp(0.38, 0.22, t1);
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
    parts.push(prepPart(seg, 0.45, 0.34, 0.22, 0));

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
  const body = new THREE.CapsuleGeometry(rad, Math.max(1.2, height - rad * 2), 4, 7);
  body.translate(0, height * 0.5, 0);
  parts.push(prepPart(body, 0.86, 0.96, 0.84, 1));

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
    parts.push(prepPart(horiz, 0.84, 0.95, 0.82, 1));

    const vert = new THREE.CapsuleGeometry(armR * 0.95, armUp, 3, 6);
    vert.translate(armOut, armUp * 0.5, 0);
    vert.rotateY(angle);
    vert.translate(0, armY, 0);
    parts.push(prepPart(vert, 0.88, 0.98, 0.86, 1));
  }

  return mergeParts(parts);
}

function buildShrubVariant(variantIdx: number): THREE.BufferGeometry {
  const rng = mulberry32(0x50505 + variantIdx * 919);
  const puffs = 2 + (variantIdx % 2);
  const baseH = 1.2 + variantIdx * 0.38;

  const parts: THREE.BufferGeometry[] = [];
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

function buildGrassVariant(variantIdx: number): THREE.BufferGeometry {
  const rng = mulberry32(0x60606 + variantIdx * 887);
  const blades = 5 + variantIdx;
  const baseH = 0.82 + variantIdx * 0.22;

  const parts: THREE.BufferGeometry[] = [];
  for (let b = 0; b < blades; b++) {
    const angle = (b / blades) * Math.PI * 2 + (rng() - 0.5) * 0.35;
    const bh = baseH * (0.85 + rng() * 0.3);
    const bw = 0.14 + rng() * 0.06;
    const lean = 0.25 + rng() * 0.32;
    const spreadR = rng() * 0.22;

    const geo = new THREE.BufferGeometry();
    const verts = new Float32Array([
      -bw, 0, 0,
      bw, 0, 0,
      0, bh, lean,
    ]);
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.rotateY(angle);
    geo.translate(Math.cos(angle) * spreadR, 0, Math.sin(angle) * spreadR);

    const prepared = prepPart(geo, 1, 1, 1, 1);
    const colAttr = prepared.getAttribute('color') as THREE.BufferAttribute;
    colAttr.setXYZ(0, 0.58, 0.65, 0.52);
    colAttr.setXYZ(1, 0.58, 0.65, 0.52);
    colAttr.setXYZ(2, 0.98, 1.0, 0.94);
    colAttr.needsUpdate = true;
    parts.push(prepared);
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
      pos.setXYZ(i, x * disp, Math.max(-radius * 0.35, y * disp + radius * 0.25), z * disp);
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
  const height = 2.0 + variantIdx * 1.0 + rng() * 0.45;
  const stalkH = height * 0.74;
  const stalkR = 0.18 + variantIdx * 0.05;
  const capR = 0.85 + variantIdx * 0.32;
  const capH = height * 0.38;

  const parts: THREE.BufferGeometry[] = [];
  const stalk = new THREE.CylinderGeometry(stalkR * 0.72, stalkR * 1.15, stalkH, 6);
  stalk.translate(0, stalkH * 0.5, 0);
  parts.push(prepPart(stalk, 0.85, 0.84, 0.92, 0));

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
    case 'grass':
      return buildGrassVariant(variantIdx);
    case 'rock':
      return buildRockVariant(variantIdx);
    case 'mushroom':
      return buildMushroomVariant(variantIdx);
  }
}

function createFloraMaterial(options: {
  cacheKey: string;
  windAmplitude: number; // 0 for rocks, 0.04 for trees, 0.12 for grass
  doubleSide?: boolean;
  glowing?: boolean;
  uTime: { value: number };
  uWind: { value: number };
  uSunDir: { value: THREE.Vector3 };
}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    flatShading: true,
    roughness: options.glowing ? 0.65 : 0.9,
    metalness: 0.02,
    vertexColors: true,
    side: options.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    emissive: options.glowing ? new THREE.Color(0xffffff) : new THREE.Color(0x000000),
    emissiveIntensity: options.glowing ? 1.0 : 0,
  });

  mat.customProgramCacheKey = () => options.cacheKey;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = options.uTime;
    shader.uniforms.uWind = options.uWind;
    shader.uniforms.uSunDir = options.uSunDir;

    const extraVertDecl = [
      'attribute float aTint;',
      'attribute float aWindH;',
      'uniform float uTime;',
      'uniform float uWind;',
      options.glowing ? 'uniform vec3 uSunDir;' : '',
      options.glowing ? 'varying vec3 vFloraGlow;' : '',
    ]
      .filter(Boolean)
      .join('\n');

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <color_pars_vertex>',
        `${extraVertDecl}\n#include <color_pars_vertex>`,
      )
      .replace(
        '#include <begin_vertex>',
        options.windAmplitude > 0
          ? `#include <begin_vertex>
          #ifdef USE_INSTANCING
            float windPhase = uTime * 1.6 + instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.27;
            float sway = sin(windPhase) * uWind * ${options.windAmplitude.toFixed(3)} * aWindH * aWindH;
            transformed.x += sway;
            transformed.z += sway * 0.7;
          #endif`
          : '#include <begin_vertex>',
      )
      .replace(
        'vColor.rgb *= instanceColor.rgb;',
        options.glowing
          ? `vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, aTint);
          float mPhase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].y * 0.53 + instanceMatrix[3].z * 0.41;
          float mPulse = 1.1 + 0.3 * sin(uTime * 2.0944 + mPhase);
          vec3 mInstNormal = normalize(instanceMatrix[1].xyz);
          float mNight = 1.0 + 1.5 * (1.0 - smoothstep(-0.3, 0.2, dot(mInstNormal, uSunDir)));
          vFloraGlow = instanceColor.rgb * aTint * mPulse * mNight;`
          : 'vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, aTint);',
      );

    if (options.glowing) {
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vFloraGlow;`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          totalEmissiveRadiance *= vFloraGlow;`,
        );
    }
  };

  return mat;
}

/**
 * Deterministic Cube-Sphere procedural flora system with wind animation,
 * day/night pulsing glowing mushrooms, landing clearings, tree collision queries,
 * frame-budgeted streaming queue, and LRU cell cache.
 */
export class FloraManager {
  private readonly scene: THREE.Scene;
  private readonly isMobileOrSoftware: boolean;
  private castShadows: boolean;

  private readonly uTime = { value: 0 };
  private readonly uWind = { value: 1 };
  private readonly uSunDir = { value: new THREE.Vector3(0.58, 0.71, 0.4) };

  private readonly treeMat: THREE.MeshStandardMaterial;
  private readonly smallPlantMat: THREE.MeshStandardMaterial;
  private readonly rockMat: THREE.MeshStandardMaterial;
  private readonly grassMat: THREE.MeshStandardMaterial;
  private readonly mushroomMat: THREE.MeshStandardMaterial;

  // Flat list [speciesIdx * 3 + variantIdx]
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly meshCapacities: number[] = [];
  private readonly meshHeights: number[] = [];
  private readonly meshSpecies: SpeciesSpec[] = [];
  private readonly meshCounts = new Int32Array(
    SPECIES_LIST.length * VARIANTS_PER_SPECIES,
  );

  // Cube-sphere cell grid metadata
  private cachedPlanetRadius = -1;
  private gridN = 8;
  private cellCount = 0;
  private cellCenters = new Float32Array(0);
  private cellAngRadii = new Float32Array(0);

  // LRU cell instance cache & streaming state
  private readonly cellCache = new Map<number, Float32Array>();
  private readonly activeCellList: number[] = [];
  private readonly genQueue: number[] = [];
  private readonly queuedSet = new Set<number>();

  // Landing clearing state
  private clearingActive = false;
  private readonly clearingPos = new THREE.Vector3();
  private clearingRadiusSq = 0;

  private activeInstanceCount = 0;
  private needsRebuild = true;
  private wasVisible = false;
  private timeSinceRebuild = 99;
  private timeSinceFill = 99;
  private readonly lastRebuildShipPos = new THREE.Vector3(1e9, 1e9, 1e9);
  private lastDensityFactor = -1;
  private readonly tempInstances: number[] = [];

  constructor(
    scene: THREE.Scene,
    options: { castShadows: boolean; isMobileOrSoftware: boolean },
  ) {
    this.scene = scene;
    this.castShadows = options.castShadows;
    this.isMobileOrSoftware = options.isMobileOrSoftware;

    this.treeMat = createFloraMaterial({
      cacheKey: 'flora-tree',
      windAmplitude: 0.04,
      uTime: this.uTime,
      uWind: this.uWind,
      uSunDir: this.uSunDir,
    });
    this.smallPlantMat = createFloraMaterial({
      cacheKey: 'flora-small',
      windAmplitude: 0.07,
      uTime: this.uTime,
      uWind: this.uWind,
      uSunDir: this.uSunDir,
    });
    this.rockMat = createFloraMaterial({
      cacheKey: 'flora-rock',
      windAmplitude: 0,
      uTime: this.uTime,
      uWind: this.uWind,
      uSunDir: this.uSunDir,
    });
    this.grassMat = createFloraMaterial({
      cacheKey: 'flora-grass',
      windAmplitude: 0.12,
      doubleSide: true,
      uTime: this.uTime,
      uWind: this.uWind,
      uSunDir: this.uSunDir,
    });
    this.mushroomMat = createFloraMaterial({
      cacheKey: 'flora-mushroom',
      windAmplitude: 0.06,
      glowing: true,
      uTime: this.uTime,
      uWind: this.uWind,
      uSunDir: this.uSunDir,
    });

    for (let s = 0; s < SPECIES_LIST.length; s++) {
      const spec = SPECIES_LIST[s];
      const mat =
        spec.id === 'grass'
          ? this.grassMat
          : spec.id === 'mushroom'
            ? this.mushroomMat
            : spec.id === 'rock'
              ? this.rockMat
              : spec.category === 'tree'
                ? this.treeMat
                : this.smallPlantMat;

      const capacity =
        spec.category === 'tree'
          ? this.isMobileOrSoftware
            ? 1200
            : 2500
          : spec.category === 'small'
            ? this.isMobileOrSoftware
              ? 1500
              : 3000
            : this.isMobileOrSoftware
              ? 2500
              : 6000;

      for (let v = 0; v < VARIANTS_PER_SPECIES; v++) {
        const geo = buildSpeciesGeometry(spec.id, v);
        const height = Math.max(geo.boundingBox?.max.y ?? 1, 0.1);
        const mesh = new THREE.InstancedMesh(geo, mat, capacity);
        mesh.frustumCulled = false;
        mesh.castShadow = spec.category === 'tree' ? this.castShadows : false;
        mesh.receiveShadow = false;
        mesh.count = 0;
        mesh.visible = false;
        mesh.setColorAt(0, _instColor.setHex(0xffffff));

        this.scene.add(mesh);
        this.geometries.push(geo);
        this.meshes.push(mesh);
        this.meshCapacities.push(capacity);
        this.meshHeights.push(height);
        this.meshSpecies.push(spec);
      }
    }
  }

  public getActiveInstanceCount(): number {
    return this.activeInstanceCount;
  }

  public setClearing(position: THREE.Vector3 | null, radius = 8): void {
    if (position === null) {
      if (this.clearingActive) {
        this.clearingActive = false;
        this.clearingRadiusSq = 0;
        this.timeSinceFill = 99;
      }
      return;
    }
    this.clearingActive = true;
    this.clearingPos.copy(position);
    this.clearingRadiusSq = radius * radius;
    this.timeSinceFill = 99;
  }

  public setCastShadows(enabled: boolean): void {
    if (this.castShadows === enabled) return;
    this.castShadows = enabled;
    for (let i = 0; i < this.meshes.length; i++) {
      if (this.meshSpecies[i].category === 'tree') {
        this.meshes[i].castShadow = enabled;
      }
    }
  }

  public invalidate(): void {
    this.cellCache.clear();
    this.genQueue.length = 0;
    this.queuedSet.clear();
    this.activeCellList.length = 0;
    this.needsRebuild = true;
    this.timeSinceRebuild = 99;
    this.timeSinceFill = 99;
    this.hideAllMeshes();
  }

  private hideAllMeshes(): void {
    for (let i = 0; i < this.meshes.length; i++) {
      this.meshes[i].count = 0;
      this.meshes[i].visible = false;
    }
    this.activeInstanceCount = 0;
    this.wasVisible = false;
  }

  private ensureCellGrid(planetRadius: number): void {
    if (planetRadius === this.cachedPlanetRadius) return;
    this.cachedPlanetRadius = planetRadius;

    const n = Math.max(8, Math.round((planetRadius * (Math.PI * 0.5)) / 32));
    this.gridN = n;
    this.cellCount = 6 * n * n;
    this.cellCenters = new Float32Array(this.cellCount * 3);
    this.cellAngRadii = new Float32Array(this.cellCount);

    const step = 2 / n;
    let cellIdx = 0;

    for (let f = 0; f < CUBE_FACES.length; f++) {
      const face = CUBE_FACES[f];
      for (let j = 0; j < n; j++) {
        const v0 = -1 + j * step;
        const v1 = v0 + step;
        const vMid = v0 + step * 0.5;
        for (let i = 0; i < n; i++) {
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
          cellIdx++;
        }
      }
    }

    this.invalidate();
  }

  public queryTrees(pos: THREE.Vector3, out: TreeCollider[]): number {
    if (this.cellCount === 0 || this.cachedPlanetRadius <= 0) return 0;

    const lenSq = pos.lengthSq();
    if (lenSq < 0.0001) return 0;
    _queryDir.copy(pos).divideScalar(Math.sqrt(lenSq));

    // Only inspect nearby cells (~current cell + 8 neighbors, radius ~48 units)
    const maxAngle = 48 / Math.max(this.cachedPlanetRadius, 1);
    const centers = this.cellCenters;
    const angRadii = this.cellAngRadii;
    let count = 0;

    for (let c = 0; c < this.activeCellList.length; c++) {
      const cellIdx = this.activeCellList[c];
      const thresholdAngle = maxAngle + angRadii[cellIdx];
      if (thresholdAngle < Math.PI) {
        const dot =
          centers[cellIdx * 3] * _queryDir.x +
          centers[cellIdx * 3 + 1] * _queryDir.y +
          centers[cellIdx * 3 + 2] * _queryDir.z;
        if (dot <= Math.cos(thresholdAngle)) continue;
      }

      const data = this.cellCache.get(cellIdx);
      if (!data || data.length === 0) continue;

      for (let offset = 0; offset < data.length; offset += INSTANCE_STRIDE) {
        const spIdx = data[offset + 8];
        if (SPECIES_LIST[spIdx].category !== 'tree') continue;

        const px = data[offset];
        const py = data[offset + 1];
        const pz = data[offset + 2];

        if (this.clearingActive) {
          const cdx = px - this.clearingPos.x;
          const cdy = py - this.clearingPos.y;
          const cdz = pz - this.clearingPos.z;
          if (cdx * cdx + cdy * cdy + cdz * cdz < this.clearingRadiusSq) {
            continue;
          }
        }

        const varIdx = data[offset + 9];
        const scale = data[offset + 7];
        const height = this.meshHeights[spIdx * VARIANTS_PER_SPECIES + varIdx] * scale;

        if (count < out.length) {
          const item = out[count];
          item.x = px;
          item.y = py;
          item.z = pz;
          item.nx = data[offset + 3];
          item.ny = data[offset + 4];
          item.nz = data[offset + 5];
          item.height = height;
        } else {
          out.push({
            x: px,
            y: py,
            z: pz,
            nx: data[offset + 3],
            ny: data[offset + 4],
            nz: data[offset + 5],
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
    _altitude: number,
    planetManager: PlanetTerrainManager,
    planet: PlanetParams,
    flora: FloraParams,
    quality: {
      floraDensityRatio: number;
      floraViewRatio: number;
      qualityLevel: QualityLevel;
    },
    sunDir?: THREE.Vector3,
  ): void {
    this.ensureCellGrid(planet.planetRadius);

    this.uTime.value += dt;
    this.uWind.value = quality.qualityLevel >= 2 ? 0 : 1;
    if (sunDir) {
      this.uSunDir.value.copy(sunDir);
    }

    // Compute radial altitude relative to planet surface so moon flight never turns planet flora on
    const shipDist = shipPos.length();
    if (shipDist > 0.0001) {
      _shipDir.copy(shipPos).divideScalar(shipDist);
    } else {
      _shipDir.set(0, 1, 0);
    }
    const planetAltitude = shipDist - planet.planetRadius - planet.maxHeight * 0.5;

    if (!flora.enabled || flora.density <= 0 || planetAltitude >= 150) {
      if (this.wasVisible) {
        this.hideAllMeshes();
      }
      return;
    }

    const densityFactor =
      flora.density *
      quality.floraDensityRatio *
      (this.isMobileOrSoftware ? 0.6 : 1.0);
    if (Math.abs(densityFactor - this.lastDensityFactor) > 0.02) {
      this.lastDensityFactor = densityFactor;
      this.invalidate();
    }

    this.timeSinceRebuild += dt;
    this.timeSinceFill += dt;

    const movedDistSq = this.lastRebuildShipPos.distanceToSquared(shipPos);
    const shouldRebuildCells =
      this.needsRebuild ||
      !this.wasVisible ||
      (movedDistSq > 625 && this.timeSinceRebuild >= 0.4);

    if (shouldRebuildCells) {
      this.rebuildActiveCellList(
        shipPos,
        planet.planetRadius,
        quality.floraViewRatio,
      );
      this.needsRebuild = false;
      this.timeSinceRebuild = 0;
      this.lastRebuildShipPos.copy(shipPos);

      if (this.genQueue.length === 0) {
        this.fillInstancedMeshes(shipPos, quality.floraViewRatio);
        this.timeSinceFill = 0;
      }
    }

    let queueEmptied = false;
    if (this.genQueue.length > 0) {
      const budget = Math.min(MAX_CELLS_PER_FRAME, this.genQueue.length);
      for (let g = 0; g < budget; g++) {
        const cellIdx = this.genQueue.pop();
        if (cellIdx === undefined) break;
        this.queuedSet.delete(cellIdx);
        if (!this.cellCache.has(cellIdx)) {
          const data = this.generateCellInstances(
            cellIdx,
            planetManager,
            planet,
            densityFactor,
          );
          this.setCachedCell(cellIdx, data);
        }
      }
      if (this.genQueue.length === 0) {
        queueEmptied = true;
      }
    }

    if (queueEmptied || this.timeSinceFill >= 0.3 || !this.wasVisible) {
      this.fillInstancedMeshes(shipPos, quality.floraViewRatio);
      this.timeSinceFill = 0;
    }

    this.wasVisible = true;
  }

  private rebuildActiveCellList(
    shipPos: THREE.Vector3,
    planetRadius: number,
    viewRatio: number,
  ): void {
    this.activeCellList.length = 0;
    this.genQueue.length = 0;
    this.queuedSet.clear();

    const maxRange = 230 * viewRatio;
    const baseAngle = maxRange / Math.max(planetRadius, 1);

    for (let idx = 0; idx < this.cellCount; idx++) {
      const maxAng = baseAngle + this.cellAngRadii[idx];
      let visible = false;
      if (maxAng >= Math.PI) {
        visible = true;
      } else {
        const cx = this.cellCenters[idx * 3];
        const cy = this.cellCenters[idx * 3 + 1];
        const cz = this.cellCenters[idx * 3 + 2];
        const dot =
          cx * _shipDir.x + cy * _shipDir.y + cz * _shipDir.z;
        if (dot > Math.cos(maxAng)) {
          visible = true;
        }
      }

      if (visible) {
        this.activeCellList.push(idx);
        if (!this.cellCache.has(idx)) {
          this.genQueue.push(idx);
          this.queuedSet.add(idx);
        }
      }
    }

    if (this.genQueue.length > 1) {
      const sx = _shipDir.x;
      const sy = _shipDir.y;
      const sz = _shipDir.z;
      const centers = this.cellCenters;
      this.genQueue.sort((a, b) => {
        const da =
          centers[a * 3] * sx +
          centers[a * 3 + 1] * sy +
          centers[a * 3 + 2] * sz;
        const db =
          centers[b * 3] * sx +
          centers[b * 3 + 1] * sy +
          centers[b * 3 + 2] * sz;
        return da - db;
      });
    }

    void shipPos;
  }

  private setCachedCell(cellIdx: number, data: Float32Array): void {
    if (this.cellCache.has(cellIdx)) {
      this.cellCache.delete(cellIdx);
    }
    this.cellCache.set(cellIdx, data);
    while (this.cellCache.size > CELL_CACHE_LIMIT) {
      const oldest = this.cellCache.keys().next().value;
      if (oldest === undefined) break;
      this.cellCache.delete(oldest);
    }
  }

  private generateCellInstances(
    cellIdx: number,
    planetManager: PlanetTerrainManager,
    planet: PlanetParams,
    densityFactor: number,
  ): Float32Array {
    const n = this.gridN;
    const perFace = n * n;
    const faceIdx = Math.floor(cellIdx / perFace);
    const rem = cellIdx - faceIdx * perFace;
    const j = Math.floor(rem / n);
    const i = rem - j * n;

    const face = CUBE_FACES[faceIdx];
    const step = 2 / n;
    const uStart = -1 + i * step;
    const vStart = -1 + j * step;

    const cellSeed = hashCell(faceIdx, i, j, SEED_FIXA);
    const rngLarge = mulberry32(cellSeed ^ 0x13579bdf);
    const rngGrass = mulberry32(cellSeed ^ 0x2468ace1);

    const safeMaxH = Math.max(planet.maxHeight, 0.001);
    const out = this.tempInstances;
    out.length = 0;

    // Pass 1: Large flora
    const largeCandidates = Math.round(14 * MAX_BIOME_DENSITY * densityFactor);
    const largeCols = Math.max(1, Math.ceil(Math.sqrt(largeCandidates)));
    const largeRows = Math.max(1, Math.ceil(largeCandidates / largeCols));

    for (let k = 0; k < largeCandidates; k++) {
      const gx = k % largeCols;
      const gy = Math.floor(k / largeCols);
      const u = uStart + ((gx + rngLarge()) / largeCols) * step;
      const v = vStart + ((gy + rngLarge()) / largeRows) * step;

      const { nx, ny, nz } = spherifyCubePoint(
        face.normal[0] + u * face.uAxis[0] + v * face.vAxis[0],
        face.normal[1] + u * face.uAxis[1] + v * face.vAxis[1],
        face.normal[2] + u * face.uAxis[2] + v * face.vAxis[2],
      );
      _candDir.set(nx, ny, nz).normalize();

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
      if (biome === 'ocean' || biome === 'ice') continue;

      const profile = BIOME_FLORA_TABLE[biome];
      if (profile.density <= 0 || profile.entries.length === 0) continue;
      if (rngLarge() > profile.density / MAX_BIOME_DENSITY) continue;

      planetManager.getSurfaceNormalAt(
        _candDir.x,
        _candDir.y,
        _candDir.z,
        _candNormal,
      );
      if (_candNormal.dot(_candDir) < COS_32_DEG) continue;

      let eligibleCount = 0;
      let totalWeight = 0;
      for (let e = 0; e < profile.entries.length; e++) {
        const entry = profile.entries[e];
        if (entry.minT !== undefined && _biomeSample.T <= entry.minT) continue;
        if (entry.maxRawNorm !== undefined && rawNorm >= entry.maxRawNorm) continue;

        const spIdx = SPECIES_INDEX[entry.species];
        const spec = SPECIES_LIST[spIdx];
        if (
          rawNorm <= planet.seaLevel + spec.minAboveSea ||
          rawNorm >= spec.maxRawNorm
        ) {
          continue;
        }
        _eligibleIndices[eligibleCount] = spIdx;
        _eligibleWeights[eligibleCount] = entry.weight;
        totalWeight += entry.weight;
        eligibleCount++;
      }

      if (eligibleCount === 0 || totalWeight <= 0) continue;

      let pick = rngLarge() * totalWeight;
      let chosenSpIdx = _eligibleIndices[0];
      for (let e = 0; e < eligibleCount; e++) {
        pick -= _eligibleWeights[e];
        if (pick <= 0) {
          chosenSpIdx = _eligibleIndices[e];
          break;
        }
      }

      const chosenId = SPECIES_LIST[chosenSpIdx].id;
      const variantIdx = Math.floor(rngLarge() * VARIANTS_PER_SPECIES);
      const scale = 0.85 + rngLarge() * 0.32;
      const yaw = rngLarge() * Math.PI * 2;
      const surfH = getPlanetSurfaceHeight(
        _candDir.x,
        _candDir.y,
        _candDir.z,
        planet.planetRadius,
        planet.noiseScale,
        planet.maxHeight,
        planet.seaLevel,
      );
      const r = planet.planetRadius + surfH - 0.15 * scale;

      if (chosenId === 'mushroom') {
        _baseTintColor.setHex(
          biome === 'grassland'
            ? rngLarge() < 0.5
              ? 0xf472b6
              : 0x38bdf8
            : rngLarge() < 0.5
              ? 0x22d3ee
              : 0xe879f9,
        );
      } else {
        _baseTintColor.setHex(profile.foliageHex);
      }
      const lum = 0.9 + rngLarge() * 0.2;
      _baseTintColor.multiplyScalar(lum);

      out.push(
        _candDir.x * r,
        _candDir.y * r,
        _candDir.z * r,
        _candNormal.x,
        _candNormal.y,
        _candNormal.z,
        yaw,
        scale,
        chosenSpIdx,
        variantIdx,
        _baseTintColor.r,
        _baseTintColor.g,
        _baseTintColor.b,
      );
    }

    // Pass 2: Cover pass (grass)
    const grassCandidates = Math.round(70 * densityFactor);
    const grassCols = Math.max(1, Math.ceil(Math.sqrt(grassCandidates)));
    const grassRows = Math.max(1, Math.ceil(grassCandidates / grassCols));
    const grassSpec = SPECIES_LIST[SPECIES_INDEX.grass];
    const grassSpIdx = SPECIES_INDEX.grass;

    for (let k = 0; k < grassCandidates; k++) {
      const gx = k % grassCols;
      const gy = Math.floor(k / grassCols);
      const u = uStart + ((gx + rngGrass()) / grassCols) * step;
      const v = vStart + ((gy + rngGrass()) / grassRows) * step;

      const { nx, ny, nz } = spherifyCubePoint(
        face.normal[0] + u * face.uAxis[0] + v * face.vAxis[0],
        face.normal[1] + u * face.uAxis[1] + v * face.vAxis[1],
        face.normal[2] + u * face.uAxis[2] + v * face.vAxis[2],
      );
      _candDir.set(nx, ny, nz).normalize();

      const rawH = getPlanetTerrainHeight(
        _candDir.x,
        _candDir.y,
        _candDir.z,
        planet.planetRadius,
        planet.noiseScale,
        planet.maxHeight,
      );
      const rawNorm = THREE.MathUtils.clamp(rawH / safeMaxH, -1, 1);
      if (
        rawNorm <= planet.seaLevel + grassSpec.minAboveSea ||
        rawNorm >= grassSpec.maxRawNorm
      ) {
        continue;
      }

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
      if (profile.grassWeight <= 0) continue;
      if (rngGrass() > Math.min(1, profile.density)) continue;

      planetManager.getSurfaceNormalAt(
        _candDir.x,
        _candDir.y,
        _candDir.z,
        _candNormal,
      );
      if (_candNormal.dot(_candDir) < COS_32_DEG) continue;

      const variantIdx = Math.floor(rngGrass() * VARIANTS_PER_SPECIES);
      const scale = 0.85 + rngGrass() * 0.3;
      const yaw = rngGrass() * Math.PI * 2;
      const surfH = getPlanetSurfaceHeight(
        _candDir.x,
        _candDir.y,
        _candDir.z,
        planet.planetRadius,
        planet.noiseScale,
        planet.maxHeight,
        planet.seaLevel,
      );
      const r = planet.planetRadius + surfH - 0.15 * scale;

      _baseTintColor.setHex(profile.foliageHex);
      const lum = 0.9 + rngGrass() * 0.2;
      _baseTintColor.multiplyScalar(lum);

      out.push(
        _candDir.x * r,
        _candDir.y * r,
        _candDir.z * r,
        _candNormal.x,
        _candNormal.y,
        _candNormal.z,
        yaw,
        scale,
        grassSpIdx,
        variantIdx,
        _baseTintColor.r,
        _baseTintColor.g,
        _baseTintColor.b,
      );
    }

    return new Float32Array(out);
  }

  private fillInstancedMeshes(
    shipPos: THREE.Vector3,
    viewRatio: number,
  ): void {
    this.meshCounts.fill(0);

    for (let c = 0; c < this.activeCellList.length; c++) {
      const cellIdx = this.activeCellList[c];
      const data = this.cellCache.get(cellIdx);
      if (!data || data.length === 0) continue;

      this.cellCache.delete(cellIdx);
      this.cellCache.set(cellIdx, data);

      for (let offset = 0; offset < data.length; offset += INSTANCE_STRIDE) {
        const px = data[offset];
        const py = data[offset + 1];
        const pz = data[offset + 2];

        if (this.clearingActive) {
          const cdx = px - this.clearingPos.x;
          const cdy = py - this.clearingPos.y;
          const cdz = pz - this.clearingPos.z;
          if (cdx * cdx + cdy * cdy + cdz * cdz < this.clearingRadiusSq) {
            continue;
          }
        }

        const dx = px - shipPos.x;
        const dy = py - shipPos.y;
        const dz = pz - shipPos.z;
        const distSq = dx * dx + dy * dy + dz * dz;

        const spIdx = data[offset + 8];
        const varIdx = data[offset + 9];
        const meshIdx = spIdx * VARIANTS_PER_SPECIES + varIdx;

        const count = this.meshCounts[meshIdx];
        if (count >= this.meshCapacities[meshIdx]) continue;

        const maxDist = SPECIES_LIST[spIdx].maxDist * viewRatio;
        if (distSq >= maxDist * maxDist) continue;

        const dist = Math.sqrt(distSq);
        const fade = smoothstep(maxDist, maxDist * 0.85, dist);
        if (fade <= 0.02) continue;

        const scale = data[offset + 7] * fade;
        _instPos.set(px, py, pz);
        _instNormal.set(data[offset + 3], data[offset + 4], data[offset + 5]);
        _alignQuat.setFromUnitVectors(_unitY, _instNormal);
        _yawQuat.setFromAxisAngle(_unitY, data[offset + 6]);
        _instQuat.copy(_alignQuat).multiply(_yawQuat);
        _instScale.setScalar(scale);

        _instMatrix.compose(_instPos, _instQuat, _instScale);
        const mesh = this.meshes[meshIdx];
        mesh.setMatrixAt(count, _instMatrix);

        _instColor.setRGB(
          data[offset + 10],
          data[offset + 11],
          data[offset + 12],
        );
        mesh.setColorAt(count, _instColor);

        this.meshCounts[meshIdx] = count + 1;
      }
    }

    let totalActive = 0;
    for (let i = 0; i < this.meshes.length; i++) {
      const mesh = this.meshes[i];
      const count = this.meshCounts[i];
      mesh.count = count;
      mesh.visible = count > 0;
      totalActive += count;
      if (count > 0) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) {
          mesh.instanceColor.needsUpdate = true;
        }
      }
    }
    this.activeInstanceCount = totalActive;
  }

  public dispose(): void {
    this.cellCache.clear();
    this.genQueue.length = 0;
    this.queuedSet.clear();
    this.activeCellList.length = 0;

    for (let i = 0; i < this.meshes.length; i++) {
      this.scene.remove(this.meshes[i]);
      this.meshes[i].dispose();
    }
    this.meshes.length = 0;

    for (let i = 0; i < this.geometries.length; i++) {
      this.geometries[i].dispose();
    }
    this.geometries.length = 0;

    this.treeMat.dispose();
    this.smallPlantMat.dispose();
    this.rockMat.dispose();
    this.grassMat.dispose();
    this.mushroomMat.dispose();
  }
}
