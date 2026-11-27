import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GEAR_REST_HEIGHT } from './LandingController';

export interface ShipColliderBox {
  id: string;
  min: THREE.Vector3;
  max: THREE.Vector3;
  requiresGear?: boolean;
}

export interface ShipModelHandle {
  group: THREE.Group;
  colliders: ShipColliderBox[];
  leftFlame: THREE.Mesh;
  rightFlame: THREE.Mesh;
  thrusterLight: THREE.PointLight | null;
  flameMaterial: THREE.MeshBasicMaterial;
  setGearExtension: (t: number) => void;
  setCockpitView: (active: boolean) => void;
  setPilotSeated: (seated: boolean) => void;
  updateCockpit: (
    dt: number,
    speed: number,
    altitude: number,
    inSpace: boolean,
    isBoosting: boolean,
    turnInput: number,
    pitchInput: number,
    pitchRad?: number,
    rollRad?: number,
    headingDeg?: number,
    targetBearingDeg?: number,
  ) => void;
  updateEffects: (
    elapsed: number,
    thrustPower: number,
    isBoosting: boolean,
    reentryIntensity: number,
  ) => void;
  dispose: () => void;
}

export interface BeaconModelHandle {
  group: THREE.Group;
  outerRing: THREE.Mesh;
  innerRing: THREE.Mesh;
  core: THREE.Mesh;
  beam: THREE.Mesh;
  update: (elapsed: number, dt: number) => void;
  dispose: () => void;
}

const _mergeColor = new THREE.Color();

function remapAtlasUVs(
  geo: THREE.BufferGeometry,
  region: 'hull' | 'wing' | 'white',
): THREE.BufferGeometry {
  if (!geo.getAttribute('uv')) {
    const count = geo.getAttribute('position').count;
    geo.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2),
    );
  }
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const u = THREE.MathUtils.clamp(uv.getX(i), 0, 1);
    const v = THREE.MathUtils.clamp(uv.getY(i), 0, 1);
    if (region === 'hull') {
      uv.setXY(i, 0.002 + u * 0.496, 0.002 + v * 0.996);
    } else if (region === 'wing') {
      uv.setXY(i, 0.504 + u * 0.242, 0.504 + v * 0.492);
    } else {
      uv.setXY(i, 0.875, 0.25);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

function mergeStaticGeometries(
  parts: THREE.BufferGeometry[],
): THREE.BufferGeometry {
  const normalized = parts.map((g) => {
    const nonIdx = g.index ? g.toNonIndexed() : g;
    if (!nonIdx.getAttribute('normal')) {
      nonIdx.computeVertexNormals();
    }
    if (!nonIdx.getAttribute('uv')) {
      const count = nonIdx.getAttribute('position').count;
      nonIdx.setAttribute(
        'uv',
        new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2),
      );
    }
    return nonIdx;
  });
  const merged = mergeGeometries(normalized, false);
  for (let i = 0; i < parts.length; i++) {
    if (normalized[i] !== parts[i]) normalized[i].dispose();
    parts[i].dispose();
  }
  return merged;
}

interface ColoredGeoPart {
  geo: THREE.BufferGeometry;
  color: number;
  atlasRegion?: 'hull' | 'wing' | 'white';
}

function mergeColoredGeometries(
  parts: ColoredGeoPart[],
): THREE.BufferGeometry {
  const normalized = parts.map((part) => {
    const g = part.geo.index ? part.geo.toNonIndexed() : part.geo;
    if (!g.getAttribute('normal')) {
      g.computeVertexNormals();
    }
    if (part.atlasRegion) {
      remapAtlasUVs(g, part.atlasRegion);
    } else if (!g.getAttribute('uv')) {
      const count = g.getAttribute('position').count;
      g.setAttribute(
        'uv',
        new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2),
      );
    }
    const count = g.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    _mergeColor.setHex(part.color);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = _mergeColor.r;
      colors[i * 3 + 1] = _mergeColor.g;
      colors[i * 3 + 2] = _mergeColor.b;
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return g;
  });
  const merged = mergeGeometries(normalized, false);
  for (let i = 0; i < parts.length; i++) {
    if (normalized[i] !== parts[i].geo) normalized[i].dispose();
    parts[i].geo.dispose();
  }
  return merged;
}

let loggedShipMeshStats = false;
let loggedBeaconMeshStats = false;

function makeBox(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

function makeCyl(
  rt: number,
  rb: number,
  h: number,
  segs: number,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rt, rb, h, segs);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

function createShipAtlasTexture(): THREE.CanvasTexture {
  const width = 1024;
  const height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    // 1. Left 512x512: Starfighter hull texture (u in [0, 0.5], v in [0, 1])
    const hullSize = 512;
    ctx.fillStyle = '#f2ede2';
    ctx.fillRect(0, 0, hullSize, hullSize);

    const sideGrad = ctx.createLinearGradient(0, 0, hullSize, 0);
    sideGrad.addColorStop(0.0, '#dfd8ca');
    sideGrad.addColorStop(0.25, '#ece6da');
    sideGrad.addColorStop(0.5, '#f6f2e9');
    sideGrad.addColorStop(0.75, '#ece6da');
    sideGrad.addColorStop(1.0, '#dfd8ca');
    ctx.fillStyle = sideGrad;
    ctx.fillRect(0, 0, hullSize, hullSize);

    const cx = hullSize * 0.5;
    const stripeTop = hullSize * 0.135;
    const stripeBot = hullSize * 0.37;

    ctx.fillStyle = '#c84833';
    ctx.beginPath();
    ctx.moveTo(cx - 11, stripeTop);
    ctx.lineTo(cx + 11, stripeTop);
    ctx.lineTo(cx + 15, stripeBot);
    ctx.lineTo(cx - 15, stripeBot);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx - 18, stripeTop + 6);
    ctx.lineTo(cx - 14.5, stripeTop + 6);
    ctx.lineTo(cx - 19, stripeBot);
    ctx.lineTo(cx - 23.5, stripeBot);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx + 14.5, stripeTop + 6);
    ctx.lineTo(cx + 18, stripeTop + 6);
    ctx.lineTo(cx + 23.5, stripeBot);
    ctx.lineTo(cx + 19, stripeBot);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(176, 134, 62, 0.72)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(cx, hullSize * 0.105, 5.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, hullSize * 0.105, 11, Math.PI * 0.18, Math.PI * 0.82);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, hullSize * 0.062);
    ctx.lineTo(cx, hullSize * 0.094);
    ctx.moveTo(cx - 5, hullSize * 0.072);
    ctx.lineTo(cx - 5, hullSize * 0.096);
    ctx.moveTo(cx + 5, hullSize * 0.072);
    ctx.lineTo(cx + 5, hullSize * 0.096);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(130, 114, 88, 0.34)';
    ctx.lineWidth = 1.4;
    const panelYs = [0.22, 0.34, 0.66, 0.80, 0.91];
    for (let i = 0; i < panelYs.length; i++) {
      const py = hullSize * panelYs[i];
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(hullSize, py);
      ctx.stroke();
    }

    const seamXs = [0.22, 0.34, 0.42, 0.58, 0.66, 0.78];
    for (let i = 0; i < seamXs.length; i++) {
      const px = hullSize * seamXs[i];
      ctx.beginPath();
      ctx.moveTo(px, hullSize * 0.08);
      ctx.lineTo(px, hullSize * 0.96);
      ctx.stroke();
    }

    // 2. Top-mid-right 256x256: Wing & Pod texture (u in [0.5, 0.75], v in [0.5, 1.0])
    const podSize = 256;
    ctx.save();
    ctx.translate(512, 0);
    ctx.fillStyle = '#f0ebe0';
    ctx.fillRect(0, 0, podSize, podSize);

    const grad = ctx.createLinearGradient(0, 0, 0, podSize);
    grad.addColorStop(0, '#f5f1e8');
    grad.addColorStop(1, '#e3dccd');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, podSize, podSize);

    ctx.strokeStyle = 'rgba(128, 112, 86, 0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(18, 22, podSize - 36, podSize - 44);
    ctx.beginPath();
    ctx.moveTo(18, podSize * 0.55);
    ctx.lineTo(podSize - 18, podSize * 0.55);
    ctx.moveTo(podSize * 0.5, 22);
    ctx.lineTo(podSize * 0.5, podSize - 22);
    ctx.stroke();
    ctx.restore();

    // 3. Bottom-right 256x256: Solid white swatch for vertex-colored painted parts
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(768, 256, 256, 256);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 2;
  tex.needsUpdate = true;
  return tex;
}

// 1.6x full-scale starfighter hull profile (length 6.80 u: z = -3.85 .. +2.95)
// Designed so a 1.66 u tall astronaut fits comfortably inside the cockpit cavity.
const COCKPIT_Z_MIN = -1.28;
const COCKPIT_Z_MAX = 0.50;
const COCKPIT_RIM_THETA = Math.PI * 0.185; // ~33 deg from top centerline -> xRim ~ +-0.49
const COCKPIT_FLOOR_Y = -0.15;
const COCKPIT_FLOOR_HALF_W = 0.39;

