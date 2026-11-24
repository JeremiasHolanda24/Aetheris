import * as THREE from 'three';
import { CameraMode } from '../types/simulation';

export interface VirtualInputs {
  thrust: number; // -0.5..1
  turn: number; // -1..1
  pitch: number; // -1..1 (climb/dive)
  boost: boolean;
  firing: boolean;
}

export interface FlightInputSample {
  turn: number;
  pitch: number;
  thrust: number;
  isThrusting: boolean;
  isBoosting: boolean;
  wantsFire: boolean;
}

/**
 * Manages keyboard, multi-touch pointer firing, virtual inputs,
 * input-focus guards, and focus-loss key release.
 */
export class InputController {
  private readonly domElement: HTMLElement;
  private readonly getCameraMode: () => CameraMode;
  private readonly onUnlockAudio: () => void;
  private readonly onVisibilityChange: (hidden: boolean) => void;
  private readonly onLandToggle?: () => void;

  private keysDown = new Set<string>();
  private activeFirePointerIds = new Set<number>();
  private virtualInputs: VirtualInputs = {
    thrust: 0,
    turn: 0,
    pitch: 0,
    boost: false,
    firing: false,
  };

  private readonly sample: FlightInputSample = {
    turn: 0,
    pitch: 0,
    thrust: 0,
    isThrusting: false,
    isBoosting: false,
    wantsFire: false,
  };

  private readonly boundOnBlur: () => void;
  private readonly boundOnVisibilityChange: () => void;
  private readonly boundOnKeyDown: (e: KeyboardEvent) => void;
  private readonly boundOnKeyUp: (e: KeyboardEvent) => void;
  private readonly boundOnPointerDown: (e: PointerEvent) => void;
  private readonly boundOnPointerUp: (e: PointerEvent) => void;
  private readonly boundUnlockAudio: () => void;
  private readonly boundOnContextMenu: (e: Event) => void;

  constructor(
    domElement: HTMLElement,
    options: {
      getCameraMode: () => CameraMode;
      onUnlockAudio: () => void;
      onVisibilityChange: (hidden: boolean) => void;
      onLandToggle?: () => void;
    },
  ) {
    this.domElement = domElement;
    this.getCameraMode = options.getCameraMode;
    this.onUnlockAudio = options.onUnlockAudio;
    this.onVisibilityChange = options.onVisibilityChange;
    this.onLandToggle = options.onLandToggle;

    this.boundOnBlur = () => this.releaseAllInputs();
    this.boundOnVisibilityChange = () => {
      if (document.hidden) this.releaseAllInputs();
      this.onVisibilityChange(document.hidden);
    };
    this.boundOnKeyDown = this.handleKeyDown.bind(this);
    this.boundOnKeyUp = this.handleKeyUp.bind(this);
    this.boundOnPointerDown = (e: PointerEvent) => {
      this.onUnlockAudio();
      if (
        this.getCameraMode() !== 'orbit' &&
        (e.pointerType !== 'mouse' || e.button === 0)
      ) {
        this.activeFirePointerIds.add(e.pointerId);
      }
    };
    this.boundOnPointerUp = (e: PointerEvent) => {
      this.activeFirePointerIds.delete(e.pointerId);
    };
    this.boundUnlockAudio = () => {
      this.onUnlockAudio();
    };
    this.boundOnContextMenu = (e: Event) => {
      e.preventDefault();
    };

    window.addEventListener('blur', this.boundOnBlur);
    document.addEventListener('visibilitychange', this.boundOnVisibilityChange);
    window.addEventListener('keydown', this.boundOnKeyDown);
    window.addEventListener('keyup', this.boundOnKeyUp);
    window.addEventListener('pointerdown', this.boundUnlockAudio, {
      passive: true,
    });
    window.addEventListener('keydown', this.boundUnlockAudio, {
      passive: true,
    });
    window.addEventListener('pointerup', this.boundOnPointerUp);
    window.addEventListener('pointercancel', this.boundOnPointerUp);
    this.domElement.addEventListener('pointerdown', this.boundOnPointerDown);
    this.domElement.addEventListener('contextmenu', this.boundOnContextMenu);
  }

