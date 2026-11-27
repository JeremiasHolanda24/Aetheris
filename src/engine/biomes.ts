import * as THREE from 'three';
import { simplex3 } from './terrainMath';

export type BiomeId =
  | 'ocean'
  | 'beach'
  | 'desert'
  | 'grassland'
  | 'forest'
  | 'tundra'
  | 'taiga'
  | 'mountain'
  | 'ice';

export interface BiomeSample {
  biome: BiomeId;
  T: number;
  M: number;
}

// Editable biome color table
const COLOR_OCEAN_DEEP = new THREE.Color(0x0b2a6b);
const COLOR_OCEAN_SHALLOW = new THREE.Color(0x2aa6b8);
const COLOR_BEACH = new THREE.Color(0xe2d3a0);
const COLOR_TUNDRA = new THREE.Color(0x8a8f7a);
const COLOR_TAIGA = new THREE.Color(0x2f5d3a);
const COLOR_DESERT = new THREE.Color(0xd9b26f);
const COLOR_JUNGLE = new THREE.Color(0x1f7a3a);
const COLOR_GRASSLAND = new THREE.Color(0x7fae4a);
const COLOR_ROCK = new THREE.Color(0x6b6560);
const COLOR_SNOW = new THREE.Color(0xf4f7fb);
const COLOR_POLAR_ICE = new THREE.Color(0xe8f1fb);
const COLOR_POLAR_SEA_ICE = new THREE.Color(0xdbeafe);

// Pre-allocated scratch helpers (Zero GC per vertex/telemetry call)
const _coldRow = new THREE.Color();
const _hotRow = new THREE.Color();
const _landColor = new THREE.Color();
const _oceanColor = new THREE.Color();
const _biomeSample: BiomeSample = { biome: 'ocean', T: 0.5, M: 0.5 };

const BIOME_NAMES: Record<BiomeId, string> = {
  ocean: 'Oceano',
  beach: 'Praia',
  desert: 'Deserto',
  grassland: 'Pradaria',
  forest: 'Floresta/Selva',
  tundra: 'Tundra',
  taiga: 'Taiga',
  mountain: 'Montanha',
  ice: 'Neve/Gelo',
};

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function computeTemperature(
  nx: number,
  ny: number,
  nz: number,
  rawHeightNorm: number,
): number {
  const base = 1 - Math.pow(Math.abs(ny), 1.4);
  const variation = simplex3(nx * 2.5 + 31, ny * 2.5, nz * 2.5) * 0.12;
  const elevationCool = Math.max(0, rawHeightNorm) * 0.35;
  return THREE.MathUtils.clamp(base + variation - elevationCool, 0, 1);
}

function computeMoisture(nx: number, ny: number, nz: number): number {
  const oct1 = simplex3(nx * 3 + 73.1, ny * 3 - 41.7, nz * 3 + 19.3);
  const oct2 = simplex3(nx * 6 + 73.1, ny * 6 - 41.7, nz * 6 + 19.3) * 0.5;
  const combined = (oct1 + oct2) / 1.5;
  return THREE.MathUtils.clamp(combined * 0.65 + 0.5, 0, 1);
}

/**
 * Pure, zero-allocation biome classifier filling temperature `T`, moisture `M`, and `biome`.
 * `rawHeightNorm` is unclipped `h / maxHeight` in [-1, 1].
 */
export function sampleBiome(
  nx: number,
  ny: number,
  nz: number,
  rawHeightNorm: number,
  seaLevel: number,
  out: BiomeSample,
): BiomeSample {
  const temperature = computeTemperature(nx, ny, nz, rawHeightNorm);
  const moisture = computeMoisture(nx, ny, nz);
  out.T = temperature;
  out.M = moisture;

  if (temperature < 0.15) {
    out.biome = 'ice';
  } else if (rawHeightNorm <= seaLevel) {
    out.biome = 'ocean';
  } else if (rawHeightNorm < seaLevel + 0.05) {
    out.biome = 'beach';
  } else if (rawHeightNorm >= THREE.MathUtils.lerp(0.55, 0.95, temperature)) {
    out.biome = 'ice';
  } else if (rawHeightNorm >= 0.5) {
    out.biome = 'mountain';
  } else if (
    temperature >= 0.35 &&
    temperature <= 0.65 &&
    moisture >= 0.35 &&
    moisture <= 0.65
  ) {
    out.biome = 'grassland';
  } else if (temperature < 0.5) {
    out.biome = moisture < 0.5 ? 'tundra' : 'taiga';
  } else {
    out.biome = moisture < 0.5 ? 'desert' : 'forest';
  }

  return out;
}