function fuselageProfileAt(t: number): {
  z: number;
  rx: number;
  yTop: number;
  yBot: number;
} {
  const z = THREE.MathUtils.lerp(-3.85, 2.95, t);

  let rx: number;
  if (t < 0.08) {
    rx = 0.018 + 0.38 * Math.pow(t / 0.08, 0.62);
  } else if (t < 0.52) {
    const u = (t - 0.08) / 0.44;
    rx = 0.398 + 0.482 * Math.sin(u * Math.PI * 0.5);
  } else if (t < 0.84) {
    const u = (t - 0.52) / 0.32;
    rx = 0.88 - 0.10 * Math.sin(u * Math.PI * 0.5);
  } else {
    const u = (t - 0.84) / 0.16;
    rx = 0.78 - 0.24 * u * u;
  }

  const noseRise = Math.pow(Math.min(t / 0.38, 1), 0.72);
  const tailTaper = t > 0.82 ? ((t - 0.82) / 0.18) * 0.14 : 0;
  const yTop = 0.025 + 0.455 * noseRise - tailTaper;
  const yBot = -0.025 - 0.395 * Math.sin(Math.min(t / 0.9, 1) * Math.PI * 0.85);

  return { z, rx, yTop, yBot };
}

function hullOuterPointAt(
  z: number,
  rx: number,
  yTop: number,
  yBot: number,
  theta: number,
  radialPad = 0,
): { x: number; y: number } {
  const w = rx + radialPad;
  const midY = (yTop + yBot) * 0.5;
  const halfH = (yTop - yBot) * 0.5 + radialPad;
  const sinT = Math.sin(theta);
  const cosT = Math.cos(theta);
  const x = Math.sign(sinT) * Math.pow(Math.abs(sinT), 0.9) * w;
  const y =
    midY +
    (cosT >= 0
      ? Math.pow(cosT, 0.88) * halfH
      : -Math.pow(-cosT, 1.08) * halfH);
  void z;
  return { x, y };
}

function buildLoftedFuselageGeometry(
  tStart = 0,
  tEnd = 1,
  rings = 36,
  segs = 32,
  radialPad = 0,
  carveCockpit = true,
): THREE.BufferGeometry {
  const cols = segs + 1;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let r = 0; r <= rings; r++) {
    const rt = r / rings;
    const t = THREE.MathUtils.lerp(tStart, tEnd, rt);
    const { z, rx, yTop, yBot } = fuselageProfileAt(t);

    const sZ = THREE.MathUtils.clamp(
      (z - COCKPIT_Z_MIN) / (COCKPIT_Z_MAX - COCKPIT_Z_MIN),
      0,
      1,
    );
    const openWeight = carveCockpit
      ? THREE.MathUtils.smoothstep(sZ, 0, 0.22) *
        (1 - THREE.MathUtils.smoothstep(sZ, 0.78, 1))
      : 0;

    // Exact outer rim coordinates at theta = COCKPIT_RIM_THETA so U-channel meets sill seamlessly
    const rimOuter = hullOuterPointAt(
      z,
      rx,
      yTop,
      yBot,
      COCKPIT_RIM_THETA,
      radialPad,
    );

    for (let s = 0; s <= segs; s++) {
      const su = s / segs;
      const theta = (su - 0.5) * Math.PI * 2;
      const outer = hullOuterPointAt(z, rx, yTop, yBot, theta, radialPad);
      let x = outer.x;
      let y = outer.y;

      const absT = Math.abs(theta);
      if (openWeight > 0 && absT < COCKPIT_RIM_THETA) {
        const f = absT / COCKPIT_RIM_THETA; // 0 = centerline, 1 = coaming rim
        const signX = theta >= 0 ? 1 : -1;
        let tubX: number;
        let tubY: number;

        if (f <= 0.62) {
          // Flat cockpit floor inside U-channel
          const floorFrac = f / 0.62;
          tubX = signX * floorFrac * COCKPIT_FLOOR_HALF_W;
          tubY = COCKPIT_FLOOR_Y;
        } else {
          // Smoothly contoured sloped inner cockpit side walls meeting sill at f = 1.0
          const wallT = (f - 0.62) / 0.38;
          const eased = THREE.MathUtils.smoothstep(wallT, 0, 1);
          tubX = signX * THREE.MathUtils.lerp(COCKPIT_FLOOR_HALF_W, rimOuter.x, wallT);
          tubY = THREE.MathUtils.lerp(COCKPIT_FLOOR_Y, rimOuter.y, eased);
        }

        x = THREE.MathUtils.lerp(x, tubX, openWeight);
        y = THREE.MathUtils.lerp(y, tubY, openWeight);
      }

      positions.push(x, y, z);
      uvs.push(su, 1 - t);
    }
  }

  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const p00 = r * cols + s;
      const p10 = (r + 1) * cols + s;
      const p01 = p00 + 1;
      const p11 = p10 + 1;
      indices.push(p00, p10, p11);
      indices.push(p00, p11, p01);
    }
  }

  if (tEnd > 0.98) {
    const tailRingStart = rings * cols;
    const tailProfile = fuselageProfileAt(tEnd);
    const centerIdx = positions.length / 3;
    positions.push(
      0,
      (tailProfile.yTop + tailProfile.yBot) * 0.5,
      tailProfile.z,
    );
    uvs.push(0.5, 0);
    for (let s = 0; s < segs; s++) {
      indices.push(centerIdx, tailRingStart + s + 1, tailRingStart + s);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function hullSurfacePointAt(
  t: number,
  theta: number,
  radialPad = 0.002,
): THREE.Vector3 {
  const { z, rx, yTop, yBot } = fuselageProfileAt(t);
  const pt = hullOuterPointAt(z, rx, yTop, yBot, theta, radialPad);
  return new THREE.Vector3(pt.x, pt.y, z);
}

function buildHullSurfaceTube(
  samples: Array<[number, number]>,
  tubeRadius: number,
  radialPad = 0.002,
  tubularSegments = 24,
): THREE.TubeGeometry {
  const pts = samples.map(([t, theta]) =>
    hullSurfacePointAt(t, theta, radialPad),
  );
  return new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(pts, false),
    tubularSegments,
    tubeRadius,
    7,
    false,
  );
}

function buildCanopyEllipsoidRib(
  uZ: number,
  tubeRadius: number,
  radialPad = 0.002,
): THREE.TubeGeometry {
  const z = -0.39 + 0.9 * uZ;
  const ringScale = Math.sqrt(Math.max(0.02, 1 - uZ * uZ));
  const pts: THREE.Vector3[] = [];
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const a = THREE.MathUtils.lerp(-Math.PI * 0.48, Math.PI * 0.48, i / steps);
    const x = (0.495 + radialPad) * ringScale * Math.sin(a);
    const y = 0.40 + (0.52 + radialPad) * ringScale * Math.cos(a);
    pts.push(new THREE.Vector3(x, y, z));
  }
  return new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(pts, false),
    18,
    tubeRadius,
    6,
    false,
  );
}

function buildCockpitCoamingCurve(): THREE.TubeGeometry {
  // Sample exact rim points along the carved fuselage boundary so gold coaming sits flush with zero gaps
  const pts: THREE.Vector3[] = [];
  const tForZ = (zTarget: number) =>
    THREE.MathUtils.clamp((zTarget - -3.85) / (2.95 - -3.85), 0, 1);

  const zFwdNose = COCKPIT_Z_MIN + 0.08; // -1.20
  const zAftTail = COCKPIT_Z_MAX - 0.08; // +0.42

  // Forward centerline apex
  const fwdProf = fuselageProfileAt(tForZ(zFwdNose));
  pts.push(new THREE.Vector3(0, fwdProf.yTop - 0.01, zFwdNose));

  // Right sill from front to back
  const sideSamples = [-1.06, -0.84, -0.52, -0.20, 0.12, 0.30];
  for (let i = 0; i < sideSamples.length; i++) {
    const p = fuselageProfileAt(tForZ(sideSamples[i]));
    const rim = hullOuterPointAt(p.z, p.rx, p.yTop, p.yBot, COCKPIT_RIM_THETA, 0.002);
    pts.push(new THREE.Vector3(rim.x, rim.y, p.z));
  }

  // Aft centerline apex
  const aftProf = fuselageProfileAt(tForZ(zAftTail));
  pts.push(new THREE.Vector3(0, aftProf.yTop - 0.006, zAftTail));

  // Left sill from back to front
  for (let i = sideSamples.length - 1; i >= 0; i--) {
    const p = fuselageProfileAt(tForZ(sideSamples[i]));
    const rim = hullOuterPointAt(p.z, p.rx, p.yTop, p.yBot, -COCKPIT_RIM_THETA, 0.002);
    pts.push(new THREE.Vector3(rim.x, rim.y, p.z));
  }

  return new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(pts, true),
    36,
    0.018,
    8,
    true,
  );
}

