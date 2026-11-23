import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Flame, Gauge, LocateFixed, RotateCw, Smartphone } from 'lucide-react';
import { VirtualInputs } from '../engine/FlightEngine';

interface MobileControlsProps {
  visible: boolean;
  targetLocked: boolean;
  isPortraitMobile: boolean;
  portraitDismissed: boolean;
  onDismissPortrait: () => void;
  onRequestLandscapeFullscreen: () => void;
  onToggleTargetLock: () => void;
  onVirtualInputChange: (inputs: VirtualInputs) => void;
}

export const MobileControls: React.FC<MobileControlsProps> = React.memo(
  ({
    visible,
    targetLocked,
    isPortraitMobile,
    portraitDismissed,
    onDismissPortrait,
    onRequestLandscapeFullscreen,
    onToggleTargetLock,
    onVirtualInputChange,
  }) => {
    const stickStateRef = useRef({ turn: 0, pitch: 0 });
    const pedalStateRef = useRef({
      thrustPressed: false,
      boostPressed: false,
      brakePressed: false,
    });

    const activeStickPointerRef = useRef<number | null>(null);
    const stickZoneRef = useRef<HTMLDivElement | null>(null);
    const [puckOffset, setPuckOffset] = useState({ x: 0, y: 0, active: false });

    const [pedalsUi, setPedalsUi] = useState({
      thrust: false,
      boost: false,
      brake: false,
    });

    const emitCombinedInputs = useCallback(() => {
      const { turn, pitch } = stickStateRef.current;
      const { thrustPressed, boostPressed, brakePressed } =
        pedalStateRef.current;

      let pedalThrust = 0;
      if (thrustPressed || boostPressed) pedalThrust += 1;
      if (brakePressed) pedalThrust -= 0.5;

      onVirtualInputChange({
        turn,
        pitch,
        thrust: Math.max(-0.5, Math.min(1, pedalThrust)),
        boost: boostPressed,
        firing: false,
      });
    }, [onVirtualInputChange]);

    useEffect(() => {
      if (!visible) {
        stickStateRef.current = { turn: 0, pitch: 0 };
        pedalStateRef.current = {
          thrustPressed: false,
          boostPressed: false,
          brakePressed: false,
        };
        activeStickPointerRef.current = null;
        setPuckOffset({ x: 0, y: 0, active: false });
        setPedalsUi({ thrust: false, boost: false, brake: false });
        onVirtualInputChange({
          turn: 0,
          pitch: 0,
          thrust: 0,
          boost: false,
          firing: false,
        });
      }
    }, [visible, onVirtualInputChange]);

    const updateStickFromPointer = (clientX: number, clientY: number) => {
      const el = stickZoneRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width * 0.5;
      const cy = rect.top + rect.height * 0.5;
      const maxRadius = rect.width * 0.38;

      let dx = clientX - cx;
      let dy = clientY - cy;
      const dist = Math.hypot(dx, dy);

      if (dist > maxRadius && dist > 0) {
        const scale = maxRadius / dist;
        dx *= scale;
        dy *= scale;
      }

      const normX = dx / maxRadius; // -1 left, +1 right
      const normY = dy / maxRadius; // -1 up, +1 down

      const deadzone = 0.12;
      const rawTurn = -normX;
      const turn =
        Math.abs(rawTurn) < deadzone
          ? 0
          : (Math.sign(rawTurn) * (Math.abs(rawTurn) - deadzone)) /
            (1 - deadzone);

      const rawPitch = -normY; // Push UP to climb into space, DOWN to dive
      const pitch =
        Math.abs(rawPitch) < deadzone
          ? 0
          : (Math.sign(rawPitch) * (Math.abs(rawPitch) - deadzone)) /
            (1 - deadzone);

      stickStateRef.current = { turn, pitch };
      setPuckOffset({ x: dx, y: dy, active: true });
      emitCombinedInputs();
    };

    const handleStickPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      if (activeStickPointerRef.current !== null) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      activeStickPointerRef.current = e.pointerId;
      updateStickFromPointer(e.clientX, e.clientY);
    };

    const handleStickPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      if (activeStickPointerRef.current !== e.pointerId) return;
      e.preventDefault();
      updateStickFromPointer(e.clientX, e.clientY);
    };

    const handleStickPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
      if (activeStickPointerRef.current !== e.pointerId) return;
      e.preventDefault();
      activeStickPointerRef.current = null;
      stickStateRef.current = { turn: 0, pitch: 0 };
      setPuckOffset({ x: 0, y: 0, active: false });
      emitCombinedInputs();
    };

    const setPedal = (
      key: 'thrustPressed' | 'boostPressed' | 'brakePressed',
      pressed: boolean,
    ) => {
      pedalStateRef.current[key] = pressed;
      setPedalsUi({
        thrust: pedalStateRef.current.thrustPressed,
        boost: pedalStateRef.current.boostPressed,
        brake: pedalStateRef.current.brakePressed,
      });
      emitCombinedInputs();
    };

    return (
      <>
        {/* Portrait Orientation Prompt on Mobile Devices */}
        {isPortraitMobile && !portraitDismissed && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#05050d]/95 p-6">
            <div className="w-full max-w-sm bg-[#090c16] border border-white/15 rounded-2xl p-6 text-center shadow-2xl">
              <div className="mx-auto mb-4 w-14 h-14 rounded-xl bg-amber-500/15 border border-amber-400/35 flex items-center justify-center text-amber-400">
                <Smartphone className="w-7 h-7 -rotate-90" />
              </div>
              <h2 className="font-display text-lg font-semibold text-slate-100">
                Jogue na Horizontal
              </h2>
              <p className="mt-2 text-sm text-slate-300 leading-relaxed">
                Gire o celular para o modo paisagem para pilotar com o manche
                3D à esquerda (girar, subir e descer) e propulsão à direita.
              </p>
              <div className="mt-5 flex flex-col gap-2.5">
                <button
                  type="button"
                  onClick={onRequestLandscapeFullscreen}
                  className="w-full min-h-[46px] px-4 py-2.5 text-sm font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RotateCw className="w-4 h-4" />
                  <span>Tela Cheia Horizontal</span>
                </button>
                <button
                  type="button"
                  onClick={onDismissPortrait}
                  className="w-full min-h-[44px] px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-900 border border-white/10 rounded-xl transition-colors cursor-pointer"
                >
                  Continuar na Vertical
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Dual-Thumb Landscape Touch Controls */}
        {visible && (
          <div className="pointer-events-none hidden [@media(min-height:220px)]:flex fixed inset-x-0 bottom-0 z-15 items-end justify-between px-5 pb-5 sm:px-8 sm:pb-6">
            {/* LEFT THUMB ZONE: 3D Flight Analog Stick (Yaw + Pitch Climb/Dive) */}
            <div
              ref={stickZoneRef}
              onPointerDown={handleStickPointerDown}
              onPointerMove={handleStickPointerMove}
              onPointerUp={handleStickPointerUp}
              onPointerCancel={handleStickPointerUp}
              style={{
                touchAction: 'none',
                marginLeft: 'env(safe-area-inset-left)',
                marginBottom: 'env(safe-area-inset-bottom)',
              }}
              className={`pointer-events-auto relative w-32 h-32 sm:w-36 sm:h-36 rounded-full border transition-colors flex items-center justify-center ${
                puckOffset.active
                  ? 'bg-[#090c16]/80 border-amber-400/50'
                  : 'bg-[#090c16]/65 border-white/15'
              }`}
              aria-label="Manche 3D (Direção, Subir e Descer)"
            >
              <div className="absolute inset-x-4 h-px bg-white/10 pointer-events-none" />
              <div className="absolute inset-y-4 w-px bg-white/10 pointer-events-none" />
              <span className="absolute top-1.5 text-[9px] font-medium text-sky-300/90 pointer-events-none">
                ▲ Subir
              </span>
              <span className="absolute bottom-1.5 text-[9px] font-medium text-slate-400 pointer-events-none">
                ▼ Descer
              </span>
              <span className="absolute left-2.5 text-[11px] font-semibold text-slate-400 pointer-events-none">
                ‹
              </span>
              <span className="absolute right-2.5 text-[11px] font-semibold text-slate-400 pointer-events-none">
                ›
              </span>

              <div
                className={`w-13 h-13 rounded-full border-2 shadow-lg pointer-events-none flex items-center justify-center ${
                  puckOffset.active
                    ? 'bg-amber-500 border-amber-200 text-slate-950'
                    : 'bg-slate-800/90 border-white/30 text-slate-200'
                }`}
                style={{
                  transform: `translate3d(${puckOffset.x}px, ${puckOffset.y}px, 0)`,
                }}
              >
                <div className="w-2.5 h-2.5 rounded-full bg-current opacity-80" />
              </div>
            </div>

            {/* RIGHT THUMB ZONE: Travar Alvo, Frear, Turbo & Acelerar */}
            <div
              className="pointer-events-auto flex items-end gap-3"
              style={{
                touchAction: 'none',
                marginRight: 'env(safe-area-inset-right)',
                marginBottom: 'env(safe-area-inset-bottom)',
              }}
            >
              <div className="flex flex-col items-center gap-2.5">
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onToggleTargetLock();
                  }}
                  style={{ touchAction: 'none' }}
                  className={`w-16 h-16 sm:w-18 sm:h-18 rounded-full border-2 flex flex-col items-center justify-center gap-0.5 transition-all active:scale-95 cursor-pointer ${
                    targetLocked
                      ? 'bg-amber-500 text-slate-950 border-amber-200 font-bold shadow-[0_0_16px_rgba(245,158,11,0.45)]'
                      : 'bg-[#090c16]/85 text-amber-300 border-amber-400/50'
                  }`}
                  aria-label="Travar Alvo"
                  aria-pressed={targetLocked}
                >
                  <LocateFixed className="w-5 h-5" />
                  <span className="text-[10px] font-semibold leading-none text-center px-1">
                    {targetLocked ? 'Travado' : 'Travar'}
                  </span>
                </button>

                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setPedal('brakePressed', true);
                  }}
                  onPointerUp={(e) => {
                    e.preventDefault();
                    setPedal('brakePressed', false);
                  }}
                  onPointerCancel={() => setPedal('brakePressed', false)}
                  style={{ touchAction: 'none' }}
                  className={`w-14 h-12 sm:w-16 sm:h-14 rounded-2xl border flex flex-col items-center justify-center gap-0.5 transition-transform active:scale-95 cursor-pointer ${
                    pedalsUi.brake
                      ? 'bg-rose-500 text-white border-rose-300'
                      : 'bg-[#090c16]/75 text-slate-200 border-white/15'
                  }`}
                  aria-label="Frear"
                >
                  <span className="text-[11px] font-semibold leading-none">
                    Frear
                  </span>
                </button>
              </div>

              <div className="flex flex-col items-end gap-2.5">
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setPedal('boostPressed', true);
                  }}
                  onPointerUp={(e) => {
                    e.preventDefault();
                    setPedal('boostPressed', false);
                  }}
                  onPointerCancel={() => setPedal('boostPressed', false)}
                  style={{ touchAction: 'none' }}
                  className={`w-16 h-14 sm:w-18 sm:h-15 rounded-2xl border flex flex-col items-center justify-center gap-0.5 transition-transform active:scale-95 cursor-pointer ${
                    pedalsUi.boost
                      ? 'bg-amber-500 text-slate-950 border-amber-300'
                      : 'bg-[#090c16]/80 text-amber-300 border-amber-400/35'
                  }`}
                  aria-label="Turbo"
                >
                  <Flame className="w-4 h-4" />
                  <span className="text-[11px] font-semibold leading-none">
                    Turbo
                  </span>
                </button>

                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setPedal('thrustPressed', true);
                  }}
                  onPointerUp={(e) => {
                    e.preventDefault();
                    setPedal('thrustPressed', false);
                  }}
                  onPointerCancel={() => setPedal('thrustPressed', false)}
                  style={{ touchAction: 'none' }}
                  className={`w-20 h-20 sm:w-22 sm:h-22 rounded-full border-2 flex flex-col items-center justify-center gap-1 transition-transform active:scale-95 cursor-pointer ${
                    pedalsUi.thrust
                      ? 'bg-sky-400 text-slate-950 border-sky-200'
                      : 'bg-[#090c16]/85 text-sky-300 border-sky-400/45'
                  }`}
                  aria-label="Acelerar"
                >
                  <Gauge className="w-5 h-5" />
                  <span className="text-xs font-semibold leading-none">
                    Acelerar
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  },
);

MobileControls.displayName = 'MobileControls';
