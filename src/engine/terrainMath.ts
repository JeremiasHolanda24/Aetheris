/**
 * Seamless 3D procedural heightfield on a unit sphere normal (nx, ny, nz).
 * Uses continuous 3D coordinates so cube-sphere edges have zero seams.
 */
export function getPlanetTerrainHeight(
  nx: number,
  ny: number,
  nz: number,
  planetRadius: number,
  noiseScale: number,
  maxHeight: number,
): number {
  const sx = nx * planetRadius * noiseScale;
  const sy = ny * planetRadius * noiseScale;
  const sz = nz * planetRadius * noiseScale;

  const o1 = Math.sin(sx) * Math.cos(sz) * Math.cos(sy * 0.9 + 0.4);
  const o2 =
    Math.sin(sx * 2.7 + 1.3) *
    Math.cos(sz * 2.7 + 0.7) *
    Math.sin(sy * 2.5 + 1.1);
  const o3 =
    Math.sin(sx * 6.1 + 4.1) *
    Math.cos(sz * 6.1 + 2.3) *
    Math.cos(sy * 5.8 + 0.9);

  return (o1 * 0.55 + o2 * 0.3 + o3 * 0.15) * maxHeight;
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
