import * as THREE from 'three';
import { PlanetParams } from '../types/simulation';
import { BiomeSample, getBiomeColor, getGrassCoverage } from './biomes';
import {
  getPlanetSurfaceHeight,
  getPlanetTerrainHeight,
  spherifyCubePoint,
} from './terrainMath';

export interface CubeFaceBasis {
  normal: [number, number, number];
  uAxis: [number, number, number];
  vAxis: [number, number, number];
}

// All 6 faces satisfy cross(uAxis, vAxis) === normal for consistent outward FrontSide winding
export const CUBE_FACES: CubeFaceBasis[] = [
  { normal: [0, 1, 0], uAxis: [1, 0, 0], vAxis: [0, 0, -1] },  // +Y
  { normal: [0, -1, 0], uAxis: [1, 0, 0], vAxis: [0, 0, 1] },  // -Y
  { normal: [1, 0, 0], uAxis: [0, 0, -1], vAxis: [0, 1, 0] },  // +X
  { normal: [-1, 0, 0], uAxis: [0, 0, 1], vAxis: [0, 1, 0] },  // -X
  { normal: [0, 0, 1], uAxis: [1, 0, 0], vAxis: [0, 1, 0] },   // +Z
  { normal: [0, 0, -1], uAxis: [-1, 0, 0], vAxis: [0, 1, 0] }, // -Z
];

