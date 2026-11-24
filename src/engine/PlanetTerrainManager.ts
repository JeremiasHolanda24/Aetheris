import * as THREE from 'three';
import { PlanetParams } from '../types/simulation';
import { getPlanetTerrainHeight, spherifyCubePoint } from './terrainMath';

interface CubeFaceBasis {
  normal: [number, number, number];
  uAxis: [number, number, number];
  vAxis: [number, number, number];
}

// All 6 faces satisfy cross(uAxis, vAxis) === normal for consistent outward FrontSide winding
const CUBE_FACES: CubeFaceBasis[] = [
  { normal: [0, 1, 0], uAxis: [1, 0, 0], vAxis: [0, 0, -1] },  // +Y
  { normal: [0, -1, 0], uAxis: [1, 0, 0], vAxis: [0, 0, 1] },  // -Y
  { normal: [1, 0, 0], uAxis: [0, 0, -1], vAxis: [0, 1, 0] },  // +X
  { normal: [-1, 0, 0], uAxis: [0, 0, 1], vAxis: [0, 1, 0] },  // -X
  { normal: [0, 0, 1], uAxis: [1, 0, 0], vAxis: [0, 1, 0] },   // +Z
  { normal: [0, 0, -1], uAxis: [-1, 0, 0], vAxis: [0, 1, 0] }, // -Z
];

