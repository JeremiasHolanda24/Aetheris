import * as THREE from 'three';
import { CameraMode, OffScreenIndicatorState } from '../types/simulation';

// Pre-allocated math helpers outside render loop (Zero GC)
const _projVec = new THREE.Vector3();
const _viewPos = new THREE.Vector3();
const _nearColor = new THREE.Color(0xfacc15);
const _farColor = new THREE.Color(0xef4444);
const _indColor = new THREE.Color();

/**
 * Projects a 3D world target into viewport coordinates, clamping off-screen targets
 * to the configured margin with directional arrow angle and distance color gradient.
 */
export function computeOffScreenIndicatorInto(
  camera: THREE.Camera,
  targetWorld: THREE.Vector3,
  viewportW: number,
  viewportH: number,
  indicatorMargin: number,
  out: OffScreenIndicatorState,
  fixedColorHex?: string,
): void {
  _viewPos.copy(targetWorld).applyMatrix4(camera.matrixWorldInverse);
  const isBehind = _viewPos.z > 0;

  _projVec.copy(targetWorld).project(camera);

  let sx = (_projVec.x * 0.5 + 0.5) * viewportW;
  let sy = (-_projVec.y * 0.5 + 0.5) * viewportH;

  if (isBehind) {
    sx = viewportW - sx;
    sy = viewportH - sy;
  }

  const onScreen =
    !isBehind &&
    sx >= 12 &&
    sx <= viewportW - 12 &&
    sy >= 12 &&
    sy <= viewportH - 12;

  const dist = camera.position.distanceTo(targetWorld);
  let colorHex: string;
  if (fixedColorHex) {
    colorHex = fixedColorHex;
  } else {
    const t = THREE.MathUtils.clamp(dist / 220, 0, 1);
    _indColor.lerpColors(_nearColor, _farColor, t);
    colorHex = `#${_indColor.getHexString()}`;
  }

  out.active = true;
  out.distance = dist;
  out.color = colorHex;

  if (onScreen) {
    out.onScreen = true;
    out.x = sx;
    out.y = sy;
    out.angleDeg = 0;
    return;
  }

  const cx = viewportW * 0.5;
  const cy = viewportH * 0.5;
  let dx = sx - cx;
  let dy = sy - cy;

  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
    dy = -1;
  }

  const margin = THREE.MathUtils.clamp(indicatorMargin, 0.03, 0.3);
  const halfW = viewportW * 0.5 * (1 - margin);
  const halfH = viewportH * 0.5 * (1 - margin);

  const scale = Math.min(
    halfW / (Math.abs(dx) + 0.001),
    halfH / (Math.abs(dy) + 0.001),
  );

  out.onScreen = false;
  out.x = cx + dx * scale;
  out.y = cy + dy * scale;
  out.angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
}

export function computeOffScreenIndicator(
  camera: THREE.Camera,
  targetWorld: THREE.Vector3,
  viewportW: number,
  viewportH: number,
  indicatorMargin: number,
): OffScreenIndicatorState {
  const out: OffScreenIndicatorState = {
    active: true,
    onScreen: false,
    x: 0,
    y: 0,
    angleDeg: 0,
    distance: 0,
    color: '#facc15',
  };
  computeOffScreenIndicatorInto(
    camera,
    targetWorld,
    viewportW,
    viewportH,
    indicatorMargin,
    out,
  );
  return out;
}

const HORIZON_SAMPLES = 25;
const _hRadUp = new THREE.Vector3();
const _hCamFwd = new THREE.Vector3();
const _hCamUp = new THREE.Vector3();
const _hHorizFwd = new THREE.Vector3();
const _hHorizRight = new THREE.Vector3();
const _hPt = new THREE.Vector3();
const _hViewPt = new THREE.Vector3();
const _hProjPt = new THREE.Vector3();
const _hAtmoColor = new THREE.Color(0x38bdf8);
const _hOrbitColor = new THREE.Color(0x818cf8);
const _hBlendedColor = new THREE.Color();
const _hScreenX = new Float32Array(HORIZON_SAMPLES);
const _hScreenY = new Float32Array(HORIZON_SAMPLES);

/**
 * Projects the true 3D planetary tangent horizon arc into screen coordinates
 * so the HUD horizon line reflects curvature vs. altitude, pitch, and roll.
 */