function makeExtrudedSideShape(
  pts: Array<[number, number]>,
  side: -1 | 1,
  depth: number,
  bevelThickness: number,
  bevelSize: number,
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const ordered =
    side === 1 ? pts : pts.map(([x, y]) => [-x, y] as [number, number]).reverse();
  shape.moveTo(ordered[0][0], ordered[0][1]);
  for (let i = 1; i < ordered.length; i++) {
    shape.lineTo(ordered[i][0], ordered[i][1]);
  }
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness,
    bevelSize,
    bevelSegments: 2,
  });
  geo.rotateX(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

export function createShipModel(isMobileOrSoftware: boolean): ShipModelHandle {
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };
  const trackTex = <T extends THREE.Texture>(t: T): T => {
    textures.push(t);
    return t;
  };

  const shipAtlasTex = trackTex(createShipAtlasTexture());

  const shipPaintedMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: shipAtlasTex,
      color: 0xffffff,
      vertexColors: true,
      metalness: 0.15,
      roughness: 0.30,
      envMapIntensity: 1.0,
    }),
  );

  const brightMetalMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      metalness: 0.88,
      roughness: 0.25,
      envMapIntensity: 1.38,
    }),
  );

  const darkTrimMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      metalness: 0.58,
      roughness: 0.54,
      envMapIntensity: 0.72,
    }),
  );

  const pilotSuitMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.46,
      metalness: 0.14,
      envMapIntensity: 0.85,
    }),
  );

  const cockpitAccentMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
    }),
  );

  const pilotVisorMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x9fd8ff,
      emissive: 0x0b2239,
      emissiveIntensity: 0.22,
      metalness: 0.2,
      roughness: 0.08,
      envMapIntensity: 1.5,
      transparent: true,
      opacity: 0.36,
      depthWrite: false,
    }),
  );

  // Dynamic Cockpit MFD CanvasTextures (Left Speed, Center Attitude/Radar, Right Altitude)
  const createInstrumentScreen = (w = 512, h = 384) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const tex = trackTex(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    const mat = trackMat(
      new THREE.MeshBasicMaterial({
        map: tex,
        toneMapped: false,
      }),
    );
    return { canvas, ctx, tex, mat };
  };

  const speedScreen = createInstrumentScreen(512, 384);
  const altScreen = createInstrumentScreen(512, 384);

  // Transparent Green HUD Combiner Glass projection CanvasTexture
  const hudCanvas = document.createElement('canvas');
  hudCanvas.width = 512;
  hudCanvas.height = 384;
  const hudCtx = hudCanvas.getContext('2d');
  const hudTex = trackTex(new THREE.CanvasTexture(hudCanvas));
  hudTex.colorSpace = THREE.SRGBColorSpace;
  hudTex.generateMipmaps = false;
  hudTex.minFilter = THREE.LinearFilter;
  hudTex.magFilter = THREE.LinearFilter;

  const hudGlassTintMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0x22c55e,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );

  const hudSymbologyMat = trackMat(
    new THREE.MeshBasicMaterial({
      map: hudTex,
      transparent: true,
      opacity: 0.96,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );

  const drawSpeedConsole = (speed: number, isBoosting: boolean) => {
    const ctx = speedScreen.ctx;
    if (!ctx) return;
    const w = speedScreen.canvas.width;
    const h = speedScreen.canvas.height;
    const accent = isBoosting ? '#fbbf24' : '#38bdf8';

    ctx.fillStyle = '#040a12';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = accent;
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, w - 20, h - 20);

    ctx.fillStyle = isBoosting
      ? 'rgba(251, 191, 36, 0.22)'
      : 'rgba(56, 189, 248, 0.18)';
    ctx.fillRect(18, 18, w - 36, 66);

    ctx.fillStyle = accent;
    ctx.font = 'bold 34px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('VELOCIDADE', 30, 62);

    ctx.textAlign = 'right';
    ctx.font = 'bold 28px monospace';
    ctx.fillText(isBoosting ? 'TURBO' : 'NORM', w - 30, 62);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 132px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(String(Math.max(0, Math.round(speed))), 30, 232);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = 'bold 42px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('m/s', w - 32, 232);

    const barRatio = THREE.MathUtils.clamp(speed / 120, 0, 1);
    const segs = 12;
    const filledSegs = Math.round(barRatio * segs);
    const barX = 32;
    const barY = 294;
    const segW = 32;
    const gap = 5.5;
    for (let i = 0; i < segs; i++) {
      ctx.fillStyle =
        i < filledSegs
          ? i >= 9
            ? '#f59e0b'
            : accent
          : 'rgba(148, 163, 184, 0.26)';
      ctx.fillRect(barX + i * (segW + gap), barY, segW, 48);
    }

    speedScreen.tex.needsUpdate = true;
  };

  const drawAltConsole = (altitude: number, inSpace: boolean) => {
    const ctx = altScreen.ctx;
    if (!ctx) return;
    const w = altScreen.canvas.width;
    const h = altScreen.canvas.height;
    const accent = inSpace ? '#a78bfa' : '#34d399';

    ctx.fillStyle = '#040a12';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = accent;
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, w - 20, h - 20);

    ctx.fillStyle = inSpace
      ? 'rgba(167, 139, 250, 0.22)'
      : 'rgba(52, 211, 153, 0.18)';
    ctx.fillRect(18, 18, w - 36, 66);

    ctx.fillStyle = accent;
    ctx.font = 'bold 34px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('ALTITUDE', 30, 62);

    ctx.textAlign = 'right';
    ctx.font = 'bold 28px monospace';
    ctx.fillText(inSpace ? 'ORBIT' : 'ATMOS', w - 30, 62);

    const roundedAlt = Math.max(0, Math.round(altitude));
    const altText =
      roundedAlt >= 10000
        ? `${(roundedAlt / 1000).toFixed(1)}k`
        : String(roundedAlt);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 124px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(altText, 30, 232);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = 'bold 42px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('m', w - 32, 232);

    const barRatio = THREE.MathUtils.clamp(altitude / 220, 0, 1);
    const segs = 12;
    const filledSegs = Math.round(barRatio * segs);
    const barX = 32;
    const barY = 294;
    const segW = 32;
    const gap = 5.5;
    for (let i = 0; i < segs; i++) {
      ctx.fillStyle = i < filledSegs ? accent : 'rgba(148, 163, 184, 0.26)';
      ctx.fillRect(barX + i * (segW + gap), barY, segW, 48);
    }

    altScreen.tex.needsUpdate = true;
  };

  const drawHudCombiner = (
    speed: number,
    altitude: number,
    headingDeg: number,
    pitchRad: number,
    rollRad: number,
  ) => {
    const ctx = hudCtx;
    if (!ctx) return;
    const w = hudCanvas.width;
    const h = hudCanvas.height;
    const cx = w * 0.5;
    const cy = h * 0.52;

    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = '#4ade80';
    ctx.fillStyle = '#86efac';
    ctx.lineWidth = 4.5;

    // Heading tape at top of HUD glass
    ctx.font = 'bold 34px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(String(Math.round(headingDeg)).padStart(3, '0'), cx, 46);
    ctx.beginPath();
    ctx.moveTo(cx - 112, 60);
    ctx.lineTo(cx + 112, 60);
    for (let dx = -96; dx <= 96; dx += 32) {
      ctx.moveTo(cx + dx, 52);
      ctx.lineTo(cx + dx, 68);
    }
    ctx.stroke();

    // Left Speed Box & Right Altitude Box
    ctx.font = 'bold 32px monospace';
    ctx.textAlign = 'center';
    ctx.strokeRect(20, cy - 26, 98, 48);
    ctx.fillText(String(Math.round(speed)), 69, cy + 9);

    ctx.strokeRect(w - 118, cy - 26, 98, 48);
    ctx.fillText(String(Math.round(altitude)), w - 69, cy + 9);

    // Center Boresight Watermark Reticle (- v -)
    ctx.beginPath();
    ctx.moveTo(cx - 32, cy);
    ctx.lineTo(cx - 12, cy);
    ctx.lineTo(cx, cy + 12);
    ctx.lineTo(cx + 12, cy);
    ctx.lineTo(cx + 32, cy);
    ctx.stroke();

    // Pitch Ladder rotated by roll inside central HUD zone
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-rollRad);
    const pShift = THREE.MathUtils.clamp(pitchRad * 116, -68, 68);
    ctx.beginPath();
    // Horizon bar
    ctx.moveTo(-66, pShift);
    ctx.lineTo(-20, pShift);
    ctx.moveTo(20, pShift);
    ctx.lineTo(66, pShift);
    // +10 deg / -10 deg pitch bars
    ctx.moveTo(-46, pShift - 46);
    ctx.lineTo(-20, pShift - 46);
    ctx.moveTo(20, pShift - 46);
    ctx.lineTo(46, pShift - 46);
    ctx.moveTo(-46, pShift + 46);
    ctx.lineTo(-20, pShift + 46);
    ctx.moveTo(20, pShift + 46);
    ctx.lineTo(46, pShift + 46);
    ctx.stroke();
    ctx.restore();

    hudTex.needsUpdate = true;
  };

  drawSpeedConsole(0, false);
  drawAltConsole(0, false);
  drawHudCombiner(0, 0, 0, 0, 0);

  const canopyMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x20406a,
      emissive: 0x071327,
      emissiveIntensity: 0.3,
      metalness: 0.16,
      roughness: 0.08,
      envMapIntensity: 1.55,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    }),
  );

  const nozzleInnerMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
    }),
  );

  const flameMaterial = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0xe0f2fe,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );

  const outerPlumeUniforms = {
    uTime: { value: 0 },
    uPower: { value: 0.25 },
    uColorCore: { value: new THREE.Color(0x38bdf8) },
    uColorEdge: { value: new THREE.Color(0x8b5cf6) },
  };
  const outerPlumeMaterial = trackMat(
    new THREE.ShaderMaterial({
      uniforms: outerPlumeUniforms,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 mvPos = vec4(position, 1.0);
          #ifdef USE_INSTANCING
            mvPos = instanceMatrix * mvPos;
          #endif
          gl_Position = projectionMatrix * modelViewMatrix * mvPos;
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform float uTime;
        uniform float uPower;
        uniform vec3 uColorCore;
        uniform vec3 uColorEdge;

        void main() {
          float axial = 1.0 - vUv.y;
          float machWave = 0.78 + 0.22 * sin(vUv.y * 22.0 - uTime * 42.0);
          float swirl = 0.88 + 0.12 * sin(vUv.x * 18.8495 + uTime * 16.0);
          float fade = pow(clamp(axial, 0.0, 1.0), 1.35);
          vec3 col = mix(uColorEdge, uColorCore, smoothstep(0.15, 0.85, axial));
          float alpha = fade * machWave * swirl * clamp(0.28 + uPower * 0.72, 0.0, 1.0);
          gl_FragColor = vec4(col * (1.0 + uPower * 0.6), alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );

  const machRingMaterial = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );

  const reentryUniforms = {
    uTime: { value: 0 },
    uIntensity: { value: 0 },
  };
  const reentryMaterial = trackMat(
    new THREE.ShaderMaterial({
      uniforms: reentryUniforms,
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormalView;
        varying vec3 vViewDir;
        void main() {
          vUv = uv;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vNormalView = normalize(normalMatrix * normal);
          vViewDir = normalize(-mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        varying vec3 vNormalView;
        varying vec3 vViewDir;
        uniform float uTime;
        uniform float uIntensity;

        void main() {
          float head = 1.0 - vUv.y;
          float flow = sin(vUv.y * 28.0 - uTime * 28.0 + sin(vUv.x * 12.566) * 1.4) * 0.5 + 0.5;
          float streaks = sin(vUv.x * 37.699 + uTime * 7.0) * 0.5 + 0.5;
          float rim = 1.0 - abs(dot(normalize(vNormalView), normalize(vViewDir)));
          float rimBoost = 0.45 + pow(clamp(rim, 0.0, 1.0), 1.4) * 0.95;

          float mask = smoothstep(0.0, 0.62, head) * (0.65 + 0.35 * flow) * (0.7 + 0.3 * streaks);

          vec3 whiteHot = vec3(1.0, 0.94, 0.82);
          vec3 solarOrange = vec3(1.0, 0.45, 0.08);
          vec3 ionizedViolet = vec3(0.72, 0.25, 0.95);

          vec3 col = mix(ionizedViolet, solarOrange, smoothstep(0.15, 0.65, head));
          col = mix(col, whiteHot, smoothstep(0.68, 0.98, head));

          float alpha = mask * rimBoost * uIntensity * 0.92;
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(col * (1.25 + uIntensity * 0.55), clamp(alpha, 0.0, 0.95));
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );

  // 1. Static ship geometry buckets merged across fuselage/cockpit/exterior (<=10 draw calls total!)
  const COLOR_WHITE = 0xffffff;
  const COLOR_GOLD = 0xd6a64c;
  const COLOR_ENGINE_METAL = 0x5c5750;
  const COLOR_DARK_TRIM = 0x1a2029;
  const COLOR_CRIMSON = 0xc94732;
  const COLOR_SEAT_TAN = 0xb76835;
  const COLOR_PILOT_WHITE = 0xf1f5f9;
  const COLOR_PILOT_GRAY = 0x525d6d;
  const COLOR_PILOT_BLACK = 0x171b22;
  const COLOR_PILOT_SKIN = 0xd9a27e;

  const shipPaintedParts: ColoredGeoPart[] = [
    {
      geo: buildLoftedFuselageGeometry(0, 1, 36, 32, 0, true),
      color: COLOR_WHITE,
      atlasRegion: 'hull',
    },
  ];
  const shipBrightMetalParts: ColoredGeoPart[] = [];
  const shipDarkTrimParts: ColoredGeoPart[] = [];

  // 2. Cockpit-visible static geometry buckets (flush surface-inlaid gold trim matching Solaris design)
  const hullGoldGeos: THREE.BufferGeometry[] = [
    // Flush gold nose cone cap
    buildLoftedFuselageGeometry(0, 0.062, 6, 18, 0.008, false),
    // Nose M-arch seam framing the front of the crimson stripes (100% flush on hull surface)
    buildHullSurfaceTube(
      [
        [0.215, -Math.PI * 0.49],
        [0.185, -Math.PI * 0.36],
        [0.145, -Math.PI * 0.20],
        [0.158, -Math.PI * 0.08],
        [0.165, 0],
        [0.158, Math.PI * 0.08],
        [0.145, Math.PI * 0.20],
        [0.185, Math.PI * 0.36],
        [0.215, Math.PI * 0.49],
      ],
      0.016,
      0.002,
      28,
    ),
    // Foredeck chevron collar behind the crimson stripes, ahead of sensor ports (100% flush on hull)
    buildHullSurfaceTube(
      [
        [0.405, -Math.PI * 0.49],
        [0.390, -Math.PI * 0.34],
        [0.372, -Math.PI * 0.18],
        [0.362, 0],
        [0.372, Math.PI * 0.18],
        [0.390, Math.PI * 0.34],
        [0.405, Math.PI * 0.49],
      ],
      0.017,
      0.002,
      26,
    ),
    // Flush canopy coaming ring sampled directly along cockpit opening rim
    buildCockpitCoamingCurve(),
    // Forward & aft canopy arch ribs hugging exact canopy ellipsoid surface
    buildCanopyEllipsoidRib(-0.62, 0.013, 0.002),
    buildCanopyEllipsoidRib(0.58, 0.015, 0.002),
  ];

  // Flush nose deck sensor ports placed directly on hull surface
  const sensorPortL = hullSurfacePointAt(0.352, -Math.PI * 0.11, 0.004);
  const sensorPortR = hullSurfacePointAt(0.352, Math.PI * 0.11, 0.004);

  const hullDarkGeos: THREE.BufferGeometry[] = [
    makeCyl(0.044, 0.052, 0.025, 10, sensorPortL.x, sensorPortL.y, sensorPortL.z, 0.14, 0, 0.22),
    makeCyl(0.044, 0.052, 0.025, 10, sensorPortR.x, sensorPortR.y, sensorPortR.z, 0.14, 0, -0.22),
    makeBox(0.70, 0.03, 1.12, 0, -0.125, -0.44),
    makeBox(0.68, 0.44, 0.06, 0, 0.11, 0.14),
    makeBox(0.13, 0.24, 0.80, -0.30, 0.01, -0.44),
    makeBox(0.13, 0.24, 0.80, 0.30, 0.01, -0.44),
    makeBox(0.08, 0.045, 0.14, -0.28, 0.15, -0.52),
    makeBox(0.045, 0.04, 0.075, -0.28, 0.185, -0.53, -0.25),
    makeBox(0.62, 0.24, 0.18, 0, 0.04, -0.77, -0.10),
    makeBox(0.18, 0.030, 0.10, -0.20, 0.405, -0.730, 0.10, 0, 0.50),
    makeBox(0.18, 0.030, 0.10, 0.20, 0.405, -0.730, 0.10, 0, -0.50),
    makeBox(0.016, 0.145, 0.026, -0.120, 0.535, -0.710),
    makeBox(0.016, 0.145, 0.026, 0.120, 0.535, -0.710),
    makeCyl(0.038, 0.056, 0.05, 10, 0, -0.085, -0.49),
    makeBox(0.42, 0.06, 0.42, 0, -0.075, -0.16),
    makeBox(0.39, 0.44, 0.065, 0, 0.16, 0.04, -0.20),
    makeBox(0.06, 0.26, 0.20, -0.205, 0.08, -0.09, -0.14),
    makeBox(0.06, 0.26, 0.20, 0.205, 0.08, -0.09, -0.14),
  ];

  const hullMetalGeos: THREE.BufferGeometry[] = [
    makeCyl(0.022, 0.022, 0.03, 8, sensorPortL.x, sensorPortL.y + 0.002, sensorPortL.z, 0.14, 0, 0.22),
    makeCyl(0.022, 0.022, 0.03, 8, sensorPortR.x, sensorPortR.y + 0.002, sensorPortR.z, 0.14, 0, -0.22),
  ];

  // Cockpit-only UI/controls (hidden in chase/orbit views for zero draw calls outside cockpit!)
  const cockpitOnlyGroup = new THREE.Group();
  cockpitOnlyGroup.visible = false;
  group.add(cockpitOnlyGroup);

  const cockpitAccentParts: THREE.BufferGeometry[] = [
    makeBox(0.026, 0.008, 0.38, -0.29, 0.136, -0.34),
    makeBox(0.026, 0.008, 0.38, 0.29, 0.136, -0.34),
  ];
  cockpitOnlyGroup.add(
    new THREE.Mesh(
      trackGeo(mergeStaticGeometries(cockpitAccentParts)),
      cockpitAccentMat,
    ),
  );

  // Transparent Green HUD Combiner Glass + Emissive Green Symbology Projection
  const hudGlassGeo = trackGeo(new THREE.PlaneGeometry(0.228, 0.150));
  const hudGlassMesh = new THREE.Mesh(hudGlassGeo, hudGlassTintMat);
  hudGlassMesh.position.set(0, 0.540, -0.710);
  hudGlassMesh.renderOrder = 3;
  cockpitOnlyGroup.add(hudGlassMesh);

  const hudSymbologyMesh = new THREE.Mesh(hudGlassGeo, hudSymbologyMat);
  hudSymbologyMesh.position.set(0, 0.540, -0.706);
  hudSymbologyMesh.renderOrder = 4;
  cockpitOnlyGroup.add(hudSymbologyMesh);

  // Left (Speed) & Right (Altitude) MFD Screens flanking an open central view
  const sideBodyGeo = new THREE.BoxGeometry(0.174, 0.130, 0.028);
  const sideBezelGeo = new THREE.BoxGeometry(0.180, 0.136, 0.012);
  const sideScreenGeo = trackGeo(new THREE.PlaneGeometry(0.164, 0.120));

  const addMfdPanel = (
    xPos: number,
    yPos: number,
    zPos: number,
    yawAngle: number,
    bodyG: THREE.BufferGeometry,
    bezelG: THREE.BufferGeometry,
    screenG: THREE.BufferGeometry,
    screenMat: THREE.Material,
  ) => {
    const euler = new THREE.Euler(-0.24, yawAngle, 0, 'YXZ');
    const q = new THREE.Quaternion().setFromEuler(euler);
    const pos = new THREE.Vector3(xPos, yPos, zPos);

    const hG = bodyG.clone();
    hG.applyQuaternion(q);
    hG.translate(pos.x, pos.y, pos.z);
    hullDarkGeos.push(hG);

    const bG = bezelG.clone();
    bG.translate(0, 0, 0.01);
    bG.applyQuaternion(q);
    bG.translate(pos.x, pos.y, pos.z);
    hullGoldGeos.push(bG);

    const screen = new THREE.Mesh(screenG, screenMat);
    const offset = new THREE.Vector3(0, 0, 0.017).applyQuaternion(q);
    screen.position.copy(pos).add(offset);
    screen.quaternion.copy(q);
    cockpitOnlyGroup.add(screen);
  };

  addMfdPanel(-0.214, 0.304, -0.648, 0.22, sideBodyGeo, sideBezelGeo, sideScreenGeo, speedScreen.mat);
  addMfdPanel(0.214, 0.304, -0.648, -0.22, sideBodyGeo, sideBezelGeo, sideScreenGeo, altScreen.mat);

  sideBodyGeo.dispose();
  sideBezelGeo.dispose();

  for (let i = 0; i < hullGoldGeos.length; i++) {
    shipBrightMetalParts.push({ geo: hullGoldGeos[i], color: COLOR_GOLD });
  }
  for (let i = 0; i < hullDarkGeos.length; i++) {
    shipDarkTrimParts.push({ geo: hullDarkGeos[i], color: COLOR_DARK_TRIM });
  }
  for (let i = 0; i < hullMetalGeos.length; i++) {
    shipBrightMetalParts.push({ geo: hullMetalGeos[i], color: COLOR_ENGINE_METAL });
  }

  // Low Ergonomic Center Flight Stick (Manche) merged into 1 cockpit-only mesh
  const stickPivot = new THREE.Group();
  stickPivot.position.set(0, -0.06, -0.49);
  cockpitOnlyGroup.add(stickPivot);

  const stickGeo = trackGeo(
    mergeColoredGeometries([
      { geo: makeCyl(0.022, 0.018, 0.105, 8, 0, 0.175, 0.008, 0.14), color: COLOR_DARK_TRIM },
      { geo: makeBox(0.048, 0.028, 0.042, 0, 0.23, 0.006), color: COLOR_DARK_TRIM },
      { geo: makeCyl(0.014, 0.017, 0.125, 8, 0, 0.062, 0), color: COLOR_ENGINE_METAL },
      { geo: makeCyl(0.021, 0.021, 0.016, 8, 0, 0.122, 0), color: COLOR_GOLD },
      { geo: makeBox(0.014, 0.016, 0.016, 0, 0.234, 0.026), color: COLOR_CRIMSON },
    ]),
  );
  stickPivot.add(new THREE.Mesh(stickGeo, darkTrimMat));

  // Seat cushions & harness straps merged directly into shipPaintedParts
  shipPaintedParts.push(
    { geo: makeBox(0.32, 0.055, 0.35, 0, -0.04, -0.17), color: COLOR_SEAT_TAN, atlasRegion: 'white' },
    { geo: makeBox(0.30, 0.36, 0.06, 0, 0.16, 0.005, -0.20), color: COLOR_SEAT_TAN, atlasRegion: 'white' },
    { geo: makeBox(0.22, 0.13, 0.065, 0, 0.39, 0.065, -0.12), color: COLOR_SEAT_TAN, atlasRegion: 'white' },
    { geo: makeBox(0.04, 0.32, 0.025, -0.085, 0.18, -0.025, -0.20), color: COLOR_CRIMSON, atlasRegion: 'white' },
    { geo: makeBox(0.04, 0.32, 0.025, 0.085, 0.18, -0.025, -0.20), color: COLOR_CRIMSON, atlasRegion: 'white' },
  );

  // Seated 1.66 u Astronaut Pilot inside Cockpit:
  // - seatedLegsGroup visible only in Cockpit View when pilotSeated === true
  // - seatedUpperGroup contains 1 merged full-pilot mesh + visor, visible in exterior views when pilotSeated === true
  const seatedLegsGroup = new THREE.Group();
  group.add(seatedLegsGroup);

  const seatedUpperGroup = new THREE.Group();
  group.add(seatedUpperGroup);

  const makePilotLegParts = (): ColoredGeoPart[] => [
    { geo: makeCyl(0.078, 0.066, 0.36, 8, -0.115, 0.045, -0.34, Math.PI * 0.42, 0.08, 0), color: COLOR_PILOT_WHITE },
    { geo: makeCyl(0.078, 0.066, 0.36, 8, 0.115, 0.045, -0.34, Math.PI * 0.42, -0.08, 0), color: COLOR_PILOT_WHITE },
    { geo: makeCyl(0.064, 0.058, 0.28, 8, -0.13, -0.025, -0.60, -0.28, 0, 0), color: COLOR_PILOT_WHITE },
    { geo: makeCyl(0.064, 0.058, 0.28, 8, 0.13, -0.025, -0.60, -0.28, 0, 0), color: COLOR_PILOT_WHITE },
    { geo: makeBox(0.095, 0.085, 0.11, -0.125, 0.09, -0.52, -0.28), color: COLOR_PILOT_GRAY },
    { geo: makeBox(0.095, 0.085, 0.11, 0.125, 0.09, -0.52, -0.28), color: COLOR_PILOT_GRAY },
  ];

  const seatedLegsGeo = trackGeo(mergeColoredGeometries(makePilotLegParts()));
  seatedLegsGroup.add(new THREE.Mesh(seatedLegsGeo, pilotSuitMat));

  const pilotExteriorGeo = trackGeo(
    mergeColoredGeometries([
      ...makePilotLegParts(),
      { geo: makeBox(0.31, 0.12, 0.20, 0, 0.015, -0.15, -0.18), color: COLOR_PILOT_WHITE },
      { geo: makeBox(0.35, 0.42, 0.22, 0, 0.26, -0.08, -0.18), color: COLOR_PILOT_WHITE },
      { geo: makeBox(0.30, 0.22, 0.06, 0, 0.31, -0.19, -0.18), color: COLOR_PILOT_WHITE },
      { geo: makeCyl(0.052, 0.046, 0.24, 8, -0.22, 0.32, -0.16, 0.62, 0, -0.12), color: COLOR_PILOT_WHITE },
      { geo: makeCyl(0.046, 0.040, 0.24, 8, -0.25, 0.20, -0.36, 1.38, -0.12, 0), color: COLOR_PILOT_WHITE },
      { geo: makeCyl(0.052, 0.046, 0.24, 8, 0.22, 0.32, -0.16, 0.65, 0, 0.16), color: COLOR_PILOT_WHITE },
      { geo: makeCyl(0.046, 0.040, 0.24, 8, 0.11, 0.21, -0.39, 1.42, 0.48, 0), color: COLOR_PILOT_WHITE },
      { geo: makeSeatedHelmetWhiteGeo(), color: COLOR_PILOT_WHITE },
      { geo: makeBox(0.14, 0.11, 0.025, 0, 0.32, -0.22, -0.18), color: COLOR_PILOT_GRAY },
      { geo: makeCyl(0.128, 0.14, 0.05, 12, 0, 0.49, -0.04, -0.18), color: COLOR_PILOT_GRAY },
      { geo: makeBox(0.20, 0.024, 0.055, 0, 0.70, -0.13), color: COLOR_PILOT_GRAY },
      { geo: makeBox(0.34, 0.07, 0.22, 0, 0.055, -0.14, -0.18), color: COLOR_PILOT_BLACK },
      { geo: makeBox(0.07, 0.085, 0.075, -0.27, 0.195, -0.50), color: COLOR_PILOT_BLACK },
      { geo: makeBox(0.07, 0.085, 0.075, 0.01, 0.23, -0.54), color: COLOR_PILOT_BLACK },
      { geo: makeBox(0.11, 0.13, 0.10, 0, 0.625, -0.055), color: COLOR_PILOT_SKIN },
    ]),
  );
  seatedUpperGroup.add(new THREE.Mesh(pilotExteriorGeo, pilotSuitMat));

  const seatVisorGeo = trackGeo(
    new THREE.SphereGeometry(
      0.138,
      14,
      10,
      Math.PI * 1.14,
      Math.PI * 0.72,
      Math.PI * 0.24,
      Math.PI * 0.44,
    ),
  );
  seatVisorGeo.scale(0.95, 1.04, 1.06);
  seatVisorGeo.translate(0, 0.632, -0.042);
  const seatVisor = new THREE.Mesh(seatVisorGeo, pilotVisorMat);
  seatVisor.renderOrder = 2;
  seatedUpperGroup.add(seatVisor);

  // Sculpted Bubble Canopy Dome seated onto cockpit opening (apex y = +0.92 -> ample clearance above seated helmet crown ~+0.79!)
  const canopyGeo = trackGeo(
    new THREE.SphereGeometry(1.0, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.54),
  );
  canopyGeo.scale(0.495, 0.52, 0.90);
  const canopy = new THREE.Mesh(canopyGeo, canopyMat);
  canopy.position.set(0, 0.40, -0.39);
  canopy.renderOrder = 2;
  group.add(canopy);

  // 3. Exterior dynamic parts (hidden in cockpit camera) + collider bounds
  const exteriorPartsGroup = new THREE.Group();
  group.add(exteriorPartsGroup);

  const colliders: ShipColliderBox[] = [];
  const measureGroupBox = (
    id: string,
    geos: THREE.BufferGeometry[],
    extraObjects: THREE.Object3D[] = [],
    pad = 0.15,
    requiresGear = false,
  ): ShipColliderBox => {
    const tmpGroup = new THREE.Group();
    for (let i = 0; i < geos.length; i++) {
      tmpGroup.add(new THREE.Mesh(geos[i], darkTrimMat));
    }
    tmpGroup.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(tmpGroup);
    for (let i = 0; i < extraObjects.length; i++) {
      extraObjects[i].updateMatrixWorld(true);
      const subBox = new THREE.Box3().setFromObject(extraObjects[i]);
      box.union(subBox);
    }
    box.expandByScalar(pad);
    return {
      id,
      min: box.min.clone(),
      max: box.max.clone(),
      requiresGear,
    };
  };

  const extIvoryGeos: THREE.BufferGeometry[] = [];
  const extGoldGeos: THREE.BufferGeometry[] = [];
  const extDarkGeos: THREE.BufferGeometry[] = [];
  const extMetalGeos: THREE.BufferGeometry[] = [];
  const extCrimsonGeos: THREE.BufferGeometry[] = [];
  const extNozzleInnerParts: THREE.BufferGeometry[] = [];

  // Aft Dorsal Spine Cowl + Stripes + Flush Hull Collars
  const spineGeo = makeExtrudedSideShape(
    [
      [-0.48, -1.04],
      [0.48, -1.04],
      [0.54, -0.68],
      [0.46, 0.88],
      [0.32, 1.24],
      [-0.32, 1.24],
      [-0.46, 0.88],
      [-0.54, -0.68],
    ],
    1,
    0.20,
    0.05,
    0.05,
  );
  spineGeo.translate(0, 0.50, 1.66);
  extIvoryGeos.push(spineGeo);

  const noseMeasureGeo = buildLoftedFuselageGeometry(0, 0.16, 8, 16, 0, false);
  const hullMeasureGeo = buildLoftedFuselageGeometry(0.16, 1, 18, 20, 0, true);
  colliders.push(measureGroupBox('nose', [noseMeasureGeo]));
  colliders.push(
    measureGroupBox('fuselage', [hullMeasureGeo, spineGeo], [canopy]),
  );
  noseMeasureGeo.dispose();
  hullMeasureGeo.dispose();

  extCrimsonGeos.push(
    makeBox(0.22, 0.018, 1.98, 0, 0.555, 1.75),
    makeBox(0.05, 0.018, 1.95, -0.19, 0.555, 1.75),
    makeBox(0.05, 0.018, 1.95, 0.19, 0.555, 1.75),
  );

  // Aft spine & tail hull collars hugging exact geometry
  extGoldGeos.push(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        hullSurfacePointAt(0.66, -Math.PI * 0.49, 0.002),
        new THREE.Vector3(-0.53, 0.39, 0.62),
        new THREE.Vector3(-0.42, 0.53, 0.66),
        new THREE.Vector3(0, 0.555, 0.68),
        new THREE.Vector3(0.42, 0.53, 0.66),
        new THREE.Vector3(0.53, 0.39, 0.62),
        hullSurfacePointAt(0.66, Math.PI * 0.49, 0.002),
      ]),
      18,
      0.016,
      7,
      false,
    ),
    buildHullSurfaceTube(
      [
        [0.955, -Math.PI * 0.49],
        [0.955, -Math.PI * 0.25],
        [0.955, 0],
        [0.955, Math.PI * 0.25],
        [0.955, Math.PI * 0.49],
      ],
      0.018,
      0.003,
      18,
    ),
  );

  // Symmetric Pods, Intakes, Wings, Beltline Rails & Under-Wing Laser Cannons (1.6x)
  const podPoints: Array<[number, number]> = [
    [-0.38, -1.18],
    [0.29, -0.92],
    [0.38, 0.99],
    [0.26, 1.22],
    [-0.29, 1.22],
    [-0.38, 0.99],
  ];
  const wingPoints: Array<[number, number]> = [
    [0.0, -0.54],
    [1.79, 0.22],
    [1.72, 0.83],
    [0.0, 0.64],
  ];

  for (const side of [-1, 1] as const) {
    const beltSamples: Array<[number, number]> = [];
    for (let k = 0; k <= 12; k++) {
      beltSamples.push([
        THREE.MathUtils.lerp(0.215, 0.955, k / 12),
        side * Math.PI * 0.49,
      ]);
    }
    extGoldGeos.push(buildHullSurfaceTube(beltSamples, 0.016, 0.003, 24));

    const pylonGeo = makeBox(0.58, 0.25, 1.15, side * 0.99, 0.03, 1.25);
    const podG = makeExtrudedSideShape(podPoints, side, 0.38, 0.075, 0.07);
    podG.translate(side * 1.44, 0.22, 1.28);
    extIvoryGeos.push(pylonGeo, podG);

    const intakeGold1 = makeBox(0.73, 0.48, 0.22, side * 1.44, 0.03, 0.22, 0, side * -0.32);
    const intakeGold2 = makeBox(0.67, 0.095, 0.12, side * 1.44, 0.22, 2.46);
    const intakeDark = makeBox(0.57, 0.32, 0.25, side * 1.44, 0.03, 0.19, 0, side * -0.32);
    const intakeMetal = makeCyl(0.13, 0.145, 0.16, 10, side * 1.44, 0.03, 0.14, Math.PI / 2, side * -0.32);
    extGoldGeos.push(intakeGold1, intakeGold2);
    extDarkGeos.push(intakeDark);
    extMetalGeos.push(intakeMetal);

    const podNozzleGeo = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.08, -0.40),
        new THREE.Vector2(0.38, -0.32),
        new THREE.Vector2(0.41, 0.19),
        new THREE.Vector2(0.34, 0.54),
        new THREE.Vector2(0.26, 0.54),
        new THREE.Vector2(0.22, 0.32),
      ],
      12,
    );
    podNozzleGeo.rotateX(Math.PI / 2);
    podNozzleGeo.scale(0.62, 0.62, 0.72);
    podNozzleGeo.translate(side * 1.44, 0.03, 2.46);
    const podNozzleGlow = makeCyl(0.135, 0.135, 0.075, 10, side * 1.44, 0.03, 2.78, Math.PI / 2);
    extMetalGeos.push(podNozzleGeo);
    extNozzleInnerParts.push(podNozzleGlow);

    colliders.push(
      measureGroupBox(side < 0 ? 'pod-left' : 'pod-right', [
        pylonGeo,
        podG,
        intakeGold1,
        intakeGold2,
        intakeDark,
        intakeMetal,
        podNozzleGeo,
        podNozzleGlow,
      ]),
    );

    const wingG = makeExtrudedSideShape(wingPoints, side, 0.12, 0.04, 0.04);
    wingG.translate(side * 1.79, 0.055, 1.47);
    const wingTrim = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 1.79, -0.005, 0.91),
        new THREE.Vector3(side * 3.58, -0.005, 1.69),
        new THREE.Vector3(side * 3.52, -0.005, 2.30),
      ]),
      12,
      0.022,
      7,
      false,
    );
    extIvoryGeos.push(wingG);
    extGoldGeos.push(wingTrim);

    colliders.push(
      measureGroupBox(side < 0 ? 'wing-left' : 'wing-right', [
        wingG,
        wingTrim,
      ]),
    );

    const wx = side * 2.65;
    const cPylon = makeBox(0.12, 0.10, 0.70, wx, -0.08, 1.52);
    const cPod = makeBox(0.21, 0.15, 0.90, wx, -0.15, 1.45);
    const cFairing = makeCyl(0.076, 0.102, 0.22, 8, wx, -0.15, 0.90, Math.PI / 2);
    const cCollar = makeCyl(0.072, 0.072, 0.10, 8, wx, -0.15, 0.74, Math.PI / 2);
    const cStripe = makeBox(0.22, 0.042, 0.38, wx, -0.15, 1.52);
    const cBarrel = makeCyl(0.034, 0.044, 0.64, 8, wx, -0.15, 0.54, Math.PI / 2);
    const cEmitter = makeCyl(0.026, 0.026, 0.04, 8, wx, -0.15, 0.21, Math.PI / 2);
    extIvoryGeos.push(cPylon);
    extDarkGeos.push(cPod, cFairing);
    extGoldGeos.push(cCollar);
    extCrimsonGeos.push(cStripe);
    extMetalGeos.push(cBarrel);
    extNozzleInnerParts.push(cEmitter);

    colliders.push(
      measureGroupBox(side < 0 ? 'cannon-left' : 'cannon-right', [
        cPylon,
        cPod,
        cFairing,
        cCollar,
        cStripe,
        cBarrel,
        cEmitter,
      ]),
    );
  }

  // Main Engine Nozzle (LatheGeometry scaled 1.6x)
  const mainNozzleProfile = [
    new THREE.Vector2(0.08, -0.40),
    new THREE.Vector2(0.38, -0.32),
    new THREE.Vector2(0.41, 0.19),
    new THREE.Vector2(0.34, 0.54),
    new THREE.Vector2(0.26, 0.54),
    new THREE.Vector2(0.22, 0.32),
  ];
  const mainNozzleGeo = new THREE.LatheGeometry(mainNozzleProfile, 14);
  mainNozzleGeo.rotateX(Math.PI / 2);
  mainNozzleGeo.translate(0, 0.06, 2.98);
  const mainNozzleGlow = makeCyl(0.22, 0.22, 0.09, 12, 0, 0.06, 3.44, Math.PI / 2);
  extMetalGeos.push(mainNozzleGeo);
  extNozzleInnerParts.push(mainNozzleGlow);

  colliders.push(
    measureGroupBox('tail', [mainNozzleGeo, mainNozzleGlow]),
  );

  for (let i = 0; i < extIvoryGeos.length; i++) {
    shipPaintedParts.push({ geo: extIvoryGeos[i], color: COLOR_WHITE, atlasRegion: 'wing' });
  }
  for (let i = 0; i < extCrimsonGeos.length; i++) {
    shipPaintedParts.push({ geo: extCrimsonGeos[i], color: COLOR_CRIMSON, atlasRegion: 'white' });
  }
  for (let i = 0; i < extGoldGeos.length; i++) {
    shipBrightMetalParts.push({ geo: extGoldGeos[i], color: COLOR_GOLD });
  }
  for (let i = 0; i < extMetalGeos.length; i++) {
    shipBrightMetalParts.push({ geo: extMetalGeos[i], color: COLOR_ENGINE_METAL });
  }
  for (let i = 0; i < extDarkGeos.length; i++) {
    shipDarkTrimParts.push({ geo: extDarkGeos[i], color: COLOR_DARK_TRIM });
  }

  // Merged static meshes (3 opaque draw calls total for entire airframe + cockpit + trim!)
  const shipMainMesh = new THREE.Mesh(
    trackGeo(mergeColoredGeometries(shipPaintedParts)),
    shipPaintedMat,
  );
  shipMainMesh.castShadow = !isMobileOrSoftware;
  group.add(shipMainMesh);

  group.add(
    new THREE.Mesh(
      trackGeo(mergeColoredGeometries(shipBrightMetalParts)),
      brightMetalMat,
    ),
  );
  group.add(
    new THREE.Mesh(
      trackGeo(mergeColoredGeometries(shipDarkTrimParts)),
      darkTrimMat,
    ),
  );

  exteriorPartsGroup.add(
    new THREE.Mesh(
      trackGeo(mergeStaticGeometries(extNozzleInnerParts)),
      nozzleInnerMat,
    ),
  );

  // 7. Instanced Multi-Layer Thruster Exhaust Plumes + Mach Shock Ring (2 instanced draws + 1 ring)
  const coreFlameGeo = trackGeo(new THREE.ConeGeometry(0.10, 1.25, 10, 1, true));
  coreFlameGeo.rotateX(Math.PI / 2);
  coreFlameGeo.translate(0, 0, 0.62);

  const outerFlameGeo = trackGeo(new THREE.ConeGeometry(0.20, 2.15, 12, 1, true));
  outerFlameGeo.rotateX(Math.PI / 2);
  outerFlameGeo.translate(0, 0, 1.08);

  const coreFlamesInstanced = new THREE.InstancedMesh(coreFlameGeo, flameMaterial, 3);
  coreFlamesInstanced.frustumCulled = false;
  exteriorPartsGroup.add(coreFlamesInstanced);

  const outerFlamesInstanced = new THREE.InstancedMesh(outerFlameGeo, outerPlumeMaterial, 3);
  outerFlamesInstanced.frustumCulled = false;
  outerFlamesInstanced.renderOrder = 3;
  exteriorPartsGroup.add(outerFlamesInstanced);

  const _flameMat4 = new THREE.Matrix4();
  const writeFlameMatrices = (
    mainW: number,
    mainL: number,
    podW: number,
    podL: number,
    coreW: number,
    coreL: number,
  ) => {
    _flameMat4.makeScale(mainW * 0.9, mainW * 0.9, mainL * 0.85);
    _flameMat4.setPosition(0, 0.06, 3.46);
    coreFlamesInstanced.setMatrixAt(0, _flameMat4);

    _flameMat4.makeScale(coreW, coreW, coreL);
    _flameMat4.setPosition(-1.44, 0.03, 2.80);
    coreFlamesInstanced.setMatrixAt(1, _flameMat4);
    _flameMat4.setPosition(1.44, 0.03, 2.80);
    coreFlamesInstanced.setMatrixAt(2, _flameMat4);
    coreFlamesInstanced.instanceMatrix.needsUpdate = true;

    _flameMat4.makeScale(mainW, mainW, mainL);
    _flameMat4.setPosition(0, 0.06, 3.46);
    outerFlamesInstanced.setMatrixAt(0, _flameMat4);

    _flameMat4.makeScale(podW, podW, podL);
    _flameMat4.setPosition(-1.44, 0.03, 2.80);
    outerFlamesInstanced.setMatrixAt(1, _flameMat4);
    _flameMat4.setPosition(1.44, 0.03, 2.80);
    outerFlamesInstanced.setMatrixAt(2, _flameMat4);
    outerFlamesInstanced.instanceMatrix.needsUpdate = true;
  };
  writeFlameMatrices(1.28, 0.3, 0.61, 0.2, 0.52, 0.2);

  // Detached proxy handles so FlightPhysics writes leftFlame/rightFlame without extra draw calls
  const leftFlame = new THREE.Mesh(coreFlameGeo, flameMaterial);
  const rightFlame = new THREE.Mesh(coreFlameGeo, flameMaterial);

  const machRingGeo = trackGeo(new THREE.RingGeometry(0.17, 0.25, 12));
  const centerRing = new THREE.Mesh(machRingGeo, machRingMaterial);
  centerRing.position.set(0, 0.06, 4.08);
  exteriorPartsGroup.add(centerRing);

  // 8. Atmospheric Re-entry Bow Plasma Shockwave Shield (1.6x)
  const shieldProfile = [
    new THREE.Vector2(0.10, 4.28),
    new THREE.Vector2(0.67, 3.71),
    new THREE.Vector2(1.40, 2.48),
    new THREE.Vector2(2.48, 0.83),
    new THREE.Vector2(3.76, -0.88),
    new THREE.Vector2(4.40, -2.16),
  ];
  const shieldGeo = trackGeo(new THREE.LatheGeometry(shieldProfile, 20));
  shieldGeo.rotateX(-Math.PI / 2);
  shieldGeo.scale(1.06, 0.45, 1.0);
  const reentryShield = new THREE.Mesh(shieldGeo, reentryMaterial);
  reentryShield.visible = false;
  reentryShield.renderOrder = 4;
  group.add(reentryShield);

  // 9. Retractable Tricycle Landing Gear (1 instanced draw call when extended)
  const gearPivotY = -0.28;
  const gearReach = GEAR_REST_HEIGHT + gearPivotY; // 0.80
  const footHeight = 0.055;
  const strutLen = 0.42;
  const pistonLen = Math.max(0.18, gearReach - strutLen * 0.92 - footHeight * 0.5);

  const legGeo = trackGeo(
    mergeColoredGeometries([
      { geo: makeCyl(0.042, 0.036, strutLen, 8, 0, -strutLen * 0.5, 0), color: COLOR_DARK_TRIM },
      {
        geo: makeCyl(0.115, 0.145, footHeight, 10, 0, -(gearReach - footHeight * 0.5), 0),
        color: COLOR_DARK_TRIM,
      },
      { geo: makeCyl(0.05, 0.05, 0.055, 8, 0, -strutLen * 0.92, 0), color: COLOR_ENGINE_METAL },
      {
        geo: makeCyl(0.025, 0.028, pistonLen, 8, 0, -(gearReach - footHeight - pistonLen * 0.5), 0),
        color: COLOR_ENGINE_METAL,
      },
    ]),
  );

  const gearLegOffsets: Array<[number, number]> = [
    [0, -2.0],
    [-1.32, 1.30],
    [1.32, 1.30],
  ];
  const gearInstanced = new THREE.InstancedMesh(legGeo, darkTrimMat, gearLegOffsets.length);
  gearInstanced.frustumCulled = false;
  gearInstanced.visible = false;
  exteriorPartsGroup.add(gearInstanced);

  legGeo.computeBoundingBox();
  const legLocalBox = legGeo.boundingBox!;
  for (let i = 0; i < gearLegOffsets.length; i++) {
    const [gx, gz] = gearLegOffsets[i];
    colliders.push({
      id: `gear-${i}`,
      min: new THREE.Vector3(
        gx + legLocalBox.min.x - 0.15,
        gearPivotY + legLocalBox.min.y - 0.15,
        gz + legLocalBox.min.z - 0.15,
      ),
      max: new THREE.Vector3(
        gx + legLocalBox.max.x + 0.15,
        gearPivotY + legLocalBox.max.y + 0.15,
        gz + legLocalBox.max.z + 0.15,
      ),
      requiresGear: true,
    });
  }

  const _gearMat4 = new THREE.Matrix4();
  let lastGearSmooth = -1;
  const setGearExtension = (t: number) => {
    const s = THREE.MathUtils.smoothstep(THREE.MathUtils.clamp(t, 0, 1), 0, 1);
    if (s < 0.02) {
      gearInstanced.visible = false;
      lastGearSmooth = 0;
      return;
    }
    gearInstanced.visible = true;
    if (Math.abs(s - lastGearSmooth) < 0.0005) return;
    lastGearSmooth = s;
    const xzScale = 0.4 + 0.6 * s;
    for (let i = 0; i < gearLegOffsets.length; i++) {
      const [gx, gz] = gearLegOffsets[i];
      _gearMat4.makeScale(xzScale, s, xzScale);
      _gearMat4.setPosition(gx, gearPivotY, gz);
      gearInstanced.setMatrixAt(i, _gearMat4);
    }
    gearInstanced.instanceMatrix.needsUpdate = true;
  };
  setGearExtension(0);

  // 10. Dynamic Thruster Glow Light
  let thrusterLight: THREE.PointLight | null = null;
  if (!isMobileOrSoftware) {
    thrusterLight = new THREE.PointLight(0x38bdf8, 1.8, 24);
    thrusterLight.position.set(0, 0.14, 3.8);
    exteriorPartsGroup.add(thrusterLight);
  }

  let stickRoll = 0;
  let stickPitch = 0;
  let pilotSeated = true;
  let cockpitActive = false;
  let hudUpdateAccum = 1;
  let lastSpeedText = '';
  let lastSpeedBucket = -1;
  let lastBoostState = false;
  let lastAltText = '';
  let lastAltBucket = -1;
  let lastSpaceState = false;

  const syncPilotVisibility = () => {
    seatedLegsGroup.visible = pilotSeated && cockpitActive;
    seatedUpperGroup.visible = pilotSeated && !cockpitActive;
  };
  syncPilotVisibility();

  const setCockpitView = (active: boolean) => {
    cockpitActive = active;
    const showExterior = !active;
    if (exteriorPartsGroup.visible !== showExterior) {
      exteriorPartsGroup.visible = showExterior;
    }
    if (cockpitOnlyGroup.visible !== active) {
      cockpitOnlyGroup.visible = active;
    }
    syncPilotVisibility();
  };

  const setPilotSeated = (seated: boolean) => {
    pilotSeated = seated;
    syncPilotVisibility();
  };

  const updateCockpit = (
    dt: number,
    speed: number,
    altitude: number,
    inSpace: boolean,
    isBoosting: boolean,
    turnInput: number,
    pitchInput: number,
    pitchRad = 0,
    rollRad = 0,
    headingDeg = 0,
    _targetBearingDeg = 0,
  ) => {
    if (!cockpitActive) return;

    stickRoll = THREE.MathUtils.damp(stickRoll, turnInput * 0.36, 12, dt);
    stickPitch = THREE.MathUtils.damp(stickPitch, pitchInput * 0.32, 12, dt);
    stickPivot.rotation.set(stickPitch, 0, stickRoll);

    const speedRounded = Math.max(0, Math.round(speed));
    const speedText = String(speedRounded);
    const speedBucket = Math.round(THREE.MathUtils.clamp(speed / 120, 0, 1) * 12);
    if (
      speedText !== lastSpeedText ||
      speedBucket !== lastSpeedBucket ||
      isBoosting !== lastBoostState
    ) {
      lastSpeedText = speedText;
      lastSpeedBucket = speedBucket;
      lastBoostState = isBoosting;
      drawSpeedConsole(speed, isBoosting);
    }

    const altRounded = Math.max(0, Math.round(altitude));
    const altText =
      altRounded >= 10000
        ? `${(altRounded / 1000).toFixed(1)}k`
        : String(altRounded);
    const altBucket = Math.round(THREE.MathUtils.clamp(altitude / 220, 0, 1) * 12);
    if (
      altText !== lastAltText ||
      altBucket !== lastAltBucket ||
      inSpace !== lastSpaceState
    ) {
      lastAltText = altText;
      lastAltBucket = altBucket;
      lastSpaceState = inSpace;
      drawAltConsole(altitude, inSpace);
    }

    hudUpdateAccum += dt;
    if (hudUpdateAccum >= 0.08) {
      hudUpdateAccum = 0;
      drawHudCombiner(speed, altitude, headingDeg, pitchRad, rollRad);
    }
  };

  if (import.meta.env.DEV && !loggedShipMeshStats) {
    loggedShipMeshStats = true;
    const rawPartsBefore =
      shipPaintedParts.length +
      shipBrightMetalParts.length +
      shipDarkTrimParts.length +
      extNozzleInnerParts.length +
      cockpitAccentParts.length +
      5 /*stick*/ +
      22 /*pilot*/ +
      12 /*gearLegs*/ +
      14; /*individual meshes*/
    let meshesAfter = 0;
    group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) meshesAfter++;
    });
    console.log(`[Models] createShipModel: ${rawPartsBefore} -> ${meshesAfter} meshes`);
  }

  return {
    group,
    colliders,
    leftFlame,
    rightFlame,
    thrusterLight,
    flameMaterial,
    setGearExtension,
    setCockpitView,
    setPilotSeated,
    updateCockpit,
    updateEffects: (
      elapsed: number,
      thrustPower: number,
      isBoosting: boolean,
      reentryIntensity: number,
    ) => {
      outerPlumeUniforms.uTime.value = elapsed;
      outerPlumeUniforms.uPower.value = thrustPower;
      if (isBoosting) {
        outerPlumeUniforms.uColorCore.value.setHex(0xfbbf24);
        outerPlumeUniforms.uColorEdge.value.setHex(0xf97316);
        nozzleInnerMat.color.setHex(0xfbbf24);
        flameMaterial.color.setHex(0xfef3c7);
        machRingMaterial.color.setHex(0xfb923c);
      } else {
        outerPlumeUniforms.uColorCore.value.setHex(0x38bdf8);
        outerPlumeUniforms.uColorEdge.value.setHex(0x8b5cf6);
        nozzleInnerMat.color.setHex(0x38bdf8);
        flameMaterial.color.setHex(0xe0f2fe);
        machRingMaterial.color.setHex(0x7dd3fc);
      }

      const showFlames = leftFlame.visible;
      coreFlamesInstanced.visible = showFlames;
      outerFlamesInstanced.visible = showFlames;

      const podWidth = leftFlame.scale.x * 0.72;
      const podLength = leftFlame.scale.z * 0.78;
      leftFlame.scale.set(podWidth, podWidth, podLength);
      rightFlame.scale.set(podWidth, podWidth, podLength);

      const coreLength = podLength * 0.82;
      const coreWidth = (0.72 + thrustPower * 0.28) * 0.72;

      const mainW = 1.28 + thrustPower * 0.34;
      const mainL = Math.max(0.28, podLength * 1.48);

      if (showFlames) {
        writeFlameMatrices(mainW, mainL, podWidth, podLength, coreWidth, coreLength);
      }

      const showRing = showFlames && thrustPower > 0.25;
      centerRing.visible = showRing;
      if (showRing) {
        const ringPulse = 0.95 + 0.18 * Math.sin(elapsed * 46);
        centerRing.position.z = 3.88 + thrustPower * 0.95;
        centerRing.scale.setScalar(ringPulse * (0.95 + thrustPower * 0.35));
        machRingMaterial.opacity = Math.min(0.85, thrustPower * 0.72);
      }

      const activeReentry = reentryIntensity > 0.025;
      reentryShield.visible = activeReentry;
      if (activeReentry) {
        reentryUniforms.uTime.value = elapsed;
        reentryUniforms.uIntensity.value = reentryIntensity;
        const pulse = 1.0 + Math.sin(elapsed * 32) * 0.02 * reentryIntensity;
        reentryShield.scale.set(pulse, pulse, 1.0);
      }
    },
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
    },
  };
}

