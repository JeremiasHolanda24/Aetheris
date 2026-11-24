// Fixed-seed mulberry32 PRNG and precomputed 3D Simplex permutation tables (Zero GC per call)
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PERM = new Uint8Array(512);
const PERM_MOD12 = new Uint8Array(512);

// 12 edge-center gradients of a cube (3 components each)
const GRAD3 = new Int8Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

(() => {
  const rng = mulberry32(0x5a3e71d3);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) {
    const v = p[i & 255];
    PERM[i] = v;
    PERM_MOD12[i] = v % 12;
  }
})();

const F3 = 1 / 3;
const G3 = 1 / 6;
const REF_PLANET_RADIUS = 180;

function simplex3(xin: number, yin: number, zin: number): number {
  const s = (xin + yin + zin) * F3;
  const i = Math.floor(xin + s);
  const j = Math.floor(yin + s);
  const k = Math.floor(zin + s);
  const t = (i + j + k) * G3;

  const x0 = xin - (i - t);
  const y0 = yin - (j - t);
  const z0 = zin - (k - t);

  let i1: number, j1: number, k1: number;
  let i2: number, j2: number, k2: number;

  if (x0 >= y0) {
    if (y0 >= z0) {
      i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
    } else if (x0 >= z0) {
      i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1;
    } else {
      i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1;
    }
  } else {
    if (y0 < z0) {
      i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1;
    } else if (x0 < z0) {
      i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1;
    } else {
      i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
    }
  }

  const x1 = x0 - i1 + G3;
  const y1 = y0 - j1 + G3;
  const z1 = z0 - k1 + G3;
  const x2 = x0 - i2 + 2 * G3;
  const y2 = y0 - j2 + 2 * G3;
  const z2 = z0 - k2 + 2 * G3;
  const x3 = x0 - 1 + 3 * G3;
  const y3 = y0 - 1 + 3 * G3;
  const z3 = z0 - 1 + 3 * G3;

  const ii = i & 255;
  const jj = j & 255;
  const kk = k & 255;

  let n0 = 0;
  let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
  if (t0 >= 0) {
    const g0 = PERM_MOD12[ii + PERM[jj + PERM[kk]]] * 3;
    t0 *= t0;
    n0 = t0 * t0 * (GRAD3[g0] * x0 + GRAD3[g0 + 1] * y0 + GRAD3[g0 + 2] * z0);
  }

  let n1 = 0;
  let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
  if (t1 >= 0) {
    const g1 = PERM_MOD12[ii + i1 + PERM[jj + j1 + PERM[kk + k1]]] * 3;
    t1 *= t1;
    n1 = t1 * t1 * (GRAD3[g1] * x1 + GRAD3[g1 + 1] * y1 + GRAD3[g1 + 2] * z1);
  }

  let n2 = 0;
  let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
  if (t2 >= 0) {
    const g2 = PERM_MOD12[ii + i2 + PERM[jj + j2 + PERM[kk + k2]]] * 3;
    t2 *= t2;
    n2 = t2 * t2 * (GRAD3[g2] * x2 + GRAD3[g2 + 1] * y2 + GRAD3[g2 + 2] * z2);
  }

  let n3 = 0;
  let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
  if (t3 >= 0) {
    const g3 = PERM_MOD12[ii + 1 + PERM[jj + 1 + PERM[kk + 1]]] * 3;
    t3 *= t3;
    n3 = t3 * t3 * (GRAD3[g3] * x3 + GRAD3[g3 + 1] * y3 + GRAD3[g3 + 2] * z3);
  }

  return 32 * (n0 + n1 + n2 + n3);
}

/**
 * Seamless 3D procedural heightfield on a unit sphere normal (nx, ny, nz).
 * Uses continuous 3D simplex fBm + continent-masked ridged mountains so
 * cube-sphere edges have zero seams and terrain shape is invariant to planetRadius.
 */
export function getPlanetTerrainHeight(
  nx: number,
  ny: number,
  nz: number,
  _planetRadius: number,
  noiseScale: number,
  maxHeight: number,
): number {
  const freq = noiseScale * REF_PLANET_RADIUS;
  const sx = nx * freq;
  const sy = ny * freq;
  const sz = nz * freq;

  // 4-octave base fBm (lacunarity = 2, gain = 0.45)
  let baseSum = 0;
  let ridgedSum = 0;
  let amp = 1;
  let maxAmp = 0;
  let f = 1;

  for (let o = 0; o < 4; o++) {
    baseSum += simplex3(sx * f, sy * f, sz * f) * amp;
    const rn = simplex3((sx + 31.4) * f, (sy - 19.2) * f, (sz + 23.8) * f);
    const ridge = 1 - Math.abs(rn);
    ridgedSum += ridge * ridge * amp;
    maxAmp += amp;
    amp *= 0.45;
    f *= 2;
  }

  const baseNorm = baseSum / maxAmp;
  const ridgedNorm = ridgedSum / maxAmp;

  // Low-frequency continental mask in [0, 1] separating smooth plains from mountain chains
  const contRaw = simplex3(sx * 0.36 + 13.7, sy * 0.36 - 5.2, sz * 0.36 + 9.1);
  const contT = Math.max(0, Math.min(1, (contRaw + 0.32) / 0.75));
  const continentMask = contT * contT * (3 - 2 * contT);

  // Combine ~0.6 base fBm with ~0.4 continent-masked ridged mountains, normalized to [-1, +1]
  const baseScaled = baseNorm * 2.15;
  const ridgedSigned = (ridgedNorm * 2.4 - 0.95) * continentMask;
  const normalized = Math.max(
    -1,
    Math.min(1, baseScaled * 0.6 + ridgedSigned * 0.4),
  );

  return normalized * maxHeight;
}

/**
 * Analytical cube-to-sphere projection for uniform triangle distribution across all 6 faces.
 */
export function spherifyCubePoint(
  x: number,
  y: number,
  z: number,
): { nx: number; ny: number; nz: number } {
  const x2 = x * x;
  const y2 = y * y;
  const z2 = z * z;
  const nx = x * Math.sqrt(Math.max(0, 1 - y2 * 0.5 - z2 * 0.5 + (y2 * z2) / 3));
  const ny = y * Math.sqrt(Math.max(0, 1 - z2 * 0.5 - x2 * 0.5 + (z2 * x2) / 3));
  const nz = z * Math.sqrt(Math.max(0, 1 - x2 * 0.5 - y2 * 0.5 + (x2 * y2) / 3));
  return { nx, ny, nz };
}