export function computeHorizonHud(
  camera: THREE.PerspectiveCamera,
  planetRadius: number,
  groundRadius: number,
  atmosphereHeight: number,
  _cameraMode: CameraMode,
  viewportW: number,
  viewportH: number,
): {
  visible: boolean;
  pathD: string;
  opacity: number;
  color: string;
  viewportW: number;
  viewportH: number;
} {
  if (viewportW < 10 || viewportH < 10) {
    return {
      visible: false,
      pathD: '',
      opacity: 0,
      color: '#38bdf8',
      viewportW,
      viewportH,
    };
  }

  const camDist = camera.position.length();
  if (camDist < 1) {
    return {
      visible: false,
      pathD: '',
      opacity: 0,
      color: '#38bdf8',
      viewportW,
      viewportH,
    };
  }

  _hRadUp.copy(camera.position).divideScalar(camDist);

  const clearance = Math.max(0.8, camDist - groundRadius);
  const nearBlend = THREE.MathUtils.smoothstep(camDist - planetRadius, 0, 12);
  const rawR = THREE.MathUtils.lerp(camDist - clearance, planetRadius, nearBlend);
  const R = Math.max(4, Math.min(camDist - 0.5, rawR));

  const cosAlpha = R / camDist;
  const sinAlpha = Math.sqrt(Math.max(0, 1 - cosAlpha * cosAlpha));
  const ringCenterDist = R * cosAlpha;
  const ringRadius = R * sinAlpha;

  camera.getWorldDirection(_hCamFwd);
  const fwdDotUp = _hCamFwd.dot(_hRadUp);
  const absFwdDotUp = Math.abs(fwdDotUp);
  const pitchDirFade = 1 - THREE.MathUtils.smoothstep(absFwdDotUp, 0.9, 0.985);
  if (pitchDirFade <= 0.01) {
    return {
      visible: false,
      pathD: '',
      opacity: 0,
      color: '#38bdf8',
      viewportW,
      viewportH,
    };
  }

  _hHorizFwd.copy(_hCamFwd).addScaledVector(_hRadUp, -fwdDotUp);
  if (_hHorizFwd.lengthSq() < 1e-5) {
    _hCamUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    _hHorizFwd
      .copy(_hCamUp)
      .addScaledVector(_hRadUp, -_hCamUp.dot(_hRadUp));
  }
  if (_hHorizFwd.lengthSq() < 1e-6) {
    return {
      visible: false,
      pathD: '',
      opacity: 0,
      color: '#38bdf8',
      viewportW,
      viewportH,
    };
  }
  _hHorizFwd.normalize();
  _hHorizRight.crossVectors(_hHorizFwd, _hRadUp).normalize();

  const halfVFov = THREE.MathUtils.degToRad(camera.fov * 0.5);
  const halfHFov = Math.atan(Math.tan(halfVFov) * Math.max(camera.aspect, 0.5));
  const orbitT = THREE.MathUtils.smoothstep(camDist - planetRadius, 20, 180);
  const thetaMax = THREE.MathUtils.lerp(
    Math.min(Math.PI * 0.45, halfHFov * 1.15),
    Math.PI * 0.72,
    orbitT,
  );

  let validCount = 0;
  let anyInVertBounds = false;
  let midY = viewportH * 0.5;
  let bestCenterDist = Infinity;

  for (let i = 0; i < HORIZON_SAMPLES; i++) {
    const theta = -thetaMax + (i / (HORIZON_SAMPLES - 1)) * 2 * thetaMax;
    _hPt
      .copy(_hRadUp)
      .multiplyScalar(ringCenterDist)
      .addScaledVector(_hHorizFwd, ringRadius * Math.cos(theta))
      .addScaledVector(_hHorizRight, ringRadius * Math.sin(theta));

    _hViewPt.copy(_hPt).applyMatrix4(camera.matrixWorldInverse);
    if (_hViewPt.z >= -1.0) continue;

    _hProjPt.copy(_hViewPt).applyMatrix4(camera.projectionMatrix);
    const sx = (_hProjPt.x * 0.5 + 0.5) * viewportW;
    const sy = (-_hProjPt.y * 0.5 + 0.5) * viewportH;
    if (
      !Number.isFinite(sx) ||
      !Number.isFinite(sy) ||
      Math.abs(sx) > viewportW * 2.5 ||
      Math.abs(sy) > viewportH * 2.5
    ) {
      continue;
    }

    _hScreenX[validCount] = sx;
    _hScreenY[validCount] = sy;
    validCount++;

    if (sy >= -24 && sy <= viewportH + 24) {
      anyInVertBounds = true;
    }
    const cxDist = Math.abs(sx - viewportW * 0.5);
    if (cxDist < bestCenterDist) {
      bestCenterDist = cxDist;
      midY = sy;
    }
  }

  if (validCount < 2 || !anyInVertBounds) {
    return {
      visible: false,
      pathD: '',
      opacity: 0,
      color: '#38bdf8',
      viewportW,
      viewportH,
    };
  }

  const topFade = THREE.MathUtils.smoothstep(midY, 32, 92);
  const botFade = THREE.MathUtils.smoothstep(viewportH - midY, 24, 72);
  const opacity = 0.55 * pitchDirFade * topFade * botFade;
  if (opacity <= 0.01) {
    return {
      visible: false,
      pathD: '',
      opacity: 0,
      color: '#38bdf8',
      viewportW,
      viewportH,
    };
  }

  let pathD = `M ${_hScreenX[0].toFixed(1)} ${_hScreenY[0].toFixed(1)}`;
  for (let i = 1; i < validCount - 1; i++) {
    const mx = ((_hScreenX[i] + _hScreenX[i + 1]) * 0.5).toFixed(1);
    const my = ((_hScreenY[i] + _hScreenY[i + 1]) * 0.5).toFixed(1);
    pathD += ` Q ${_hScreenX[i].toFixed(1)} ${_hScreenY[i].toFixed(1)} ${mx} ${my}`;
  }
  pathD += ` L ${_hScreenX[validCount - 1].toFixed(1)} ${_hScreenY[validCount - 1].toFixed(1)}`;

  const spaceT = THREE.MathUtils.clamp(
    (camDist - planetRadius) / Math.max(atmosphereHeight, 1),
    0,
    1,
  );
  _hBlendedColor.lerpColors(_hAtmoColor, _hOrbitColor, spaceT * 0.65);

  return {
    visible: true,
    pathD,
    opacity,
    color: `#${_hBlendedColor.getHexString()}`,
    viewportW,
    viewportH,
  };
}