const PATCH_SUBDIV = 4;
const PATCH_SEGMENTS = 20;
const PATCH_VC = (PATCH_SEGMENTS + 1) * (PATCH_SEGMENTS + 1);
const ORBITAL_SEGMENTS = 32;
const MOON_RADIUS_RATIO = 0.145;
const _patchRGrid = new Float32Array(PATCH_VC);
const _patchNGrid = new Float32Array(PATCH_VC * 3);
const _camDir = new THREE.Vector3();
const _cullProjScreenMatrix = new THREE.Matrix4();
const _cullFrustum = new THREE.Frustum();
const _nDir = new THREE.Vector3();
const _nT1 = new THREE.Vector3();
const _nT2 = new THREE.Vector3();
const _nSample = new THREE.Vector3();
const _nP1a = new THREE.Vector3();
const _nP1b = new THREE.Vector3();
const _nP2a = new THREE.Vector3();
const _nP2b = new THREE.Vector3();
const _nD1 = new THREE.Vector3();
const _nD2 = new THREE.Vector3();
const _mPtl = new THREE.Vector3();
const _mPtr = new THREE.Vector3();
const _mPbl = new THREE.Vector3();
const _mPbr = new THREE.Vector3();
const _rDir = new THREE.Vector3();
const _rS0 = new THREE.Vector3();
const _rSu = new THREE.Vector3();
const _rSv = new THREE.Vector3();
const _rRes = new THREE.Vector3();
const _rTriA = new THREE.Vector3();
const _rTriB = new THREE.Vector3();
const _rTriC = new THREE.Vector3();
const _rEdge1 = new THREE.Vector3();
const _rEdge2 = new THREE.Vector3();
const _rTriN = new THREE.Vector3();
const _sDir = new THREE.Vector3();
const _sT1 = new THREE.Vector3();
const _sT2 = new THREE.Vector3();
const _sSample = new THREE.Vector3();
const _biomeSample: BiomeSample = { biome: 'ocean', T: 0.5, M: 0.5 };

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function tileableNoise(x: number, y: number, period: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const x0 = ((ix % period) + period) % period;
  const y0 = ((iy % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;

  const a = hash2(x0, y0);
  const b = hash2(x1, y0);
  const c = hash2(x0, y1);
  const d = hash2(x1, y1);

  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function hash2Pair(ix: number, iy: number, seed: number): number {
  const s = Math.sin(ix * 127.1 + iy * 311.7 + seed * 74.7) * 43758.5453123;
  return s - Math.floor(s);
}

/**
 * Generates ONE small (256x256) tileable RGBA DataTexture encoding 4 independent
 * seamless noise channels so the terrain fragment shader needs at most 1-2 texture2D
 * reads and zero real-time procedural noise/loops:
 * - R: Macro patches & mineral strata (periods 2 + 4)
 * - G: Medium grass/mineral variation (periods 6 + 12)
 * - B: Close grass blade tufts & bump height (periods 36 + 72)
 * - A: Precomputed tileable Voronoi flower dot mask (16x16 periodic cells)
 */
function createTerrainNoiseTexture(): THREE.DataTexture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);

  // Precompute 16x16 periodic flower cell centers
  const flowerGrid = 16;
  const cellCount = flowerGrid * flowerGrid;
  const flowerActive = new Uint8Array(cellCount);
  const flowerCx = new Float32Array(cellCount);
  const flowerCy = new Float32Array(cellCount);
  for (let cy = 0; cy < flowerGrid; cy++) {
    for (let cx = 0; cx < flowerGrid; cx++) {
      const idx = cy * flowerGrid + cx;
      const pick = hash2Pair(cx, cy, 11.3);
      if (pick < 0.14) {
        flowerActive[idx] = 1;
        flowerCx[idx] = cx + 0.22 + 0.56 * hash2Pair(cx, cy, 23.7);
        flowerCy[idx] = cy + 0.22 + 0.56 * hash2Pair(cx, cy, 41.9);
      }
    }
  }

  for (let y = 0; y < size; y++) {
    const v = y / size;
    const fy = v * flowerGrid;
    const baseCy = Math.floor(fy);

    for (let x = 0; x < size; x++) {
      const u = x / size;
      const fx = u * flowerGrid;
      const baseCx = Math.floor(fx);

      const macro =
        tileableNoise(u * 2, v * 2, 2) * 0.66 +
        tileableNoise(u * 4 + 1.7, v * 4 + 3.1, 4) * 0.34;
      const medium =
        tileableNoise(u * 6 + 5.2, v * 6 + 1.9, 6) * 0.62 +
        tileableNoise(u * 12 + 2.3, v * 12 + 7.4, 12) * 0.38;
      const fine =
        tileableNoise(u * 36 + 4.1, v * 36 + 9.3, 36) * 0.58 +
        tileableNoise(u * 72 + 8.7, v * 72 + 3.6, 72) * 0.42;

      let minD2 = 1.0;
      for (let oy = -1; oy <= 1; oy++) {
        const ny = (((baseCy + oy) % flowerGrid) + flowerGrid) % flowerGrid;
        const wrapY = (baseCy + oy - ny) * (1 / flowerGrid) * flowerGrid;
        for (let ox = -1; ox <= 1; ox++) {
          const nx = (((baseCx + ox) % flowerGrid) + flowerGrid) % flowerGrid;
          const cIdx = ny * flowerGrid + nx;
          if (!flowerActive[cIdx]) continue;
          const wrapX = (baseCx + ox - nx) * (1 / flowerGrid) * flowerGrid;
          const dx = flowerCx[cIdx] + wrapX - fx;
          const dy = flowerCy[cIdx] + wrapY - fy;
          const d2 = dx * dx + dy * dy;
          if (d2 < minD2) {
            minD2 = d2;
          }
        }
      }
      const flowerDot = 1 - smoothstep(0.06, 0.18, Math.sqrt(minD2));

      const pIdx = (y * size + x) * 4;
      data[pIdx] = Math.min(255, Math.max(0, Math.round(macro * 255)));
      data[pIdx + 1] = Math.min(255, Math.max(0, Math.round(medium * 255)));
      data[pIdx + 2] = Math.min(255, Math.max(0, Math.round(fine * 255)));
      data[pIdx + 3] = Math.min(255, Math.max(0, Math.round(flowerDot * 255)));
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 3D Procedural Spherical Planet Manager:
 * - 100% continuous terrain across all 96 Cube-Sphere patches (no black ocean cutouts)
 * - Rich blue & purple planetary elevation colors + seamless triplanar mineral texture
 * - Cyan-to-Violet Fresnel atmosphere halo shell
 * - Distant orbiting moon
 */
/**
 * "Terreno simples" (forceOrbitalTerrain -> orbitalMesh com orbitalMaterial) desativa:
 * 1. Texturas e detalhe procedural no fragment shader (uNoiseTex triplanar, grama/flores procedurais,
 *    curvas de nivel, perturbacao de normal grassPerturbNormalArb).
 * 2. Iluminacao PBR e normais do MeshStandardMaterial (RoomEnvironment IBL/envMap, specular,
 *    recebimento de sombras direcionais/receiveShadow), trocando para MeshLambertMaterial simples.
 * 3. Malha de alta resolucao dividida em 96 patches (20x20 cada, ~40 visiveis), trocando para
 *    uma unica malha global (6 faces x 32x32 segmentos, 1 draw call).
 */
export class PlanetTerrainManager {
  public readonly root = new THREE.Group();

  private patches: Array<{
    faceIdx: number;
    pu: number;
    pv: number;
    mesh: THREE.Mesh;
    geometry: THREE.BufferGeometry;
    centerDir: THREE.Vector3;
    angularRadius: number;
    sinAngR: number;
    cosAngR: number;
  }> = [];

  private sharedIndices: THREE.BufferAttribute;
  private sharedUvs: THREE.BufferAttribute;
  private noiseTexture: THREE.DataTexture;
  private terrainMaterial: THREE.MeshStandardMaterial;
  private unlitTerrainMaterial: THREE.MeshBasicMaterial;
  private contourUniform = { value: 1.0 };
  private grassDetailUniform = { value: 1.0 };
  private highDetailScaleUniform = { value: 1.0 };
  private bumpEnabledUniform = { value: 1.0 };
  private timeUniform = { value: 0.0 };
  private planetRadiusUniform = { value: 360.0 };
  private invMaxHeightUniform = { value: 1 / 14 };
  private diagNoGrassUniform = { value: 0.0 };
  private diagNoContoursUniform = { value: 0.0 };
  private diagNoPixelBiomeUniform = { value: 0.0 };
  private diagNoNoiseUniform = { value: 0.0 };
  private diagNoTextureUniform = { value: 0.0 };
  public readonly horizonFogColorUniform = { value: new THREE.Color(0x0e2547) };
  public readonly horizonFogParamsUniform = {
    value: new THREE.Vector3(95, 175, 1.0),
  };
  private morphRangeUniform = { value: new THREE.Vector2(55, 155) };

  private orbitalGeometry: THREE.BufferGeometry;
  private orbitalMaterial: THREE.MeshLambertMaterial;
  private orbitalMesh: THREE.Mesh;
  private isOrbitalMode = false;
  private forceOrbitalTerrain = false;
  private terrainFewerPatches = false;
  private terrainNoLighting = false;
  private noReceiveShadow = false;
  private readonly lastShadowFocus = new THREE.Vector3();
  private hasShadowFocus = false;

  private rebuildPending = false;
  private rebuildPatchIdx = 0;
  private rebuildOrbFaceIdx = 0;
  // Counts terrain patches/meshes actually rebuilt with GPU BufferAttribute needsUpdate = true
  // (0 during normal descent because LOD uses GPU vertex morphing on prebuilt patches).
  private builtPatchCounter = 0;

  private atmosphereMesh: THREE.Mesh;
  private atmosphereGeo: THREE.SphereGeometry;
  private atmosphereMat: THREE.ShaderMaterial;

  private moonPivot = new THREE.Group();
  private moonMesh: THREE.Mesh;
  private moonGeo: THREE.IcosahedronGeometry;
  private moonMat: THREE.MeshStandardMaterial;
  private readonly moonCenter = new THREE.Vector3();
  private readonly moonVelocity = new THREE.Vector3();
  private readonly moonWorldQuat = new THREE.Quaternion();
  private readonly moonState = {
    center: this.moonCenter,
    radius: 0,
    moonVelocity: this.moonVelocity,
    moonQuat: this.moonWorldQuat,
  };

  private params: PlanetParams;

  private readonly tempColor = new THREE.Color();

  constructor(initialParams: PlanetParams) {
    this.params = { ...initialParams };
    this.root.name = 'PlanetTerrainManager';

    const vc = (PATCH_SEGMENTS + 1) * (PATCH_SEGMENTS + 1);
    const uvs = new Float32Array(vc * 2);
    const indices = new Uint16Array(PATCH_SEGMENTS * PATCH_SEGMENTS * 6);

    let vi = 0;
    for (let y = 0; y <= PATCH_SEGMENTS; y++) {
      for (let x = 0; x <= PATCH_SEGMENTS; x++) {
        uvs[vi * 2] = x / PATCH_SEGMENTS;
        uvs[vi * 2 + 1] = y / PATCH_SEGMENTS;
        vi++;
      }
    }

    let ti = 0;
    for (let y = 0; y < PATCH_SEGMENTS; y++) {
      for (let x = 0; x < PATCH_SEGMENTS; x++) {
        const tl = y * (PATCH_SEGMENTS + 1) + x;
        const tr = tl + 1;
        const bl = tl + (PATCH_SEGMENTS + 1);
        const br = bl + 1;
        indices[ti++] = tl;
        indices[ti++] = tr;
        indices[ti++] = bl;
        indices[ti++] = tr;
        indices[ti++] = br;
        indices[ti++] = bl;
      }
    }

    this.sharedIndices = new THREE.BufferAttribute(indices, 1);
    this.sharedUvs = new THREE.BufferAttribute(uvs, 2);
    this.noiseTexture = createTerrainNoiseTexture();
    this.planetRadiusUniform.value = initialParams.planetRadius;
    this.invMaxHeightUniform.value = 1 / Math.max(initialParams.maxHeight, 0.001);

    this.terrainMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.72,
      metalness: 0.12,
      envMapIntensity: 0.16,
      emissive: new THREE.Color(0x050810),
      emissiveIntensity: 0.04,
      wireframe: initialParams.wireframe,
      side: THREE.FrontSide,
      fog: false,
    });

    this.unlitTerrainMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      wireframe: initialParams.wireframe,
      side: THREE.FrontSide,
    });

    this.contourUniform.value = initialParams.showContours ? 1.0 : 0.0;
    this.terrainMaterial.customProgramCacheKey = () => 'planet-terrain-opt-v5';

    this.terrainMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uShowContours = this.contourUniform;
      shader.uniforms.uNoiseTex = { value: this.noiseTexture };
      shader.uniforms.uGrassDetail = this.grassDetailUniform;
      shader.uniforms.uHighDetailScale = this.highDetailScaleUniform;
      shader.uniforms.uBumpEnabled = this.bumpEnabledUniform;
      shader.uniforms.uTime = this.timeUniform;
      shader.uniforms.uPlanetRadius = this.planetRadiusUniform;
      shader.uniforms.uInvMaxHeight = this.invMaxHeightUniform;
      shader.uniforms.uDiagNoGrass = this.diagNoGrassUniform;
      shader.uniforms.uDiagNoContours = this.diagNoContoursUniform;
      shader.uniforms.uDiagNoPixelBiome = this.diagNoPixelBiomeUniform;
      shader.uniforms.uDiagNoNoise = this.diagNoNoiseUniform;
      shader.uniforms.uDiagNoTexture = this.diagNoTextureUniform;
      shader.uniforms.uHorizonFogColor = this.horizonFogColorUniform;
      shader.uniforms.uHorizonFogParams = this.horizonFogParamsUniform;
      shader.uniforms.uMorphRange = this.morphRangeUniform;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute vec4 aTerrainData;
          attribute vec4 aMorph;
          varying highp vec3 vPlanetPos;
          varying mediump vec3 vPlanetNormal;
          varying mediump vec4 vTerrainData;
          varying mediump float vHeightFactor;
          varying mediump float vCamDist;
          varying mediump float vDetailFade;
          uniform float uPlanetRadius;
          uniform float uInvMaxHeight;
          uniform vec2 uMorphRange;`,
        )
        .replace(
          '#include <beginnormal_vertex>',
          `#include <beginnormal_vertex>
          float planetCamDistV = distance(cameraPosition, (modelMatrix * vec4(position, 1.0)).xyz);
          float morphT = smoothstep(uMorphRange.x, uMorphRange.y, planetCamDistV);
          objectNormal = normalize(mix(objectNormal, aMorph.yzw, morphT));`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          transformed += normalize(position) * (aMorph.x * morphT);`,
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
          vec4 planetWp = modelMatrix * vec4(transformed, 1.0);
          vPlanetPos = planetWp.xyz;
          vPlanetNormal = normalize(mat3(modelMatrix) * objectNormal);
          vTerrainData = aTerrainData;
          vHeightFactor = clamp((length(planetWp.xyz) - uPlanetRadius) * uInvMaxHeight, -1.0, 1.0);
          vCamDist = distance(cameraPosition, planetWp.xyz);
          vDetailFade = 1.0 - smoothstep(70.0, 120.0, vCamDist);`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying highp vec3 vPlanetPos;
          varying mediump vec3 vPlanetNormal;
          varying mediump vec4 vTerrainData;
          varying mediump float vHeightFactor;
          varying mediump float vCamDist;
          varying mediump float vDetailFade;
          uniform mediump float uShowContours;
          uniform mediump float uGrassDetail;
          uniform mediump float uHighDetailScale;
          uniform mediump float uBumpEnabled;
          uniform mediump float uTime;
          uniform mediump float uDiagNoGrass;
          uniform mediump float uDiagNoContours;
          uniform mediump float uDiagNoPixelBiome;
          uniform mediump float uDiagNoNoise;
          uniform mediump float uDiagNoTexture;
          uniform mediump vec3 uHorizonFogColor;
          uniform mediump vec3 uHorizonFogParams;
          uniform sampler2D uNoiseTex;

          mediump vec3 grassPerturbNormalArb(vec3 surf_pos, vec3 surf_norm, mediump vec2 dHdxy, float faceDir) {
            vec3 dPosX = dFdx(surf_pos.xyz);
            vec3 dPosY = dFdy(surf_pos.xyz);
            float lenX = length(dPosX);
            float lenY = length(dPosY);
            if (lenX < 1e-6 || lenY < 1e-6) return surf_norm;
            vec3 vSigmaX = dPosX / lenX;
            vec3 vSigmaY = dPosY / lenY;
            vec3 vN = surf_norm;
            vec3 R1 = cross(vSigmaY, vN);
            vec3 R2 = cross(vN, vSigmaX);
            float fDet = dot(vSigmaX, R1) * faceDir;
            float denom = abs(fDet);
            if (denom < 1e-6) return surf_norm;
            vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
            return normalize(denom * surf_norm - vGrad);
          }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          mediump float grassBumpH = 0.0;
          mediump float grassNearFade = 0.0;
          mediump float highDetail = uGrassDetail * uHighDetailScale;
          mediump float vGrass = vTerrainData.x;
          mediump vec4 noiseVal = vec4(0.5, 0.5, 0.5, 0.0);
          mediump float flowerRaw = 0.0;

          if (uDiagNoNoise < 0.5 && uDiagNoTexture < 0.5) {
            mediump vec3 an = abs(vPlanetNormal);
            highp vec2 uv1;
            highp vec2 uv2;
            mediump float w1;
            mediump float w2;
            if (an.y >= an.x && an.y >= an.z) {
              uv1 = vPlanetPos.xz;
              w1 = an.y;
              if (an.x >= an.z) {
                uv2 = vPlanetPos.yz;
                w2 = an.x;
              } else {
                uv2 = vPlanetPos.xy;
                w2 = an.z;
              }
            } else if (an.x >= an.y && an.x >= an.z) {
              uv1 = vPlanetPos.yz;
              w1 = an.x;
              if (an.y >= an.z) {
                uv2 = vPlanetPos.xz;
                w2 = an.y;
              } else {
                uv2 = vPlanetPos.xy;
                w2 = an.z;
              }
            } else {
              uv1 = vPlanetPos.xy;
              w1 = an.z;
              if (an.y >= an.x) {
                uv2 = vPlanetPos.xz;
                w2 = an.y;
              } else {
                uv2 = vPlanetPos.yz;
                w2 = an.x;
              }
            }
            w1 = max(w1 - 0.57735, 0.0001);
            w2 = max(w2 - 0.57735, 0.0);
            w1 *= w1;
            w2 *= w2;
            mediump float wInv = 1.0 / (w1 + w2);
            w1 *= wInv;
            w2 *= wInv;

            mediump vec4 n1 = texture2D(uNoiseTex, uv1 * 0.055);
            if (vDetailFade > 0.001 && w2 > 0.001) {
              mediump vec4 n2 = texture2D(uNoiseTex, uv2 * 0.055);
              noiseVal = n1 * w1 + n2 * w2;
              flowerRaw = max(n1.a * step(0.12, w1), n2.a * step(0.12, w2));
            } else {
              noiseVal = n1;
              flowerRaw = n1.a;
            }
          }

          // Continuous snow, polar ice, and coastal softness driven by interpolated vertex masks + 1 noise breakup
          mediump float nBreak = (noiseVal.r - 0.5) * 0.22;
          mediump float snowMask = smoothstep(0.14, 0.88, vTerrainData.y + nBreak);
          mediump float polarMask = smoothstep(0.14, 0.88, vTerrainData.w + nBreak * 0.8);
          mediump float iceBlend = max(snowMask, polarMask);
          mediump vec3 iceCol = mix(
            vec3(0.859, 0.918, 0.996),
            vec3(0.957, 0.969, 0.984),
            smoothstep(0.25, 0.65, vTerrainData.z + nBreak * 0.4)
          );
          diffuseColor.rgb = mix(diffuseColor.rgb, iceCol, iceBlend);

          if (vDetailFade > 0.001) {
            if (uDiagNoPixelBiome < 0.5 && uDiagNoTexture < 0.5) {
              mediump float mineralLum = mix(0.84, 1.16, noiseVal.r * 0.55 + noiseVal.g * 0.45);
              mediump float heightTint = mix(0.95, 1.04, clamp(vHeightFactor * 0.5 + 0.5, 0.0, 1.0));
              diffuseColor.rgb *= mix(1.0, mineralLum * heightTint, 0.42 * vDetailFade);
            }

            if (uDiagNoGrass < 0.5 && uDiagNoTexture < 0.5 && uGrassDetail > 0.0 && vGrass > 0.001) {
              grassNearFade = 1.0 - smoothstep(32.0, 95.0, vCamDist);

              mediump vec3 grassTint = mix(vec3(0.62, 0.78, 0.30), vec3(0.24, 0.62, 0.38), noiseVal.r);
              mediump float grassTintMean = (grassTint.r + grassTint.g + grassTint.b) * 0.3333;
              diffuseColor.rgb *= mix(vec3(1.0), grassTint / max(grassTintMean, 0.001), vGrass * 0.75 * vDetailFade);

              diffuseColor.rgb *= 1.0 + (noiseVal.g * 2.0 - 1.0) * 0.12 * vGrass * vDetailFade;

              if (uGrassDetail >= 0.5 && grassNearFade > 0.001) {
                mediump float windWave = 0.04 * sin(uTime * 1.2 + dot(vPlanetPos, vec3(0.3, 0.2, 0.4)));
                mediump float gTips = smoothstep(0.50, 0.88, noiseVal.b);
                mediump float gTufts = smoothstep(0.45, 0.85, noiseVal.g);
                grassBumpH = uGrassDetail >= 0.8 ? (gTips - gTufts * 0.65) : gTips;
                mediump float furShade = uGrassDetail >= 0.8 ? (gTips - gTufts) * 0.18 : (gTips - 0.35) * 0.22;
                diffuseColor.rgb *= (1.0 + windWave * grassNearFade * vGrass) * (1.0 + furShade * grassNearFade * uGrassDetail * vGrass);
              }

              if (highDetail >= 0.8 && vGrass > 0.6 && vCamDist < 55.0 && flowerRaw > 0.01) {
                mediump float dotMask = flowerRaw * (1.0 - smoothstep(40.0, 55.0, vCamDist));
                mediump float colPick = fract(noiseVal.g * 7.31 + noiseVal.r * 3.17);
                mediump vec3 flowerCol = colPick < 0.333
                  ? vec3(0.98, 0.98, 0.95)
                  : colPick < 0.666
                    ? vec3(0.98, 0.86, 0.25)
                    : vec3(0.96, 0.52, 0.72);
                mediump float flowerBlend = dotMask * smoothstep(0.6, 0.78, vGrass) * 0.9;
                diffuseColor.rgb = mix(diffuseColor.rgb, flowerCol, flowerBlend);
              }
            }

            if (uShowContours > 0.5 && uDiagNoContours < 0.5) {
              highp float r = length(vPlanetPos);
              mediump float contourCoord = r * 0.18;
              mediump float fw = max(fwidth(contourCoord), 0.0001);
              mediump float e = abs(fract(contourCoord - 0.5) - 0.5) / fw;
              mediump float contourLine = 1.0 - min(e, 1.0);
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.55, 1.0), contourLine * 0.14 * vDetailFade);
            }
          }`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          if (uBumpEnabled > 0.5 && uDiagNoGrass < 0.5 && uDiagNoNoise < 0.5 && uDiagNoTexture < 0.5 && highDetail >= 0.9 && vGrass > 0.001 && grassNearFade > 0.001) {
            mediump float grassBumpAmp = 0.35 * grassNearFade * uGrassDetail * vGrass;
            if (grassBumpAmp > 0.001) {
              mediump vec2 grassDH = clamp(vec2(dFdx(grassBumpH), dFdy(grassBumpH)), -0.35, 0.35);
              normal = grassPerturbNormalArb(-vViewPosition, normal, grassDH * grassBumpAmp, faceDirection);
            }
          }`,
        )
        .replace(
          '#include <fog_fragment>',
          `#include <fog_fragment>
          mediump float hFogFactor = smoothstep(uHorizonFogParams.x, uHorizonFogParams.y, vCamDist) * uHorizonFogParams.z;
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uHorizonFogColor, hFogFactor);`,
        );
    };

    const patchSpan = 2 / PATCH_SUBDIV;
    for (let f = 0; f < CUBE_FACES.length; f++) {
      const face = CUBE_FACES[f];
      for (let pv = 0; pv < PATCH_SUBDIV; pv++) {
        const vStart = -1 + pv * patchSpan;
        const vMid = vStart + patchSpan * 0.5;
        for (let pu = 0; pu < PATCH_SUBDIV; pu++) {
          const uStart = -1 + pu * patchSpan;
          const uMid = uStart + patchSpan * 0.5;

          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute(
            'position',
            new THREE.BufferAttribute(new Float32Array(vc * 3), 3),
          );
          geometry.setAttribute(
            'color',
            new THREE.BufferAttribute(new Float32Array(vc * 3), 3),
          );
          geometry.setAttribute(
            'normal',
            new THREE.BufferAttribute(new Float32Array(vc * 3), 3),
          );
          geometry.setAttribute(
            'aTerrainData',
            new THREE.BufferAttribute(new Float32Array(vc * 4), 4),
          );
          geometry.setAttribute(
            'aMorph',
            new THREE.BufferAttribute(new Float32Array(vc * 4), 4),
          );
          geometry.setAttribute('uv', this.sharedUvs);
          geometry.setIndex(this.sharedIndices);

          const mesh = new THREE.Mesh(geometry, this.terrainMaterial);
          mesh.receiveShadow = true;
          mesh.castShadow = false;
          this.root.add(mesh);

          const cMid = spherifyCubePoint(
            face.normal[0] + uMid * face.uAxis[0] + vMid * face.vAxis[0],
            face.normal[1] + uMid * face.uAxis[1] + vMid * face.vAxis[1],
            face.normal[2] + uMid * face.uAxis[2] + vMid * face.vAxis[2],
          );
          const centerDir = new THREE.Vector3(cMid.nx, cMid.ny, cMid.nz).normalize();

          let angularRadius = 0;
          for (let py = 0; py <= PATCH_SEGMENTS; py++) {
            const v = vStart + (py / PATCH_SEGMENTS) * patchSpan;
            for (let px = 0; px <= PATCH_SEGMENTS; px++) {
              const u = uStart + (px / PATCH_SEGMENTS) * patchSpan;
              const { nx, ny, nz } = spherifyCubePoint(
                face.normal[0] + u * face.uAxis[0] + v * face.vAxis[0],
                face.normal[1] + u * face.uAxis[1] + v * face.vAxis[1],
                face.normal[2] + u * face.uAxis[2] + v * face.vAxis[2],
              );
              const dot = THREE.MathUtils.clamp(
                centerDir.x * nx + centerDir.y * ny + centerDir.z * nz,
                -1,
                1,
              );
              const angle = Math.acos(dot);
              if (angle > angularRadius) {
                angularRadius = angle;
              }
            }
          }

          this.patches.push({
            faceIdx: f,
            pu,
            pv,
            mesh,
            geometry,
            centerDir,
            angularRadius,
            sinAngR: Math.sin(angularRadius),
            cosAngR: Math.cos(angularRadius),
          });
        }
      }
    }

    // Single-draw Orbital Planet Mesh (6 faces * 32x32 segments, simple Lambert vertex-colored terrain)
    const orbVertsPerFace = (ORBITAL_SEGMENTS + 1) * (ORBITAL_SEGMENTS + 1);
    const orbTotalVerts = CUBE_FACES.length * orbVertsPerFace;
    const orbIndices = new Uint16Array(
      CUBE_FACES.length * ORBITAL_SEGMENTS * ORBITAL_SEGMENTS * 6,
    );
    let oti = 0;
    for (let f = 0; f < CUBE_FACES.length; f++) {
      const baseV = f * orbVertsPerFace;
      for (let y = 0; y < ORBITAL_SEGMENTS; y++) {
        for (let x = 0; x < ORBITAL_SEGMENTS; x++) {
          const tl = baseV + y * (ORBITAL_SEGMENTS + 1) + x;
          const tr = tl + 1;
          const bl = tl + (ORBITAL_SEGMENTS + 1);
          const br = bl + 1;
          orbIndices[oti++] = tl;
          orbIndices[oti++] = tr;
          orbIndices[oti++] = bl;
          orbIndices[oti++] = tr;
          orbIndices[oti++] = br;
          orbIndices[oti++] = bl;
        }
      }
    }
    this.orbitalGeometry = new THREE.BufferGeometry();
    this.orbitalGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(orbTotalVerts * 3), 3),
    );
    this.orbitalGeometry.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(orbTotalVerts * 3), 3),
    );
    this.orbitalGeometry.setAttribute(
      'normal',
      new THREE.BufferAttribute(new Float32Array(orbTotalVerts * 3), 3),
    );
    this.orbitalGeometry.setAttribute(
      'aTerrainData',
      new THREE.BufferAttribute(new Float32Array(orbTotalVerts * 4), 4),
    );
    this.orbitalGeometry.setAttribute(
      'aMorph',
      new THREE.BufferAttribute(new Float32Array(orbTotalVerts * 4), 4),
    );
    this.orbitalGeometry.setIndex(new THREE.BufferAttribute(orbIndices, 1));
    this.orbitalMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true,
      wireframe: initialParams.wireframe,
      side: THREE.FrontSide,
    });
    this.orbitalMesh = new THREE.Mesh(this.orbitalGeometry, this.orbitalMaterial);
    this.orbitalMesh.visible = false;
    this.orbitalMesh.receiveShadow = false;
    this.orbitalMesh.castShadow = false;
    this.root.add(this.orbitalMesh);

    // Cyan-to-Violet Atmospheric Fresnel Glow Shell with Day/Night Terminator
    this.atmosphereGeo = new THREE.SphereGeometry(1, 36, 24);
    this.atmosphereMat = new THREE.ShaderMaterial({
      uniforms: {
        uColorInner: { value: new THREE.Color(0x38bdf8) },
        uColorOuter: { value: new THREE.Color(0x7c3aed) },
        uColorSunset: { value: new THREE.Color(0xf97316) },
        uSunDir: { value: new THREE.Vector3(0.5, 0.7, 0.5).normalize() },
      },
      vertexShader: `
        varying vec3 vNormalWorld;
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vNormalWorld = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        varying vec3 vNormalWorld;
        varying vec3 vWorldPos;
        uniform vec3 uColorInner;
        uniform vec3 uColorOuter;
        uniform vec3 uColorSunset;
        uniform vec3 uSunDir;
        void main() {
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          vec3 normW = normalize(vNormalWorld);
          float rim = clamp(0.65 - dot(viewDir, -normW), 0.0, 1.0);
          float sunDot = dot(normW, normalize(uSunDir));
          float dayMask = smoothstep(-0.32, 0.35, sunDot);
          float terminator = exp(-pow(sunDot * 3.8, 2.0));
          float intensity = pow(rim, 2.5) * mix(0.10, 0.90, dayMask);
          vec3 dayCol = mix(uColorOuter, uColorInner, pow(rim, 1.4));
          vec3 col = mix(dayCol, uColorSunset, terminator * 0.55);
          gl_FragColor = vec4(col, intensity);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
    });
    this.atmosphereMesh = new THREE.Mesh(this.atmosphereGeo, this.atmosphereMat);
    this.atmosphereMesh.renderOrder = 4;
    this.atmosphereMesh.userData.perfTag = 'atmLua';
    this.root.add(this.atmosphereMesh);

    // Distant Orbiting Moon (unit radius geometry scaled to planetRadius * MOON_RADIUS_RATIO)
    this.moonGeo = new THREE.IcosahedronGeometry(1, 2);
    this.moonMat = new THREE.MeshStandardMaterial({
      color: 0x8b92c4,
      roughness: 0.85,
      metalness: 0.1,
      envMapIntensity: 0.14,
      flatShading: true,
    });
    this.moonMesh = new THREE.Mesh(this.moonGeo, this.moonMat);
    this.moonPivot.userData.perfTag = 'atmLua';
    this.moonPivot.add(this.moonMesh);
    this.root.add(this.moonPivot);

    this.rebuildPlanetSync();
  }

  public get patchCount(): number {
    return this.patches.length;
  }

  public getVisiblePatchCount(): number {
    if (this.orbitalMesh.visible) return 1;
    let count = 0;
    for (let i = 0; i < this.patches.length; i++) {
      if (this.patches[i].mesh.visible) count++;
    }
    return count;
  }

  public consumeBuiltPatchCount(): number {
    const count = this.builtPatchCounter;
    this.builtPatchCounter = 0;
    return count;
  }

  private warmupSavedOrbitalVisible = false;
  private warmupSavedOrbitalReceiveShadow = false;
  private warmupSavedAtmoVisible = true;
  private warmupSavedMoonVisible = true;
  private readonly warmupSavedPatchVisible: boolean[] = [];
  private readonly warmupSavedPatchShadow: boolean[] = [];

  public prepareForShaderWarmup(shadowsEnabled: boolean): void {
    this.warmupSavedOrbitalVisible = this.orbitalMesh.visible;
    this.warmupSavedOrbitalReceiveShadow = this.orbitalMesh.receiveShadow;
    this.warmupSavedAtmoVisible = this.atmosphereMesh.visible;
    this.warmupSavedMoonVisible = this.moonMesh.visible;
    this.warmupSavedPatchVisible.length = 0;
    this.warmupSavedPatchShadow.length = 0;

    this.orbitalMesh.visible = true;
    this.atmosphereMesh.visible = true;
    this.moonMesh.visible = true;

    for (let i = 0; i < this.patches.length; i++) {
      const m = this.patches[i].mesh;
      this.warmupSavedPatchVisible.push(m.visible);
      this.warmupSavedPatchShadow.push(m.receiveShadow);
      m.visible = true;
      // Ensure both shadowed and unshadowed terrain shader variants compile
      m.receiveShadow = i === 0 ? false : shadowsEnabled;
    }
  }

  public restoreAfterShaderWarmup(): void {
    this.orbitalMesh.visible = this.warmupSavedOrbitalVisible;
    this.orbitalMesh.receiveShadow = this.warmupSavedOrbitalReceiveShadow;
    this.atmosphereMesh.visible = this.warmupSavedAtmoVisible;
    this.moonMesh.visible = this.warmupSavedMoonVisible;
    for (let i = 0; i < this.patches.length; i++) {
      const m = this.patches[i].mesh;
      if (i < this.warmupSavedPatchVisible.length) {
        m.visible = this.warmupSavedPatchVisible[i];
        m.receiveShadow = this.warmupSavedPatchShadow[i];
      }
    }
  }

  public setGrassDetail(detail: number, isLowSpec = false): void {
    this.grassDetailUniform.value = THREE.MathUtils.clamp(detail, 0, 1);
    this.highDetailScaleUniform.value = isLowSpec ? 0.7 : 1.0;
    this.bumpEnabledUniform.value = isLowSpec ? 0.0 : 1.0;
  }

  public setForceOrbitalTerrain(force: boolean): void {
    this.forceOrbitalTerrain = force;
    this.syncOrbitalMaterial();
  }

  public setTerrainFewerPatches(enabled: boolean): void {
    this.terrainFewerPatches = enabled;
    this.syncOrbitalMaterial();
  }

  public setTerrainNoTexture(disabled: boolean): void {
    this.diagNoTextureUniform.value = disabled ? 1.0 : 0.0;
  }

  public setHorizonFog(
    srgbR: number,
    srgbG: number,
    srgbB: number,
    fogNear: number,
    fogFar: number,
    fogStrength: number,
  ): void {
    this.horizonFogColorUniform.value.setRGB(srgbR, srgbG, srgbB);
    this.horizonFogParamsUniform.value.set(fogNear, fogFar, fogStrength);
  }

  public setMorphRange(near: number, far: number): void {
    this.morphRangeUniform.value.set(near, far);
  }

  public setTerrainNoLighting(disabled: boolean): void {
    if (this.terrainNoLighting === disabled) return;
    this.terrainNoLighting = disabled;
    const mat = disabled ? this.unlitTerrainMaterial : this.terrainMaterial;
    for (let i = 0; i < this.patches.length; i++) {
      this.patches[i].mesh.material = mat;
    }
    this.syncOrbitalMaterial();
  }

  private syncOrbitalMaterial(): void {
    if (this.forceOrbitalTerrain || this.isOrbitalMode) {
      this.orbitalMesh.material = this.orbitalMaterial;
      this.orbitalMesh.receiveShadow = false;
    } else if (this.terrainFewerPatches) {
      this.orbitalMesh.material = this.terrainNoLighting
        ? this.unlitTerrainMaterial
        : this.terrainMaterial;
      this.orbitalMesh.receiveShadow =
        !this.noReceiveShadow && !this.terrainNoLighting;
    }
  }

  public setAtmosphereVisible(visible: boolean): void {
    this.atmosphereMesh.visible = visible;
  }

  public setTerrainShaderDiagnostics(opts: {
    noProceduralGrass: boolean;
    noContours: boolean;
    noPixelBiomeBlend: boolean;
    noNoiseDetail: boolean;
  }): void {
    this.diagNoGrassUniform.value = opts.noProceduralGrass ? 1.0 : 0.0;
    this.diagNoContoursUniform.value = opts.noContours ? 1.0 : 0.0;
    this.diagNoPixelBiomeUniform.value = opts.noPixelBiomeBlend ? 1.0 : 0.0;
    this.diagNoNoiseUniform.value = opts.noNoiseDetail ? 1.0 : 0.0;
  }

  public setNoReceiveShadow(disabled: boolean): void {
    this.noReceiveShadow = disabled;
    this.syncOrbitalMaterial();
    if (disabled) {
      for (let i = 0; i < this.patches.length; i++) {
        this.patches[i].mesh.receiveShadow = false;
      }
      return;
    }
    if (this.hasShadowFocus) {
      this.applyPatchShadowMask(this.lastShadowFocus);
    } else {
      for (let i = 0; i < this.patches.length; i++) {
        this.patches[i].mesh.receiveShadow = true;
      }
    }
  }

  private applyPatchShadowMask(shadowFocus: THREE.Vector3): void {
    for (let i = 0; i < this.patches.length; i++) {
      const patch = this.patches[i];
      if (this.noReceiveShadow) {
        patch.mesh.receiveShadow = false;
      } else {
        const bs = patch.geometry.boundingSphere;
        patch.mesh.receiveShadow = bs
          ? bs.center.distanceTo(shadowFocus) <= bs.radius + 60
          : true;
      }
    }
  }

  public getMoonState(): {
    center: THREE.Vector3;
    radius: number;
    moonVelocity: THREE.Vector3;
    moonQuat: THREE.Quaternion;
  } {
    return this.moonState;
  }

  public getSurfaceRadiusAt(nx: number, ny: number, nz: number): number {
    const h = getPlanetSurfaceHeight(
      nx,
      ny,
      nz,
      this.params.planetRadius,
      this.params.noiseScale,
      this.params.maxHeight,
      this.params.seaLevel,
    );
    return this.params.planetRadius + h;
  }

  public getSeaLevel(): number {
    return this.params.seaLevel;
  }

  public getRawHeightNormAt(nx: number, ny: number, nz: number): number {
    const rawH = getPlanetTerrainHeight(
      nx,
      ny,
      nz,
      this.params.planetRadius,
      this.params.noiseScale,
      this.params.maxHeight,
    );
    return rawH / Math.max(this.params.maxHeight, 0.001);
  }

  public getSurfaceNormalAt(
    dx: number,
    dy: number,
    dz: number,
    out: THREE.Vector3,
  ): THREE.Vector3 {
    const eps = 0.004;
    _nDir.set(dx, dy, dz);
    if (_nDir.lengthSq() < 1e-8) {
      _nDir.set(0, 1, 0);
    } else {
      _nDir.normalize();
    }

    if (Math.abs(_nDir.y) < 0.9) {
      _nT1.set(0, 1, 0);
    } else {
      _nT1.set(1, 0, 0);
    }
    _nT1.crossVectors(_nT1, _nDir).normalize();
    _nT2.crossVectors(_nDir, _nT1).normalize();

    _nSample.copy(_nDir).addScaledVector(_nT1, eps).normalize();
    const r1a = this.getSurfaceRadiusAt(_nSample.x, _nSample.y, _nSample.z);
    _nP1a.copy(_nSample).multiplyScalar(r1a);

    _nSample.copy(_nDir).addScaledVector(_nT1, -eps).normalize();
    const r1b = this.getSurfaceRadiusAt(_nSample.x, _nSample.y, _nSample.z);
    _nP1b.copy(_nSample).multiplyScalar(r1b);

    _nSample.copy(_nDir).addScaledVector(_nT2, eps).normalize();
    const r2a = this.getSurfaceRadiusAt(_nSample.x, _nSample.y, _nSample.z);
    _nP2a.copy(_nSample).multiplyScalar(r2a);

    _nSample.copy(_nDir).addScaledVector(_nT2, -eps).normalize();
    const r2b = this.getSurfaceRadiusAt(_nSample.x, _nSample.y, _nSample.z);
    _nP2b.copy(_nSample).multiplyScalar(r2b);

    _nD1.subVectors(_nP1a, _nP1b);
    _nD2.subVectors(_nP2a, _nP2b);
    out.crossVectors(_nD1, _nD2);

    if (out.dot(_nDir) < 0) {
      out.negate();
    }
    if (out.lengthSq() < 1e-10) {
      out.copy(_nDir);
    } else {
      out.normalize();
    }
    return out;
  }

  private evalCubeSphereDir(
    face: CubeFaceBasis,
    u: number,
    v: number,
    out: THREE.Vector3,
  ): void {
    const x = face.normal[0] + u * face.uAxis[0] + v * face.vAxis[0];
    const y = face.normal[1] + u * face.uAxis[1] + v * face.vAxis[1];
    const z = face.normal[2] + u * face.uAxis[2] + v * face.vAxis[2];
    const x2 = x * x;
    const y2 = y * y;
    const z2 = z * z;
    const nx = x * Math.sqrt(Math.max(0, 1 - y2 * 0.5 - z2 * 0.5 + (y2 * z2) / 3));
    const ny = y * Math.sqrt(Math.max(0, 1 - z2 * 0.5 - x2 * 0.5 + (z2 * x2) / 3));
    const nz = z * Math.sqrt(Math.max(0, 1 - x2 * 0.5 - y2 * 0.5 + (x2 * y2) / 3));
    out.set(nx, ny, nz);
  }

  private sampleCubeGridVertex(
    face: CubeFaceBasis,
    u: number,
    v: number,
    out: THREE.Vector3,
  ): void {
    this.evalCubeSphereDir(face, u, v, out);
    const r = this.getSurfaceRadiusAt(out.x, out.y, out.z);
    out.multiplyScalar(r);
  }

  public getRenderedSurfaceRadiusAt(
    nx: number,
    ny: number,
    nz: number,
  ): number {
    _rDir.set(nx, ny, nz);
    const lenSq = _rDir.lengthSq();
    if (lenSq < 1e-10) {
      _rDir.set(0, 1, 0);
    } else {
      _rDir.divideScalar(Math.sqrt(lenSq));
    }

    const ax = Math.abs(_rDir.x);
    const ay = Math.abs(_rDir.y);
    const az = Math.abs(_rDir.z);
    let faceIdx: number;
    if (ay >= ax && ay >= az) {
      faceIdx = _rDir.y >= 0 ? 0 : 1;
    } else if (ax >= ay && ax >= az) {
      faceIdx = _rDir.x >= 0 ? 2 : 3;
    } else {
      faceIdx = _rDir.z >= 0 ? 4 : 5;
    }
    const face = CUBE_FACES[faceIdx];

    const maxAbs = Math.max(ax, ay, az, 1e-8);
    const cx = _rDir.x / maxAbs;
    const cy = _rDir.y / maxAbs;
    const cz = _rDir.z / maxAbs;
    let u = THREE.MathUtils.clamp(
      cx * face.uAxis[0] + cy * face.uAxis[1] + cz * face.uAxis[2],
      -1,
      1,
    );
    let v = THREE.MathUtils.clamp(
      cx * face.vAxis[0] + cy * face.vAxis[1] + cz * face.vAxis[2],
      -1,
      1,
    );

    const eps = 1e-4;
    const invEps = 1 / eps;
    for (let iter = 0; iter < 3; iter++) {
      this.evalCubeSphereDir(face, u, v, _rS0);
      this.evalCubeSphereDir(face, u + eps, v, _rSu);
      this.evalCubeSphereDir(face, u, v + eps, _rSv);

      _rSu.sub(_rS0).multiplyScalar(invEps);
      _rSv.sub(_rS0).multiplyScalar(invEps);
      _rRes.subVectors(_rS0, _rDir);

      const j00 = _rSu.dot(_rSu);
      const j01 = _rSu.dot(_rSv);
      const j11 = _rSv.dot(_rSv);
      const det = j00 * j11 - j01 * j01;
      if (Math.abs(det) < 1e-12) break;

      const rhs0 = -_rSu.dot(_rRes);
      const rhs1 = -_rSv.dot(_rRes);
      const du = (rhs0 * j11 - rhs1 * j01) / det;
      const dv = (j00 * rhs1 - j01 * rhs0) / det;
      u = THREE.MathUtils.clamp(u + du, -1, 1);
      v = THREE.MathUtils.clamp(v + dv, -1, 1);
    }

    const grid = PATCH_SUBDIV * PATCH_SEGMENTS;
    const gu = (u + 1) * 0.5 * grid;
    const gv = (v + 1) * 0.5 * grid;
    const i = Math.min(Math.max(Math.floor(gu), 0), grid - 1);
    const j = Math.min(Math.max(Math.floor(gv), 0), grid - 1);
    const fu = gu - i;
    const fv = gv - j;

    const invGrid2 = 2 / grid;
    const u0 = -1 + i * invGrid2;
    const u1 = -1 + (i + 1) * invGrid2;
    const v0 = -1 + j * invGrid2;
    const v1 = -1 + (j + 1) * invGrid2;

    if (fu + fv <= 1) {
      this.sampleCubeGridVertex(face, u0, v0, _rTriA); // tl
      this.sampleCubeGridVertex(face, u1, v0, _rTriB); // tr
      this.sampleCubeGridVertex(face, u0, v1, _rTriC); // bl
    } else {
      this.sampleCubeGridVertex(face, u1, v0, _rTriA); // tr
      this.sampleCubeGridVertex(face, u1, v1, _rTriB); // br
      this.sampleCubeGridVertex(face, u0, v1, _rTriC); // bl
    }

    _rEdge1.subVectors(_rTriB, _rTriA);
    _rEdge2.subVectors(_rTriC, _rTriA);
    _rTriN.crossVectors(_rEdge1, _rEdge2);

    const denom = _rTriN.dot(_rDir);
    if (Math.abs(denom) < 1e-8) {
      return this.getSurfaceRadiusAt(_rDir.x, _rDir.y, _rDir.z);
    }
    const t = _rTriN.dot(_rTriA) / denom;
    if (!Number.isFinite(t) || t <= 0) {
      return this.getSurfaceRadiusAt(_rDir.x, _rDir.y, _rDir.z);
    }
    return t;
  }

  public getRenderedSupportRadiusAt(
    nx: number,
    ny: number,
    nz: number,
    footprint = 1.6,
  ): number {
    _sDir.set(nx, ny, nz);
    const lenSq = _sDir.lengthSq();
    if (lenSq < 1e-10) {
      _sDir.set(0, 1, 0);
    } else {
      _sDir.divideScalar(Math.sqrt(lenSq));
    }

    let maxR = this.getRenderedSurfaceRadiusAt(_sDir.x, _sDir.y, _sDir.z);

    if (Math.abs(_sDir.y) < 0.9) {
      _sT1.set(0, 1, 0);
    } else {
      _sT1.set(1, 0, 0);
    }
    _sT1.crossVectors(_sT1, _sDir).normalize();
    _sT2.crossVectors(_sDir, _sT1).normalize();

    const ang = footprint / Math.max(maxR, 1);

    _sSample.copy(_sDir).addScaledVector(_sT1, ang).normalize();
    const r1 = this.getRenderedSurfaceRadiusAt(_sSample.x, _sSample.y, _sSample.z);
    if (r1 > maxR) maxR = r1;

    _sSample.copy(_sDir).addScaledVector(_sT1, -ang).normalize();
    const r2 = this.getRenderedSurfaceRadiusAt(_sSample.x, _sSample.y, _sSample.z);
    if (r2 > maxR) maxR = r2;

    _sSample.copy(_sDir).addScaledVector(_sT2, ang).normalize();
    const r3 = this.getRenderedSurfaceRadiusAt(_sSample.x, _sSample.y, _sSample.z);
    if (r3 > maxR) maxR = r3;

    _sSample.copy(_sDir).addScaledVector(_sT2, -ang).normalize();
    const r4 = this.getRenderedSurfaceRadiusAt(_sSample.x, _sSample.y, _sSample.z);
    if (r4 > maxR) maxR = r4;

    return maxR;
  }

  public getMeshPointAtCubeUV(
    faceIdx: number,
    u: number,
    v: number,
    out: THREE.Vector3,
  ): THREE.Vector3 {
    const face = CUBE_FACES[faceIdx];
    const grid = PATCH_SUBDIV * PATCH_SEGMENTS;
    const cu = THREE.MathUtils.clamp(u, -1, 1);
    const cv = THREE.MathUtils.clamp(v, -1, 1);
    const gu = (cu + 1) * 0.5 * grid;
    const gv = (cv + 1) * 0.5 * grid;
    const i = Math.min(Math.max(Math.floor(gu), 0), grid - 1);
    const j = Math.min(Math.max(Math.floor(gv), 0), grid - 1);
    const fu = gu - i;
    const fv = gv - j;

    const invGrid2 = 2 / grid;
    const u0 = -1 + i * invGrid2;
    const u1 = -1 + (i + 1) * invGrid2;
    const v0 = -1 + j * invGrid2;
    const v1 = -1 + (j + 1) * invGrid2;

    this.sampleCubeGridVertex(face, u0, v0, _mPtl);
    this.sampleCubeGridVertex(face, u1, v0, _mPtr);
    this.sampleCubeGridVertex(face, u0, v1, _mPbl);
    this.sampleCubeGridVertex(face, u1, v1, _mPbr);

    if (fu + fv <= 1) {
      out
        .copy(_mPtl)
        .addScaledVector(_nD1.subVectors(_mPtr, _mPtl), fu)
        .addScaledVector(_nD2.subVectors(_mPbl, _mPtl), fv);
    } else {
      out
        .copy(_mPbr)
        .addScaledVector(_nD1.subVectors(_mPbl, _mPbr), 1 - fu)
        .addScaledVector(_nD2.subVectors(_mPtr, _mPbr), 1 - fv);
    }
    return out;
  }

  public findLandDirection(
    startIndex: number,
    out: THREE.Vector3,
  ): THREE.Vector3 {
    const totalSamples = 512;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const safeMaxH = Math.max(this.params.maxHeight, 0.001);
    const minNorm = this.params.seaLevel + 0.12;
    const start = ((Math.floor(startIndex) % totalSamples) + totalSamples) % totalSamples;

    let bestNx = 0;
    let bestNy = 0;
    let bestNz = 1;
    let bestRawNorm = -Infinity;

    for (let step = 0; step < totalSamples; step++) {
      const idx = (start + step) % totalSamples;
      const ny = 1 - (2 * (idx + 0.5)) / totalSamples;
      if (Math.abs(ny) >= 0.6) continue;

      const rAtY = Math.sqrt(Math.max(0, 1 - ny * ny));
      const theta = idx * goldenAngle;
      const nx = Math.cos(theta) * rAtY;
      const nz = Math.sin(theta) * rAtY;

      const rawNorm =
        getPlanetTerrainHeight(
          nx,
          ny,
          nz,
          this.params.planetRadius,
          this.params.noiseScale,
          this.params.maxHeight,
        ) / safeMaxH;

      if (rawNorm > minNorm) {
        return out.set(nx, ny, nz).normalize();
      }
      if (rawNorm > bestRawNorm) {
        bestRawNorm = rawNorm;
        bestNx = nx;
        bestNy = ny;
        bestNz = nz;
      }
    }

    return out.set(bestNx, bestNy, bestNz).normalize();
  }

  public update(elapsed: number, sunDir?: THREE.Vector3): void {
    this.timeUniform.value = elapsed;
    if (sunDir) {
      this.atmosphereMat.uniforms.uSunDir.value.copy(sunDir).normalize();
    }
    if (this.rebuildPending) {
      this.stepRebuild();
    }
  }

  public updateHorizonCulling(
    cameraPos: THREE.Vector3,
    camera?: THREE.Camera,
    focusPos?: THREE.Vector3,
  ): void {
    const shadowRef = focusPos ?? cameraPos;
    this.lastShadowFocus.copy(shadowRef);
    this.hasShadowFocus = true;

    const camDist = cameraPos.length();
    const camAlt = camDist - this.params.planetRadius;
    const atmo = Math.max(1, this.params.atmosphereHeight);

    const prevOrbital = this.isOrbitalMode;
    if (!this.isOrbitalMode && camAlt > atmo * 2.2) {
      this.isOrbitalMode = true;
    } else if (this.isOrbitalMode && camAlt < atmo * 1.8) {
      this.isOrbitalMode = false;
    }
    if (prevOrbital !== this.isOrbitalMode) {
      this.syncOrbitalMaterial();
    }

    if (
      this.forceOrbitalTerrain ||
      this.isOrbitalMode ||
      this.terrainFewerPatches
    ) {
      this.syncOrbitalMaterial();
      this.orbitalMesh.visible = true;
      for (let i = 0; i < this.patches.length; i++) {
        this.patches[i].mesh.visible = false;
      }
      return;
    }

    this.orbitalMesh.visible = false;
    const applyHorizon = camDist > this.params.planetRadius;

    let horizonAngle = Math.PI;
    let cosH = -1;
    let sinH = 0;
    if (applyHorizon) {
      _camDir.copy(cameraPos).divideScalar(camDist);
      horizonAngle = Math.acos(this.params.planetRadius / camDist) + 0.05;
      cosH = Math.cos(horizonAngle);
      sinH = Math.sin(horizonAngle);
    }

    if (camera) {
      camera.updateMatrixWorld();
      _cullProjScreenMatrix.multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      );
      _cullFrustum.setFromProjectionMatrix(_cullProjScreenMatrix);
    }

    for (let i = 0; i < this.patches.length; i++) {
      const patch = this.patches[i];
      let visible = true;
      if (applyHorizon && horizonAngle + patch.angularRadius < Math.PI) {
        visible =
          _camDir.dot(patch.centerDir) >=
          cosH * patch.cosAngR - sinH * patch.sinAngR;
      }
      if (visible && camera && patch.geometry.boundingSphere) {
        visible = _cullFrustum.intersectsSphere(patch.geometry.boundingSphere);
      }
      patch.mesh.visible = visible;
      if (visible) {
        if (this.noReceiveShadow) {
          patch.mesh.receiveShadow = false;
        } else {
          const bs = patch.geometry.boundingSphere;
          patch.mesh.receiveShadow = bs
            ? bs.center.distanceTo(shadowRef) <= bs.radius + 60
            : true;
        }
      }
    }
  }

  public updateParams(next: PlanetParams): void {
    const geoChanged =
      next.planetRadius !== this.params.planetRadius ||
      next.maxHeight !== this.params.maxHeight ||
      next.noiseScale !== this.params.noiseScale ||
      next.seaLevel !== this.params.seaLevel;

    const atmoChanged =
      next.atmosphereHeight !== this.params.atmosphereHeight ||
      next.planetRadius !== this.params.planetRadius;

    this.terrainMaterial.wireframe = next.wireframe;
    this.unlitTerrainMaterial.wireframe = next.wireframe;
    this.orbitalMaterial.wireframe = next.wireframe;
    this.contourUniform.value = next.showContours ? 1.0 : 0.0;
    this.planetRadiusUniform.value = next.planetRadius;
    this.invMaxHeightUniform.value = 1 / Math.max(next.maxHeight, 0.001);
    this.params = { ...next };

    if (geoChanged) {
      this.scheduleRebuild();
    } else if (atmoChanged) {
      this.syncShellScales();
    }
  }

  private syncShellScales(): void {
    const { planetRadius, atmosphereHeight } = this.params;
    const atmoRadius = planetRadius + Math.max(15, atmosphereHeight * 1.15);
    this.atmosphereMesh.scale.setScalar(atmoRadius);
    const moonRadius = planetRadius * MOON_RADIUS_RATIO;
    this.moonMesh.scale.setScalar(moonRadius);
    this.moonMesh.position.set(planetRadius * 2.55, planetRadius * 0.45, 0);
    this.moonPivot.rotation.set(0, 0, 0);
    this.moonMesh.rotation.set(0, 0, 0);
    this.moonPivot.updateMatrixWorld(true);
    this.moonMesh.getWorldPosition(this.moonCenter);
    this.moonVelocity.set(0, 0, 0);
    this.moonWorldQuat.identity();
    this.moonState.radius = moonRadius;
  }

  private computeSmoothTerrainNormal(
    nx: number,
    ny: number,
    nz: number,
    planetRadius: number,
    noiseScale: number,
    maxHeight: number,
    seaLevel: number,
    rawH: number,
  ): [number, number, number] {
    const safeMaxH = Math.max(maxHeight, 0.001);
    const rawHNorm = rawH / safeMaxH;
    const landSlopeWeight = smoothstep(
      seaLevel - 0.025,
      seaLevel + 0.035,
      rawHNorm,
    );
    if (landSlopeWeight <= 0.0001) {
      return [nx, ny, nz];
    }

    const eps = 0.006;
    const ax = Math.abs(ny) < 0.9 ? 0 : 1;
    const ay = Math.abs(ny) < 0.9 ? 1 : 0;
    const az = 0;

    let t1x = ay * nz - az * ny;
    let t1y = az * nx - ax * nz;
    let t1z = ax * ny - ay * nx;
    const t1Len = Math.hypot(t1x, t1y, t1z) || 1;
    t1x /= t1Len;
    t1y /= t1Len;
    t1z /= t1Len;

    const t2x = ny * t1z - nz * t1y;
    const t2y = nz * t1x - nx * t1z;
    const t2z = nx * t1y - ny * t1x;

    const sampleH = (dx: number, dy: number, dz: number) => {
      const len = Math.hypot(dx, dy, dz) || 1;
      return getPlanetTerrainHeight(
        dx / len,
        dy / len,
        dz / len,
        planetRadius,
        noiseScale,
        maxHeight,
      );
    };

    const h1a = sampleH(nx + t1x * eps, ny + t1y * eps, nz + t1z * eps);
    const h1b = sampleH(nx - t1x * eps, ny - t1y * eps, nz - t1z * eps);
    const h2a = sampleH(nx + t2x * eps, ny + t2y * eps, nz + t2z * eps);
    const h2b = sampleH(nx - t2x * eps, ny - t2y * eps, nz - t2z * eps);

    const r = planetRadius + Math.max(rawH, seaLevel * maxHeight);
    const invStep = landSlopeWeight / (2 * eps * Math.max(r, 1));
    const dh1 = (h1a - h1b) * invStep;
    const dh2 = (h2a - h2b) * invStep;

    const outX = nx - t1x * dh1 - t2x * dh2;
    const outY = ny - t1y * dh1 - t2y * dh2;
    const outZ = nz - t1z * dh1 - t2z * dh2;
    const outLen = Math.hypot(outX, outY, outZ) || 1;
    return [outX / outLen, outY / outLen, outZ / outLen];
  }

  private buildSinglePatch(patchIdx: number): void {
    const patch = this.patches[patchIdx];
    const { planetRadius, maxHeight, noiseScale, seaLevel } = this.params;
    const safeMaxH = Math.max(maxHeight, 0.001);
    const seaFloorH = seaLevel * maxHeight;
    const patchSpan = 2 / PATCH_SUBDIV;

    const face = CUBE_FACES[patch.faceIdx];
    const uStart = -1 + patch.pu * patchSpan;
    const vStart = -1 + patch.pv * patchSpan;

    const posAttr = patch.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = patch.geometry.getAttribute('color') as THREE.BufferAttribute;
    const normAttr = patch.geometry.getAttribute('normal') as THREE.BufferAttribute;
    const dataAttr = patch.geometry.getAttribute('aTerrainData') as THREE.BufferAttribute;
    const morphAttr = patch.geometry.getAttribute('aMorph') as THREE.BufferAttribute;

    const positions = posAttr.array as Float32Array;
    const colors = colAttr.array as Float32Array;
    const normals = normAttr.array as Float32Array;
    const terrainData = dataAttr.array as Float32Array;
    const morphs = morphAttr.array as Float32Array;

    let vi = 0;
    for (let py = 0; py <= PATCH_SEGMENTS; py++) {
      const v = vStart + (py / PATCH_SEGMENTS) * patchSpan;
      for (let px = 0; px <= PATCH_SEGMENTS; px++) {
        const u = uStart + (px / PATCH_SEGMENTS) * patchSpan;

        const cx = face.normal[0] + u * face.uAxis[0] + v * face.vAxis[0];
        const cy = face.normal[1] + u * face.uAxis[1] + v * face.vAxis[1];
        const cz = face.normal[2] + u * face.uAxis[2] + v * face.vAxis[2];

        const { nx, ny, nz } = spherifyCubePoint(cx, cy, cz);
        const rawH = getPlanetTerrainHeight(
          nx,
          ny,
          nz,
          planetRadius,
          noiseScale,
          maxHeight,
        );
        const h = Math.max(rawH, seaFloorH);
        const r = planetRadius + h;

        _patchRGrid[vi] = r;
        positions[vi * 3] = nx * r;
        positions[vi * 3 + 1] = ny * r;
        positions[vi * 3 + 2] = nz * r;

        const [snx, sny, snz] = this.computeSmoothTerrainNormal(
          nx,
          ny,
          nz,
          planetRadius,
          noiseScale,
          maxHeight,
          seaLevel,
          rawH,
        );
        normals[vi * 3] = snx;
        normals[vi * 3 + 1] = sny;
        normals[vi * 3 + 2] = snz;
        _patchNGrid[vi * 3] = snx;
        _patchNGrid[vi * 3 + 1] = sny;
        _patchNGrid[vi * 3 + 2] = snz;

        const rawHeightNorm = THREE.MathUtils.clamp(rawH / safeMaxH, -1, 1);
        getBiomeColor(
          nx,
          ny,
          nz,
          rawHeightNorm,
          seaLevel,
          this.tempColor,
          _biomeSample,
          false,
        );

        colors[vi * 3] = this.tempColor.r;
        colors[vi * 3 + 1] = this.tempColor.g;
        colors[vi * 3 + 2] = this.tempColor.b;

        const dotSlope = THREE.MathUtils.clamp(
          snx * nx + sny * ny + snz * nz,
          0,
          1,
        );
        const grassCov =
          getGrassCoverage(
            _biomeSample.T,
            _biomeSample.M,
            rawHeightNorm,
            seaLevel,
          ) * smoothstep(0.8, 0.92, dotSlope);

        const snowLine = THREE.MathUtils.lerp(0.48, 0.90, _biomeSample.T);
        const snowDriver = THREE.MathUtils.clamp(
          (rawHeightNorm - (snowLine - 0.18)) / 0.36,
          0,
          1,
        );
        const shoreDriver = THREE.MathUtils.clamp(
          (rawHeightNorm - (seaLevel - 0.05)) / 0.12,
          0,
          1,
        );
        const polarDriver = THREE.MathUtils.clamp(
          (0.28 - _biomeSample.T) / 0.25,
          0,
          1,
        );

        terrainData[vi * 4] = grassCov;
        terrainData[vi * 4 + 1] = snowDriver;
        terrainData[vi * 4 + 2] = shoreDriver;
        terrainData[vi * 4 + 3] = polarDriver;
        vi++;
      }
    }

    // Second fast pass: compute half-resolution geomorph targets (zero border cracks)
    const stride = PATCH_SEGMENTS + 1;
    let mi = 0;
    for (let py = 0; py <= PATCH_SEGMENTS; py++) {
      const oddY = (py & 1) === 1;
      for (let px = 0; px <= PATCH_SEGMENTS; px++) {
        const oddX = (px & 1) === 1;
        let idxA = mi;
        let idxB = mi;
        if (oddX && !oddY) {
          idxA = mi - 1;
          idxB = mi + 1;
        } else if (!oddX && oddY) {
          idxA = mi - stride;
          idxB = mi + stride;
        } else if (oddX && oddY) {
          // Matches quad diagonal tr (px+1, py-1) <-> bl (px-1, py+1)
          idxA = (py - 1) * stride + (px + 1);
          idxB = (py + 1) * stride + (px - 1);
        }

        const halfR = 0.5 * (_patchRGrid[idxA] + _patchRGrid[idxB]);
        let hnx = _patchNGrid[idxA * 3] + _patchNGrid[idxB * 3];
        let hny = _patchNGrid[idxA * 3 + 1] + _patchNGrid[idxB * 3 + 1];
        let hnz = _patchNGrid[idxA * 3 + 2] + _patchNGrid[idxB * 3 + 2];
        const hnLen = Math.hypot(hnx, hny, hnz) || 1;
        hnx /= hnLen;
        hny /= hnLen;
        hnz /= hnLen;

        morphs[mi * 4] = halfR - _patchRGrid[mi];
        morphs[mi * 4 + 1] = hnx;
        morphs[mi * 4 + 2] = hny;
        morphs[mi * 4 + 3] = hnz;
        mi++;
      }
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    normAttr.needsUpdate = true;
    dataAttr.needsUpdate = true;
    morphAttr.needsUpdate = true;
    patch.geometry.computeBoundingSphere();
    // Incremented whenever a terrain patch mesh is actually rebuilt/regenerated
    // (0 during normal flight descent because LOD uses GPU vertex morphing on prebuilt patches).
    this.builtPatchCounter++;
  }

  private buildOrbitalFace(faceIdx: number): void {
    const { planetRadius, maxHeight, noiseScale, seaLevel } = this.params;
    const safeMaxH = Math.max(maxHeight, 0.001);
    const seaFloorH = seaLevel * maxHeight;
    const orbVertsPerFace = (ORBITAL_SEGMENTS + 1) * (ORBITAL_SEGMENTS + 1);

    const orbPosAttr = this.orbitalGeometry.getAttribute('position') as THREE.BufferAttribute;
    const orbColAttr = this.orbitalGeometry.getAttribute('color') as THREE.BufferAttribute;
    const orbNormAttr = this.orbitalGeometry.getAttribute('normal') as THREE.BufferAttribute;
    const orbDataAttr = this.orbitalGeometry.getAttribute('aTerrainData') as THREE.BufferAttribute;
    const orbMorphAttr = this.orbitalGeometry.getAttribute('aMorph') as THREE.BufferAttribute;

    const orbPos = orbPosAttr.array as Float32Array;
    const orbCol = orbColAttr.array as Float32Array;
    const orbNorm = orbNormAttr.array as Float32Array;
    const orbData = orbDataAttr.array as Float32Array;
    const orbMorph = orbMorphAttr.array as Float32Array;

    const face = CUBE_FACES[faceIdx];
    let ovi = faceIdx * orbVertsPerFace;
    for (let py = 0; py <= ORBITAL_SEGMENTS; py++) {
      const v = -1 + (py / ORBITAL_SEGMENTS) * 2;
      for (let px = 0; px <= ORBITAL_SEGMENTS; px++) {
        const u = -1 + (px / ORBITAL_SEGMENTS) * 2;
        const cx = face.normal[0] + u * face.uAxis[0] + v * face.vAxis[0];
        const cy = face.normal[1] + u * face.uAxis[1] + v * face.vAxis[1];
        const cz = face.normal[2] + u * face.uAxis[2] + v * face.vAxis[2];

        const { nx, ny, nz } = spherifyCubePoint(cx, cy, cz);
        const rawH = getPlanetTerrainHeight(
          nx,
          ny,
          nz,
          planetRadius,
          noiseScale,
          maxHeight,
        );
        const h = Math.max(rawH, seaFloorH);
        const r = planetRadius + h;

        orbPos[ovi * 3] = nx * r;
        orbPos[ovi * 3 + 1] = ny * r;
        orbPos[ovi * 3 + 2] = nz * r;

        const [snx, sny, snz] = this.computeSmoothTerrainNormal(
          nx,
          ny,
          nz,
          planetRadius,
          noiseScale,
          maxHeight,
          seaLevel,
          rawH,
        );
        orbNorm[ovi * 3] = snx;
        orbNorm[ovi * 3 + 1] = sny;
        orbNorm[ovi * 3 + 2] = snz;

        const rawHeightNorm = THREE.MathUtils.clamp(rawH / safeMaxH, -1, 1);
        getBiomeColor(
          nx,
          ny,
          nz,
          rawHeightNorm,
          seaLevel,
          this.tempColor,
          _biomeSample,
          true,
        );
        orbCol[ovi * 3] = this.tempColor.r;
        orbCol[ovi * 3 + 1] = this.tempColor.g;
        orbCol[ovi * 3 + 2] = this.tempColor.b;

        const dotSlope = THREE.MathUtils.clamp(
          snx * nx + sny * ny + snz * nz,
          0,
          1,
        );
        const grassCov =
          getGrassCoverage(
            _biomeSample.T,
            _biomeSample.M,
            rawHeightNorm,
            seaLevel,
          ) * smoothstep(0.8, 0.92, dotSlope);
        const snowLine = THREE.MathUtils.lerp(0.48, 0.90, _biomeSample.T);
        orbData[ovi * 4] = grassCov;
        orbData[ovi * 4 + 1] = THREE.MathUtils.clamp(
          (rawHeightNorm - (snowLine - 0.18)) / 0.36,
          0,
          1,
        );
        orbData[ovi * 4 + 2] = THREE.MathUtils.clamp(
          (rawHeightNorm - (seaLevel - 0.05)) / 0.12,
          0,
          1,
        );
        orbData[ovi * 4 + 3] = THREE.MathUtils.clamp(
          (0.28 - _biomeSample.T) / 0.25,
          0,
          1,
        );

        orbMorph[ovi * 4] = 0;
        orbMorph[ovi * 4 + 1] = snx;
        orbMorph[ovi * 4 + 2] = sny;
        orbMorph[ovi * 4 + 3] = snz;
        ovi++;
      }
    }

    if (faceIdx === CUBE_FACES.length - 1) {
      orbPosAttr.needsUpdate = true;
      orbColAttr.needsUpdate = true;
      orbNormAttr.needsUpdate = true;
      orbDataAttr.needsUpdate = true;
      orbMorphAttr.needsUpdate = true;
      this.orbitalGeometry.computeBoundingSphere();
      // Orbital global mesh buffers uploaded with needsUpdate = true
      this.builtPatchCounter++;
    }
  }

  private scheduleRebuild(): void {
    this.rebuildPending = true;
    this.rebuildPatchIdx = 0;
    this.rebuildOrbFaceIdx = 0;
    this.syncShellScales();
    this.stepRebuild();
  }

  private stepRebuild(): void {
    if (!this.rebuildPending) return;

    if (this.rebuildPatchIdx < this.patches.length) {
      this.buildSinglePatch(this.rebuildPatchIdx);
      this.rebuildPatchIdx++;
      return;
    }

    if (this.rebuildOrbFaceIdx < CUBE_FACES.length) {
      this.buildOrbitalFace(this.rebuildOrbFaceIdx);
      this.rebuildOrbFaceIdx++;
      if (this.rebuildOrbFaceIdx < CUBE_FACES.length) return;
    }

    this.rebuildPending = false;
  }

  private rebuildPlanetSync(): void {
    for (let i = 0; i < this.patches.length; i++) {
      this.buildSinglePatch(i);
    }
    for (let f = 0; f < CUBE_FACES.length; f++) {
      this.buildOrbitalFace(f);
    }
    this.rebuildPending = false;
    this.syncShellScales();
  }

  public dispose(): void {
    for (const patch of this.patches) {
      this.root.remove(patch.mesh);
      patch.geometry.dispose();
    }
    this.patches.length = 0;
    this.root.remove(this.orbitalMesh);
    this.orbitalGeometry.dispose();
    this.orbitalMaterial.dispose();
    this.noiseTexture.dispose();
    this.terrainMaterial.dispose();
    this.unlitTerrainMaterial.dispose();
    this.atmosphereGeo.dispose();
    this.atmosphereMat.dispose();
    this.moonGeo.dispose();
    this.moonMat.dispose();
  }
}
