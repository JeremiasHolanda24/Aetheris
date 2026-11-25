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
): THREE.Color {
  const sample = outSample ?? _biomeSample;
  sampleBiome(nx, ny, nz, rawHeightNorm, seaLevel, sample);
  const temperature = sample.T;
  const moisture = sample.M;

  if (rawHeightNorm <= seaLevel) {
    const depthNorm = THREE.MathUtils.clamp(
      (seaLevel - rawHeightNorm) / 0.5,
      0,
      1,
    );
    out.lerpColors(COLOR_OCEAN_SHALLOW, COLOR_OCEAN_DEEP, depthNorm);

    if (temperature < 0.15) {
      const seaIceT = smoothstep(0.15, 0.04, temperature);
      out.lerp(COLOR_POLAR_SEA_ICE, seaIceT);
    }
  } else {
    // Bilinear climate blend in (temperature, moisture)
    _coldRow.lerpColors(COLOR_TUNDRA, COLOR_TAIGA, moisture);
    _hotRow.lerpColors(COLOR_DESERT, COLOR_JUNGLE, moisture);
    _landColor.lerpColors(_coldRow, _hotRow, temperature);

    // Mid-climate pull toward temperate grassland (T and M between 0.35 and 0.65)
    const tCenter =
      smoothstep(0.32, 0.45, temperature) *
      (1 - smoothstep(0.55, 0.68, temperature));
    const mCenter =
      smoothstep(0.32, 0.45, moisture) *
      (1 - smoothstep(0.55, 0.68, moisture));
    const grassWeight = tCenter * mCenter;
    if (grassWeight > 0) {
      _landColor.lerp(COLOR_GRASSLAND, grassWeight * 0.9);
    }

    // Coastal beach band between seaLevel and seaLevel + 0.05
    const beachFactor =
      1 - smoothstep(seaLevel + 0.01, seaLevel + 0.05, rawHeightNorm);
    out.copy(_landColor).lerp(COLOR_BEACH, beachFactor);

    // High-altitude rocky mountains
    const rockT = smoothstep(0.45, 0.7, rawHeightNorm);
    if (rockT > 0) {
      out.lerp(COLOR_ROCK, rockT);
    }

    // Elevation snow line (lower snow line in colder climates)
    const snowLine = THREE.MathUtils.lerp(0.55, 0.95, temperature);
    const snowT = smoothstep(snowLine - 0.06, snowLine + 0.06, rawHeightNorm);
    if (snowT > 0) {
      out.lerp(COLOR_SNOW, snowT);
    }

    // Polar ice cap
    if (temperature < 0.15) {
      const polarIceT = smoothstep(0.15, 0.04, temperature);
      out.lerp(COLOR_POLAR_ICE, polarIceT);
    }
  }

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
