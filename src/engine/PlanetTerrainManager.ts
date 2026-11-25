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
const MOON_RADIUS_RATIO = 0.145;
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

/**
 * Generates a bright, tileable procedural blue-and-purple surface texture
 * with zero black/dark blotches for triplanar sphere mapping.
 */
function createPlanetSurfaceTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const img = ctx.createImageData(size, size);
    const data = img.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;

        const n1 = tileableNoise(u * 6, v * 6, 6);
        const n2 = tileableNoise(u * 14 + 3.2, v * 14 + 1.9, 14);
        const n3 = tileableNoise(u * 30 + 7.1, v * 30 + 5.4, 30);

        const strata =
          Math.sin((u * 4 + v * 2 + n1 * 1.5) * Math.PI * 2) * 0.5 + 0.5;
        const grain = n1 * 0.5 + n2 * 0.32 + n3 * 0.18;
        const blend = strata * 0.42 + grain * 0.58;

        // Luminous blue-to-purple variation without darkening albedo
        const r = 165 + blend * 85;
        const g = 148 + (1 - blend) * 70;
        const b = 232 + blend * 23;

        const idx = (y * size + x) * 4;
        data[idx] = Math.min(255, Math.round(r));
        data[idx + 1] = Math.min(255, Math.round(g));
        data[idx + 2] = Math.min(255, Math.round(b));
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
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
  private surfaceTexture: THREE.CanvasTexture;
  private terrainMaterial: THREE.MeshStandardMaterial;
  private contourUniform = { value: 1.0 };
  private grassDetailUniform = { value: 1.0 };
  private timeUniform = { value: 0.0 };

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
    this.surfaceTexture = createPlanetSurfaceTexture();

    this.terrainMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.72,
      metalness: 0.12,
      envMapIntensity: 0.16,
      emissive: new THREE.Color(0x050810),
      emissiveIntensity: 0.04,
      wireframe: initialParams.wireframe,
      side: THREE.FrontSide,
    });

    this.contourUniform.value = initialParams.showContours ? 1.0 : 0.0;
    this.terrainMaterial.customProgramCacheKey = () => 'planet-terrain-grass-v1';

    this.terrainMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uShowContours = this.contourUniform;
      shader.uniforms.uDetailTex = { value: this.surfaceTexture };
      shader.uniforms.uGrassDetail = this.grassDetailUniform;
      shader.uniforms.uTime = this.timeUniform;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute float aGrass;
          varying float vGrass;
          varying vec3 vPlanetPos;
          varying vec3 vPlanetNormal;`,
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
          vPlanetPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vPlanetNormal = normalize(mat3(modelMatrix) * objectNormal);
          vGrass = aGrass;`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vPlanetPos;
          varying vec3 vPlanetNormal;
          varying float vGrass;
          uniform float uShowContours;
          uniform float uGrassDetail;
          uniform float uTime;
          uniform sampler2D uDetailTex;

          float grassHash31(vec3 p) {
            p = fract(p * 0.1031);
            p += dot(p, p.yzx + 33.33);
            return fract((p.x + p.y) * p.z);
          }

          vec3 grassHash33(vec3 p) {
            p = fract(p * vec3(0.1031, 0.1030, 0.0973));
            p += dot(p, p.yxz + 33.33);
            return fract((p.xxy + p.yxx) * p.zyx);
          }

          float grassNoise3D(vec3 p) {
            vec3 i = floor(p);
            vec3 f = fract(p);
            vec3 u = f * f * (3.0 - 2.0 * f);
            return mix(
              mix(
                mix(grassHash31(i + vec3(0.0, 0.0, 0.0)), grassHash31(i + vec3(1.0, 0.0, 0.0)), u.x),
                mix(grassHash31(i + vec3(0.0, 1.0, 0.0)), grassHash31(i + vec3(1.0, 1.0, 0.0)), u.x),
                u.y
              ),
              mix(
                mix(grassHash31(i + vec3(0.0, 0.0, 1.0)), grassHash31(i + vec3(1.0, 0.0, 1.0)), u.x),
                mix(grassHash31(i + vec3(0.0, 1.0, 1.0)), grassHash31(i + vec3(1.0, 1.0, 1.0)), u.x),
                u.y
              ),
              u.z
            );
          }

          vec2 grassVoronoi3D(vec3 p) {
            vec3 i = floor(p);
            vec3 f = fract(p);
            float minD = 8.0;
            float cellId = 0.0;
            for (int z = -1; z <= 1; z++) {
              for (int y = -1; y <= 1; y++) {
                for (int x = -1; x <= 1; x++) {
                  vec3 neighbor = vec3(float(x), float(y), float(z));
                  vec3 rnd = grassHash33(i + neighbor);
                  vec3 diff = neighbor + rnd - f;
                  float d = dot(diff, diff);
                  if (d < minD) {
                    minD = d;
                    cellId = rnd.x;
                  }
                }
              }
            }
            return vec2(sqrt(minD), cellId);
          }

          vec3 grassPerturbNormalArb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir) {
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
          vec3 triW = abs(vPlanetNormal);
          triW *= triW;
          triW *= triW;
          triW /= max(triW.x + triW.y + triW.z, 0.0001);
          float texScale = 0.018;
          vec3 tx = texture2D(uDetailTex, vPlanetPos.yz * texScale).rgb;
          vec3 ty = texture2D(uDetailTex, vPlanetPos.xz * texScale).rgb;
          vec3 tz = texture2D(uDetailTex, vPlanetPos.xy * texScale).rgb;
          vec3 detailTint = tx * triW.x + ty * triW.y + tz * triW.z;
          float lum = dot(detailTint, vec3(0.299, 0.587, 0.114));
          diffuseColor.rgb *= mix(1.0, lum * 1.5, 0.45);

          float grassCamDist = distance(cameraPosition, vPlanetPos);
          float grassNearFade = 1.0 - smoothstep(35.0, 150.0, grassCamDist);
          float grassBumpH = 0.0;

          if (vGrass > 0.001) {
            // 1. Macro patches (~0.035)
            float patchN = grassNoise3D(vPlanetPos * 0.035);
            vec3 grassTint = mix(vec3(0.62, 0.78, 0.30), vec3(0.24, 0.62, 0.38), patchN);
            float grassTintMean = (grassTint.r + grassTint.g + grassTint.b) / 3.0;
            diffuseColor.rgb *= mix(vec3(1.0), grassTint / max(grassTintMean, 0.001), vGrass * 0.75);

            // 2. Medium scale (~0.25) +-12%
            float medN = grassNoise3D(vPlanetPos * 0.25 + vec3(5.2, 13.7, 9.1));
            diffuseColor.rgb *= 1.0 + (medN * 2.0 - 1.0) * 0.12 * vGrass;

            // 5. Subtle wind brightness wave
            if (uGrassDetail > 0.3 && grassNearFade > 0.001) {
              float windWave = 0.04 * sin(uTime * 1.2 + dot(vPlanetPos, vec3(0.3, 0.2, 0.4)));
              diffuseColor.rgb *= 1.0 + windWave * grassNearFade * vGrass;
            }

            // 3. Close fur layers (~4 and ~9) + synthetic height for bump (only on grassy nearby pixels)
            if (uGrassDetail > 0.3 && grassNearFade > 0.001) {
              float gN1 = grassNoise3D(vPlanetPos * 4.0);
              float gN2 = grassNoise3D(vPlanetPos * 9.0 + vec3(17.3, 31.7, 11.1));
              float gTips = smoothstep(0.55, 0.9, gN1);
              float gTufts = smoothstep(0.5, 0.85, gN2);
              grassBumpH = gTips - gTufts * 0.65;
              float furShade = (gTips - gTufts) * 0.18;
              diffuseColor.rgb *= 1.0 + furShade * grassNearFade * uGrassDetail * vGrass;
            }

            // 4. Flowers (Voronoi ~1.4, ~12% cells)
            if (uGrassDetail > 0.5 && vGrass > 0.6 && grassCamDist < 60.0) {
              vec2 vor = grassVoronoi3D(vPlanetPos * 1.4);
              if (vor.y < 0.12) {
                float dotMask = (1.0 - smoothstep(0.06, 0.14, vor.x)) * (1.0 - smoothstep(45.0, 60.0, grassCamDist));
                if (dotMask > 0.001) {
                  float colPick = fract(vor.y * 83.71);
                  vec3 flowerCol = colPick < 0.333
                    ? vec3(0.98, 0.98, 0.95)
                    : colPick < 0.666
                      ? vec3(0.98, 0.86, 0.25)
                      : vec3(0.96, 0.52, 0.72);
                  float flowerBlend = dotMask * smoothstep(0.6, 0.78, vGrass) * 0.9;
                  diffuseColor.rgb = mix(diffuseColor.rgb, flowerCol, flowerBlend);
                }
              }
            }
          }

          if (uShowContours > 0.5 && grassCamDist < 220.0) {
            float r = length(vPlanetPos);
            float e = abs(fract(r * 0.18 - 0.5) - 0.5) / max(fwidth(r * 0.18), 0.0001);
            float contourLine = 1.0 - min(e, 1.0);

            vec3 dir = vPlanetPos / max(r, 0.001);
            float lat = asin(clamp(dir.y, -1.0, 1.0)) * 8.0;
            float lon = atan(dir.z, dir.x) * 8.0;
            float gLat = abs(fract(lat - 0.5) - 0.5) / max(fwidth(lat), 0.0001);
            float gLon = abs(fract(lon - 0.5) - 0.5) / max(fwidth(lon), 0.0001);
            float gridLine = 1.0 - min(min(gLat, gLon), 1.0);

            float distFade = 1.0 - smoothstep(60.0, 220.0, grassCamDist);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.38, 0.82, 1.0), gridLine * 0.08 * distFade);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.55, 1.0), contourLine * 0.12 * distFade);
          }`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          if (uGrassDetail > 0.3 && vGrass > 0.001 && grassNearFade > 0.001) {
            float grassBumpAmp = 0.35 * grassNearFade * uGrassDetail * vGrass;
            if (grassBumpAmp > 0.001) {
              vec2 grassDH = vec2(dFdx(grassBumpH), dFdy(grassBumpH));
              normal = grassPerturbNormalArb(-vViewPosition, normal, grassDH * grassBumpAmp, faceDirection);
            }
          }`,
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
            'aGrass',
            new THREE.BufferAttribute(new Float32Array(vc), 1),
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
    this.moonPivot.add(this.moonMesh);
    this.root.add(this.moonPivot);

    this.rebuildPlanet();
  }

  public get patchCount(): number {
    return this.patches.length;
  }

  public getVisiblePatchCount(): number {
    let count = 0;
    for (let i = 0; i < this.patches.length; i++) {
      if (this.patches[i].mesh.visible) count++;
    }
    return count;
  }

  public setGrassDetail(detail: number): void {
    this.grassDetailUniform.value = THREE.MathUtils.clamp(detail, 0, 1);
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
  }

  public updateHorizonCulling(
    cameraPos: THREE.Vector3,
    camera?: THREE.Camera,
  ): void {
    const camDist = cameraPos.length();
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
    this.contourUniform.value = next.showContours ? 1.0 : 0.0;
    this.params = { ...next };

    if (geoChanged) {
      this.rebuildPlanet();
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
  ): [number, number, number] {
    const eps = 0.008;
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

    const sample = (dx: number, dy: number, dz: number) => {
      const len = Math.hypot(dx, dy, dz) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const uz = dz / len;
      const r =
        planetRadius +
        getPlanetSurfaceHeight(
          ux,
          uy,
          uz,
          planetRadius,
          noiseScale,
          maxHeight,
          seaLevel,
        );
      return [ux * r, uy * r, uz * r];
    };

    const p1a = sample(nx + t1x * eps, ny + t1y * eps, nz + t1z * eps);
    const p1b = sample(nx - t1x * eps, ny - t1y * eps, nz - t1z * eps);
    const p2a = sample(nx + t2x * eps, ny + t2y * eps, nz + t2z * eps);
    const p2b = sample(nx - t2x * eps, ny - t2y * eps, nz - t2z * eps);

    const d1x = p1a[0] - p1b[0];
    const d1y = p1a[1] - p1b[1];
    const d1z = p1a[2] - p1b[2];

    const d2x = p2a[0] - p2b[0];
    const d2y = p2a[1] - p2b[1];
    const d2z = p2a[2] - p2b[2];

    let outX = d1y * d2z - d1z * d2y;
    let outY = d1z * d2x - d1x * d2z;
    let outZ = d1x * d2y - d1y * d2x;
    if (outX * nx + outY * ny + outZ * nz < 0) {
      outX = -outX;
      outY = -outY;
      outZ = -outZ;
    }
    const outLen = Math.hypot(outX, outY, outZ) || 1;
    return [outX / outLen, outY / outLen, outZ / outLen];
  }

  private rebuildPlanet(): void {
    const { planetRadius, maxHeight, noiseScale, seaLevel } = this.params;
    const safeMaxH = Math.max(maxHeight, 0.001);
    const seaFloorH = seaLevel * maxHeight;
    const patchSpan = 2 / PATCH_SUBDIV;

    for (const patch of this.patches) {
      const face = CUBE_FACES[patch.faceIdx];
      const uStart = -1 + patch.pu * patchSpan;
      const vStart = -1 + patch.pv * patchSpan;

      const posAttr = patch.geometry.getAttribute(
        'position',
      ) as THREE.BufferAttribute;
      const colAttr = patch.geometry.getAttribute(
        'color',
      ) as THREE.BufferAttribute;
      const normAttr = patch.geometry.getAttribute(
        'normal',
      ) as THREE.BufferAttribute;
      const grassAttr = patch.geometry.getAttribute(
        'aGrass',
      ) as THREE.BufferAttribute;

      const positions = posAttr.array as Float32Array;
      const colors = colAttr.array as Float32Array;
      const normals = normAttr.array as Float32Array;
      const grass = grassAttr.array as Float32Array;

      let vi = 0;
      for (let py = 0; py <= PATCH_SEGMENTS; py++) {
        const v = vStart + (py / PATCH_SEGMENTS) * patchSpan;
        for (let px = 0; px <= PATCH_SEGMENTS; px++) {
          const u = uStart + (px / PATCH_SEGMENTS) * patchSpan;

          const cx =
            face.normal[0] + u * face.uAxis[0] + v * face.vAxis[0];
          const cy =
            face.normal[1] + u * face.uAxis[1] + v * face.vAxis[1];
          const cz =
            face.normal[2] + u * face.uAxis[2] + v * face.vAxis[2];

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
          );
          normals[vi * 3] = snx;
          normals[vi * 3 + 1] = sny;
          normals[vi * 3 + 2] = snz;

          const rawHeightNorm = THREE.MathUtils.clamp(rawH / safeMaxH, -1, 1);
          getBiomeColor(
            nx,
            ny,
            nz,
            rawHeightNorm,
            seaLevel,
            this.tempColor,
            _biomeSample,
          );

          colors[vi * 3] = this.tempColor.r;
          colors[vi * 3 + 1] = this.tempColor.g;
          colors[vi * 3 + 2] = this.tempColor.b;

          const dotSlope = THREE.MathUtils.clamp(
            snx * nx + sny * ny + snz * nz,
            0,
            1,
          );
          grass[vi] =
            getGrassCoverage(
              _biomeSample.T,
              _biomeSample.M,
              rawHeightNorm,
              seaLevel,
            ) * smoothstep(0.8, 0.92, dotSlope);
          vi++;
        }
      }

      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      normAttr.needsUpdate = true;
      grassAttr.needsUpdate = true;
      patch.geometry.computeBoundingSphere();
    }

    this.syncShellScales();
  }

  public dispose(): void {
    for (const patch of this.patches) {
      this.root.remove(patch.mesh);
      patch.geometry.dispose();
    }
    this.patches.length = 0;
    this.surfaceTexture.dispose();
    this.terrainMaterial.dispose();
    this.atmosphereGeo.dispose();
    this.atmosphereMat.dispose();
    this.moonGeo.dispose();
    this.moonMat.dispose();
  }
}
