import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface CharacterModelHandle {
  group: THREE.Group;
  setFirstPerson: (active: boolean) => void;
  animate: (
    dt: number,
    elapsed: number,
    params: {
      moveSpeed: number;
      grounded: boolean;
      jetpackActive: boolean;
      thrustStrength: number;
      crouching: boolean;
      lookPitchRad: number;
    },
  ) => void;
  dispose: () => void;
}

function mergeStaticParts(
  parts: THREE.BufferGeometry[],
): THREE.BufferGeometry {
  const normalized = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(normalized, false);
  for (let i = 0; i < parts.length; i++) {
    if (normalized[i] !== parts[i]) normalized[i].dispose();
    parts[i].dispose();
  }
  return merged;
}

function makeTransformedBox(
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

export function createCharacterModel(
  isMobileOrSoftware: boolean,
): CharacterModelHandle {
  const group = new THREE.Group();
  group.name = 'AstronautCharacter';

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

  // Materials: White EVA suit, Black & Gray belt/boots/joints, Skin & Hair inside SE2 transparent visor
  const suitWhiteMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      roughness: 0.42,
      metalness: 0.08,
      envMapIntensity: 0.9,
    }),
  );

  const suitLightGrayMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.45,
      metalness: 0.35,
      envMapIntensity: 1.0,
    }),
  );

  const suitGrayMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x525d6d,
      roughness: 0.48,
      metalness: 0.42,
      envMapIntensity: 0.95,
    }),
  );

  const suitBlackMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x171b22,
      roughness: 0.62,
      metalness: 0.25,
      envMapIntensity: 0.7,
    }),
  );

  const helmetLinerMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x12161c,
      roughness: 0.85,
      metalness: 0.1,
      side: THREE.BackSide,
    }),
  );

  const accentCyanMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
    }),
  );

  const visorMat = trackMat(
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
      side: THREE.FrontSide,
    }),
  );

  const skinMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xd9a27e,
      roughness: 0.68,
      metalness: 0.02,
      envMapIntensity: 0.45,
    }),
  );

  const hairMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x241a15,
      roughness: 0.85,
      metalness: 0.02,
    }),
  );

  const eyeMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x161c24,
      roughness: 0.2,
      metalness: 0.1,
    }),
  );

  const eyeWhiteMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0xf8fafc,
    }),
  );

  const jetFlameMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );

  const jetCoreMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0xe0f2fe,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );

  const castShadows = !isMobileOrSoftware;

  // Body hierarchy (feet bottom at y = 0, total standing height = 1.66, facing -Z)
  const bodyGroup = new THREE.Group();
  group.add(bodyGroup);

  const hipsGroup = new THREE.Group();
  hipsGroup.position.set(0, 0.82, 0);
  bodyGroup.add(hipsGroup);

  // --- Pelvis + Utility Belt (merged per material) ---
  const pelvis = new THREE.Mesh(
    trackGeo(makeTransformedBox(0.32, 0.13, 0.21, 0, 0, 0)),
    suitWhiteMat,
  );
  pelvis.castShadow = castShadows;
  hipsGroup.add(pelvis);

  const beltBlackGeo = trackGeo(
    mergeStaticParts([
      makeTransformedBox(0.35, 0.075, 0.235, 0, 0.045, 0),
      makeTransformedBox(0.042, 0.026, 0.036, 0, 0.045, -0.12),
      makeTransformedBox(0.055, 0.095, 0.095, -0.19, 0.035, 0.01),
      makeTransformedBox(0.055, 0.095, 0.095, 0.19, 0.035, 0.01),
    ]),
  );
  const beltBlackMesh = new THREE.Mesh(beltBlackGeo, suitBlackMat);
  beltBlackMesh.castShadow = castShadows;
  hipsGroup.add(beltBlackMesh);

  const beltGrayGeo = trackGeo(
    mergeStaticParts([
      makeTransformedBox(0.358, 0.024, 0.242, 0, 0.045, 0),
      makeTransformedBox(0.06, 0.03, 0.1, -0.19, 0.072, 0.01),
      makeTransformedBox(0.06, 0.03, 0.1, 0.19, 0.072, 0.01),
    ]),
  );
  hipsGroup.add(new THREE.Mesh(beltGrayGeo, suitGrayMat));

  const buckle = new THREE.Mesh(
    trackGeo(makeTransformedBox(0.085, 0.065, 0.032, 0, 0.045, -0.118)),
    suitLightGrayMat,
  );
  hipsGroup.add(buckle);

  // --- Torso, Chest Armor & Jetpack Backpack (merged static parts per material) ---
  const torsoGroup = new THREE.Group();
  torsoGroup.position.set(0, 0.08, 0);
  hipsGroup.add(torsoGroup);

  const torsoWhiteGeo = trackGeo(
    mergeStaticParts([
      makeTransformedBox(0.37, 0.44, 0.23, 0, 0.22, 0),
      makeTransformedBox(0.32, 0.24, 0.065, 0, 0.28, -0.11),
      makeTransformedBox(0.31, 0.38, 0.13, 0, 0.24, 0.165),
    ]),
  );
  const torsoWhite = new THREE.Mesh(torsoWhiteGeo, suitWhiteMat);
  torsoWhite.castShadow = castShadows;
  torsoGroup.add(torsoWhite);

  const collarRingGeo = new THREE.CylinderGeometry(0.132, 0.145, 0.055, 14);
  collarRingGeo.translate(0, 0.455, 0);
  const torsoGrayGeo = trackGeo(
    mergeStaticParts([
      makeTransformedBox(0.14, 0.11, 0.028, 0, 0.30, -0.142),
      collarRingGeo,
      makeTransformedBox(0.21, 0.24, 0.145, 0, 0.24, 0.165),
    ]),
  );
  torsoGroup.add(new THREE.Mesh(torsoGrayGeo, suitGrayMat));

  const nozzleL = new THREE.CylinderGeometry(0.032, 0.048, 0.08, 10);
  nozzleL.rotateX(0.28);
  nozzleL.rotateZ(0.12);
  nozzleL.translate(-0.11, 0.07, 0.195);
  const nozzleR = new THREE.CylinderGeometry(0.032, 0.048, 0.08, 10);
  nozzleR.rotateX(0.28);
  nozzleR.rotateZ(-0.12);
  nozzleR.translate(0.11, 0.07, 0.195);

  const torsoBlackGeo = trackGeo(
    mergeStaticParts([
      makeTransformedBox(0.055, 0.43, 0.248, -0.115, 0.22, 0),
      makeTransformedBox(0.055, 0.43, 0.248, 0.115, 0.22, 0),
      makeTransformedBox(0.04, 0.32, 0.152, 0, 0.24, 0.165),
      nozzleL,
      nozzleR,
    ]),
  );
  torsoGroup.add(new THREE.Mesh(torsoBlackGeo, suitBlackMat));

  const torsoCyanGeo = trackGeo(
    mergeStaticParts([
      makeTransformedBox(0.055, 0.018, 0.016, 0, 0.325, -0.152),
      makeTransformedBox(0.08, 0.025, 0.02, 0, 0.365, 0.24),
    ]),
  );
  torsoGroup.add(new THREE.Mesh(torsoCyanGeo, accentCyanMat));

  // Jetpack flames under angled backpack nozzles
  const flameConeGeo = trackGeo(new THREE.ConeGeometry(0.046, 0.34, 10, 1, true));
  flameConeGeo.rotateX(Math.PI);
  flameConeGeo.translate(0, -0.17, 0);

  const jetFlames: THREE.Mesh[] = [];
  for (let side = -1; side <= 1; side += 2) {
    const pod = new THREE.Group();
    pod.position.set(side * 0.11, 0.07, 0.195);
    pod.rotation.x = 0.28;
    pod.rotation.z = side * -0.12;
    torsoGroup.add(pod);

    const flame = new THREE.Mesh(flameConeGeo, jetFlameMat);
    flame.position.y = -0.04;
    flame.visible = false;
    pod.add(flame);

    const core = new THREE.Mesh(flameConeGeo, jetCoreMat);
    core.scale.set(0.5, 0.65, 0.5);
    flame.add(core);

    jetFlames.push(flame);
  }

  // --- Head & Space Engineers 2 Helmet (opening facing -Z FRONT!) ---
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.48, 0);
  torsoGroup.add(headGroup);

  // Male face inside the helmet (merged skin & hair/eyes)
  const craniumGeo = new THREE.SphereGeometry(0.092, 14, 12);
  craniumGeo.scale(0.92, 1.08, 0.98);
  craniumGeo.translate(0, 0.14, -0.01);
  const faceSkinGeo = trackGeo(
    mergeStaticParts([
      craniumGeo,
      makeTransformedBox(0.115, 0.082, 0.105, 0, 0.085, -0.024),
      makeTransformedBox(0.022, 0.036, 0.028, 0, 0.132, -0.102),
    ]),
  );
  headGroup.add(new THREE.Mesh(faceSkinGeo, skinMat));

  const hairCapGeo = new THREE.SphereGeometry(
    0.095,
    12,
    10,
    0,
    Math.PI * 2,
    0,
    Math.PI * 0.54,
  );
  hairCapGeo.scale(0.94, 1.05, 1.0);
  hairCapGeo.rotateX(0.22);
  hairCapGeo.translate(0, 0.148, -0.004);
  const headHairGeo = trackGeo(
    mergeStaticParts([
      hairCapGeo,
      makeTransformedBox(0.036, 0.01, 0.014, -0.034, 0.168, -0.092, 0, 0, 0.08),
      makeTransformedBox(0.036, 0.01, 0.014, 0.034, 0.168, -0.092, 0, 0, -0.08),
    ]),
  );
  headGroup.add(new THREE.Mesh(headHairGeo, hairMat));

  const scleraGeo = trackGeo(
    mergeStaticParts([
      makeTransformedBox(0.024, 0.014, 0.01, -0.034, 0.152, -0.092),
      makeTransformedBox(0.024, 0.014, 0.01, 0.034, 0.152, -0.092),
    ]),
  );
  headGroup.add(new THREE.Mesh(scleraGeo, eyeWhiteMat));

  const pupilsGeo = trackGeo(
    mergeStaticParts([
      makeTransformedBox(0.013, 0.013, 0.012, -0.034, 0.152, -0.094),
      makeTransformedBox(0.013, 0.013, 0.012, 0.034, 0.152, -0.094),
    ]),
  );
  headGroup.add(new THREE.Mesh(pupilsGeo, eyeMat));

  // Outer white helmet shell: phi = -0.15π .. 1.15π wraps around +Z (BACK),
  // leaving the front opening cleanly at 1.15π .. 1.85π centered on 1.5π (-Z FRONT)
  const helmetBackGeo = new THREE.SphereGeometry(
    0.148,
    16,
    12,
    -Math.PI * 0.15,
    Math.PI * 1.3,
    0.12,
    Math.PI * 0.78,
  );
  helmetBackGeo.scale(1.0, 1.08, 1.06);
  helmetBackGeo.translate(0, 0.145, 0.012);

  const helmetCrownGeo = new THREE.SphereGeometry(
    0.152,
    14,
    10,
    0,
    Math.PI * 2,
    0,
    Math.PI * 0.42,
  );
  helmetCrownGeo.scale(0.98, 1.04, 1.08);
  helmetCrownGeo.translate(0, 0.148, 0.0);

  const helmetWhiteGeo = trackGeo(
    mergeStaticParts([
      helmetBackGeo,
      helmetCrownGeo,
      makeTransformedBox(0.19, 0.075, 0.13, 0, 0.048, -0.068, 0.22, 0, 0),
      makeTransformedBox(0.055, 0.13, 0.12, -0.115, 0.115, -0.048),
      makeTransformedBox(0.055, 0.13, 0.12, 0.115, 0.115, -0.048),
    ]),
  );
  const helmetWhite = new THREE.Mesh(helmetWhiteGeo, suitWhiteMat);
  helmetWhite.castShadow = castShadows;
  headGroup.add(helmetWhite);

  // Dark inner helmet padding visible behind head through transparent visor
  const helmetLinerGeo = trackGeo(
    new THREE.SphereGeometry(
      0.138,
      14,
      10,
      -Math.PI * 0.15,
      Math.PI * 1.3,
      0.12,
      Math.PI * 0.78,
    ),
  );
  helmetLinerGeo.scale(1.0, 1.06, 1.04);
  helmetLinerGeo.translate(0, 0.145, 0.01);
  headGroup.add(new THREE.Mesh(helmetLinerGeo, helmetLinerMat));

  const earPodL = new THREE.CylinderGeometry(0.052, 0.052, 0.04, 10);
  earPodL.rotateZ(Math.PI / 2);
  earPodL.translate(-0.142, 0.14, 0.005);
  const earPodR = new THREE.CylinderGeometry(0.052, 0.052, 0.04, 10);
  earPodR.rotateZ(Math.PI / 2);
  earPodR.translate(0.142, 0.14, 0.005);
  const helmetGrayGeo = trackGeo(
    mergeStaticParts([
      makeTransformedBox(0.21, 0.025, 0.06, 0, 0.215, -0.105),
      earPodL,
      earPodR,
    ]),
  );
  headGroup.add(new THREE.Mesh(helmetGrayGeo, suitGrayMat));

  // Transparent curved front visor centered directly at phi = 1.5π (-Z FRONT)
  const visorGeo = trackGeo(
    new THREE.SphereGeometry(
      0.142,
      16,
      12,
      Math.PI * 1.14,
      Math.PI * 0.72,
      Math.PI * 0.24,
      Math.PI * 0.44,
    ),
  );
  visorGeo.scale(0.95, 1.05, 1.08);
  const visor = new THREE.Mesh(visorGeo, visorMat);
  visor.position.set(0, 0.142, -0.012);
  visor.renderOrder = 2;
  headGroup.add(visor);

  // --- Articulated Arms (positive X rotation bends elbows FORWARD toward -Z!) ---
  const buildArm = (side: -1 | 1) => {
    const armPivot = new THREE.Group();
    armPivot.position.set(side * 0.24, 0.39, 0);
    armPivot.rotation.x = 0.06;
    torsoGroup.add(armPivot);

    const uArm = new THREE.CylinderGeometry(0.056, 0.048, 0.26, 8);
    uArm.translate(side * 0.015, -0.14, 0);
    const armWhiteGeo = trackGeo(
      mergeStaticParts([
        makeTransformedBox(0.11, 0.09, 0.13, side * 0.01, -0.01, 0, 0, 0, side * -0.18),
        uArm,
      ]),
    );
    const upperArmMesh = new THREE.Mesh(armWhiteGeo, suitWhiteMat);
    upperArmMesh.castShadow = castShadows;
    armPivot.add(upperArmMesh);

    const elbow = new THREE.Mesh(
      trackGeo(new THREE.SphereGeometry(0.054, 8, 8)),
      suitGrayMat,
    );
    elbow.position.set(side * 0.015, -0.27, 0);
    armPivot.add(elbow);

    const forearmPivot = new THREE.Group();
    forearmPivot.position.set(side * 0.015, -0.27, 0);
    forearmPivot.rotation.x = 0.24; // Forward anatomical elbow bend (-Z)
    armPivot.add(forearmPivot);

    const forearm = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.048, 0.042, 0.24, 8)),
      suitWhiteMat,
    );
    forearm.position.set(0, -0.12, 0);
    forearm.castShadow = castShadows;
    forearmPivot.add(forearm);

    const cuff = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.049, 0.046, 0.05, 8)),
      suitGrayMat,
    );
    cuff.position.set(0, -0.215, 0);
    forearmPivot.add(cuff);

    const glove = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.072, 0.095, 0.078)),
      suitBlackMat,
    );
    glove.position.set(0, -0.275, -0.005);
    glove.castShadow = castShadows;
    forearmPivot.add(glove);

    return { armPivot, forearmPivot };
  };

  const leftArm = buildArm(-1);
  const rightArm = buildArm(1);

  // --- Articulated Legs & Black/Gray Armored EVA Boots (merged boot sub-meshes) ---
  const thighGeo = trackGeo(new THREE.CylinderGeometry(0.078, 0.066, 0.36, 8));
  const shinGeo = trackGeo(new THREE.CylinderGeometry(0.064, 0.058, 0.27, 8));

  const bootBlackGeo = trackGeo(
    mergeStaticParts([
      makeTransformedBox(0.132, 0.12, 0.145, 0, -0.26, 0.002),
      makeTransformedBox(0.136, 0.085, 0.235, 0, -0.345, -0.036),
    ]),
  );

  const bootGrayGeo = trackGeo(
    mergeStaticParts([
      makeTransformedBox(0.11, 0.1, 0.12, 0, 0, -0.015),
      makeTransformedBox(0.138, 0.04, 0.152, 0, -0.21, 0.002),
      makeTransformedBox(0.132, 0.055, 0.065, 0, -0.34, -0.132),
      makeTransformedBox(0.144, 0.035, 0.246, 0, -0.382, -0.036),
    ]),
  );

  const buildLeg = (side: -1 | 1) => {
    const hipPivot = new THREE.Group();
    hipPivot.position.set(side * 0.1, -0.05, 0);
    hipsGroup.add(hipPivot);

    const thigh = new THREE.Mesh(thighGeo, suitWhiteMat);
    thigh.position.set(0, -0.18, 0);
    thigh.castShadow = castShadows;
    hipPivot.add(thigh);

    const thighStrip = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.04, 0.22, 0.13)),
      suitGrayMat,
    );
    thighStrip.position.set(side * 0.048, -0.17, 0);
    hipPivot.add(thighStrip);

    const kneePivot = new THREE.Group();
    kneePivot.position.set(0, -0.37, 0);
    hipPivot.add(kneePivot);

    const shin = new THREE.Mesh(shinGeo, suitWhiteMat);
    shin.position.set(0, -0.145, 0);
    shin.castShadow = castShadows;
    kneePivot.add(shin);

    const bootBlack = new THREE.Mesh(bootBlackGeo, suitBlackMat);
    bootBlack.castShadow = castShadows;
    kneePivot.add(bootBlack);

    const bootGray = new THREE.Mesh(bootGrayGeo, suitGrayMat);
    kneePivot.add(bootGray);

    return { hipPivot, kneePivot };
  };

  const leftLeg = buildLeg(-1);
  const rightLeg = buildLeg(1);

  let walkPhase = 0;
  let leanPitch = 0;
  let crouchBlend = 0;
  let firstPersonActive = false;

  const setFirstPerson = (active: boolean) => {
    firstPersonActive = active;
    group.visible = !active;
  };

  const animate: CharacterModelHandle['animate'] = (dt, elapsed, params) => {
    if (firstPersonActive) return;

    const {
      moveSpeed,
      grounded,
      jetpackActive,
      thrustStrength,
      crouching,
      lookPitchRad,
    } = params;

    crouchBlend = THREE.MathUtils.damp(crouchBlend, crouching ? 1 : 0, 12, dt);

    if (grounded && !jetpackActive && moveSpeed > 0.25) {
      walkPhase += dt * Math.min(14, 3.2 + moveSpeed * 1.15);
    } else {
      walkPhase += dt * 1.4;
    }

    const moveFactor =
      grounded && !jetpackActive
        ? THREE.MathUtils.clamp(moveSpeed / 5.5, 0, 1.25)
        : 0;

    const stride = Math.sin(walkPhase) * 0.62 * moveFactor;
    const kneeBendL = Math.max(0, Math.cos(walkPhase)) * 0.55 * moveFactor;
    const kneeBendR = Math.max(0, -Math.cos(walkPhase)) * 0.55 * moveFactor;

    if (jetpackActive && !grounded) {
      // Space Engineers zero-g / jetpack flight hover pose
      const hoverBob = Math.sin(elapsed * 3.2) * 0.04;
      leanPitch = THREE.MathUtils.damp(
        leanPitch,
        THREE.MathUtils.clamp(moveSpeed * 0.025, 0.06, 0.34),
        7,
        dt,
      );
      bodyGroup.position.y = hoverBob;
      bodyGroup.rotation.x = -leanPitch;

      leftLeg.hipPivot.rotation.x = 0.22 + hoverBob * 0.8;
      rightLeg.hipPivot.rotation.x = 0.1 + hoverBob * 0.8;
      leftLeg.kneePivot.rotation.x = -0.38;
      rightLeg.kneePivot.rotation.x = -0.25;

      leftArm.armPivot.rotation.x = 0.22;
      rightArm.armPivot.rotation.x = 0.22;
      leftArm.armPivot.rotation.z = -0.18;
      rightArm.armPivot.rotation.z = 0.18;
      // Positive X bends forearms forward (-Z)
      leftArm.forearmPivot.rotation.x = 0.46;
      rightArm.forearmPivot.rotation.x = 0.46;
    } else if (!grounded) {
      // Mid-jump pose
      leanPitch = THREE.MathUtils.damp(leanPitch, 0.08, 8, dt);
      bodyGroup.position.y = 0;
      bodyGroup.rotation.x = -leanPitch;
      leftLeg.hipPivot.rotation.x = 0.36;
      rightLeg.hipPivot.rotation.x = -0.18;
      leftLeg.kneePivot.rotation.x = -0.52;
      rightLeg.kneePivot.rotation.x = -0.22;
      leftArm.armPivot.rotation.x = -0.25;
      rightArm.armPivot.rotation.x = 0.25;
      leftArm.armPivot.rotation.z = -0.22;
      rightArm.armPivot.rotation.z = 0.22;
      leftArm.forearmPivot.rotation.x = 0.34;
      rightArm.forearmPivot.rotation.x = 0.34;
    } else {
      // Grounded idle / walk / sprint / crouch
      leanPitch = THREE.MathUtils.damp(leanPitch, moveFactor * 0.08, 10, dt);
      bodyGroup.position.y =
        Math.abs(Math.sin(walkPhase)) * 0.03 * moveFactor - crouchBlend * 0.22;
      bodyGroup.rotation.x = -leanPitch - crouchBlend * 0.16;

      leftLeg.hipPivot.rotation.x = stride + crouchBlend * 0.45;
      rightLeg.hipPivot.rotation.x = -stride + crouchBlend * 0.45;
      leftLeg.kneePivot.rotation.x = -kneeBendL - crouchBlend * 0.78;
      rightLeg.kneePivot.rotation.x = -kneeBendR - crouchBlend * 0.78;

      const idleArm = Math.sin(elapsed * 2.0) * 0.025;
      leftArm.armPivot.rotation.x = 0.06 - stride * 0.8 + idleArm;
      rightArm.armPivot.rotation.x = 0.06 + stride * 0.8 - idleArm;
      leftArm.armPivot.rotation.z = -0.07;
      rightArm.armPivot.rotation.z = 0.07;
      // Positive X keeps elbows naturally bent forward (-Z) at rest & stride
      leftArm.forearmPivot.rotation.x = 0.24 + Math.max(0, -stride) * 0.3;
      rightArm.forearmPivot.rotation.x = 0.24 + Math.max(0, stride) * 0.3;
    }

    headGroup.rotation.x = THREE.MathUtils.clamp(lookPitchRad * 0.45, -0.45, 0.45);

    // Jetpack nozzle flames
    const showFlames = jetpackActive && (thrustStrength > 0.04 || !grounded);
    const flamePulse = 0.88 + 0.14 * Math.sin(elapsed * 44);
    const scaleY = (0.28 + thrustStrength * 1.15) * flamePulse;
    const scaleXZ = 0.65 + thrustStrength * 0.45;
    for (let i = 0; i < jetFlames.length; i++) {
      jetFlames[i].visible = showFlames;
      if (showFlames) {
        jetFlames[i].scale.set(scaleXZ, scaleY, scaleXZ);
      }
    }
    jetFlameMat.opacity = THREE.MathUtils.clamp(0.45 + thrustStrength * 0.5, 0.35, 0.95);
  };

  const dispose = () => {
    for (let i = 0; i < geometries.length; i++) geometries[i].dispose();
    for (let i = 0; i < materials.length; i++) materials[i].dispose();
  };

  return {
    group,
    setFirstPerson,
    animate,
    dispose,
  };
}
