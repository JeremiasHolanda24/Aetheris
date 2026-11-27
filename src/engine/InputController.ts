import * as THREE from 'three';
import { CameraMode, PlayerMode } from '../types/simulation';

export interface VirtualInputs {
  thrust: number; // -0.5..1
  turn: number; // -1..1
  pitch: number; // -1..1 (climb/dive)
  boost: boolean;
  firing: boolean;
  charUp?: boolean;
  charDown?: boolean;
  collect?: boolean;
}

export interface FlightInputSample {
  turn: number;
  pitch: number;
  thrust: number;
  isThrusting: boolean;
  isBoosting: boolean;
  wantsFire: boolean;
}

export interface CharacterInputSample {
  forward: number;
  strafe: number;
  up: boolean;
  down: boolean;
  sprint: boolean;
  jumpEdge: boolean;
  collectHeld: boolean;
  lookDeltaX: number;
  lookDeltaY: number;
  keyYaw: number;
  keyPitch: number;
}

/**
 * Manages keyboard, multi-touch pointer firing/drag-look, virtual inputs,
 * input-focus guards, and focus-loss key release.
 */
export class InputController {
  private readonly domElement: HTMLElement;
  private readonly getCameraMode: () => CameraMode;
  private readonly onUnlockAudio: () => void;
  private readonly onVisibilityChange: (hidden: boolean) => void;
  private readonly onLandToggle?: () => void;
  private readonly onToggleJetpack?: () => void;
  private readonly onToggleDampeners?: () => void;
  private readonly onToggleCharacterCamera?: () => void;

  private playerMode: PlayerMode = 'ship';
  private keysDown = new Set<string>();
  private activeFirePointerIds = new Set<number>();
  private activeLookPointerId: number | null = null;
  private prevLookX = 0;
  private prevLookY = 0;
  private pendingLookDX = 0;
  private pendingLookDY = 0;
  private pendingJumpEdge = false;

  private virtualInputs: VirtualInputs = {
    thrust: 0,
    turn: 0,
    pitch: 0,
    boost: false,
    firing: false,
    charUp: false,
    charDown: false,
    collect: false,
  };
  private prevVirtualUp = false;

  private readonly sample: FlightInputSample = {
    turn: 0,
    pitch: 0,
    thrust: 0,
    isThrusting: false,
    isBoosting: false,
    wantsFire: false,
  };

  private readonly charSample: CharacterInputSample = {
    forward: 0,
    strafe: 0,
    up: false,
    down: false,
    sprint: false,
    jumpEdge: false,
    collectHeld: false,
    lookDeltaX: 0,
    lookDeltaY: 0,
    keyYaw: 0,
    keyPitch: 0,
  };

