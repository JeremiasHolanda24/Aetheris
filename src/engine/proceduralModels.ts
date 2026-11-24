import * as THREE from 'three';
import { GEAR_REST_HEIGHT } from './LandingController';

export interface ShipModelHandle {
  group: THREE.Group;
  leftFlame: THREE.Mesh;
  rightFlame: THREE.Mesh;
  thrusterLight: THREE.PointLight | null;
  flameMaterial: THREE.MeshBasicMaterial;
  setGearExtension: (t: number) => void;
  setCockpitView: (active: boolean) => void;
  updateCockpit: (
    dt: number,
    speed: number,
    altitude: number,
    inSpace: boolean,
    isBoosting: boolean,
    turnInput: number,
    pitchInput: number,
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

function createStarfighterHullTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    // Warm creamy ivory ceramic base
    ctx.fillStyle = '#f2ede2';
    ctx.fillRect(0, 0, size, size);

    // Subtle longitudinal panel shading (nose-to-tail Y: 0=nose, size=tail; X: 0.5=top centerline)
    const sideGrad = ctx.createLinearGradient(0, 0, size, 0);
    sideGrad.addColorStop(0.0, '#dfd8ca');
    sideGrad.addColorStop(0.25, '#ece6da');
    sideGrad.addColorStop(0.5, '#f6f2e9');
    sideGrad.addColorStop(0.75, '#ece6da');
    sideGrad.addColorStop(1.0, '#dfd8ca');
    ctx.fillStyle = sideGrad;
    ctx.fillRect(0, 0, size, size);

    // Foredeck crimson triple racing stripe (t = 0.14..0.38 -> y = 72..195)
    const cx = size * 0.5;
    const stripeTop = size * 0.135;
    const stripeBot = size * 0.39;

    // Slight forward taper on center band + pinstripes
    ctx.fillStyle = '#c84833';
    ctx.beginPath();
    ctx.moveTo(cx - 11, stripeTop);
    ctx.lineTo(cx + 11, stripeTop);
    ctx.lineTo(cx + 15, stripeBot);
    ctx.lineTo(cx - 15, stripeBot);
    ctx.closePath();
    ctx.fill();

    // Left pinstripe
    ctx.beginPath();
    ctx.moveTo(cx - 18, stripeTop + 6);
    ctx.lineTo(cx - 14.5, stripeTop + 6);
    ctx.lineTo(cx - 19, stripeBot);
    ctx.lineTo(cx - 23.5, stripeBot);
    ctx.closePath();
    ctx.fill();

    // Right pinstripe
    ctx.beginPath();
    ctx.moveTo(cx + 14.5, stripeTop + 6);
    ctx.lineTo(cx + 18, stripeTop + 6);
    ctx.lineTo(cx + 23.5, stripeBot);
    ctx.lineTo(cx + 19, stripeBot);
    ctx.closePath();
    ctx.fill();

    // Subtle filigree emblem on forward nose cone (t = 0.065..0.125)
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

    // Clean recessed hull panel seam lines
    ctx.strokeStyle = 'rgba(130, 114, 88, 0.34)';
    ctx.lineWidth = 1.4;
    const panelYs = [0.22, 0.34, 0.62, 0.78, 0.9];
    for (let i = 0; i < panelYs.length; i++) {
      const py = size * panelYs[i];
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(size, py);
      ctx.stroke();
    }

    // Symmetric longitudinal panel seams flanking top deck & sides
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
  tex.anisotropy = 4;
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
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function fuselageProfileAt(t: number): {
  z: number;
  rx: number;
  yTop: number;
  yBot: number;
} {
  // t = 0 nose (-2.42), t = 1 tail (+1.84)
  const z = THREE.MathUtils.lerp(-2.42, 1.84, t);

  // Smooth aerodynamic width curve: rounded nose -> wide shoulders around cockpit -> gentle waist -> aft tail
  let rx: number;
  if (t < 0.08) {
    rx = 0.012 + 0.24 * Math.pow(t / 0.08, 0.62);
  } else if (t < 0.52) {
    const u = (t - 0.08) / 0.44;
    rx = 0.252 + 0.308 * Math.sin(u * Math.PI * 0.5);
  } else if (t < 0.84) {
    const u = (t - 0.52) / 0.32;
    rx = 0.56 - 0.06 * Math.sin(u * Math.PI * 0.5);
  } else {
    const u = (t - 0.84) / 0.16;
    rx = 0.50 - 0.15 * u * u;
  }

  // Smooth upper & lower deck heights
  const noseRise = Math.pow(Math.min(t / 0.38, 1), 0.72);
  const tailTaper = t > 0.82 ? ((t - 0.82) / 0.18) * 0.09 : 0;
  const yTop = 0.015 + 0.295 * noseRise - tailTaper;
  const yBot = -0.015 - 0.245 * Math.sin(Math.min(t / 0.9, 1) * Math.PI * 0.85);

  return { z, rx, yTop, yBot };
}

function buildLoftedFuselageGeometry(
  tStart = 0,
  tEnd = 1,
  rings = 30,
  segs = 28,
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

    const w = rx + radialPad;
    const midY = (yTop + yBot) * 0.5;
    const halfH = (yTop - yBot) * 0.5 + radialPad;

    // Carve cockpit bay depression cleanly between z = -0.78 and z = +0.28
    const cockpitFactor =
      carveCockpit && z > -0.82 && z < 0.30
        ? Math.sin(THREE.MathUtils.clamp((z + 0.82) / 1.12, 0, 1) * Math.PI)
        : 0;

    for (let s = 0; s <= segs; s++) {
      const su = s / segs;
      // theta = -PI (bottom seam) -> 0 (top spine) -> +PI (bottom seam)
      const theta = (su - 0.5) * Math.PI * 2;
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);

      // Slight superellipse flattening on belly & crisp shoulder roundness
      const x = Math.sign(sinT) * Math.pow(Math.abs(sinT), 0.9) * w;
      let y =
        midY +
        (cosT >= 0
          ? Math.pow(cosT, 0.88) * halfH
          : -Math.pow(-cosT, 1.08) * halfH);

      if (cockpitFactor > 0 && cosT > 0.35) {
        const bowlWeight = Math.pow((cosT - 0.35) / 0.65, 0.85);
        y -= cockpitFactor * bowlWeight * 0.25;
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

  // Cap aft bulkhead at r = rings when full hull
  if (tEnd > 0.98) {
    const tailRingStart = rings * cols;
    const tailProfile = fuselageProfileAt(tEnd);
    const centerIdx = positions.length / 3;
    positions.push(0, (tailProfile.yTop + tailProfile.yBot) * 0.5, tailProfile.z);
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

  // Calibrated PBR Materials (roughness delta >= 0.25 between ivory ceramic, brushed gold & charcoal internals)
  const hullMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      map: hullTex,
      color: 0xffffff,
      metalness: 0.14,
      roughness: 0.28,
      clearcoat: 0.45,
      clearcoatRoughness: 0.2,
      envMapIntensity: 1.1,
    }),
  );

  const wingIvoryMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      map: wingPodTex,
      color: 0xffffff,
      metalness: 0.14,
      roughness: 0.3,
      clearcoat: 0.4,
      clearcoatRoughness: 0.22,
      envMapIntensity: 1.1,
    }),
  );

  const brushedGoldMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0xd6a64c,
      metalness: 0.92,
      roughness: 0.22,
      anisotropy: isMobileOrSoftware ? 0 : 0.72,
      anisotropyRotation: 0.4,
      envMapIntensity: 1.55,
    }),
  );

  const crimsonMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xc94732,
      metalness: 0.12,
      roughness: 0.36,
      envMapIntensity: 0.9,
    }),
  );

  const darkTrimMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x242933,
      metalness: 0.75,
      roughness: 0.55,
    }),
  );

  const seatTanMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xb76835,
      metalness: 0.05,
      roughness: 0.72,
    }),
  );

  // Dynamic Cockpit Instrument Console CanvasTextures (Speed & Altitude)
  const createInstrumentScreen = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 168;
    const ctx = canvas.getContext('2d');
    const tex = trackTex(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = trackMat(
      new THREE.MeshStandardMaterial({
        map: tex,
        emissiveMap: tex,
        emissive: 0xffffff,
        emissiveIntensity: 1.15,
        roughness: 0.24,
        metalness: 0.06,
      }),
    );
    return { canvas, ctx, tex, mat };
  };

  const speedScreen = createInstrumentScreen();
  const altScreen = createInstrumentScreen();

  const drawSpeedConsole = (speed: number, isBoosting: boolean) => {
    const ctx = speedScreen.ctx;
    if (!ctx) return;
    const w = speedScreen.canvas.width;
    const h = speedScreen.canvas.height;
    const accent = isBoosting ? '#fbbf24' : '#38bdf8';

    ctx.fillStyle = '#07111d';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.strokeRect(6, 6, w - 12, h - 12);

    ctx.fillStyle = isBoosting ? 'rgba(251, 191, 36, 0.16)' : 'rgba(56, 189, 248, 0.12)';
    ctx.fillRect(10, 10, w - 20, 34);

    ctx.fillStyle = accent;
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('VELOCIDADE', 18, 33);

    ctx.textAlign = 'right';
    ctx.font = 'bold 15px monospace';
    ctx.fillText(isBoosting ? 'TURBO' : 'CRUZEIRO', w - 18, 33);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 58px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(String(Math.max(0, Math.round(speed))), 18, 106);

    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('m/s', w - 18, 106);

    // Segmented bar gauge
    const barRatio = THREE.MathUtils.clamp(speed / 120, 0, 1);
    const segs = 12;
    const filledSegs = Math.round(barRatio * segs);
    const barX = 18;
    const barY = 126;
    const segW = 16;
    const gap = 2.5;
    for (let i = 0; i < segs; i++) {
      ctx.fillStyle =
        i < filledSegs
          ? i >= 9
            ? '#f59e0b'
            : accent
          : 'rgba(148, 163, 184, 0.22)';
      ctx.fillRect(barX + i * (segW + gap), barY, segW, 20);
    }

    speedScreen.tex.needsUpdate = true;
  };

  const drawAltConsole = (altitude: number, inSpace: boolean) => {
    const ctx = altScreen.ctx;
    if (!ctx) return;
    const w = altScreen.canvas.width;
    const h = altScreen.canvas.height;
    const accent = inSpace ? '#a78bfa' : '#34d399';

    ctx.fillStyle = '#07111d';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.strokeRect(6, 6, w - 12, h - 12);

    ctx.fillStyle = inSpace ? 'rgba(167, 139, 250, 0.16)' : 'rgba(52, 211, 153, 0.12)';
    ctx.fillRect(10, 10, w - 20, 34);

    ctx.fillStyle = accent;
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('ALTITUDE', 18, 33);

    ctx.textAlign = 'right';
    ctx.font = 'bold 15px monospace';
    ctx.fillText(inSpace ? 'ORBITAL' : 'ATMOS', w - 18, 33);

    const roundedAlt = Math.max(0, Math.round(altitude));
    const altText =
      roundedAlt >= 10000
        ? `${(roundedAlt / 1000).toFixed(1)}k`
        : String(roundedAlt);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 54px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(altText, 18, 106);

    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('m', w - 18, 106);

    // Segmented altitude gauge (0..250m atmosphere band)
    const barRatio = THREE.MathUtils.clamp(altitude / 220, 0, 1);
    const segs = 12;
    const filledSegs = Math.round(barRatio * segs);
    const barX = 18;
    const barY = 126;
    const segW = 16;
    const gap = 2.5;
    for (let i = 0; i < segs; i++) {
      ctx.fillStyle = i < filledSegs ? accent : 'rgba(148, 163, 184, 0.22)';
      ctx.fillRect(barX + i * (segW + gap), barY, segW, 20);
    }

    altScreen.tex.needsUpdate = true;
  };

  drawSpeedConsole(0, false);
  drawAltConsole(0, false);

  // Glossy dark-blue / amber reflective glass canopy revealing the ochre interior seat
  const canopyMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0x1e3b64,
      emissive: 0x071226,
      emissiveIntensity: 0.4,
      metalness: 0.1,
      roughness: 0.06,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.75,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
    }),
  );

  const engineMetalMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x5c5750,
      metalness: 0.88,
      roughness: 0.28,
    }),
  );

  const nozzleInnerMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
    }),
  );

  // Inner white-hot plasma core material (kept compatible with ShipModelHandle.flameMaterial)
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

  // Outer animated Mach plasma plume ShaderMaterial
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

  // Atmospheric Re-entry Bow Shockwave ShaderMaterial
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

  // 1. Primary Silhouette: Sculpted Lofted Ivory Fuselage with Recessed Cockpit Bay
  const fuselageGeo = trackGeo(buildLoftedFuselageGeometry(0, 1, 30, 28, 0, true));
  const fuselage = new THREE.Mesh(fuselageGeo, hullMat);
  fuselage.castShadow = !isMobileOrSoftware;
  group.add(fuselage);

  // 2. Brushed Gold Nose Tip Bumper Cap + Foredeck Collars & Beltline Rails
  const noseCapGeo = trackGeo(
    buildLoftedFuselageGeometry(0, 0.062, 8, 22, 0.012, false),
  );
  const noseCap = new THREE.Mesh(noseCapGeo, brushedGoldMat);
  noseCap.castShadow = !isMobileOrSoftware;
  group.add(noseCap);

  // Foredeck U-collar framing forward tip of crimson nose stripe
  const noseCollarCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.34, 0.09, -1.45),
    new THREE.Vector3(-0.22, 0.19, -1.72),
    new THREE.Vector3(0, 0.215, -1.87),
    new THREE.Vector3(0.22, 0.19, -1.72),
    new THREE.Vector3(0.34, 0.09, -1.45),
  ]);
  const noseCollarGeo = trackGeo(
    new THREE.TubeGeometry(noseCollarCurve, 20, 0.026, 8, false),
  );
  const noseCollar = new THREE.Mesh(noseCollarGeo, brushedGoldMat);
  group.add(noseCollar);

  // Pre-cockpit sculpted gold collar arch curving across nose deck & down flanks
  const frontCollarCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.50, 0.02, -0.70),
    new THREE.Vector3(-0.38, 0.21, -0.84),
    new THREE.Vector3(0, 0.305, -0.94),
    new THREE.Vector3(0.38, 0.21, -0.84),
    new THREE.Vector3(0.50, 0.02, -0.70),
  ]);
  const frontCollarGeo = trackGeo(
    new THREE.TubeGeometry(frontCollarCurve, 24, 0.032, 8, false),
  );
  const frontCollar = new THREE.Mesh(frontCollarGeo, brushedGoldMat);
  group.add(frontCollar);

  // Exterior / aft parts hidden during cockpit mode to avoid rendering geometry outside pilot FOV
  const exteriorPartsGroup = new THREE.Group();
  group.add(exteriorPartsGroup);

  // Twin side gold beltline trim rails flanking the fuselage waist
  for (let side = -1; side <= 1; side += 2) {
    const railCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.50, 0.02, -0.70),
      new THREE.Vector3(side * 0.555, 0.03, -0.15),
      new THREE.Vector3(side * 0.53, 0.04, 0.55),
      new THREE.Vector3(side * 0.48, 0.04, 1.38),
    ]);
    const railGeo = trackGeo(new THREE.TubeGeometry(railCurve, 16, 0.028, 8, false));
    const rail = new THREE.Mesh(railGeo, brushedGoldMat);
    exteriorPartsGroup.add(rail);
  }

  // Twin small foredeck sensor ports ahead of canopy (matching reference closeup)
  const portRingGeo = trackGeo(new THREE.CylinderGeometry(0.036, 0.044, 0.035, 10));
  const portCenterGeo = trackGeo(new THREE.CylinderGeometry(0.018, 0.018, 0.042, 8));
  for (let side = -1; side <= 1; side += 2) {
    const portRing = new THREE.Mesh(portRingGeo, darkTrimMat);
    portRing.position.set(side * 0.16, 0.295, -0.95);
    portRing.rotation.x = 0.22;
    group.add(portRing);

    const portCore = new THREE.Mesh(portCenterGeo, engineMetalMat);
    portCore.position.set(side * 0.16, 0.298, -0.95);
    portCore.rotation.x = 0.22;
    group.add(portCore);
  }

  // 3. Cockpit Tub, Tan Pilot Seat (exterior), Dual Live System Consoles, Center Flight Stick (Manche) & Canopy
  const tubGeo = trackGeo(new THREE.BoxGeometry(0.54, 0.12, 0.96));
  const cockpitTub = new THREE.Mesh(tubGeo, darkTrimMat);
  cockpitTub.position.set(0, 0.10, -0.25);
  group.add(cockpitTub);

  const seatBaseGeo = trackGeo(new THREE.BoxGeometry(0.28, 0.08, 0.30));
  const seatBase = new THREE.Mesh(seatBaseGeo, seatTanMat);
  seatBase.position.set(0, 0.17, -0.18);
  exteriorPartsGroup.add(seatBase);

  const seatBackGeo = trackGeo(new THREE.BoxGeometry(0.26, 0.28, 0.08));
  const seatBack = new THREE.Mesh(seatBackGeo, seatTanMat);
  seatBack.position.set(0, 0.30, -0.04);
  seatBack.rotation.x = -0.24;
  exteriorPartsGroup.add(seatBack);

  const headrestGeo = trackGeo(new THREE.BoxGeometry(0.18, 0.11, 0.07));
  const headrest = new THREE.Mesh(headrestGeo, seatTanMat);
  headrest.position.set(0, 0.45, 0.01);
  headrest.rotation.x = -0.15;
  exteriorPartsGroup.add(headrest);

  // Cockpit dashboard cowling behind the dual consoles
  const dashHoodGeo = trackGeo(new THREE.BoxGeometry(0.46, 0.065, 0.16));
  const dashHood = new THREE.Mesh(dashHoodGeo, darkTrimMat);
  dashHood.position.set(0, 0.235, -0.585);
  dashHood.rotation.x = 0.25;
  group.add(dashHood);

  // Dual System Consoles (Left: Velocidade, Right: Altitude)
  const consoleBodyGeo = trackGeo(new THREE.BoxGeometry(0.136, 0.092, 0.026));
  const consoleBezelGeo = trackGeo(new THREE.BoxGeometry(0.142, 0.098, 0.012));
  const consoleScreenGeo = trackGeo(new THREE.PlaneGeometry(0.122, 0.078));

  const buildConsolePanel = (
    xPos: number,
    yawAngle: number,
    screenMat: THREE.Material,
  ) => {
    const panel = new THREE.Group();
    panel.position.set(xPos, 0.282, -0.535);
    panel.rotation.order = 'YXZ';
    panel.rotation.y = yawAngle;
    panel.rotation.x = -0.44;

    const housing = new THREE.Mesh(consoleBodyGeo, darkTrimMat);
    panel.add(housing);

    const bezel = new THREE.Mesh(consoleBezelGeo, brushedGoldMat);
    bezel.position.z = 0.008;
    panel.add(bezel);

    const screen = new THREE.Mesh(consoleScreenGeo, screenMat);
    screen.position.z = 0.016;
    panel.add(screen);

    group.add(panel);
  };

  buildConsolePanel(-0.135, 0.24, speedScreen.mat);
  buildConsolePanel(0.135, -0.24, altScreen.mat);

  // Center Airplane Flight Stick (Manche) between Speed & Altitude consoles
  const stickBootGeo = trackGeo(new THREE.CylinderGeometry(0.032, 0.044, 0.036, 12));
  const stickBoot = new THREE.Mesh(stickBootGeo, darkTrimMat);
  stickBoot.position.set(0, 0.208, -0.44);
  group.add(stickBoot);

  const stickPivot = new THREE.Group();
  stickPivot.position.set(0, 0.22, -0.44);
  group.add(stickPivot);

  const stickShaftGeo = trackGeo(new THREE.CylinderGeometry(0.010, 0.013, 0.082, 8));
  const stickShaft = new THREE.Mesh(stickShaftGeo, engineMetalMat);
  stickShaft.position.y = 0.041;
  stickPivot.add(stickShaft);

  const stickCollarGeo = trackGeo(new THREE.CylinderGeometry(0.015, 0.015, 0.012, 10));
  const stickCollar = new THREE.Mesh(stickCollarGeo, brushedGoldMat);
  stickCollar.position.y = 0.076;
  stickPivot.add(stickCollar);

  const stickGripGeo = trackGeo(new THREE.CylinderGeometry(0.017, 0.014, 0.064, 10));
  const stickGrip = new THREE.Mesh(stickGripGeo, darkTrimMat);
  stickGrip.position.set(0, 0.112, 0.004);
  stickGrip.rotation.x = 0.16;
  stickPivot.add(stickGrip);

  const stickHeadGeo = trackGeo(new THREE.BoxGeometry(0.034, 0.020, 0.028));
  const stickHead = new THREE.Mesh(stickHeadGeo, darkTrimMat);
  stickHead.position.set(0, 0.145, 0.004);
  stickPivot.add(stickHead);

  const stickTriggerGeo = trackGeo(new THREE.BoxGeometry(0.011, 0.012, 0.012));
  const stickTrigger = new THREE.Mesh(stickTriggerGeo, crimsonMat);
  stickTrigger.position.set(0, 0.148, 0.018);
  stickPivot.add(stickTrigger);

  // Sculpted bubble canopy dome
  const canopyGeo = trackGeo(new THREE.SphereGeometry(0.34, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.56));
  canopyGeo.scale(0.95, 0.92, 1.58);
  const canopy = new THREE.Mesh(canopyGeo, canopyMat);
  canopy.position.set(0, 0.24, -0.25);
  canopy.renderOrder = 2;
  group.add(canopy);

  // Outer brushed-gold canopy bezel loop + curved lower visor cross-bar
  const bezelCurve = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(0, 0.26, -0.80),
      new THREE.Vector3(0.27, 0.26, -0.62),
      new THREE.Vector3(0.33, 0.27, -0.25),
      new THREE.Vector3(0.26, 0.29, 0.16),
      new THREE.Vector3(0, 0.31, 0.29),
      new THREE.Vector3(-0.26, 0.29, 0.16),
      new THREE.Vector3(-0.33, 0.27, -0.25),
      new THREE.Vector3(-0.27, 0.26, -0.62),
    ],
    true,
  );
  const bezelGeo = trackGeo(new THREE.TubeGeometry(bezelCurve, 36, 0.028, 8, true));
  const canopyBezel = new THREE.Mesh(bezelGeo, brushedGoldMat);
  group.add(canopyBezel);

  // Forward visor cross-rib across lower glass canopy (clear horizon line from inside cockpit)
  const visorBarCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.24, 0.265, -0.60),
    new THREE.Vector3(-0.14, 0.34, -0.66),
    new THREE.Vector3(0, 0.365, -0.68),
    new THREE.Vector3(0.14, 0.34, -0.66),
    new THREE.Vector3(0.24, 0.265, -0.60),
  ]);
  const visorBarGeo = trackGeo(new THREE.TubeGeometry(visorBarCurve, 18, 0.018, 8, false));
  const visorBar = new THREE.Mesh(visorBarGeo, brushedGoldMat);
  group.add(visorBar);

  // 4. Aft Dorsal Spine Cowl + Aft Triple Crimson Stripes + Gold Tail Arch
  const spineDeckShape = new THREE.Shape();
  spineDeckShape.moveTo(-0.33, -0.66);
  spineDeckShape.lineTo(0.33, -0.66);
  spineDeckShape.lineTo(0.36, -0.44);
  spineDeckShape.lineTo(0.31, 0.55);
  spineDeckShape.lineTo(0.21, 0.78);
  spineDeckShape.lineTo(-0.21, 0.78);
  spineDeckShape.lineTo(-0.31, 0.55);
  spineDeckShape.lineTo(-0.36, -0.44);
  spineDeckShape.closePath();

  const spineDeckGeo = trackGeo(
    new THREE.ExtrudeGeometry(spineDeckShape, {
      depth: 0.16,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.04,
      bevelSegments: 2,
    }),
  );
  spineDeckGeo.rotateX(Math.PI / 2);
  spineDeckGeo.computeVertexNormals();

  const aftCowl = new THREE.Mesh(spineDeckGeo, wingIvoryMat);
  aftCowl.position.set(0, 0.36, 1.06);
  aftCowl.castShadow = !isMobileOrSoftware;
  exteriorPartsGroup.add(aftCowl);

  // Aft triple crimson stripes on dorsal spine cowl
  const aftCenterStripeGeo = trackGeo(new THREE.BoxGeometry(0.14, 0.015, 1.24));
  const aftCenterStripe = new THREE.Mesh(aftCenterStripeGeo, crimsonMat);
  aftCenterStripe.position.set(0, 0.402, 1.12);
  exteriorPartsGroup.add(aftCenterStripe);

  const aftPinStripeGeo = trackGeo(new THREE.BoxGeometry(0.032, 0.015, 1.22));
  for (let side = -1; side <= 1; side += 2) {
    const pin = new THREE.Mesh(aftPinStripeGeo, crimsonMat);
    pin.position.set(side * 0.12, 0.402, 1.12);
    exteriorPartsGroup.add(pin);
  }

  // Gold collars wrapping front and rear of the aft spine cowl
  const aftFrontCollarCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.39, 0.23, 0.40),
    new THREE.Vector3(-0.30, 0.39, 0.47),
    new THREE.Vector3(0, 0.415, 0.50),
    new THREE.Vector3(0.30, 0.39, 0.47),
    new THREE.Vector3(0.39, 0.23, 0.40),
  ]);
  const aftFrontCollarGeo = trackGeo(
    new THREE.TubeGeometry(aftFrontCollarCurve, 20, 0.026, 8, false),
  );
  const aftFrontCollar = new THREE.Mesh(aftFrontCollarGeo, brushedGoldMat);
  exteriorPartsGroup.add(aftFrontCollar);

  const tailArchCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.36, 0.04, 1.72),
    new THREE.Vector3(-0.24, 0.26, 1.83),
    new THREE.Vector3(0, 0.32, 1.78),
    new THREE.Vector3(0.24, 0.26, 1.83),
    new THREE.Vector3(0.36, 0.04, 1.72),
  ]);
  const tailArchGeo = trackGeo(new THREE.TubeGeometry(tailArchCurve, 20, 0.03, 8, false));
  const tailArch = new THREE.Mesh(tailArchGeo, brushedGoldMat);
  exteriorPartsGroup.add(tailArch);

  // 5. Wing-Root Pylons + Dual Lateral Engine / Intake Pods (exact Image 1 & 2 silhouette)
  const pylonGeo = trackGeo(new THREE.BoxGeometry(0.36, 0.16, 0.72));
  const podShape = new THREE.Shape();
  podShape.moveTo(-0.24, -0.74);
  podShape.lineTo(0.18, -0.58);
  podShape.lineTo(0.24, 0.62);
  podShape.lineTo(0.16, 0.76);
  podShape.lineTo(-0.18, 0.76);
  podShape.lineTo(-0.24, 0.62);
  podShape.closePath();

  const podGeo = trackGeo(
    new THREE.ExtrudeGeometry(podShape, {
      depth: 0.24,
      bevelEnabled: true,
      bevelThickness: 0.05,
      bevelSize: 0.045,
      bevelSegments: 2,
    }),
  );
  podGeo.rotateX(Math.PI / 2);
  podGeo.translate(0, 0.12, 0);
  podGeo.computeVertexNormals();

  // Intake bezel + recessed dark intake housing + circular turbine fan inside pod front
  const intakeFrameGeo = trackGeo(new THREE.BoxGeometry(0.46, 0.30, 0.14));
  const intakeHoleGeo = trackGeo(new THREE.BoxGeometry(0.36, 0.20, 0.16));
  const intakeTurbineGeo = trackGeo(new THREE.CylinderGeometry(0.08, 0.09, 0.10, 12));
  intakeTurbineGeo.rotateX(Math.PI / 2);

  // Sculpted gold inner/rear pod trim rail
  const podTrimGeo = trackGeo(new THREE.BoxGeometry(0.42, 0.06, 0.08));

  // Swept Outer Trapezoidal Wings with Brushed Gold Leading-Edge Trim
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0.0, -0.34);
  wingShape.lineTo(1.12, 0.14);
  wingShape.lineTo(1.08, 0.52);
  wingShape.lineTo(0.0, 0.40);
  wingShape.closePath();

  const rightWingGeo = trackGeo(
    new THREE.ExtrudeGeometry(wingShape, {
      depth: 0.075,
      bevelEnabled: true,
      bevelThickness: 0.025,
      bevelSize: 0.025,
      bevelSegments: 2,
    }),
  );
  rightWingGeo.rotateX(Math.PI / 2);
  rightWingGeo.translate(0, 0.035, 0);
  rightWingGeo.computeVertexNormals();

  const wingGoldEdgeCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.0, 0.0, -0.35),
    new THREE.Vector3(1.12, 0.0, 0.14),
    new THREE.Vector3(1.08, 0.0, 0.52),
  ]);
  const wingGoldEdgeGeo = trackGeo(
    new THREE.TubeGeometry(wingGoldEdgeCurve, 16, 0.036, 8, false),
  );

  // Left & Right Pod + Wing assemblies
  for (let side = -1; side <= 1; side += 2) {
    const pylon = new THREE.Mesh(pylonGeo, wingIvoryMat);
    pylon.position.set(side * 0.62, 0.02, 0.78);
    exteriorPartsGroup.add(pylon);

    const pod = new THREE.Mesh(podGeo, wingIvoryMat);
    pod.position.set(side * 0.90, 0.02, 0.80);
    if (side === -1) pod.scale.x = -1;
    pod.castShadow = !isMobileOrSoftware;
    exteriorPartsGroup.add(pod);

    // Angled front air intake bezel matching Image 2
    const intakeBezel = new THREE.Mesh(intakeFrameGeo, brushedGoldMat);
    intakeBezel.position.set(side * 0.90, 0.02, 0.14);
    intakeBezel.rotation.y = side * -0.32;
    exteriorPartsGroup.add(intakeBezel);

    const intakeHole = new THREE.Mesh(intakeHoleGeo, darkTrimMat);
    intakeHole.position.set(side * 0.90, 0.02, 0.12);
    intakeHole.rotation.y = side * -0.32;
    exteriorPartsGroup.add(intakeHole);

    const intakeCore = new THREE.Mesh(intakeTurbineGeo, engineMetalMat);
    intakeCore.position.set(side * 0.90, 0.02, 0.09);
    intakeCore.rotation.y = side * -0.32;
    exteriorPartsGroup.add(intakeCore);

    const podTailTrim = new THREE.Mesh(podTrimGeo, brushedGoldMat);
    podTailTrim.position.set(side * 0.90, 0.14, 1.54);
    exteriorPartsGroup.add(podTailTrim);

    const wing = new THREE.Mesh(rightWingGeo, wingIvoryMat);
    wing.position.set(side * 1.12, 0.0, 0.92);
    if (side === -1) wing.scale.x = -1;
    wing.castShadow = !isMobileOrSoftware;
    exteriorPartsGroup.add(wing);

    const wingTrim = new THREE.Mesh(wingGoldEdgeGeo, brushedGoldMat);
    wingTrim.position.set(side * 1.12, 0.0, 0.92);
    if (side === -1) wingTrim.scale.x = -1;
    exteriorPartsGroup.add(wingTrim);
  }

  // 6. Central Main Engine Nozzle + Twin Pod Auxiliary Nozzles (LatheGeometry)
  const mainNozzleProfile = [
    new THREE.Vector2(0.05, -0.25),
    new THREE.Vector2(0.24, -0.20),
    new THREE.Vector2(0.26, 0.12),
    new THREE.Vector2(0.21, 0.34),
    new THREE.Vector2(0.16, 0.34),
    new THREE.Vector2(0.14, 0.20),
  ];
  const mainNozzleGeo = trackGeo(new THREE.LatheGeometry(mainNozzleProfile, 16));
  mainNozzleGeo.rotateX(Math.PI / 2);

  const mainNozzle = new THREE.Mesh(mainNozzleGeo, engineMetalMat);
  mainNozzle.position.set(0, 0.04, 1.86);
  exteriorPartsGroup.add(mainNozzle);

  const podNozzleGeo = trackGeo(new THREE.LatheGeometry(mainNozzleProfile, 14));
  podNozzleGeo.rotateX(Math.PI / 2);
  podNozzleGeo.scale(0.62, 0.62, 0.72);

  const leftNozzle = new THREE.Mesh(podNozzleGeo, engineMetalMat);
  leftNozzle.position.set(-0.90, 0.02, 1.54);
  exteriorPartsGroup.add(leftNozzle);

  const rightNozzle = new THREE.Mesh(podNozzleGeo, engineMetalMat);
  rightNozzle.position.set(0.90, 0.02, 1.54);
  exteriorPartsGroup.add(rightNozzle);

  // Inner Nozzle Cores (center main + left & right pod)
  const mainCoreGeo = trackGeo(new THREE.CylinderGeometry(0.14, 0.14, 0.06, 14));
  mainCoreGeo.rotateX(Math.PI / 2);
  const mainCore = new THREE.Mesh(mainCoreGeo, nozzleInnerMat);
  mainCore.position.set(0, 0.04, 2.15);
  exteriorPartsGroup.add(mainCore);

  const podCoreGeo = trackGeo(new THREE.CylinderGeometry(0.085, 0.085, 0.05, 12));
  podCoreGeo.rotateX(Math.PI / 2);
  const leftCore = new THREE.Mesh(podCoreGeo, nozzleInnerMat);
  leftCore.position.set(-0.90, 0.02, 1.74);
  exteriorPartsGroup.add(leftCore);

  const rightCore = new THREE.Mesh(podCoreGeo, nozzleInnerMat);
  rightCore.position.set(0.90, 0.02, 1.74);
  exteriorPartsGroup.add(rightCore);

  // 7. Dynamic Multi-Layer Thruster Exhaust Plumes + Mach Shock Rings (all 3 nozzles)
  const coreFlameGeo = trackGeo(new THREE.ConeGeometry(0.065, 0.78, 10, 1, true));
  coreFlameGeo.rotateX(Math.PI / 2);
  coreFlameGeo.translate(0, 0, 0.39);

  const outerFlameGeo = trackGeo(new THREE.ConeGeometry(0.125, 1.35, 14, 1, true));
  outerFlameGeo.rotateX(Math.PI / 2);
  outerFlameGeo.translate(0, 0, 0.68);

  const mainCoreFlame = new THREE.Mesh(coreFlameGeo, flameMaterial);
  mainCoreFlame.position.set(0, 0.04, 2.16);
  exteriorPartsGroup.add(mainCoreFlame);

  const mainOuterFlame = new THREE.Mesh(outerFlameGeo, outerPlumeMaterial);
  mainOuterFlame.position.set(0, 0.04, 2.16);
  mainOuterFlame.renderOrder = 3;
  exteriorPartsGroup.add(mainOuterFlame);

  const leftCoreFlame = new THREE.Mesh(coreFlameGeo, flameMaterial);
  leftCoreFlame.position.set(-0.90, 0.02, 1.75);
  exteriorPartsGroup.add(leftCoreFlame);

  const rightCoreFlame = new THREE.Mesh(coreFlameGeo, flameMaterial);
  rightCoreFlame.position.set(0.90, 0.02, 1.75);
  exteriorPartsGroup.add(rightCoreFlame);

  // Exposed on ShipModelHandle so FlightPhysics controls thrust visibility & length cleanly
  const leftFlame = new THREE.Mesh(outerFlameGeo, outerPlumeMaterial);
  leftFlame.position.set(-0.90, 0.02, 1.75);
  leftFlame.renderOrder = 3;
  exteriorPartsGroup.add(leftFlame);

  const rightFlame = new THREE.Mesh(outerFlameGeo, outerPlumeMaterial);
  rightFlame.position.set(0.90, 0.02, 1.75);
  rightFlame.renderOrder = 3;
  exteriorPartsGroup.add(rightFlame);

  const machRingGeo = trackGeo(new THREE.RingGeometry(0.11, 0.16, 14));
  const centerRing = new THREE.Mesh(machRingGeo, machRingMaterial);
  centerRing.position.set(0, 0.04, 2.55);
  exteriorPartsGroup.add(centerRing);

  // 8. Atmospheric Re-entry Bow Plasma Shockwave Shield
  const shieldProfile = [
    new THREE.Vector2(0.06, 2.68),
    new THREE.Vector2(0.42, 2.32),
    new THREE.Vector2(0.88, 1.55),
    new THREE.Vector2(1.55, 0.52),
    new THREE.Vector2(2.35, -0.55),
    new THREE.Vector2(2.75, -1.35),
  ];
  const shieldGeo = trackGeo(new THREE.LatheGeometry(shieldProfile, 24));
  shieldGeo.rotateX(-Math.PI / 2);
  shieldGeo.scale(1.06, 0.45, 1.0);
  const reentryShield = new THREE.Mesh(shieldGeo, reentryMaterial);
  reentryShield.visible = false;
  reentryShield.renderOrder = 4;
  group.add(reentryShield);

  // 9. Compact Slim Retractable Tricycle Landing Gear (diluted/reduced size, foot bottoms at -GEAR_REST_HEIGHT)
  const landingGear = new THREE.Group();
  landingGear.visible = false;
  exteriorPartsGroup.add(landingGear);

  const gearPivotY = -0.18;
  const gearReach = GEAR_REST_HEIGHT + gearPivotY; // 0.54 below pivot -> -0.72 total
  const footHeight = 0.036;
  const strutLen = 0.30;
  const pistonLen = 0.28;

  const gearStrutGeo = trackGeo(new THREE.CylinderGeometry(0.028, 0.024, strutLen, 8));
  const gearCollarGeo = trackGeo(new THREE.CylinderGeometry(0.033, 0.033, 0.038, 8));
  const gearPistonGeo = trackGeo(new THREE.CylinderGeometry(0.017, 0.019, pistonLen, 8));
  const gearFootGeo = trackGeo(new THREE.CylinderGeometry(0.075, 0.095, footHeight, 12));

  const gearLegOffsets: Array<[number, number]> = [
    [0, -1.25],    // Nose strut
    [-0.82, 0.82], // Left main strut (under left pod)
    [0.82, 0.82],  // Right main strut (under right pod)
  ];
  const gearLegs: THREE.Group[] = [];

  for (let i = 0; i < gearLegOffsets.length; i++) {
    const [gx, gz] = gearLegOffsets[i];
    const legGroup = new THREE.Group();
    legGroup.position.set(gx, gearPivotY, gz);
    legGroup.scale.setScalar(0.001);

    const strut = new THREE.Mesh(gearStrutGeo, darkTrimMat);
    strut.position.y = -strutLen * 0.5;
    strut.castShadow = !isMobileOrSoftware;
    legGroup.add(strut);

    const collar = new THREE.Mesh(gearCollarGeo, brushedGoldMat);
    collar.position.y = -strutLen * 0.92;
    legGroup.add(collar);

    const piston = new THREE.Mesh(gearPistonGeo, engineMetalMat);
    piston.position.y = -(gearReach - footHeight - pistonLen * 0.5);
    piston.castShadow = !isMobileOrSoftware;
    legGroup.add(piston);

    const foot = new THREE.Mesh(gearFootGeo, darkTrimMat);
    foot.position.y = -(gearReach - footHeight * 0.5);
    foot.castShadow = !isMobileOrSoftware;
    legGroup.add(foot);

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

  // 10. Dynamic Thruster Glow Light (skip extra per-pixel point light on mobile/software GL)
  let thrusterLight: THREE.PointLight | null = null;
  if (!isMobileOrSoftware) {
    thrusterLight = new THREE.PointLight(0x38bdf8, 1.5, 18);
    thrusterLight.position.set(0, 0.1, 2.45);
    exteriorPartsGroup.add(thrusterLight);
  }

  let stickRoll = 0;
  let stickPitch = 0;
  let lastSpeedText = '';
  let lastSpeedBucket = -1;
  let lastBoostState = false;
  let lastAltText = '';
  let lastAltBucket = -1;
  let lastSpaceState = false;

  const setCockpitView = (active: boolean) => {
    const showExterior = !active;
    if (exteriorPartsGroup.visible !== showExterior) {
      exteriorPartsGroup.visible = showExterior;
    }
  };

  const updateCockpit = (
    dt: number,
    speed: number,
    altitude: number,
    inSpace: boolean,
    isBoosting: boolean,
    turnInput: number,
    pitchInput: number,
  ) => {
    // Animate flight stick (manche) matching ship pitch & turn direction
    stickRoll = THREE.MathUtils.damp(stickRoll, turnInput * 0.36, 12, dt);
    stickPitch = THREE.MathUtils.damp(stickPitch, pitchInput * 0.32, 12, dt);
    stickPivot.rotation.set(stickPitch, 0, stickRoll);

    // Update consoles only when cockpit view is active and visible values change
    if (exteriorPartsGroup.visible) return;

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
      altRounded >= 10000 ? `${(altRounded / 1000).toFixed(1)}k` : String(altRounded);
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
  };

  return {
    group,
    leftFlame,
    rightFlame,
    thrusterLight,
    flameMaterial,
    setGearExtension,
    setCockpitView,
    updateCockpit,
    updateEffects: (
      elapsed: number,
      thrustPower: number,
      isBoosting: boolean,
      reentryIntensity: number,
    ) => {
      // Multi-layer thruster shader & Mach rings
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

      // Keep pod flames slightly slimmer than the main central engine plume
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
        centerRing.position.z = 2.42 + thrustPower * 0.65;
        centerRing.scale.setScalar(ringPulse * (0.95 + thrustPower * 0.35));
        machRingMaterial.opacity = Math.min(0.85, thrustPower * 0.72);
      }

      // Planetary atmospheric re-entry bow shockwave shield
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

  const baseGeo = trackGeo(new THREE.CylinderGeometry(2.6, 3.0, 0.45, 16, 1, true));
  const baseRing = new THREE.Mesh(baseGeo, baseMat);
  baseRing.position.y = -2.2;
  group.add(baseRing);

  const outerGeo = trackGeo(new THREE.TorusGeometry(2.4, 0.14, 10, 32));
  const outerRing = new THREE.Mesh(outerGeo, ringMat);
  group.add(outerRing);

  const innerGeo = trackGeo(new THREE.TorusGeometry(1.65, 0.11, 10, 28));
  const innerRing = new THREE.Mesh(innerGeo, innerMat);
  group.add(innerRing);

  const coreGeo = trackGeo(new THREE.OctahedronGeometry(0.85, 0));
  const core = new THREE.Mesh(coreGeo, coreMat);
  group.add(core);

  const beamGeo = trackGeo(new THREE.CylinderGeometry(0.45, 1.35, 36, 12, 1, true));
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
