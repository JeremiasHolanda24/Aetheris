import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GEAR_REST_HEIGHT } from './LandingController';

export interface ShipModelHandle {
  group: THREE.Group;
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

function mergeStaticGeometries(
  parts: THREE.BufferGeometry[],
): THREE.BufferGeometry {
  const normalized = parts.map((g) => {
    const nonIdx = g.index ? g.toNonIndexed() : g;
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

function createStarfighterHullTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    ctx.fillStyle = '#f2ede2';
    ctx.fillRect(0, 0, size, size);

    const sideGrad = ctx.createLinearGradient(0, 0, size, 0);
    sideGrad.addColorStop(0.0, '#dfd8ca');
    sideGrad.addColorStop(0.25, '#ece6da');
    sideGrad.addColorStop(0.5, '#f6f2e9');
    sideGrad.addColorStop(0.75, '#ece6da');
    sideGrad.addColorStop(1.0, '#dfd8ca');
    ctx.fillStyle = sideGrad;
    ctx.fillRect(0, 0, size, size);

    // Foredeck crimson triple racing stripe
    const cx = size * 0.5;
    const stripeTop = size * 0.135;
    const stripeBot = size * 0.37;

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

    // Filigree emblem on nose cone
    ctx.strokeStyle = 'rgba(176, 134, 62, 0.72)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(cx, size * 0.105, 5.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, size * 0.105, 11, Math.PI * 0.18, Math.PI * 0.82);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, size * 0.062);
    ctx.lineTo(cx, size * 0.094);
    ctx.moveTo(cx - 5, size * 0.072);
    ctx.lineTo(cx - 5, size * 0.096);
    ctx.moveTo(cx + 5, size * 0.072);
    ctx.lineTo(cx + 5, size * 0.096);
    ctx.stroke();

    // Recessed hull panel seam lines
    ctx.strokeStyle = 'rgba(130, 114, 88, 0.34)';
    ctx.lineWidth = 1.4;
    const panelYs = [0.22, 0.34, 0.66, 0.80, 0.91];
    for (let i = 0; i < panelYs.length; i++) {
      const py = size * panelYs[i];
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(size, py);
      ctx.stroke();
    }

    const seamXs = [0.22, 0.34, 0.42, 0.58, 0.66, 0.78];
    for (let i = 0; i < seamXs.length; i++) {
      const px = size * seamXs[i];
      ctx.beginPath();
      ctx.moveTo(px, size * 0.08);
      ctx.lineTo(px, size * 0.96);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 2;
  tex.needsUpdate = true;
  return tex;
}

function createWingPodTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    ctx.fillStyle = '#f0ebe0';
    ctx.fillRect(0, 0, size, size);

    const grad = ctx.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, '#f5f1e8');
    grad.addColorStop(1, '#e3dccd');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = 'rgba(128, 112, 86, 0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(18, 22, size - 36, size - 44);
    ctx.beginPath();
    ctx.moveTo(18, size * 0.55);
    ctx.lineTo(size - 18, size * 0.55);
    ctx.moveTo(size * 0.5, 22);
    ctx.lineTo(size * 0.5, size - 22);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 2;
  tex.needsUpdate = true;
  return tex;
}

function createUfcKeypadTexture(): THREE.CanvasTexture {
  const w = 512;
  const h = 288;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#060d14';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, w - 12, h - 12);

    // Keypad matrix on left + status readout on right
    const keyCols = 3;
    const keyRows = 4;
    const labels = [
      '1', '2', '3',
      '4', '5', '6',
      '7', '8', '9',
      'CLR', '0', 'ENT',
    ];
    for (let r = 0; r < keyRows; r++) {
      for (let c = 0; c < keyCols; c++) {
        const bx = 22 + c * 68;
        const by = 24 + r * 62;
        ctx.fillStyle = '#15202e';
        ctx.fillRect(bx, by, 58, 50);
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(bx, by, 58, 50);
        ctx.fillStyle = '#86efac';
        ctx.font = c === 0 && r === 3 ? 'bold 20px monospace' : c === 2 && r === 3 ? 'bold 20px monospace' : 'bold 28px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labels[r * keyCols + c], bx + 29, by + 26);
      }
    }
    ctx.textBaseline = 'alphabetic';

    // UFC readout channels on right side
    const readoutLines = ['NAV  OK', 'WPN RDY', 'ATM STD', 'COM CH1'];
    for (let i = 0; i < readoutLines.length; i++) {
      const rx = 242;
      const ry = 24 + i * 62;
      ctx.fillStyle = '#07180f';
      ctx.fillRect(rx, ry, 246, 50);
      ctx.strokeStyle = i === 1 ? '#f59e0b' : '#22c55e';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(rx, ry, 246, 50);
      ctx.fillStyle = i === 1 ? '#fde047' : '#4ade80';
      ctx.font = 'bold 30px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(readoutLines[i], rx + 123, ry + 26);
    }
    ctx.textBaseline = 'alphabetic';
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
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

  const hullTex = trackTex(createStarfighterHullTexture());
  const wingPodTex = trackTex(createWingPodTexture());
  const ufcTex = trackTex(createUfcKeypadTexture());

  const hullMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: hullTex,
      color: 0xffffff,
      metalness: 0.16,
      roughness: 0.28,
      envMapIntensity: 1.0,
    }),
  );

  const wingIvoryMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: wingPodTex,
      color: 0xffffff,
      metalness: 0.16,
      roughness: 0.3,
      envMapIntensity: 1.0,
    }),
  );

  const brushedGoldMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xd6a64c,
      metalness: 0.9,
      roughness: 0.24,
      envMapIntensity: 1.45,
    }),
  );

  const crimsonMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xc94732,
      metalness: 0.14,
      roughness: 0.38,
      envMapIntensity: 0.85,
    }),
  );

  const darkTrimMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x1a2029,
      metalness: 0.58,
      roughness: 0.54,
      envMapIntensity: 0.72,
    }),
  );

  const seatTanMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xb76835,
      metalness: 0.06,
      roughness: 0.72,
    }),
  );

  const cockpitAccentMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
    }),
  );

  const ufcMat = trackMat(
    new THREE.MeshBasicMaterial({
      map: ufcTex,
      toneMapped: false,
    }),
  );

  // Pilot EVA suit materials (matches CharacterModel 1:1)
  const pilotWhiteMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      roughness: 0.42,
      metalness: 0.08,
      envMapIntensity: 0.9,
    }),
  );
  const pilotGrayMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x525d6d,
      roughness: 0.48,
      metalness: 0.42,
      envMapIntensity: 0.95,
    }),
  );
  const pilotBlackMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x171b22,
      roughness: 0.62,
      metalness: 0.25,
      envMapIntensity: 0.7,
    }),
  );
  const pilotSkinMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xd9a27e,
      roughness: 0.68,
      metalness: 0.02,
      envMapIntensity: 0.45,
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
  const radarScreen = createInstrumentScreen(512, 384);
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

  const drawRadarConsole = (
    pitchRad: number,
    rollRad: number,
    headingDeg: number,
    targetBearingDeg: number,
  ) => {
    const ctx = radarScreen.ctx;
    if (!ctx) return;
    const w = radarScreen.canvas.width;
    const h = radarScreen.canvas.height;
    const cx = w * 0.5;
    const cy = h * 0.58;
    const r = 126;

    ctx.fillStyle = '#030b11';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, w - 20, h - 20);

    // Top digital heading bar
    ctx.fillStyle = 'rgba(34, 197, 94, 0.18)';
    ctx.fillRect(18, 18, w - 36, 56);
    ctx.fillStyle = '#86efac';
    ctx.font = 'bold 34px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`CAP ${String(Math.round(headingDeg)).padStart(3, '0')}`, 30, 56);
    ctx.textAlign = 'right';
    ctx.fillText('ATD/RDR', w - 30, 56);

    // Horizon line tilted by roll/pitch inside circular mask
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 3, 0, Math.PI * 2);
    ctx.clip();

    ctx.translate(cx, cy);
    ctx.rotate(-rollRad);
    const pitchPx = THREE.MathUtils.clamp(pitchRad * 92, -84, 84);
    ctx.fillStyle = 'rgba(14, 116, 144, 0.34)';
    ctx.fillRect(-r, pitchPx - 180, r * 2, 180);
    ctx.fillStyle = 'rgba(146, 64, 14, 0.34)';
    ctx.fillRect(-r, pitchPx, r * 2, 180);

    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-r, pitchPx);
    ctx.lineTo(r, pitchPx);
    ctx.stroke();
    ctx.restore();

    // Compass rose circles
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.68)';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.54, 0, Math.PI * 2);
    ctx.stroke();

    // Ship center aircraft symbol
    ctx.strokeStyle = '#86efac';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(cx - 28, cy);
    ctx.lineTo(cx - 10, cy);
    ctx.lineTo(cx, cy + 10);
    ctx.lineTo(cx + 10, cy);
    ctx.lineTo(cx + 28, cy);
    ctx.stroke();

    // Target direction blip around radar edge
    const relRad = THREE.MathUtils.degToRad(targetBearingDeg - headingDeg);
    const bx = cx + Math.sin(relRad) * (r - 20);
    const by = cy - Math.cos(relRad) * (r - 20);
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.arc(bx, by, 10, 0, Math.PI * 2);
    ctx.fill();

    radarScreen.tex.needsUpdate = true;
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
  drawRadarConsole(0, 0, 0, 0);
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

  const engineMetalMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x5c5750,
      metalness: 0.86,
      roughness: 0.28,
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
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
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

  // 1. Primary Silhouette: 1.6x Smooth Lofted Ivory Fuselage with seamless U-channel cockpit cavity (1 draw call)
  const fuselageGeo = trackGeo(
    buildLoftedFuselageGeometry(0, 1, 36, 32, 0, true),
  );
  const fuselage = new THREE.Mesh(fuselageGeo, hullMat);
  fuselage.castShadow = !isMobileOrSoftware;
  group.add(fuselage);

  // 2. Cockpit-visible static geometry buckets (flush surface-inlaid gold trim matching Solaris design)
  const hullGoldParts: THREE.BufferGeometry[] = [
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

  // ALL cockpit interior geometry strictly bounded inside |x| <= 0.37, y >= -0.145, z ∈ [-1.02, +0.20]
  // so zero edges can ever touch or protrude through the white hull skin!
  const hullDarkParts: THREE.BufferGeometry[] = [
    // Flush exterior nose deck sensor ports
    makeCyl(0.044, 0.052, 0.025, 10, sensorPortL.x, sensorPortL.y, sensorPortL.z, 0.14, 0, 0.22),
    makeCyl(0.044, 0.052, 0.025, 10, sensorPortR.x, sensorPortR.y, sensorPortR.z, 0.14, 0, -0.22),

    // Cockpit tub floor liner & aft bulkhead sealing behind seat
    makeBox(0.70, 0.03, 1.12, 0, -0.125, -0.44),
    makeBox(0.68, 0.44, 0.06, 0, 0.11, 0.14),

    // Sloped Left & Right Side Switch Consoles strictly inside tub walls (|x| <= 0.365)
    makeBox(0.13, 0.24, 0.80, -0.30, 0.01, -0.44),
    makeBox(0.13, 0.24, 0.80, 0.30, 0.01, -0.44),
    // Left throttle quadrant base + handle
    makeBox(0.08, 0.045, 0.14, -0.28, 0.15, -0.52),
    makeBox(0.045, 0.04, 0.075, -0.28, 0.185, -0.53, -0.25),

    // Trapezoidal Sloped Front Instrument Pedestal & Shroud (z = -0.86 .. -0.68, unobstructed face ahead of panels)
    makeBox(0.62, 0.40, 0.18, 0, 0.12, -0.77, -0.10),
    // Upper tapered glare shroud sits FORWARD of MFDs & UFC so NOTHING blocks any screen!
    makeBox(0.26, 0.030, 0.10, 0, 0.468, -0.745, 0.10),
    makeBox(0.18, 0.030, 0.10, -0.20, 0.405, -0.730, 0.10, 0, 0.50),
    makeBox(0.18, 0.030, 0.10, 0.20, 0.405, -0.730, 0.10, 0, -0.50),

    // UFC mounting housing (centered directly above Center MFD)
    makeBox(0.202, 0.104, 0.04, 0, 0.415, -0.685, -0.16),

    // Twin Dark Vertical HUD Combiner Glass Brackets
    makeBox(0.016, 0.145, 0.026, -0.120, 0.535, -0.710),
    makeBox(0.016, 0.145, 0.026, 0.120, 0.535, -0.710),

    // Center Flight Stick Boot & Sub-Floor Socket (between pilot legs at z = -0.49)
    makeCyl(0.038, 0.056, 0.05, 10, 0, -0.085, -0.49),

    // Sculpted Armored Pilot Seat frame (merged into hullDarkParts to save a draw call)
    makeBox(0.42, 0.06, 0.42, 0, -0.075, -0.16), // Seat pan
    makeBox(0.39, 0.44, 0.065, 0, 0.16, 0.04, -0.20), // Reclined backrest frame
    makeBox(0.06, 0.26, 0.20, -0.205, 0.08, -0.09, -0.14), // Left side bolster
    makeBox(0.06, 0.26, 0.20, 0.205, 0.08, -0.09, -0.14), // Right side bolster
  ];

  const hullMetalParts: THREE.BufferGeometry[] = [
    makeCyl(0.022, 0.022, 0.03, 8, sensorPortL.x, sensorPortL.y + 0.002, sensorPortL.z, 0.14, 0, 0.22),
    makeCyl(0.022, 0.022, 0.03, 8, sensorPortR.x, sensorPortR.y + 0.002, sensorPortR.z, 0.14, 0, -0.22),
  ];

  // Glowing side-console switch strips & throttle indicator LEDs
  const cockpitAccentParts: THREE.BufferGeometry[] = [
    makeBox(0.026, 0.008, 0.38, -0.29, 0.136, -0.34),
    makeBox(0.026, 0.008, 0.38, 0.29, 0.136, -0.34),
  ];

  // UFC Illuminated Keypad Face (directly visible above Center MFD)
  const ufcFace = new THREE.Mesh(
    trackGeo(new THREE.PlaneGeometry(0.188, 0.092)),
    ufcMat,
  );
  ufcFace.position.set(0, 0.415, -0.663);
  ufcFace.rotation.x = -0.16;
  group.add(ufcFace);

  // Transparent Green HUD Combiner Glass + Emissive Green Symbology Projection
  const hudGlassGeo = trackGeo(new THREE.PlaneGeometry(0.228, 0.150));
  const hudGlassMesh = new THREE.Mesh(hudGlassGeo, hudGlassTintMat);
  hudGlassMesh.position.set(0, 0.540, -0.710);
  hudGlassMesh.renderOrder = 3;
  group.add(hudGlassMesh);

  const hudSymbologyMesh = new THREE.Mesh(hudGlassGeo, hudSymbologyMat);
  hudSymbologyMesh.position.set(0, 0.540, -0.706);
  hudSymbologyMesh.renderOrder = 4;
  group.add(hudSymbologyMesh);

  // 3 Unobstructed Side-by-Side MFD Screens (Left: Speed, Center: Radar/Attitude, Right: Altitude)
  const sideBodyGeo = new THREE.BoxGeometry(0.174, 0.130, 0.028);
  const sideBezelGeo = new THREE.BoxGeometry(0.180, 0.136, 0.012);
  const sideScreenGeo = trackGeo(new THREE.PlaneGeometry(0.164, 0.120));

  const centerBodyGeo = new THREE.BoxGeometry(0.190, 0.136, 0.028);
  const centerBezelGeo = new THREE.BoxGeometry(0.196, 0.142, 0.012);
  const centerScreenGeo = trackGeo(new THREE.PlaneGeometry(0.178, 0.124));

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
    hullDarkParts.push(hG);

    const bG = bezelG.clone();
    bG.translate(0, 0, 0.01);
    bG.applyQuaternion(q);
    bG.translate(pos.x, pos.y, pos.z);
    hullGoldParts.push(bG);

    const screen = new THREE.Mesh(screenG, screenMat);
    const offset = new THREE.Vector3(0, 0, 0.017).applyQuaternion(q);
    screen.position.copy(pos).add(offset);
    screen.quaternion.copy(q);
    group.add(screen);
  };

  addMfdPanel(-0.214, 0.304, -0.648, 0.22, sideBodyGeo, sideBezelGeo, sideScreenGeo, speedScreen.mat);
  addMfdPanel(0, 0.300, -0.665, 0, centerBodyGeo, centerBezelGeo, centerScreenGeo, radarScreen.mat);
  addMfdPanel(0.214, 0.304, -0.648, -0.22, sideBodyGeo, sideBezelGeo, sideScreenGeo, altScreen.mat);

  sideBodyGeo.dispose();
  sideBezelGeo.dispose();
  centerBodyGeo.dispose();
  centerBezelGeo.dispose();

  group.add(
    new THREE.Mesh(trackGeo(mergeStaticGeometries(hullGoldParts)), brushedGoldMat),
  );
  group.add(
    new THREE.Mesh(trackGeo(mergeStaticGeometries(hullDarkParts)), darkTrimMat),
  );
  group.add(
    new THREE.Mesh(trackGeo(mergeStaticGeometries(hullMetalParts)), engineMetalMat),
  );
  group.add(
    new THREE.Mesh(
      trackGeo(mergeStaticGeometries(cockpitAccentParts)),
      cockpitAccentMat,
    ),
  );

  // Low Ergonomic Center Flight Stick (Manche) between Pilot Knees (unobstructed MFDs!)
  const stickPivot = new THREE.Group();
  stickPivot.position.set(0, -0.06, -0.49);
  group.add(stickPivot);

  const stickDarkGeo = trackGeo(
    mergeStaticGeometries([
      makeCyl(0.022, 0.018, 0.105, 8, 0, 0.175, 0.008, 0.14),
      makeBox(0.048, 0.028, 0.042, 0, 0.23, 0.006),
    ]),
  );
  stickPivot.add(new THREE.Mesh(stickDarkGeo, darkTrimMat));
  stickPivot.add(
    new THREE.Mesh(
      trackGeo(makeCyl(0.014, 0.017, 0.125, 8, 0, 0.062, 0)),
      engineMetalMat,
    ),
  );
  stickPivot.add(
    new THREE.Mesh(
      trackGeo(makeCyl(0.021, 0.021, 0.016, 8, 0, 0.122, 0)),
      brushedGoldMat,
    ),
  );
  stickPivot.add(
    new THREE.Mesh(
      trackGeo(makeBox(0.014, 0.016, 0.016, 0, 0.234, 0.026)),
      crimsonMat,
    ),
  );

  const seatTanGeo = trackGeo(
    mergeStaticGeometries([
      makeBox(0.32, 0.055, 0.35, 0, -0.04, -0.17), // Cushion
      makeBox(0.30, 0.36, 0.06, 0, 0.16, 0.005, -0.20), // Lumbar cushion
      makeBox(0.22, 0.13, 0.065, 0, 0.39, 0.065, -0.12), // Headrest pad
    ]),
  );
  group.add(new THREE.Mesh(seatTanGeo, seatTanMat));

  const seatStrapGeo = trackGeo(
    mergeStaticGeometries([
      makeBox(0.04, 0.32, 0.025, -0.085, 0.18, -0.025, -0.20),
      makeBox(0.04, 0.32, 0.025, 0.085, 0.18, -0.025, -0.20),
    ]),
  );
  group.add(new THREE.Mesh(seatStrapGeo, crimsonMat));

  // Seated 1.66 u Astronaut Pilot inside Cockpit:
  // - seatedLegsGroup stays visible in Cockpit View (knees framing center stick at bottom of FOV like Screenshot 3)
  // - seatedUpperGroup is visible in exterior views when pilotSeated === true, hidden in Cockpit View
  const seatedLegsGroup = new THREE.Group();
  group.add(seatedLegsGroup);

  const seatedUpperGroup = new THREE.Group();
  group.add(seatedUpperGroup);

  const thighMeshGeo = trackGeo(
    mergeStaticPartsForSeat([
      makeCyl(0.078, 0.066, 0.36, 8, -0.115, 0.045, -0.34, Math.PI * 0.42, 0.08, 0),
      makeCyl(0.078, 0.066, 0.36, 8, 0.115, 0.045, -0.34, Math.PI * 0.42, -0.08, 0),
      makeCyl(0.064, 0.058, 0.28, 8, -0.13, -0.025, -0.60, -0.28, 0, 0),
      makeCyl(0.064, 0.058, 0.28, 8, 0.13, -0.025, -0.60, -0.28, 0, 0),
    ]),
  );
  seatedLegsGroup.add(new THREE.Mesh(thighMeshGeo, pilotWhiteMat));

  const legPadGrayGeo = trackGeo(
    mergeStaticGeometries([
      makeBox(0.095, 0.085, 0.11, -0.125, 0.09, -0.52, -0.28),
      makeBox(0.095, 0.085, 0.11, 0.125, 0.09, -0.52, -0.28),
    ]),
  );
  seatedLegsGroup.add(new THREE.Mesh(legPadGrayGeo, pilotGrayMat));

  const seatUpperWhiteGeo = trackGeo(
    mergeStaticGeometries([
      // Pelvis + torso reclined ~12 deg
      makeBox(0.31, 0.12, 0.20, 0, 0.015, -0.15, -0.18),
      makeBox(0.35, 0.42, 0.22, 0, 0.26, -0.08, -0.18),
      makeBox(0.30, 0.22, 0.06, 0, 0.31, -0.19, -0.18),
      // Upper arms & forearms reaching forward toward throttle (-X) and center stick (0, -0.54)
      makeCyl(0.052, 0.046, 0.24, 8, -0.22, 0.32, -0.16, 0.62, 0, -0.12),
      makeCyl(0.046, 0.040, 0.24, 8, -0.25, 0.20, -0.36, 1.38, -0.12, 0),
      makeCyl(0.052, 0.046, 0.24, 8, 0.22, 0.32, -0.16, 0.65, 0, 0.16),
      makeCyl(0.046, 0.040, 0.24, 8, 0.11, 0.21, -0.39, 1.42, 0.48, 0),
      // Helmet outer white shell (opening facing -Z forward!)
      makeSeatedHelmetWhiteGeo(),
    ]),
  );
  seatedUpperGroup.add(new THREE.Mesh(seatUpperWhiteGeo, pilotWhiteMat));

  const seatUpperGrayGeo = trackGeo(
    mergeStaticGeometries([
      makeBox(0.14, 0.11, 0.025, 0, 0.32, -0.22, -0.18),
      makeCyl(0.128, 0.14, 0.05, 12, 0, 0.49, -0.04, -0.18),
      makeBox(0.20, 0.024, 0.055, 0, 0.70, -0.13),
    ]),
  );
  seatedUpperGroup.add(new THREE.Mesh(seatUpperGrayGeo, pilotGrayMat));

  const seatUpperBlackGeo = trackGeo(
    mergeStaticGeometries([
      makeBox(0.34, 0.07, 0.22, 0, 0.055, -0.14, -0.18), // Utility belt
      makeBox(0.07, 0.085, 0.075, -0.27, 0.195, -0.50), // Left glove on throttle
      makeBox(0.07, 0.085, 0.075, 0.01, 0.23, -0.54), // Right glove on stick
    ]),
  );
  seatedUpperGroup.add(new THREE.Mesh(seatUpperBlackGeo, pilotBlackMat));

  const seatPilotFaceGeo = trackGeo(
    makeBox(0.11, 0.13, 0.10, 0, 0.625, -0.055),
  );
  seatedUpperGroup.add(new THREE.Mesh(seatPilotFaceGeo, pilotSkinMat));

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

  // 3. Exterior parts (hidden in cockpit camera & merged per material for high FPS!)
  const exteriorPartsGroup = new THREE.Group();
  group.add(exteriorPartsGroup);

  const extIvoryParts: THREE.BufferGeometry[] = [];
  const extGoldParts: THREE.BufferGeometry[] = [];
  const extDarkParts: THREE.BufferGeometry[] = [];
  const extMetalParts: THREE.BufferGeometry[] = [];
  const extCrimsonParts: THREE.BufferGeometry[] = [];
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
  extIvoryParts.push(spineGeo);

  extCrimsonParts.push(
    makeBox(0.22, 0.018, 1.98, 0, 0.555, 1.75),
    makeBox(0.05, 0.018, 1.95, -0.19, 0.555, 1.75),
    makeBox(0.05, 0.018, 1.95, 0.19, 0.555, 1.75),
  );

  // Aft spine & tail hull collars hugging exact geometry
  extGoldParts.push(
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
    // Flush beltline gold seam rail following exact hull equator from Nose M-arch to Tail Collar
    const beltSamples: Array<[number, number]> = [];
    for (let k = 0; k <= 12; k++) {
      beltSamples.push([
        THREE.MathUtils.lerp(0.215, 0.955, k / 12),
        side * Math.PI * 0.49,
      ]);
    }
    extGoldParts.push(buildHullSurfaceTube(beltSamples, 0.016, 0.003, 24));

    // Wing-root pylon & engine pod
    extIvoryParts.push(makeBox(0.58, 0.25, 1.15, side * 0.99, 0.03, 1.25));
    const podG = makeExtrudedSideShape(podPoints, side, 0.38, 0.075, 0.07);
    podG.translate(side * 1.44, 0.22, 1.28);
    extIvoryParts.push(podG);

    // Intake bezel, recess & turbine fan
    extGoldParts.push(
      makeBox(0.73, 0.48, 0.22, side * 1.44, 0.03, 0.22, 0, side * -0.32),
      makeBox(0.67, 0.095, 0.12, side * 1.44, 0.22, 2.46),
    );
    extDarkParts.push(
      makeBox(0.57, 0.32, 0.25, side * 1.44, 0.03, 0.19, 0, side * -0.32),
    );
    extMetalParts.push(
      makeCyl(0.13, 0.145, 0.16, 10, side * 1.44, 0.03, 0.14, Math.PI / 2, side * -0.32),
    );

    // Swept Outer Wing & Flush Leading-Edge Gold Trim
    const wingG = makeExtrudedSideShape(wingPoints, side, 0.12, 0.04, 0.04);
    wingG.translate(side * 1.79, 0.055, 1.47);
    extIvoryParts.push(wingG);

    extGoldParts.push(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(side * 1.79, -0.005, 0.91),
          new THREE.Vector3(side * 3.58, -0.005, 1.69),
          new THREE.Vector3(side * 3.52, -0.005, 2.30),
        ]),
        12,
        0.022,
        7,
        false,
      ),
    );

    // Twin Under-Wing Laser Cannon Pods (matching WeaponsSystem muzzle at x = +-2.65, y = -0.15, z = +0.22)
    const wx = side * 2.65;
    extIvoryParts.push(makeBox(0.12, 0.10, 0.70, wx, -0.08, 1.52)); // Mounting pylon under wing
    extDarkParts.push(
      makeBox(0.21, 0.15, 0.90, wx, -0.15, 1.45), // Armored gun pod housing
      makeCyl(0.076, 0.102, 0.22, 8, wx, -0.15, 0.90, Math.PI / 2), // Nose fairing
    );
    extGoldParts.push(
      makeCyl(0.072, 0.072, 0.10, 8, wx, -0.15, 0.74, Math.PI / 2), // Cooling collar
    );
    extCrimsonParts.push(
      makeBox(0.22, 0.042, 0.38, wx, -0.15, 1.52), // Side accent stripe
    );
    extMetalParts.push(
      makeCyl(0.034, 0.044, 0.64, 8, wx, -0.15, 0.54, Math.PI / 2), // Forward laser barrel (tip at z = +0.22)
    );
    extNozzleInnerParts.push(
      makeCyl(0.026, 0.026, 0.04, 8, wx, -0.15, 0.21, Math.PI / 2), // Glowing muzzle emitter
    );
  }

  // Main Engine Nozzle + Twin Pod Auxiliary Nozzles (LatheGeometry scaled 1.6x)
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
  extMetalParts.push(mainNozzleGeo);

  for (const side of [-1, 1] as const) {
    const podNozzleGeo = new THREE.LatheGeometry(mainNozzleProfile, 12);
    podNozzleGeo.rotateX(Math.PI / 2);
    podNozzleGeo.scale(0.62, 0.62, 0.72);
    podNozzleGeo.translate(side * 1.44, 0.03, 2.46);
    extMetalParts.push(podNozzleGeo);
  }

  extNozzleInnerParts.push(
    makeCyl(0.22, 0.22, 0.09, 12, 0, 0.06, 3.44, Math.PI / 2),
    makeCyl(0.135, 0.135, 0.075, 10, -1.44, 0.03, 2.78, Math.PI / 2),
    makeCyl(0.135, 0.135, 0.075, 10, 1.44, 0.03, 2.78, Math.PI / 2),
  );

  const exteriorIvoryMesh = new THREE.Mesh(
    trackGeo(mergeStaticGeometries(extIvoryParts)),
    wingIvoryMat,
  );
  exteriorIvoryMesh.castShadow = !isMobileOrSoftware;
  exteriorPartsGroup.add(exteriorIvoryMesh);

  exteriorPartsGroup.add(
    new THREE.Mesh(trackGeo(mergeStaticGeometries(extGoldParts)), brushedGoldMat),
  );
  exteriorPartsGroup.add(
    new THREE.Mesh(trackGeo(mergeStaticGeometries(extDarkParts)), darkTrimMat),
  );
  exteriorPartsGroup.add(
    new THREE.Mesh(trackGeo(mergeStaticGeometries(extMetalParts)), engineMetalMat),
  );
  exteriorPartsGroup.add(
    new THREE.Mesh(trackGeo(mergeStaticGeometries(extCrimsonParts)), crimsonMat),
  );
  exteriorPartsGroup.add(
    new THREE.Mesh(
      trackGeo(mergeStaticGeometries(extNozzleInnerParts)),
      nozzleInnerMat,
    ),
  );

  // 7. Dynamic Multi-Layer Thruster Exhaust Plumes + Mach Shock Ring (1.6x)
  const coreFlameGeo = trackGeo(new THREE.ConeGeometry(0.10, 1.25, 10, 1, true));
  coreFlameGeo.rotateX(Math.PI / 2);
  coreFlameGeo.translate(0, 0, 0.62);

  const outerFlameGeo = trackGeo(new THREE.ConeGeometry(0.20, 2.15, 12, 1, true));
  outerFlameGeo.rotateX(Math.PI / 2);
  outerFlameGeo.translate(0, 0, 1.08);

  const mainCoreFlame = new THREE.Mesh(coreFlameGeo, flameMaterial);
  mainCoreFlame.position.set(0, 0.06, 3.46);
  exteriorPartsGroup.add(mainCoreFlame);

  const mainOuterFlame = new THREE.Mesh(outerFlameGeo, outerPlumeMaterial);
  mainOuterFlame.position.set(0, 0.06, 3.46);
  mainOuterFlame.renderOrder = 3;
  exteriorPartsGroup.add(mainOuterFlame);

  const leftCoreFlame = new THREE.Mesh(coreFlameGeo, flameMaterial);
  leftCoreFlame.position.set(-1.44, 0.03, 2.80);
  exteriorPartsGroup.add(leftCoreFlame);

  const rightCoreFlame = new THREE.Mesh(coreFlameGeo, flameMaterial);
  rightCoreFlame.position.set(1.44, 0.03, 2.80);
  exteriorPartsGroup.add(rightCoreFlame);

  const leftFlame = new THREE.Mesh(outerFlameGeo, outerPlumeMaterial);
  leftFlame.position.set(-1.44, 0.03, 2.80);
  leftFlame.renderOrder = 3;
  exteriorPartsGroup.add(leftFlame);

  const rightFlame = new THREE.Mesh(outerFlameGeo, outerPlumeMaterial);
  rightFlame.position.set(1.44, 0.03, 2.80);
  rightFlame.renderOrder = 3;
  exteriorPartsGroup.add(rightFlame);

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

  // 9. Retractable Tricycle Landing Gear (GEAR_REST_HEIGHT = 1.08)
  const landingGear = new THREE.Group();
  landingGear.visible = false;
  exteriorPartsGroup.add(landingGear);

  const gearPivotY = -0.28;
  const gearReach = GEAR_REST_HEIGHT + gearPivotY; // 0.80
  const footHeight = 0.055;
  const strutLen = 0.42;
  const pistonLen = Math.max(0.18, gearReach - strutLen * 0.92 - footHeight * 0.5);

  const legDarkGeo = trackGeo(
    mergeStaticGeometries([
      makeCyl(0.042, 0.036, strutLen, 8, 0, -strutLen * 0.5, 0),
      makeCyl(
        0.115,
        0.145,
        footHeight,
        10,
        0,
        -(gearReach - footHeight * 0.5),
        0,
      ),
    ]),
  );
  const legMetalGeo = trackGeo(
    mergeStaticGeometries([
      makeCyl(0.05, 0.05, 0.055, 8, 0, -strutLen * 0.92, 0),
      makeCyl(
        0.025,
        0.028,
        pistonLen,
        8,
        0,
        -(gearReach - footHeight - pistonLen * 0.5),
        0,
      ),
    ]),
  );

  const gearLegOffsets: Array<[number, number]> = [
    [0, -2.0],
    [-1.32, 1.30],
    [1.32, 1.30],
  ];
  const gearLegs: THREE.Group[] = [];

  for (let i = 0; i < gearLegOffsets.length; i++) {
    const [gx, gz] = gearLegOffsets[i];
    const legGroup = new THREE.Group();
    legGroup.position.set(gx, gearPivotY, gz);
    legGroup.scale.setScalar(0.001);
    legGroup.add(new THREE.Mesh(legDarkGeo, darkTrimMat));
    legGroup.add(new THREE.Mesh(legMetalGeo, engineMetalMat));
    landingGear.add(legGroup);
    gearLegs.push(legGroup);
  }

  const setGearExtension = (t: number) => {
    const s = THREE.MathUtils.smoothstep(THREE.MathUtils.clamp(t, 0, 1), 0, 1);
    if (s < 0.02) {
      landingGear.visible = false;
      return;
    }
    landingGear.visible = true;
    const xzScale = 0.4 + 0.6 * s;
    for (let i = 0; i < gearLegs.length; i++) {
      gearLegs[i].scale.set(xzScale, s, xzScale);
    }
  };

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
    seatedLegsGroup.visible = pilotSeated;
    seatedUpperGroup.visible = pilotSeated && !cockpitActive;
  };
  syncPilotVisibility();

  const setCockpitView = (active: boolean) => {
    cockpitActive = active;
    const showExterior = !active;
    if (exteriorPartsGroup.visible !== showExterior) {
      exteriorPartsGroup.visible = showExterior;
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
    targetBearingDeg = 0,
  ) => {
    stickRoll = THREE.MathUtils.damp(stickRoll, turnInput * 0.36, 12, dt);
    stickPitch = THREE.MathUtils.damp(stickPitch, pitchInput * 0.32, 12, dt);
    stickPivot.rotation.set(stickPitch, 0, stickRoll);

    if (!cockpitActive) return;

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
      drawRadarConsole(pitchRad, rollRad, headingDeg, targetBearingDeg);
      drawHudCombiner(speed, altitude, headingDeg, pitchRad, rollRad);
    }
  };

  return {
    group,
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
      leftCoreFlame.visible = showFlames;
      rightCoreFlame.visible = rightFlame.visible;
      mainCoreFlame.visible = showFlames;
      mainOuterFlame.visible = showFlames;

      const podWidth = leftFlame.scale.x * 0.72;
      const podLength = leftFlame.scale.z * 0.78;
      leftFlame.scale.set(podWidth, podWidth, podLength);
      rightFlame.scale.set(podWidth, podWidth, podLength);

      const coreLength = leftFlame.scale.z * 0.82;
      const coreWidth = (0.72 + thrustPower * 0.28) * 0.72;
      leftCoreFlame.scale.set(coreWidth, coreWidth, coreLength);
      rightCoreFlame.scale.set(coreWidth, coreWidth, coreLength);

      const mainW = 1.28 + thrustPower * 0.34;
      const mainL = Math.max(0.28, leftFlame.scale.z * 1.48);
      mainOuterFlame.scale.set(mainW, mainW, mainL);
      mainCoreFlame.scale.set(mainW * 0.9, mainW * 0.9, mainL * 0.85);

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

function mergeStaticPartsForSeat(
  parts: THREE.BufferGeometry[],
): THREE.BufferGeometry {
  return mergeStaticGeometries(parts);
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