  private readonly boundOnBlur: () => void;
  private readonly boundOnVisibilityChange: () => void;
  private readonly boundOnKeyDown: (e: KeyboardEvent) => void;
  private readonly boundOnKeyUp: (e: KeyboardEvent) => void;
  private readonly boundOnPointerDown: (e: PointerEvent) => void;
  private readonly boundOnPointerMove: (e: PointerEvent) => void;
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
      onToggleJetpack?: () => void;
      onToggleDampeners?: () => void;
      onToggleCharacterCamera?: () => void;
    },
  ) {
    this.domElement = domElement;
    this.getCameraMode = options.getCameraMode;
    this.onUnlockAudio = options.onUnlockAudio;
    this.onVisibilityChange = options.onVisibilityChange;
    this.onLandToggle = options.onLandToggle;
    this.onToggleJetpack = options.onToggleJetpack;
    this.onToggleDampeners = options.onToggleDampeners;
    this.onToggleCharacterCamera = options.onToggleCharacterCamera;

    this.boundOnBlur = () => this.releaseAllInputs();
    this.boundOnVisibilityChange = () => {
      if (document.hidden) this.releaseAllInputs();
      this.onVisibilityChange(document.hidden);
    };
    this.boundOnKeyDown = this.handleKeyDown.bind(this);
    this.boundOnKeyUp = this.handleKeyUp.bind(this);
    this.boundOnPointerDown = (e: PointerEvent) => {
      this.onUnlockAudio();
      if (this.getCameraMode() === 'orbit') return;
      if (this.playerMode === 'character') {
        if (this.activeLookPointerId === null) {
          this.activeLookPointerId = e.pointerId;
          this.prevLookX = e.clientX;
          this.prevLookY = e.clientY;
        }
        return;
      }
      if (e.pointerType !== 'mouse' || e.button === 0) {
        this.activeFirePointerIds.add(e.pointerId);
      }
    };
    this.boundOnPointerMove = (e: PointerEvent) => {
      if (
        this.playerMode === 'character' &&
        this.getCameraMode() !== 'orbit' &&
        this.activeLookPointerId === e.pointerId
      ) {
        this.pendingLookDX += e.clientX - this.prevLookX;
        this.pendingLookDY += e.clientY - this.prevLookY;
        this.prevLookX = e.clientX;
        this.prevLookY = e.clientY;
      }
    };
    this.boundOnPointerUp = (e: PointerEvent) => {
      this.activeFirePointerIds.delete(e.pointerId);
      if (this.activeLookPointerId === e.pointerId) {
        this.activeLookPointerId = null;
      }
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
    window.addEventListener('pointermove', this.boundOnPointerMove);
    window.addEventListener('pointerup', this.boundOnPointerUp);
    window.addEventListener('pointercancel', this.boundOnPointerUp);
    this.domElement.addEventListener('pointerdown', this.boundOnPointerDown);
    this.domElement.addEventListener('contextmenu', this.boundOnContextMenu);
  }

  public setPlayerMode(mode: PlayerMode): void {
    if (this.playerMode === mode) return;
    this.playerMode = mode;
    this.activeFirePointerIds.clear();
    this.activeLookPointerId = null;
    this.pendingLookDX = 0;
    this.pendingLookDY = 0;
    this.pendingJumpEdge = false;
  }

  public setVirtualInputs(inputs: VirtualInputs): void {
    const curUp = Boolean(inputs.charUp);
    if (curUp && !this.prevVirtualUp && this.playerMode === 'character') {
      this.pendingJumpEdge = true;
    }
    this.prevVirtualUp = curUp;
    this.virtualInputs = { ...inputs };
  }

  public clearFirePointers(): void {
    this.activeFirePointerIds.clear();
  }

  public releaseAllInputs(): void {
    this.keysDown.clear();
    this.activeFirePointerIds.clear();
    this.activeLookPointerId = null;
    this.pendingLookDX = 0;
    this.pendingLookDY = 0;
    this.pendingJumpEdge = false;
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
      this.playerMode === 'ship' &&
      (this.virtualInputs.firing ||
        this.keysDown.has('KeyF') ||
        (this.activeFirePointerIds.size > 0 &&
          this.getCameraMode() !== 'orbit'));

    this.sample.turn = turnInput;
    this.sample.pitch = pitchInput;
    this.sample.thrust = thrustInput;
    this.sample.isThrusting = isThrusting;
    this.sample.isBoosting = isBoosting;
    this.sample.wantsFire = wantsFire;
    return this.sample;
  }

  public sampleCharacterInputs(): CharacterInputSample {
    let forward = this.virtualInputs.pitch;
    if (this.keysDown.has('KeyW')) forward += 1;
    if (this.keysDown.has('KeyS')) forward -= 1;
    forward = THREE.MathUtils.clamp(forward, -1, 1);

    let strafe = -this.virtualInputs.turn;
    if (this.keysDown.has('KeyD')) strafe += 1;
    if (this.keysDown.has('KeyA')) strafe -= 1;
    strafe = THREE.MathUtils.clamp(strafe, -1, 1);

    let keyYaw = 0;
    if (this.keysDown.has('ArrowLeft')) keyYaw += 1;
    if (this.keysDown.has('ArrowRight')) keyYaw -= 1;

    let keyPitch = 0;
    if (this.keysDown.has('ArrowUp')) keyPitch += 1;
    if (this.keysDown.has('ArrowDown')) keyPitch -= 1;

    const up = Boolean(this.keysDown.has('Space') || this.virtualInputs.charUp);
    const down = Boolean(
      this.keysDown.has('KeyC') ||
        this.keysDown.has('ControlLeft') ||
        this.keysDown.has('ControlRight') ||
        this.virtualInputs.charDown,
    );
    const sprint = Boolean(
      this.keysDown.has('ShiftLeft') ||
        this.keysDown.has('ShiftRight') ||
        this.virtualInputs.boost,
    );

    const collectHeld = Boolean(
      this.keysDown.has('KeyE') || this.virtualInputs.collect,
    );

    this.charSample.forward = forward;
    this.charSample.strafe = strafe;
    this.charSample.up = up;
    this.charSample.down = down;
    this.charSample.sprint = sprint;
    this.charSample.jumpEdge = this.pendingJumpEdge;
    this.charSample.collectHeld = collectHeld;
    this.charSample.lookDeltaX = this.pendingLookDX;
    this.charSample.lookDeltaY = this.pendingLookDY;
    this.charSample.keyYaw = keyYaw;
    this.charSample.keyPitch = keyPitch;

    this.pendingJumpEdge = false;
    this.pendingLookDX = 0;
    this.pendingLookDY = 0;

    return this.charSample;
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const tag = document.activeElement?.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (tag === 'INPUT' && e.code.startsWith('Arrow')) return;

    if (!e.repeat) {
      if (e.code === 'KeyL') {
        this.onLandToggle?.();
      } else if (this.playerMode === 'character') {
        if (e.code === 'KeyX' || e.code === 'KeyJ') {
          this.onToggleJetpack?.();
        } else if (e.code === 'KeyZ') {
          this.onToggleDampeners?.();
        } else if (e.code === 'KeyV') {
          this.onToggleCharacterCamera?.();
        } else if (e.code === 'Space') {
          this.pendingJumpEdge = true;
        }
      }
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
    window.removeEventListener('pointermove', this.boundOnPointerMove);
    window.removeEventListener('pointerup', this.boundOnPointerUp);
    window.removeEventListener('pointercancel', this.boundOnPointerUp);
    this.domElement.removeEventListener('pointerdown', this.boundOnPointerDown);
    this.domElement.removeEventListener('contextmenu', this.boundOnContextMenu);
  }
}
