import * as THREE from 'three';
import { OffScreenIndicatorState } from '../types/simulation';

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
export function computeOffScreenIndicator(
  camera: THREE.Camera,
  targetWorld: THREE.Vector3,
  viewportW: number,
  viewportH: number,
  indicatorMargin: number,
): OffScreenIndicatorState {
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
  const t = THREE.MathUtils.clamp(dist / 220, 0, 1);
  _indColor.lerpColors(_nearColor, _farColor, t);
  const colorHex = `#${_indColor.getHexString()}`;

  if (onScreen) {
    return {
      active: true,
      onScreen: true,
      x: sx,
      y: sy,
      angleDeg: 0,
      distance: dist,
      color: colorHex,
    };
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

  const edgeX = cx + dx * scale;
  const edgeY = cy + dy * scale;
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;

  return {
    active: true,
    onScreen: false,
    x: edgeX,
    y: edgeY,
    angleDeg,
    distance: dist,
    color: colorHex,
  };
}
