import * as THREE from 'three';
import { BackdropParams } from '../types/simulation';

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function smoothNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);

  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm4(x: number, y: number): number {
  let val = 0;
  let amp = 0.5;
  let px = x;
  let py = y;
  for (let i = 0; i < 4; i++) {
    val += amp * smoothNoise(px, py);
    px *= 2.04;
    py *= 2.04;
    amp *= 0.5;
  }
  return val;
}

function createBakedNebulaTexture(): THREE.CanvasTexture {
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
        const u = x / size - 0.5;
        const v = y / size - 0.5;
        const dist = Math.hypot(u, v);
        const radial = Math.max(0, 1 - THREE.MathUtils.smoothstep(dist, 0.14, 0.5));

        const px = u * 4.2 + 3.1;
        const py = v * 4.2 + 1.7;
        const n1 = fbm4(px, py);
        const n2 = fbm4(px * 1.55 + n1 * 1.35, py * 1.55 + n1 * 1.35);
        const cloud = THREE.MathUtils.smoothstep(n2, 0.3, 0.8) * radial;

        const m1 = THREE.MathUtils.smoothstep(n1, 0.25, 0.75);
        const m2 = THREE.MathUtils.smoothstep(n2, 0.62, 0.92) * 0.45;

        let r = 0.09 + (0.24 - 0.09) * m1;
        let g = 0.08 + (0.1 - 0.08) * m1;
        let b = 0.28 + (0.36 - 0.28) * m1;
        r = r + (0.42 - r) * m2;
        g = g + (0.22 - g) * m2;
        b = b + (0.08 - b) * m2;

        const idx = (y * size + x) * 4;
        data[idx] = Math.round(r * 255);
        data[idx + 1] = Math.round(g * 255);
        data[idx + 2] = Math.round(b * 255);
        data[idx + 3] = Math.round(cloud * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Full-3D SpaceBackground surrounding the ship in all directions:
 * - Spherical 3D starfield with custom GLSL StarPoint shader
 * - Pre-baked cosmic nebula backdrop sphere
 */
export class SpaceBackground {
  public readonly root = new THREE.Group();

  private starPoints: THREE.Points | null = null;
  private starGeometry: THREE.BufferGeometry | null = null;
  private starMaterial: THREE.ShaderMaterial;

  private nebulaMesh: THREE.Mesh;
  private nebulaGeometry: THREE.SphereGeometry;
  private nebulaTexture: THREE.CanvasTexture;
  private nebulaMaterial: THREE.MeshBasicMaterial;

  private params: BackdropParams;
  private starRatio = 1;
  private totalStars = 0;
  private skyVisibility = 1;
  private skyVisible = true;
  private readonly tempColor = new THREE.Color();

  constructor(initialParams: BackdropParams) {
    this.params = { ...initialParams };
    this.root.name = 'SpaceBackground';

    this.root.renderOrder = -1000;

    this.starMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: 1 },
        uSkyVisibility: { value: 1 },
      },
      vertexShader: `
        attribute float aSize;
        attribute float aPhase;
        varying vec3 vColor;
        varying float vTwinkle;
        uniform float uTime;
        uniform float uPixelRatio;

        void main() {
          vColor = color;
          vTwinkle = 0.8 + 0.2 * sin(uTime * 1.6 + aPhase);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp(aSize * uPixelRatio * (520.0 / max(-mvPosition.z, 120.0)), 1.5, 8.5);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vTwinkle;
        uniform float uSkyVisibility;

        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float a = 1.0 - smoothstep(0.22, 0.5, d);
          gl_FragColor = vec4(vColor * vTwinkle * uSkyVisibility, a * uSkyVisibility);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      fog: false,
    });

    this.nebulaTexture = createBakedNebulaTexture();
    this.nebulaGeometry = new THREE.SphereGeometry(1250, 20, 14);
    this.nebulaMaterial = new THREE.MeshBasicMaterial({
      map: this.nebulaTexture,
      transparent: true,
      opacity: initialParams.nebulaOpacity,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      fog: false,
    });

    this.nebulaMesh = new THREE.Mesh(this.nebulaGeometry, this.nebulaMaterial);
    this.nebulaMesh.renderOrder = -1000;
    this.nebulaMesh.frustumCulled = false;
    this.root.add(this.nebulaMesh);

    this.rebuildStars();
  }

  public setPixelRatio(pr: number): void {
    this.starMaterial.uniforms.uPixelRatio.value = pr;
  }

  public setStarRatio(ratio: number): void {
    this.starRatio = THREE.MathUtils.clamp(ratio, 0.1, 1);
    if (this.starGeometry) {
      this.starGeometry.setDrawRange(
        0,
        Math.max(1, Math.round(this.totalStars * this.starRatio)),
      );
    }
  }

  private warmupSavedRootVisible = true;
  private warmupSavedSkyVisibility = 1;
  private warmupSavedSkyVisible = true;

  public prepareForShaderWarmup(): void {
    this.warmupSavedRootVisible = this.root.visible;
    this.warmupSavedSkyVisibility = this.skyVisibility;
    this.warmupSavedSkyVisible = this.skyVisible;
    this.root.visible = true;
    this.skyVisible = true;
    this.setSkyVisibility(1);
  }

  public restoreAfterShaderWarmup(): void {
    this.root.visible = this.warmupSavedRootVisible;
    this.skyVisible = this.warmupSavedSkyVisible;
    this.setSkyVisibility(this.warmupSavedSkyVisibility);
  }

  public setSkyVisibility(visibility: number): void {
    const v = THREE.MathUtils.clamp(visibility, 0, 1);
    this.skyVisibility = v;

    if (this.skyVisible && v < 0.02) {
      this.skyVisible = false;
    } else if (!this.skyVisible && v > 0.06) {
      this.skyVisible = true;
    }

    this.nebulaMaterial.opacity = this.params.nebulaOpacity * v;
    this.starMaterial.uniforms.uSkyVisibility.value = v;
    this.nebulaMesh.visible = this.skyVisible;
    if (this.starPoints) {
      this.starPoints.visible = this.skyVisible;
    }
  }

  public updateParams(next: BackdropParams): void {
    const starsNeedRebuild =
      next.starCount !== this.params.starCount ||
      next.minStarSize !== this.params.minStarSize ||
      next.maxStarSize !== this.params.maxStarSize;

    this.nebulaMaterial.opacity = next.nebulaOpacity * this.skyVisibility;
    this.params = { ...next };

    if (starsNeedRebuild) {
      this.rebuildStars();
      if (this.starPoints) {
        this.starPoints.visible = this.skyVisible;
      }
    }
  }

  private rebuildStars(): void {
    if (this.starPoints) {
      this.root.remove(this.starPoints);
      this.starGeometry?.dispose();
    }

    const count = Math.max(100, Math.floor(this.params.starCount));
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);

    const rng = mulberry32(42);
    const minS = this.params.minStarSize;
    const maxS = Math.max(minS, this.params.maxStarSize);

    for (let i = 0; i < count; i++) {
      const theta = rng() * Math.PI * 2;
      const phi = Math.acos(2 * rng() - 1);
      const radius = 850 + rng() * 320;

      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.cos(phi);
      positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

      const hue = rng();
      const sat = 0.14 + rng() * 0.12;
      const val = 0.55 + rng() * 0.45;
      this.tempColor.setHSL(hue, sat, val);

      colors[i * 3] = this.tempColor.r;
      colors[i * 3 + 1] = this.tempColor.g;
      colors[i * 3 + 2] = this.tempColor.b;

      sizes[i] = minS + rng() * (maxS - minS);
      phases[i] = rng() * Math.PI * 2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geo.computeBoundingSphere();

    this.totalStars = count;
    geo.setDrawRange(
      0,
      Math.max(1, Math.round(this.totalStars * this.starRatio)),
    );

    this.starGeometry = geo;
    this.starPoints = new THREE.Points(geo, this.starMaterial);
    this.starPoints.renderOrder = -999;
    this.starPoints.frustumCulled = false;
    this.root.add(this.starPoints);
  }

  public update(elapsed: number, cameraPos: THREE.Vector3): void {
    this.starMaterial.uniforms.uTime.value = elapsed;
    this.root.position.copy(cameraPos);
    this.nebulaMesh.rotation.y = elapsed * 0.0025;
  }

  public dispose(): void {
    if (this.starPoints) {
      this.root.remove(this.starPoints);
    }
    this.starGeometry?.dispose();
    this.starMaterial.dispose();
    this.nebulaGeometry.dispose();
    this.nebulaMaterial.dispose();
    this.nebulaTexture.dispose();
  }
}