function makeSeatedHelmetWhiteGeo(): THREE.BufferGeometry {
  const backGeo = new THREE.SphereGeometry(
    0.145,
    14,
    10,
    -Math.PI * 0.15,
    Math.PI * 1.3,
    0.12,
    Math.PI * 0.78,
  );
  backGeo.scale(1.0, 1.08, 1.06);
  backGeo.translate(0, 0.635, -0.022);

  const crownGeo = new THREE.SphereGeometry(
    0.148,
    14,
    10,
    0,
    Math.PI * 2,
    0,
    Math.PI * 0.42,
  );
  crownGeo.scale(0.98, 1.04, 1.08);
  crownGeo.translate(0, 0.638, -0.032);

  return mergeStaticGeometries([
    backGeo,
    crownGeo,
    makeBox(0.18, 0.068, 0.12, 0, 0.542, -0.098, 0.22),
    makeBox(0.052, 0.12, 0.11, -0.112, 0.605, -0.075),
    makeBox(0.052, 0.12, 0.11, 0.112, 0.605, -0.075),
  ]);
}

export function createBeaconModel(): BeaconModelHandle {
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  const ringMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      metalness: 0.85,
      roughness: 0.2,
      emissive: 0xca8a04,
      emissiveIntensity: 0.45,
    }),
  );

  const innerMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xfef08a,
      metalness: 0.65,
      roughness: 0.25,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.8,
    }),
  );

  const coreMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.2,
      roughness: 0.1,
      emissive: 0xf59e0b,
      emissiveIntensity: 1.6,
    }),
  );

  const beamMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      transparent: true,
      opacity: 0.24,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );

  const baseMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.8,
      roughness: 0.5,
    }),
  );

  const baseGeo = trackGeo(new THREE.CylinderGeometry(2.6, 3.0, 0.45, 14, 1, true));
  const baseRing = new THREE.Mesh(baseGeo, baseMat);
  baseRing.position.y = -2.2;
  group.add(baseRing);

  const outerGeo = trackGeo(new THREE.TorusGeometry(2.4, 0.14, 8, 24));
  const outerRing = new THREE.Mesh(outerGeo, ringMat);
  group.add(outerRing);

  const innerGeo = trackGeo(new THREE.TorusGeometry(1.65, 0.11, 8, 20));
  const innerRing = new THREE.Mesh(innerGeo, innerMat);
  group.add(innerRing);

  const coreGeo = trackGeo(new THREE.OctahedronGeometry(0.85, 0));
  const core = new THREE.Mesh(coreGeo, coreMat);
  group.add(core);

  const beamGeo = trackGeo(new THREE.CylinderGeometry(0.45, 1.35, 36, 10, 1, true));
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.y = 14;
  group.add(beam);

  if (import.meta.env.DEV && !loggedBeaconMeshStats) {
    loggedBeaconMeshStats = true;
    let meshesAfter = 0;
    group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) meshesAfter++;
    });
    console.log(`[Models] createBeaconModel: 5 -> ${meshesAfter} meshes`);
  }

  return {
    group,
    outerRing,
    innerRing,
    core,
    beam,
    update: (elapsed: number, dt: number) => {
      outerRing.rotation.y += dt * 1.1;
      outerRing.rotation.x = Math.sin(elapsed * 0.9) * 0.4;
      innerRing.rotation.x += dt * 1.5;
      innerRing.rotation.z += dt * 0.8;
      core.rotation.y -= dt * 1.8;
      core.position.y = Math.sin(elapsed * 2.4) * 0.32;
      beamMat.opacity = 0.2 + Math.sin(elapsed * 3.0) * 0.06;
    },
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
