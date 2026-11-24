import * as THREE from 'three';
import { GEAR_REST_HEIGHT } from './LandingController';

export interface ShipModelHandle {
  group: THREE.Group;
  leftFlame: THREE.Mesh;
  rightFlame: THREE.Mesh;
  thrusterLight: THREE.PointLight | null;
  flameMaterial: THREE.MeshBasicMaterial;
  setGearExtension: (t: number) => void;
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

export function createShipModel(isMobileOrSoftware: boolean): ShipModelHandle {
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

  // Calibrated PBR Materials (roughness delta >= 0.25 between adjacent parts)
  const hullMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xdbe2ec,
      metalness: 0.72,
      roughness: 0.26,
      envMapIntensity: 1.15,
    }),
  );

  const darkTrimMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x1b2333,
      metalness: 0.85,
      roughness: 0.55,
    }),
  );

  const accentWingMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      metalness: 0.35,
      roughness: 0.35,
    }),
  );

  // Glossy reflective canopy (no transmission FBO pass -> 2x faster rendering on mobile)
  const canopyMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0x0ea5e9,
      metalness: 0.15,
      roughness: 0.08,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
      envMapIntensity: 1.6,
      transparent: true,
      opacity: 0.78,
    }),
  );

  const engineMetalMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x475569,
      metalness: 0.92,
      roughness: 0.22,
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
          // vUv.y = 0 at nozzle exit, 1 at exhaust tip
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
          // head = 1.0 at nose stagnation tip, 0.0 at rear wing wake
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

  // 1. Primary Silhouette: Faceted Fuselage (ExtrudeGeometry with bevels, pointing -Z)
  const fuselageShape = new THREE.Shape();
  fuselageShape.moveTo(0, 2.35);
  fuselageShape.lineTo(0.42, 0.65);
  fuselageShape.lineTo(0.55, -1.25);
  fuselageShape.lineTo(0.32, -1.75);
  fuselageShape.lineTo(-0.32, -1.75);
  fuselageShape.lineTo(-0.55, -1.25);
  fuselageShape.lineTo(-0.42, 0.65);
  fuselageShape.closePath();

  const fuselageGeo = trackGeo(
    new THREE.ExtrudeGeometry(fuselageShape, {
      depth: 0.34,
      bevelEnabled: true,
      bevelThickness: 0.14,
      bevelSize: 0.12,
      bevelSegments: 1,
    }),
  );
  fuselageGeo.rotateX(-Math.PI / 2);
  fuselageGeo.translate(0, -0.17, 0);
  fuselageGeo.computeVertexNormals();

  const fuselage = new THREE.Mesh(fuselageGeo, hullMat);
  fuselage.castShadow = !isMobileOrSoftware;
  group.add(fuselage);

  // 2. Secondary Read: Swept Delta Wings
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0.45, 0.35);
  wingShape.lineTo(2.45, -1.05);
  wingShape.lineTo(2.35, -1.55);
  wingShape.lineTo(0.5, -1.25);
  wingShape.closePath();

  const rightWingGeo = trackGeo(
    new THREE.ExtrudeGeometry(wingShape, {
      depth: 0.08,
      bevelEnabled: true,
      bevelThickness: 0.03,
      bevelSize: 0.04,
      bevelSegments: 1,
    }),
  );
  rightWingGeo.rotateX(-Math.PI / 2);
  rightWingGeo.translate(0, -0.06, 0);
  rightWingGeo.computeVertexNormals();

  const rightWing = new THREE.Mesh(rightWingGeo, hullMat);
  rightWing.castShadow = !isMobileOrSoftware;
  group.add(rightWing);

  const leftWing = new THREE.Mesh(rightWingGeo, hullMat);
  leftWing.scale.x = -1;
  leftWing.castShadow = !isMobileOrSoftware;
  group.add(leftWing);

  // 3. Forward Canards
  const canardShape = new THREE.Shape();
  canardShape.moveTo(0.28, 1.35);
  canardShape.lineTo(0.95, 0.85);
  canardShape.lineTo(0.9, 0.62);
  canardShape.lineTo(0.32, 0.85);
  canardShape.closePath();

  const canardGeo = trackGeo(
    new THREE.ExtrudeGeometry(canardShape, {
      depth: 0.05,
      bevelEnabled: true,
      bevelThickness: 0.02,
      bevelSize: 0.02,
      bevelSegments: 1,
    }),
  );
  canardGeo.rotateX(-Math.PI / 2);
  canardGeo.translate(0, -0.02, 0);

  const rightCanard = new THREE.Mesh(canardGeo, accentWingMat);
  group.add(rightCanard);

  const leftCanard = new THREE.Mesh(canardGeo, accentWingMat);
  leftCanard.scale.x = -1;
  group.add(leftCanard);

  // 4. Glass Cockpit Canopy
  const canopyGeo = trackGeo(new THREE.CapsuleGeometry(0.26, 0.85, 6, 12));
  canopyGeo.rotateX(Math.PI / 2);
  canopyGeo.scale(1.0, 0.72, 1.2);
  const canopy = new THREE.Mesh(canopyGeo, canopyMat);
  canopy.position.set(0, 0.25, -0.35);
  canopy.renderOrder = 2;
  group.add(canopy);

  const collarGeo = trackGeo(new THREE.BoxGeometry(0.62, 0.14, 1.45));
  const collar = new THREE.Mesh(collarGeo, darkTrimMat);
  collar.position.set(0, 0.14, -0.35);
  group.add(collar);

  // 5. Dorsal Spine Fin
  const spineShape = new THREE.Shape();
  spineShape.moveTo(0, 0.22);
  spineShape.lineTo(0.95, 0.22);
  spineShape.lineTo(1.2, 0.75);
  spineShape.lineTo(0.75, 0.75);
  spineShape.lineTo(0, 0.34);
  spineShape.closePath();

  const spineGeo = trackGeo(
    new THREE.ExtrudeGeometry(spineShape, {
      depth: 0.06,
      bevelEnabled: true,
      bevelThickness: 0.015,
      bevelSize: 0.015,
      bevelSegments: 1,
    }),
  );
  spineGeo.rotateY(-Math.PI / 2);
  spineGeo.translate(0.03, 0, 0.6);

  const spine = new THREE.Mesh(spineGeo, darkTrimMat);
  group.add(spine);

  // 6. Dual Engine Nacelles (LatheGeometry)
  const nacelleProfile = [
    new THREE.Vector2(0.02, -0.45),
    new THREE.Vector2(0.21, -0.38),
    new THREE.Vector2(0.23, 0.25),
    new THREE.Vector2(0.18, 0.52),
    new THREE.Vector2(0.14, 0.52),
    new THREE.Vector2(0.12, 0.36),
  ];
  const nacelleGeo = trackGeo(new THREE.LatheGeometry(nacelleProfile, 14));
  nacelleGeo.rotateX(Math.PI / 2);

  const leftNacelle = new THREE.Mesh(nacelleGeo, engineMetalMat);
  leftNacelle.position.set(-0.46, 0.04, 1.32);
  group.add(leftNacelle);

  const rightNacelle = new THREE.Mesh(nacelleGeo, engineMetalMat);
  rightNacelle.position.set(0.46, 0.04, 1.32);
  group.add(rightNacelle);

  // 7. Inner Nozzle Cores
  const nozzleCoreGeo = trackGeo(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 12));
  nozzleCoreGeo.rotateX(Math.PI / 2);

  const leftCore = new THREE.Mesh(nozzleCoreGeo, nozzleInnerMat);
  leftCore.position.set(-0.46, 0.04, 1.81);
  group.add(leftCore);

  const rightCore = new THREE.Mesh(nozzleCoreGeo, nozzleInnerMat);
  rightCore.position.set(0.46, 0.04, 1.81);
  group.add(rightCore);

  // 8. Multi-Layer Dynamic Thruster Exhaust Plumes + Mach Shock Rings
  const coreFlameGeo = trackGeo(new THREE.ConeGeometry(0.085, 1.05, 10, 1, true));
  coreFlameGeo.rotateX(Math.PI / 2);
  coreFlameGeo.translate(0, 0, 0.52);

  const outerFlameGeo = trackGeo(new THREE.ConeGeometry(0.19, 1.95, 14, 1, true));
  outerFlameGeo.rotateX(Math.PI / 2);
  outerFlameGeo.translate(0, 0, 0.96);

  const leftCoreFlame = new THREE.Mesh(coreFlameGeo, flameMaterial);
  leftCoreFlame.position.set(-0.46, 0.04, 1.82);
  group.add(leftCoreFlame);

  const rightCoreFlame = new THREE.Mesh(coreFlameGeo, flameMaterial);
  rightCoreFlame.position.set(0.46, 0.04, 1.82);
  group.add(rightCoreFlame);

  const leftFlame = new THREE.Mesh(outerFlameGeo, outerPlumeMaterial);
  leftFlame.position.set(-0.46, 0.04, 1.82);
  leftFlame.renderOrder = 3;
  group.add(leftFlame);

  const rightFlame = new THREE.Mesh(outerFlameGeo, outerPlumeMaterial);
  rightFlame.position.set(0.46, 0.04, 1.82);
  rightFlame.renderOrder = 3;
  group.add(rightFlame);

  const machRingGeo = trackGeo(new THREE.RingGeometry(0.11, 0.17, 14));
  const leftRing = new THREE.Mesh(machRingGeo, machRingMaterial);
  leftRing.position.set(-0.46, 0.04, 2.25);
  group.add(leftRing);

  const rightRing = new THREE.Mesh(machRingGeo, machRingMaterial);
  rightRing.position.set(0.46, 0.04, 2.25);
  group.add(rightRing);

  // 8b. Aerodynamic Bow Plasma Shockwave Shield (for planetary atmosphere re-entry)
  const shieldProfile = [
    new THREE.Vector2(0.06, 2.75),
    new THREE.Vector2(0.42, 2.45),
    new THREE.Vector2(0.88, 1.75),
    new THREE.Vector2(1.55, 0.72),
    new THREE.Vector2(2.35, -0.35),
    new THREE.Vector2(2.85, -1.25),
  ];
  const shieldGeo = trackGeo(new THREE.LatheGeometry(shieldProfile, 24));
  shieldGeo.rotateX(-Math.PI / 2);
  shieldGeo.scale(1.08, 0.48, 1.0);
  const reentryShield = new THREE.Mesh(shieldGeo, reentryMaterial);
  reentryShield.visible = false;
  reentryShield.renderOrder = 4;
  group.add(reentryShield);

  // 9. Wingtip Accent Fins
  const finGeo = trackGeo(new THREE.BoxGeometry(0.06, 0.24, 0.56));
  const leftFin = new THREE.Mesh(finGeo, accentWingMat);
  leftFin.position.set(-2.38, 0.04, 1.28);
  leftFin.rotation.z = 0.28;
  group.add(leftFin);

  const rightFin = new THREE.Mesh(finGeo, accentWingMat);
  rightFin.position.set(2.38, 0.04, 1.28);
  rightFin.rotation.z = -0.28;
  group.add(rightFin);

  // 10. Retractable Tricycle Landing Gear calibrated so foot bottoms reach -GEAR_REST_HEIGHT
  const landingGear = new THREE.Group();
  landingGear.visible = false;
  group.add(landingGear);

  const gearPivotY = -0.05;
  const gearReach = GEAR_REST_HEIGHT + gearPivotY; // 1.65 below pivot -> -1.70 total
  const footHeight = 0.08;
  const strutLen = 0.92;
  const pistonLen = 0.92;

  const gearStrutGeo = trackGeo(new THREE.CylinderGeometry(0.07, 0.065, strutLen, 8));
  const gearPistonGeo = trackGeo(new THREE.CylinderGeometry(0.05, 0.055, pistonLen, 8));
  const gearFootGeo = trackGeo(new THREE.CylinderGeometry(0.22, 0.26, footHeight, 12));

  const gearLegOffsets: Array<[number, number]> = [
    [0, -1.42],   // Nose strut
    [-0.92, 0.72], // Left main strut
    [0.92, 0.72],  // Right main strut
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
    const xzScale = 0.35 + 0.65 * s;
    for (let i = 0; i < gearLegs.length; i++) {
      gearLegs[i].scale.set(xzScale, s, xzScale);
    }
  };

  // 11. Dynamic Thruster Glow Light (skip extra per-pixel point light on mobile/software GL)
  let thrusterLight: THREE.PointLight | null = null;
  if (!isMobileOrSoftware) {
    thrusterLight = new THREE.PointLight(0x38bdf8, 1.5, 18);
    thrusterLight.position.set(0, 0.1, 2.3);
    group.add(thrusterLight);
  }

  return {
    group,
    leftFlame,
    rightFlame,
    thrusterLight,
    flameMaterial,
    setGearExtension,
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

      const coreLength = leftFlame.scale.z * 0.85;
      const coreWidth = 0.82 + thrustPower * 0.35;
      leftCoreFlame.scale.set(coreWidth, coreWidth, coreLength);
      rightCoreFlame.scale.set(coreWidth, coreWidth, coreLength);

      const showRing = showFlames && thrustPower > 0.25;
      leftRing.visible = showRing;
      rightRing.visible = showRing;
      if (showRing) {
        const ringPulse = 0.88 + 0.18 * Math.sin(elapsed * 46);
        const ringDist = 2.18 + thrustPower * 0.55;
        leftRing.position.z = ringDist;
        rightRing.position.z = ringDist;
        leftRing.scale.setScalar(ringPulse * (0.85 + thrustPower * 0.35));
        rightRing.scale.setScalar(ringPulse * (0.85 + thrustPower * 0.35));
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