  public setVirtualInputs(inputs: VirtualInputs): void {
    this.virtualInputs = { ...inputs };
  }

  public clearFirePointers(): void {
    this.activeFirePointerIds.clear();
  }

  public releaseAllInputs(): void {
    this.keysDown.clear();
    this.activeFirePointerIds.clear();
  }

  public sampleFlightInputs(invertPitch: boolean): FlightInputSample {
    let turnInput = this.virtualInputs.turn;
    if (this.keysDown.has('KeyA') || this.keysDown.has('ArrowLeft')) turnInput += 1;
    if (this.keysDown.has('KeyD') || this.keysDown.has('ArrowRight')) turnInput -= 1;
    turnInput = THREE.MathUtils.clamp(turnInput, -1, 1);

    let pitchInput = this.virtualInputs.pitch;
    if (this.keysDown.has('KeyE') || this.keysDown.has('KeyR')) pitchInput += 1;
    if (this.keysDown.has('KeyQ') || this.keysDown.has('KeyC')) pitchInput -= 1;
    pitchInput = THREE.MathUtils.clamp(pitchInput, -1, 1);
    if (invertPitch) pitchInput = -pitchInput;

    let thrustInput = this.virtualInputs.thrust;
    if (this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp')) thrustInput += 1;
    if (this.keysDown.has('KeyS') || this.keysDown.has('ArrowDown')) thrustInput -= 0.45;
    thrustInput = THREE.MathUtils.clamp(thrustInput, -0.5, 1);

    const isThrusting =
      this.virtualInputs.thrust > 0.05 ||
      this.keysDown.has('KeyW') ||
      this.keysDown.has('ArrowUp');

    const isBoosting =
      this.virtualInputs.boost ||
      this.keysDown.has('Space') ||
      this.keysDown.has('ShiftLeft');

    const wantsFire =
      this.virtualInputs.firing ||
      this.keysDown.has('KeyF') ||
      (this.activeFirePointerIds.size > 0 &&
        this.getCameraMode() !== 'orbit');

    this.sample.turn = turnInput;
    this.sample.pitch = pitchInput;
    this.sample.thrust = thrustInput;
    this.sample.isThrusting = isThrusting;
    this.sample.isBoosting = isBoosting;
    this.sample.wantsFire = wantsFire;
    return this.sample;
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const tag = document.activeElement?.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (tag === 'INPUT' && e.code.startsWith('Arrow')) return;

    if (e.code === 'KeyL' && !e.repeat) {
      this.onLandToggle?.();
    }

    if (
      ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(
        e.code,
      )
    ) {
      if (tag !== 'INPUT' && tag !== 'BUTTON') {
        e.preventDefault();
      }
    }
    this.keysDown.add(e.code);
  }

  private handleKeyUp(e: KeyboardEvent): void {
    this.keysDown.delete(e.code);
  }

  public dispose(): void {
    window.removeEventListener('blur', this.boundOnBlur);
    document.removeEventListener(
      'visibilitychange',
      this.boundOnVisibilityChange,
    );
    window.removeEventListener('keydown', this.boundOnKeyDown);
    window.removeEventListener('keyup', this.boundOnKeyUp);
    window.removeEventListener('pointerdown', this.boundUnlockAudio);
    window.removeEventListener('keydown', this.boundUnlockAudio);
    window.removeEventListener('pointerup', this.boundOnPointerUp);
    window.removeEventListener('pointercancel', this.boundOnPointerUp);
    this.domElement.removeEventListener('pointerdown', this.boundOnPointerDown);
    this.domElement.removeEventListener('contextmenu', this.boundOnContextMenu);
  }
}