/**
 * Pure, zero-allocation biome color lookup for a unit sphere direction (nx, ny, nz).
 * Uses generous smoothstep transitions across coastline, climate biomes, rock, and snow/ice
 * with zero hard step cuts.
 * `rawHeightNorm` is unclipped `h / maxHeight` in [-1, 1].
 */
export function getBiomeColor(
  nx: number,
  ny: number,
  nz: number,
  rawHeightNorm: number,
  seaLevel: number,
  out: THREE.Color,
  outSample?: BiomeSample,
  includeSnowAndIce = true,
): THREE.Color {
  const sample = outSample ?? _biomeSample;
  sampleBiome(nx, ny, nz, rawHeightNorm, seaLevel, sample);
  const temperature = sample.T;
  const moisture = sample.M;

  // Continuous ocean gradient + smooth polar sea ice blend
  const depthNorm = smoothstep(seaLevel + 0.03, seaLevel - 0.52, rawHeightNorm);
  _oceanColor.lerpColors(COLOR_OCEAN_SHALLOW, COLOR_OCEAN_DEEP, depthNorm);
  const polarIceT = smoothstep(0.26, 0.03, temperature);
  if (includeSnowAndIce && polarIceT > 0) {
    _oceanColor.lerp(COLOR_POLAR_SEA_ICE, polarIceT);
  }

  // Continuous bilinear climate blend in (temperature, moisture)
  _coldRow.lerpColors(COLOR_TUNDRA, COLOR_TAIGA, moisture);
  _hotRow.lerpColors(COLOR_DESERT, COLOR_JUNGLE, moisture);
  _landColor.lerpColors(_coldRow, _hotRow, temperature);

  // Wide temperate grassland pull
  const tCenter =
    smoothstep(0.24, 0.44, temperature) *
    (1 - smoothstep(0.56, 0.76, temperature));
  const mCenter =
    smoothstep(0.24, 0.44, moisture) *
    (1 - smoothstep(0.56, 0.76, moisture));
  const grassWeight = tCenter * mCenter;
  if (grassWeight > 0) {
    _landColor.lerp(COLOR_GRASSLAND, grassWeight * 0.9);
  }

  // Generous coastal beach blend (no abrupt cutoff at seaLevel)
  const beachFactor =
    1 - smoothstep(seaLevel - 0.025, seaLevel + 0.14, rawHeightNorm);
  if (beachFactor > 0) {
    _landColor.lerp(COLOR_BEACH, beachFactor);
  }

  // High-altitude rocky mountains
  const rockT = smoothstep(0.36, 0.72, rawHeightNorm);
  if (rockT > 0) {
    _landColor.lerp(COLOR_ROCK, rockT);
  }

  if (includeSnowAndIce) {
    // Generous elevation snow line (lower in colder climates)
    const snowLine = THREE.MathUtils.lerp(0.48, 0.90, temperature);
    const snowT = smoothstep(snowLine - 0.16, snowLine + 0.18, rawHeightNorm);
    if (snowT > 0) {
      _landColor.lerp(COLOR_SNOW, snowT);
    }

    // Smooth polar ice cap
    if (polarIceT > 0) {
      _landColor.lerp(COLOR_POLAR_ICE, polarIceT);
    }
  }

  // Smooth coastline blend between ocean and land
  const coastT = smoothstep(seaLevel - 0.035, seaLevel + 0.035, rawHeightNorm);
  out.lerpColors(_oceanColor, _landColor, coastT);

  // Fine-scale internal micro-variation so surfaces never look flat
  const micro = 1 + simplex3(nx * 40, ny * 40, nz * 40) * 0.06;
  out.multiplyScalar(micro);
  return out;
}

/**
 * Pure, zero-allocation Portuguese biome name matching `getBiomeColor`.
 */
export function getBiomeName(
  nx: number,
  ny: number,
  nz: number,
  rawHeightNorm: number,
  seaLevel: number,
): string {
  sampleBiome(nx, ny, nz, rawHeightNorm, seaLevel, _biomeSample);
  return BIOME_NAMES[_biomeSample.biome];
}

/**
 * Continuous [0, 1] procedural grass coverage mask from temperature T, moisture M,
 * normalized height, and seaLevel.
 */
export function getGrassCoverage(
  T: number,
  M: number,
  rawHeightNorm: number,
  seaLevel: number,
): number {
  const landMask = smoothstep(seaLevel + 0.04, seaLevel + 0.12, rawHeightNorm);
  return (
    landMask *
    smoothstep(0.3, 0.55, M) *
    smoothstep(0.12, 0.3, T) *
    (1 - smoothstep(0.45, 0.7, rawHeightNorm))
  );
}