const PATCH_SUBDIV = 3;
const PATCH_SEGMENTS = 20;

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
 * - 100% continuous terrain across all 54 Cube-Sphere patches (no black ocean cutouts)
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
  }> = [];

  private sharedIndices: THREE.BufferAttribute;
  private sharedUvs: THREE.BufferAttribute;
  private surfaceTexture: THREE.CanvasTexture;
  private terrainMaterial: THREE.MeshStandardMaterial;
  private contourUniform = { value: 1.0 };

  private atmosphereMesh: THREE.Mesh;
  private atmosphereGeo: THREE.SphereGeometry;
  private atmosphereMat: THREE.ShaderMaterial;

  private moonPivot = new THREE.Group();
  private moonMesh: THREE.Mesh;
  private moonGeo: THREE.IcosahedronGeometry;
  private moonMat: THREE.MeshStandardMaterial;
  private readonly moonCenter = new THREE.Vector3();

  private params: PlanetParams;

  // 100% Blue & Purple terrain palette (no dark/black valleys)
  private readonly valleyBlueColor = new THREE.Color(0x1d4ed8);   // Vivid Cobalt Blue
  private readonly midIndigoColor = new THREE.Color(0x4338ca);    // Deep Electric Indigo
  private readonly ridgePurpleColor = new THREE.Color(0x7c3aed);  // Vibrant Amethyst Purple
  private readonly peakLavenderColor = new THREE.Color(0xc4b5fd); // Bright Violet-Lavender Peaks
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
      envMapIntensity: 0.4,
      emissive: new THREE.Color(0x16123d),
      emissiveIntensity: 0.25,
      wireframe: initialParams.wireframe,
      side: THREE.FrontSide,
    });

    this.contourUniform.value = initialParams.showContours ? 1.0 : 0.0;

    this.terrainMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uShowContours = this.contourUniform;
      shader.uniforms.uDetailTex = { value: this.surfaceTexture };

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vPlanetPos;
          varying vec3 vPlanetNormal;`,
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
          vPlanetPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vPlanetNormal = normalize(mat3(modelMatrix) * objectNormal);`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vPlanetPos;
          varying vec3 vPlanetNormal;
          uniform float uShowContours;
          uniform sampler2D uDetailTex;`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          vec3 triW = abs(vPlanetNormal);
          triW = pow(triW, vec3(4.0));
          triW /= max(triW.x + triW.y + triW.z, 0.0001);
          float texScale = 0.018;
          vec3 tx = texture2D(uDetailTex, vPlanetPos.yz * texScale).rgb;
          vec3 ty = texture2D(uDetailTex, vPlanetPos.xz * texScale).rgb;
          vec3 tz = texture2D(uDetailTex, vPlanetPos.xy * texScale).rgb;
          vec3 detailTint = tx * triW.x + ty * triW.y + tz * triW.z;
          diffuseColor.rgb *= mix(vec3(1.0), detailTint * 1.18, 0.7);

          if (uShowContours > 0.5) {
            float r = length(vPlanetPos);
            float e = abs(fract(r * 0.18 - 0.5) - 0.5) / max(fwidth(r * 0.18), 0.0001);
            float contourLine = 1.0 - min(e, 1.0);

            vec3 dir = vPlanetPos / max(r, 0.001);
            float lat = asin(clamp(dir.y, -1.0, 1.0)) * 8.0;
            float lon = atan(dir.z, dir.x) * 8.0;
            float gLat = abs(fract(lat - 0.5) - 0.5) / max(fwidth(lat), 0.0001);
            float gLon = abs(fract(lon - 0.5) - 0.5) / max(fwidth(lon), 0.0001);
            float gridLine = 1.0 - min(min(gLat, gLon), 1.0);

            float distFade = 1.0 - smoothstep(60.0, 220.0, distance(cameraPosition, vPlanetPos));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.38, 0.82, 1.0), gridLine * 0.08 * distFade);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.55, 1.0), contourLine * 0.12 * distFade);
          }`,
        );
    };

    for (let f = 0; f < CUBE_FACES.length; f++) {
      for (let pv = 0; pv < PATCH_SUBDIV; pv++) {
        for (let pu = 0; pu < PATCH_SUBDIV; pu++) {
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
          geometry.setAttribute('uv', this.sharedUvs);
          geometry.setIndex(this.sharedIndices);

          const mesh = new THREE.Mesh(geometry, this.terrainMaterial);
          mesh.receiveShadow = true;
          mesh.castShadow = false;
          this.root.add(mesh);

          this.patches.push({ faceIdx: f, pu, pv, mesh, geometry });
        }
      }
    }

    // Cyan-to-Violet Atmospheric Fresnel Glow Shell
    this.atmosphereGeo = new THREE.SphereGeometry(1, 36, 24);
    this.atmosphereMat = new THREE.ShaderMaterial({
      uniforms: {
        uColorInner: { value: new THREE.Color(0x38bdf8) },
        uColorOuter: { value: new THREE.Color(0x7c3aed) },
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
        void main() {
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float rim = clamp(0.65 - dot(viewDir, -vNormalWorld), 0.0, 1.0);
          float intensity = pow(rim, 2.5) * 0.85;
          vec3 col = mix(uColorOuter, uColorInner, pow(rim, 1.4));
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

    // Distant Orbiting Moon
    this.moonGeo = new THREE.IcosahedronGeometry(26, 2);
    this.moonMat = new THREE.MeshStandardMaterial({
      color: 0x8b92c4,
      roughness: 0.85,
      metalness: 0.1,
      envMapIntensity: 0.35,
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

  public getMoonState(): { center: THREE.Vector3; radius: number } {
    this.moonMesh.getWorldPosition(this.moonCenter);
    return { center: this.moonCenter, radius: 26 };
  }

  public getSurfaceRadiusAt(nx: number, ny: number, nz: number): number {
    const h = getPlanetTerrainHeight(
      nx,
      ny,
      nz,
      this.params.planetRadius,
      this.params.noiseScale,
      this.params.maxHeight,
    );
    return this.params.planetRadius + h;
  }

  public update(elapsed: number): void {
    this.moonPivot.rotation.y = elapsed * 0.035;
    this.moonMesh.rotation.y = elapsed * 0.08;
  }

  public updateParams(next: PlanetParams): void {
    const geoChanged =
      next.planetRadius !== this.params.planetRadius ||
      next.maxHeight !== this.params.maxHeight ||
      next.noiseScale !== this.params.noiseScale;

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
    this.moonMesh.position.set(planetRadius * 2.55, planetRadius * 0.45, 0);
  }

  private computeSmoothTerrainNormal(
    nx: number,
    ny: number,
    nz: number,
    planetRadius: number,
    noiseScale: number,
    maxHeight: number,
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
        getPlanetTerrainHeight(ux, uy, uz, planetRadius, noiseScale, maxHeight);
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
    const { planetRadius, maxHeight, noiseScale } = this.params;
    const safeMaxH = Math.max(maxHeight, 0.001);
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

      const positions = posAttr.array as Float32Array;
      const colors = colAttr.array as Float32Array;
      const normals = normAttr.array as Float32Array;

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
          const h = getPlanetTerrainHeight(
            nx,
            ny,
            nz,
            planetRadius,
            noiseScale,
            maxHeight,
          );
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
          );
          normals[vi * 3] = snx;
          normals[vi * 3 + 1] = sny;
          normals[vi * 3 + 2] = snz;

          const t = THREE.MathUtils.clamp((h / safeMaxH + 0.85) / 1.7, 0, 1);
          if (t < 0.35) {
            this.tempColor.lerpColors(
              this.valleyBlueColor,
              this.midIndigoColor,
              t / 0.35,
            );
          } else if (t < 0.72) {
            this.tempColor.lerpColors(
              this.midIndigoColor,
              this.ridgePurpleColor,
              (t - 0.35) / 0.37,
            );
          } else {
            this.tempColor.lerpColors(
              this.ridgePurpleColor,
              this.peakLavenderColor,
              (t - 0.72) / 0.28,
            );
          }

          colors[vi * 3] = this.tempColor.r;
          colors[vi * 3 + 1] = this.tempColor.g;
          colors[vi * 3 + 2] = this.tempColor.b;
          vi++;
        }
      }

      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      normAttr.needsUpdate = true;
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
