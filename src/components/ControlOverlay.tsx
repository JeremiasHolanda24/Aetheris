import React, { useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Backpack,
  Coins,
  Crosshair,
  Eye,
  Flame,
  Fuel,
  LocateFixed,
  Maximize2,
  Minimize2,
  Orbit,
  Play,
  RotateCcw,
  Settings,
  Shield,
  Volume2,
  VolumeX,
  Wind,
  X,
} from 'lucide-react';
import {
  CameraMode,
  CharacterCameraMode,
  DiagnosticFlags,
  OtherDrawBreakdown,
  QualityLevel,
  SimulationConfig,
  TelemetrySnapshot,
} from '../types/simulation';

interface TelemetryHeaderProps {
  telemetry: TelemetrySnapshot;
  showFps: boolean;
  dockOpen: boolean;
  backpackOpen: boolean;
  isFullscreen: boolean;
  isTouchDevice: boolean;
  targetLocked: boolean;
  isMuted: boolean;
  dimmed: boolean;
  hideFuelHullBars?: boolean;
  onToggleDock: () => void;
  onToggleBackpack: () => void;
  onToggleFullscreen: () => void;
  onToggleTargetLock: () => void;
  onToggleMute: () => void;
  onToggleCharacterCamera: () => void;
  onToggleJetpack: () => void;
  onToggleDampeners: () => void;
  onToggleLanding: () => void;
}

export const TelemetryHeader: React.FC<TelemetryHeaderProps> = React.memo(
  ({
    telemetry,
    showFps,
    dockOpen,
    backpackOpen,
    isFullscreen,
    isTouchDevice,
    targetLocked,
    isMuted,
    dimmed,
    hideFuelHullBars = false,
    onToggleDock,
    onToggleBackpack,
    onToggleFullscreen,
    onToggleTargetLock,
    onToggleMute,
    onToggleCharacterCamera,
    onToggleJetpack,
    onToggleDampeners,
    onToggleLanding,
  }) => (
    <header
      className={`pointer-events-none fixed top-2.5 sm:top-4 left-0 right-0 z-30 flex flex-wrap items-center justify-between gap-2 transition-opacity duration-150 ${
        dimmed ? 'opacity-20' : 'opacity-100'
      }`}
      style={{
        paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
        paddingRight: 'max(0.75rem, env(safe-area-inset-right))',
      }}
    >
      <div className="pointer-events-auto bg-[#090c16]/90 border border-white/10 rounded-lg px-3 py-1.5 sm:px-4 sm:py-2 flex flex-wrap items-center gap-x-2.5 sm:gap-x-3 gap-y-1">
        {(() => {
          const maxRef = telemetry.playerMode === 'character' ? 30 : 120;
          const barRatio = Math.min(1, Math.max(0, telemetry.speed / maxRef));
          const totalSegs = 12;
          const filledSegs = Math.round(barRatio * totalSegs);
          return (
            <div
              className="flex items-center gap-2 shrink-0"
              aria-label={`Velocidade ${Math.round(telemetry.speed)} metros por segundo`}
            >
              <div className="flex items-center gap-[2.5px]" aria-hidden="true">
                {Array.from({ length: totalSegs }, (_, idx) => {
                  const filled = idx < filledSegs;
                  const segClass = filled
                    ? idx >= 9
                      ? 'bg-amber-500'
                      : telemetry.isBoosting
                        ? 'bg-amber-400'
                        : 'bg-sky-400'
                    : 'bg-slate-400/20';
                  return (
                    <span
                      key={idx}
                      className={`block w-[4px] sm:w-[5px] h-3 sm:h-3.5 ${segClass}`}
                    />
                  );
                })}
              </div>
              <span className="text-[11px] sm:text-xs font-mono-tabular text-slate-300">
                <strong className="text-slate-100 font-medium">
                  {Math.round(telemetry.speed)}
                </strong>{' '}
                m/s
              </span>
            </div>
          );
        })()}
        <span className="text-slate-600" aria-hidden="true">
          ·
        </span>
        {/* Turbo, Fuel & Hull Bars */}
        {telemetry.playerMode === 'ship' && (
          <>
            <div
              className="flex items-center gap-1.5 shrink-0"
              title="Carga do Turbo (Espaço / Shift)"
              aria-label={`Carga do turbo ${Math.round(telemetry.turboCharge * 100)} por cento`}
            >
              <Flame
                className={`w-3.5 h-3.5 ${
                  telemetry.turboExhausted
                    ? 'text-rose-400'
                    : telemetry.isBoosting
                      ? 'text-amber-300'
                      : 'text-amber-400/80'
                }`}
              />
              <div className="w-10 sm:w-12 h-2 rounded-sm bg-slate-400/20 overflow-hidden">
                <div
                  className={`h-full transition-[width] duration-75 ${
                    telemetry.turboExhausted
                      ? 'bg-rose-500'
                      : telemetry.isBoosting
                        ? 'bg-amber-300'
                        : 'bg-amber-400'
                  }`}
                  style={{
                    width: `${Math.round(
                      Math.min(1, Math.max(0, telemetry.turboCharge)) * 100,
                    )}%`,
                  }}
                />
              </div>
            </div>
            <span className="text-slate-600" aria-hidden="true">
              ·
            </span>
          </>
        )}
        {!hideFuelHullBars && (() => {
          const fuelPct = Math.round(
            Math.min(
              100,
              Math.max(
                0,
                (telemetry.player.fuel / telemetry.player.maxFuel) * 100,
              ),
            ),
          );
          const hullPct = Math.round(
            Math.min(
              100,
              Math.max(
                0,
                (telemetry.player.hull / telemetry.player.maxHull) * 100,
              ),
            ),
          );
          return (
            <>
              <div
                className="flex items-center gap-1.5 shrink-0"
                title={`Combustível ${fuelPct}%`}
                aria-label={`Combustível ${fuelPct} por cento`}
              >
                <Fuel
                  className={`w-3.5 h-3.5 ${
                    telemetry.player.reserveMode
                      ? 'text-rose-400'
                      : fuelPct < 25
                        ? 'text-amber-300'
                        : 'text-cyan-400'
                  }`}
                />
                <div className="w-10 sm:w-12 h-2 rounded-sm bg-slate-400/20 overflow-hidden">
                  <div
                    className={`h-full transition-[width] duration-150 ${
                      telemetry.player.reserveMode
                        ? 'bg-rose-500'
                        : fuelPct < 25
                          ? 'bg-amber-400'
                          : 'bg-cyan-400'
                    }`}
                    style={{ width: `${fuelPct}%` }}
                  />
                </div>
                {telemetry.player.reserveMode && (
                  <span className="text-[9px] font-semibold font-mono-tabular text-rose-400">
                    RES
                  </span>
                )}
              </div>
              <div
                className="flex items-center gap-1.5 shrink-0"
                title={`Casco ${hullPct}%`}
                aria-label={`Casco ${hullPct} por cento`}
              >
                <Shield
                  className={`w-3.5 h-3.5 ${
                    hullPct < 35
                      ? 'text-rose-400'
                      : hullPct < 65
                        ? 'text-amber-300'
                        : 'text-emerald-400'
                  }`}
                />
                <div className="w-10 sm:w-12 h-2 rounded-sm bg-slate-400/20 overflow-hidden">
                  <div
                    className={`h-full transition-[width] duration-150 ${
                      hullPct < 35
                        ? 'bg-rose-500'
                        : hullPct < 65
                          ? 'bg-amber-400'
                          : 'bg-emerald-400'
                    }`}
                    style={{ width: `${hullPct}%` }}
                  />
                </div>
              </div>
              <span className="text-slate-600" aria-hidden="true">
                ·
              </span>
            </>
          );
        })()}
        <div className="flex flex-wrap items-center gap-x-2 sm:gap-x-2.5 gap-y-0.5 text-[11px] sm:text-xs text-slate-300 font-mono-tabular">
          <span>
            ALT{' '}
            <strong className="text-slate-100 font-medium">
              {telemetry.altitude.toFixed(0)}
            </strong>{' '}
            m
          </span>
          <span className="text-slate-600" aria-hidden="true">
            ·
          </span>
          <span>
            {telemetry.inSpace ? (
              <strong className="text-sky-300 font-medium">ESPAÇO</strong>
            ) : (
              <>
                ATM{' '}
                <strong className="text-emerald-300 font-medium">
                  {telemetry.atmospherePct}%
                </strong>
              </>
            )}
          </span>
          <span className="text-slate-600" aria-hidden="true">
            ·
          </span>
          <span>
            CAP{' '}
            <strong className="text-sky-400 font-medium">
              {telemetry.waypointsCaptured}
            </strong>
          </span>
        </div>
      </div>

      {/* Top-Right: Character Suit / Ship Quick Controls + Fullscreen + Audio + Settings */}
      <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 sm:gap-2">
        {telemetry.playerMode === 'character' && !isTouchDevice && (
          <>
            <button
              type="button"
              onClick={onToggleCharacterCamera}
              className="min-h-[38px] px-2.5 py-1.5 text-xs font-medium rounded-lg border bg-[#090c16]/90 text-slate-200 border-white/15 hover:border-white/30 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
              title="Alternar câmera 3ª / 1ª pessoa (V)"
            >
              <Eye className="w-4 h-4 text-sky-400" />
              <span>
                {telemetry.characterCamera === 'third' ? '3ª Pessoa' : '1ª Pessoa'}
              </span>
            </button>

            <button
              type="button"
              onClick={onToggleJetpack}
              className={`min-h-[38px] px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
                telemetry.jetpackEnabled
                  ? 'bg-sky-500 text-slate-950 border-sky-300 font-semibold'
                  : 'bg-[#090c16]/90 text-slate-300 border-white/15 hover:border-white/30'
              }`}
              title="Ligar/Desligar Jetpack (X)"
              aria-pressed={telemetry.jetpackEnabled}
            >
              <Flame className="w-4 h-4" />
              <span>Jetpack</span>
            </button>

            <button
              type="button"
              onClick={onToggleDampeners}
              className={`min-h-[38px] px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
                telemetry.dampenersEnabled
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/50'
                  : 'bg-[#090c16]/90 text-slate-400 border-white/15 hover:border-white/30'
              }`}
              title="Amortecedores Inerciais (Z)"
              aria-pressed={telemetry.dampenersEnabled}
            >
              <Wind className="w-4 h-4" />
              <span>Inercial</span>
            </button>

            <button
              type="button"
              onClick={onToggleLanding}
              className="min-h-[38px] px-2.5 py-1.5 text-xs font-medium rounded-lg border bg-amber-500/20 text-amber-300 border-amber-400/45 hover:bg-amber-500/30 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
              title="Entrar na nave e decolar (L)"
            >
              <ArrowUpFromLine className="w-4 h-4" />
              <span>Decolar</span>
            </button>
          </>
        )}

        {telemetry.playerMode === 'ship' && !isTouchDevice && (
          <button
            type="button"
            onClick={onToggleTargetLock}
            className={`min-h-[38px] px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
              targetLocked
                ? 'bg-amber-500 text-slate-950 border-amber-300 font-semibold'
                : 'bg-[#090c16]/90 text-amber-300 border-amber-400/35 hover:border-amber-300'
            }`}
            title="Travar mira no alvo (T)"
            aria-pressed={targetLocked}
          >
            <LocateFixed className="w-4 h-4" />
            <span>{targetLocked ? 'Alvo Travado' : 'Travar Alvo'}</span>
          </button>
        )}

        <div
          className="min-h-[38px] px-2.5 py-1.5 text-xs font-mono-tabular rounded-lg border bg-[#090c16]/90 text-amber-300 border-white/10 whitespace-nowrap shrink-0 flex items-center gap-1.5"
          title="Créditos disponíveis"
        >
          <Coins className="w-3.5 h-3.5 text-amber-400" />
          <span className="font-semibold">{telemetry.player.credits}</span>
        </div>

        <button
          type="button"
          onClick={onToggleBackpack}
          className={`min-h-[38px] px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
            backpackOpen
              ? 'bg-amber-500 text-slate-950 border-amber-300 font-semibold'
              : 'bg-[#090c16]/90 text-slate-200 border-white/10 hover:border-white/25'
          }`}
          aria-label="Abrir mochila e carga"
          aria-expanded={backpackOpen}
          title="Mochila e Carga (B)"
        >
          <Backpack className="w-4 h-4 text-amber-400" />
          <span className="font-mono-tabular">
            {telemetry.player.inventoryCount}/{telemetry.player.inventoryCapacity}
          </span>
        </button>

        <button
          type="button"
          onClick={onToggleFullscreen}
          className="min-h-[38px] px-3 py-1.5 text-xs font-medium rounded-lg border bg-[#090c16]/90 text-slate-200 border-white/10 hover:border-white/25 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
          title={isFullscreen ? 'Sair da tela cheia' : 'Ativar tela cheia'}
        >
          {isFullscreen ? (
            <Minimize2 className="w-4 h-4 text-sky-400" />
          ) : (
            <Maximize2 className="w-4 h-4 text-sky-400" />
          )}
          <span>{isFullscreen ? 'Sair' : 'Tela Cheia'}</span>
        </button>

        <button
          type="button"
          onClick={onToggleMute}
          className={`min-h-[38px] min-w-[38px] px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 flex items-center justify-center cursor-pointer ${
            isMuted
              ? 'bg-[#090c16]/90 text-slate-400 border-white/10 hover:border-white/25'
              : 'bg-[#090c16]/90 text-sky-300 border-white/10 hover:border-white/25'
          }`}
          aria-label={isMuted ? 'Ativar som' : 'Silenciar som'}
          aria-pressed={!isMuted}
          title={isMuted ? 'Ativar som (M)' : 'Silenciar som (M)'}
        >
          {isMuted ? (
            <VolumeX className="w-4 h-4 text-rose-400" />
          ) : (
            <Volume2 className="w-4 h-4 text-sky-400" />
          )}
        </button>

        <button
          type="button"
          onClick={onToggleDock}
          className={`min-h-[38px] min-w-[38px] px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 flex items-center justify-center gap-1.5 cursor-pointer ${
            dockOpen
              ? 'bg-amber-500 text-slate-950 border-amber-400 font-semibold'
              : 'bg-[#090c16]/90 text-slate-200 border-white/10 hover:border-white/25'
          }`}
          aria-label="Abrir ou fechar ajustes"
          aria-expanded={dockOpen}
          title="Ajustes (H)"
        >
          <Settings className="w-4 h-4" />
        </button>

        {showFps && (
          <span
            className="px-2 py-1 text-[10px] font-mono-tabular text-slate-400 bg-[#090c16]/85 border border-white/10 rounded-md whitespace-nowrap shrink-0"
            title="FPS médio (~1s)"
          >
            {telemetry.fps} FPS
          </span>
        )}
      </div>
    </header>
  ),
);

TelemetryHeader.displayName = 'TelemetryHeader';

interface ControlDockProps {
  config: SimulationConfig;
  diagnostics: DiagnosticFlags;
  dockOpen: boolean;
  activeSliderId: string | null;
  autoQuality: boolean;
  qualityLevel: QualityLevel;
  fps: number;
  worstFps: number;
  cpuFrameMs: number;
  floraInstances: number;
  floraGroups: number;
  renderCalls: number;
  terrainDraws: number;
  floraDraws: number;
  otherDraws: number;
  otherBreakdown: OtherDrawBreakdown;
  benchmarkActive: boolean;
  onActiveSliderChange: (id: string | null) => void;
  onToggleAutoQuality: () => void;
  onToggleDiagnostic: (key: keyof DiagnosticFlags) => void;
  onStartBenchmark: () => void;
  onStartDescentBenchmark: () => void;
  onCloseDock: () => void;
  onUpdateConfig: (updater: (prev: SimulationConfig) => SimulationConfig) => void;
  onLandSurface: () => void;
  onLaunchOrbit: () => void;
  onRelocateTarget: () => void;
  onResetDefaults: () => void;
  onNewGame: () => void;
  onDebugAddCredits: () => void;
  onDebugFillInventory: () => void;
  onDebugDamageHull: () => void;
  onTeleportNearestPoi: () => void;
}

type DockTab = 'flight' | 'planet' | 'backdrop' | 'camera';

interface SliderRowProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  decimals?: number;
  activeSliderId: string | null;
  onStartDrag: (id: string) => void;
  onChange: (val: number) => void;
}

const SliderRow: React.FC<SliderRowProps> = ({
  id,
  label,
  value,
  min,
  max,
  step,
  unit = '',
  decimals = 0,
  activeSliderId,
  onStartDrag,
  onChange,
}) => {
  const isOtherDragging = activeSliderId !== null && activeSliderId !== id;

  return (
    <label
      className={`flex flex-col gap-1.5 min-w-0 transition-opacity duration-150 ${
        isOtherDragging ? 'opacity-15' : 'opacity-100'
      }`}
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-slate-200 truncate">{label}</span>
        <span className="font-mono-tabular text-amber-400 shrink-0">
          {value.toFixed(decimals)}
          {unit}
        </span>
      </div>
      <input
        type="range"
        className="flight-slider w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={() => onStartDrag(id)}
        onMouseDown={() => onStartDrag(id)}
        onTouchStart={() => onStartDrag(id)}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </label>
  );
};

export const ControlDock: React.FC<ControlDockProps> = React.memo(
  ({
    config,
    diagnostics,
    dockOpen,
    activeSliderId,
    autoQuality,
    qualityLevel,
    fps,
    worstFps,
    cpuFrameMs,
    floraInstances,
    floraGroups,
    renderCalls,
    terrainDraws,
    floraDraws,
    otherDraws,
    otherBreakdown,
    benchmarkActive,
    onActiveSliderChange,
    onToggleAutoQuality,
    onToggleDiagnostic,
    onStartBenchmark,
    onStartDescentBenchmark,
    onCloseDock,
    onUpdateConfig,
    onLandSurface,
    onLaunchOrbit,
    onRelocateTarget,
    onResetDefaults,
    onNewGame,
    onDebugAddCredits,
    onDebugFillInventory,
    onDebugDamageHull,
    onTeleportNearestPoi,
  }) => {
    const [activeTab, setActiveTab] = useState<DockTab>('flight');
    const [confirmNewGame, setConfirmNewGame] = useState(false);

    useEffect(() => {
      if (!dockOpen) {
        setConfirmNewGame(false);
      }
    }, [dockOpen]);

    // Release slider transparency cleanly even if pointer lifts outside the slider
    useEffect(() => {
      if (activeSliderId === null) return;

      const handleRelease = () => onActiveSliderChange(null);
      window.addEventListener('pointerup', handleRelease);
      window.addEventListener('pointercancel', handleRelease);
      window.addEventListener('mouseup', handleRelease);
      window.addEventListener('touchend', handleRelease);
      window.addEventListener('touchcancel', handleRelease);

      return () => {
        window.removeEventListener('pointerup', handleRelease);
        window.removeEventListener('pointercancel', handleRelease);
        window.removeEventListener('mouseup', handleRelease);
        window.removeEventListener('touchend', handleRelease);
        window.removeEventListener('touchcancel', handleRelease);
      };
    }, [activeSliderId, onActiveSliderChange]);

    if (!dockOpen) {
      return null;
    }

    const isDraggingAny = activeSliderId !== null;

    const cameraModes: Array<{ id: CameraMode; label: string }> = [
      { id: 'chase', label: 'Perseguição' },
      { id: 'cockpit', label: 'Cabine' },
      { id: 'orbit', label: 'Órbita Livre' },
    ];

    return (
      <div
        className="fixed bottom-3 sm:bottom-5 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center"
        style={{
          width: 'min(760px, 90vw)',
        }}
      >
        <section
          aria-label="Painel de Ajustes"
          className={`w-full max-h-[68vh] overflow-y-auto rounded-xl p-3 sm:p-4 transition-colors duration-150 ${
            isDraggingAny
              ? 'bg-[#090c16]/18 border border-white/10 shadow-none'
              : 'bg-[#090c16]/94 border border-white/15 shadow-2xl'
          }`}
        >
          {/* Dock Header: Tabs + Quick Action Buttons (fade when holding any slider) */}
          <div
            className={`flex flex-wrap items-center justify-between gap-2.5 pb-2.5 border-b border-white/10 transition-opacity duration-150 ${
              isDraggingAny ? 'opacity-15 pointer-events-none' : 'opacity-100'
            }`}
          >
            <div className="flex items-center gap-1 bg-slate-900/90 p-1 rounded-lg border border-white/5 overflow-x-auto">
              {(
                [
                  { id: 'flight', label: 'Nave' },
                  { id: 'planet', label: 'Planeta' },
                  { id: 'backdrop', label: 'Espaço' },
                  { id: 'camera', label: 'Câmera' },
                ] as Array<{ id: DockTab; label: string }>
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-2.5 sm:px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    activeTab === tab.id
                      ? 'bg-amber-500 text-slate-950 font-semibold'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <button
                type="button"
                onClick={onLaunchOrbit}
                className="px-2.5 py-1.5 text-xs font-medium text-sky-200 bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/40 rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
                title="Lançar nave para o espaço em órbita do planeta"
              >
                <Orbit className="w-3.5 h-3.5 text-sky-300" />
                <span>Ir para Órbita</span>
              </button>
              <button
                type="button"
                onClick={onLandSurface}
                className="px-2.5 py-1.5 text-xs font-medium text-emerald-200 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/35 rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
                title="Voltar para voo baixo na superfície do planeta"
              >
                <ArrowDownToLine className="w-3.5 h-3.5 text-emerald-300" />
                <span>Superfície</span>
              </button>
              <button
                type="button"
                onClick={onRelocateTarget}
                className="px-2.5 py-1.5 text-xs font-medium text-slate-100 bg-slate-800 hover:bg-slate-700 border border-white/10 rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
                title="Alternar alvo entre superfície, órbita e lua"
              >
                <Crosshair className="w-3.5 h-3.5 text-amber-400" />
                <span>Novo Alvo</span>
              </button>
              {confirmNewGame ? (
                <div className="flex items-center gap-1 bg-rose-500/15 border border-rose-400/45 rounded-md px-1.5 py-0.5">
                  <span className="text-[11px] font-medium text-rose-200 px-1">
                    Zerar progresso?
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmNewGame(false);
                      onNewGame();
                    }}
                    className="px-2 py-1 text-[11px] font-semibold bg-rose-500 hover:bg-rose-400 text-white rounded cursor-pointer"
                  >
                    Confirmar
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmNewGame(false)}
                    className="px-1.5 py-1 text-[11px] font-medium text-slate-300 hover:text-white cursor-pointer"
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmNewGame(true)}
                  className="px-2.5 py-1.5 text-xs font-medium text-rose-200 bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/35 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  title="Reiniciar créditos, inventário, combustível, casco e POIs"
                >
                  Novo jogo
                </button>
              )}
              <button
                type="button"
                onClick={onResetDefaults}
                className="px-2 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-900 border border-white/10 rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 cursor-pointer"
                title="Restaurar padrões"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={onCloseDock}
                className="px-2 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-900 border border-white/10 rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center cursor-pointer"
                aria-label="Fechar ajustes"
                title="Fechar"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Tab Body */}
          <div className="pt-3">
            {activeTab === 'flight' && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-4 items-end">
                <SliderRow
                  id="thrustForce"
                  label="Propulsão"
                  value={config.ship.thrustForce}
                  min={12}
                  max={90}
                  step={1}
                  activeSliderId={activeSliderId}
                  onStartDrag={onActiveSliderChange}
                  onChange={(v) =>
                    onUpdateConfig((prev) => ({
                      ...prev,
                      ship: { ...prev.ship, thrustForce: v },
                    }))
                  }
                />
                <SliderRow
                  id="rotationSpeed"
                  label="Vel. Rotação"
                  value={config.ship.rotationSpeed}
                  min={40}
                  max={220}
                  step={5}
                  unit="°/s"
                  activeSliderId={activeSliderId}
                  onStartDrag={onActiveSliderChange}
                  onChange={(v) =>
                    onUpdateConfig((prev) => ({
                      ...prev,
                      ship: { ...prev.ship, rotationSpeed: v },
                    }))
                  }
                />
                <SliderRow
                  id="maxSpeed"
                  label="Vel. Máxima"
                  value={config.ship.maxSpeed}
                  min={20}
                  max={140}
                  step={2}
                  unit=" m/s"
                  activeSliderId={activeSliderId}
                  onStartDrag={onActiveSliderChange}
                  onChange={(v) =>
                    onUpdateConfig((prev) => ({
                      ...prev,
                      ship: { ...prev.ship, maxSpeed: v },
                    }))
                  }
                />
                <SliderRow
                  id="drag"
                  label="Inércia / Drag"
                  value={config.ship.drag}
                  min={0.9}
                  max={0.996}
                  step={0.002}
                  decimals={3}
                  activeSliderId={activeSliderId}
                  onStartDrag={onActiveSliderChange}
                  onChange={(v) =>
                    onUpdateConfig((prev) => ({
                      ...prev,
                      ship: { ...prev.ship, drag: v },
                    }))
                  }
                />
                <button
                  type="button"
                  onClick={() =>
                    onUpdateConfig((prev) => ({
                      ...prev,
                      ship: {
                        ...prev.ship,
                        invertPitch: !prev.ship.invertPitch,
                      },
                    }))
                  }
                  className={`col-span-2 sm:col-span-1 px-2.5 py-2 text-xs font-medium rounded-md border transition-all whitespace-nowrap cursor-pointer ${
                    isDraggingAny ? 'opacity-15' : 'opacity-100'
                  } ${
                    config.ship.invertPitch
                      ? 'bg-amber-500/20 text-amber-300 border-amber-400/50'
                      : 'bg-slate-800 text-slate-300 border-white/10'
                  }`}
                >
                  {config.ship.invertPitch ? 'Pitch: Invertido' : 'Pitch: Normal'}
                </button>
              </div>
            )}

            {activeTab === 'planet' && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 items-end">
                <SliderRow
                  id="planetRadius"
                  label="Raio Planeta"
                  value={config.planet.planetRadius}
                  min={100}
                  max={700}
                  step={10}
                  unit="m"
                  activeSliderId={activeSliderId}
                  onStartDrag={onActiveSliderChange}
                  onChange={(v) =>
                    onUpdateConfig((prev) => ({
                      ...prev,
                      planet: { ...prev.planet, planetRadius: v },
                    }))
                  }
                />
                <SliderRow
                  id="maxHeight"
                  label="Altura Relevos"
                  value={config.planet.maxHeight}
                  min={2}
                  max={28}
                  step={1}
                  unit="m"
                  activeSliderId={activeSliderId}
                  onStartDrag={onActiveSliderChange}
                  onChange={(v) =>
                    onUpdateConfig((prev) => ({
                      ...prev,
                      planet: { ...prev.planet, maxHeight: v },
                    }))
                  }
                />
                <SliderRow
                  id="noiseScale"
                  label="Escala Ruído"
                  value={config.planet.noiseScale}
                  min={0.015}
                  max={0.1}
                  step={0.005}
                  decimals={3}
                  activeSliderId={activeSliderId}
                  onStartDrag={onActiveSliderChange}
                  onChange={(v) =>
                    onUpdateConfig((prev) => ({
                      ...prev,
                      planet: { ...prev.planet, noiseScale: v },
                    }))
                  }
                />
                <SliderRow
                  id="atmosphereHeight"
                  label="Atmosfera"
                  value={config.planet.atmosphereHeight}
                  min={25}
                  max={140}
                  step={5}
                  unit="m"
                  activeSliderId={activeSliderId}
                  onStartDrag={onActiveSliderChange}
                  onChange={(v) =>
                    onUpdateConfig((prev) => ({
                      ...prev,
                      planet: { ...prev.planet, atmosphereHeight: v },
                    }))
                  }
                />
                <SliderRow
                  id="seaLevel"
                  label="Nível do mar"
                  value={config.planet.seaLevel}
                  min={-0.6}
                  max={0.4}
                  step={0.01}
                  decimals={2}
                  activeSliderId={activeSliderId}
                  onStartDrag={onActiveSliderChange}
                  onChange={(v) =>
                    onUpdateConfig((prev) => ({
                      ...prev,
                      planet: { ...prev.planet, seaLevel: v },
                    }))
                  }
                />
                <SliderRow
                  id="floraDensity"
                  label="Densidade da flora"
                  value={config.flora.density}
                  min={0}
                  max={1.5}
                  step={0.05}
                  decimals={2}
                  activeSliderId={activeSliderId}
                  onStartDrag={onActiveSliderChange}
                  onChange={(v) =>
                    onUpdateConfig((prev) => ({
                      ...prev,
                      flora: { ...prev.flora, density: v },
                    }))
                  }
                />
                <div
                  className={`flex items-center gap-2 col-span-2 sm:col-span-3 transition-opacity duration-150 ${
                    isDraggingAny ? 'opacity-15' : 'opacity-100'
                  }`}
                >
                  <button
                    type="button"
                    role="switch"
                    aria-checked={config.flora.enabled}
                    onClick={() =>
                      onUpdateConfig((prev) => ({
                        ...prev,
                        flora: {
                          ...prev.flora,
                          enabled: !prev.flora.enabled,
                        },
                      }))
                    }
                    className={`flex-1 px-2.5 py-2 text-xs font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer flex items-center justify-center gap-2 ${
                      config.flora.enabled
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/50'
                        : 'bg-slate-800 text-slate-300 border-white/10'
                    }`}
                  >
                    <span>Flora</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateConfig((prev) => ({
                        ...prev,
                        planet: {
                          ...prev.planet,
                          showContours: !prev.planet.showContours,
                        },
                      }))
                    }
                    className={`flex-1 px-2.5 py-2 text-xs font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
                      config.planet.showContours
                        ? 'bg-sky-500/20 text-sky-300 border-sky-400/50'
                        : 'bg-slate-800 text-slate-300 border-white/10'
                    }`}
                  >
                    Contornos
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateConfig((prev) => ({
                        ...prev,
                        planet: {
                          ...prev.planet,
                          wireframe: !prev.planet.wireframe,
                        },
                      }))
                    }
                    className={`flex-1 px-2.5 py-2 text-xs font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
                      config.planet.wireframe
                        ? 'bg-amber-500/20 text-amber-300 border-amber-400/50'
                        : 'bg-slate-800 text-slate-300 border-white/10'
                    }`}
                  >
                    Malha
                  </button>
                </div>

                {/* Diagnóstico (não persistido) */}
                <div
                  className={`col-span-2 sm:col-span-3 pt-2 border-t border-white/10 transition-opacity duration-150 ${
                    isDraggingAny ? 'opacity-15 pointer-events-none' : 'opacity-100'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div className="text-[11px] font-medium text-slate-400">
                      Diagnóstico (reinicia ao recarregar)
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        disabled={benchmarkActive}
                        onClick={onTeleportNearestPoi}
                        className="px-2.5 py-1 text-[11px] font-semibold rounded-md border bg-cyan-500/20 text-cyan-200 border-cyan-400/45 hover:bg-cyan-500/30 disabled:opacity-40 transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5"
                      >
                        <LocateFixed className="w-3 h-3" />
                        <span>Teleportar ao POI mais próximo</span>
                      </button>
                      <button
                        type="button"
                        disabled={benchmarkActive}
                        onClick={onStartDescentBenchmark}
                        className="px-2.5 py-1 text-[11px] font-semibold rounded-md border bg-amber-500/20 text-amber-200 border-amber-400/45 hover:bg-amber-500/30 disabled:opacity-40 transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5"
                      >
                        <Play className="w-3 h-3" />
                        <span>Benchmark de descida</span>
                      </button>
                      <button
                        type="button"
                        disabled={benchmarkActive}
                        onClick={onStartBenchmark}
                        className="px-2.5 py-1 text-[11px] font-semibold rounded-md border bg-sky-500/20 text-sky-200 border-sky-400/45 hover:bg-sky-500/30 disabled:opacity-40 transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5"
                      >
                        <Play className="w-3 h-3" />
                        <span>Rodar benchmark</span>
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {(
                      [
                        { key: 'noReentryGlow', label: 'Brilho de reentrada desligado' },
                        { key: 'noReentryParticles', label: 'Sem partículas de reentrada' },
                        { key: 'noPois', label: 'Sem POIs' },
                        { key: 'noPoiHudMarkers', label: 'Sem marcadores de POI no HUD' },
                        { key: 'noPoiEffects', label: 'Sem fumaça/efeitos de POI' },
                        { key: 'noFuelHullBars', label: 'Sem barras de combustível e casco' },
                        { key: 'noAutosave', label: 'Sem salvar progresso' },
                        { key: 'simpleTerrain', label: 'Terreno simples' },
                        { key: 'noAtmosphere', label: 'Sem atmosfera' },
                        { key: 'noSpaceBackdrop', label: 'Sem estrelas e nebulosa' },
                        { key: 'noFlora', label: 'Sem flora' },
                        { key: 'hideShip', label: 'Esconder nave' },
                        { key: 'hideCharacter', label: 'Esconder personagem' },
                        { key: 'halfResolution', label: 'Resolução 0.5x' },
                        { key: 'noProceduralGrass', label: 'Sem grama procedural' },
                        { key: 'noContours', label: 'Sem contornos' },
                        { key: 'noPixelBiomeBlend', label: 'Sem mistura de bioma por pixel' },
                        { key: 'noReceiveShadow', label: 'Sem receber sombra' },
                        { key: 'noNoiseDetail', label: 'Sem detalhe de ruído' },
                        { key: 'terrainNoTexture', label: 'Terreno sem textura' },
                        { key: 'terrainNoLighting', label: 'Terreno sem luz/normal' },
                        { key: 'terrainNoSkyAtmo', label: 'Terreno sem sombra do ceu/atmosfera' },
                        { key: 'terrainFewerPatches', label: 'Terreno com menos patches' },
                        { key: 'showColliders', label: 'Mostrar colisores' },
                      ] as Array<{ key: keyof DiagnosticFlags; label: string }>
                    ).map((item) => {
                      const active = diagnostics[item.key];
                      return (
                        <button
                          key={item.key}
                          type="button"
                          role="switch"
                          aria-checked={active}
                          onClick={() => onToggleDiagnostic(item.key)}
                          className={`px-2.5 py-1.5 text-[11px] font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer flex items-center gap-2 ${
                            active
                              ? 'bg-amber-500/20 text-amber-300 border-amber-400/50'
                              : 'bg-slate-800/90 text-slate-300 border-white/10 hover:border-white/25'
                          }`}
                        >
                          <span
                            className={`inline-block w-2 h-2 rounded-full ${
                              active ? 'bg-amber-400' : 'bg-slate-500'
                            }`}
                          />
                          <span>{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2.5 pt-2 border-t border-white/10 flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-medium text-slate-400">
                      Testes rápidos (economia e nave):
                    </span>
                    <button
                      type="button"
                      onClick={onDebugAddCredits}
                      className="px-2.5 py-1 text-[11px] font-medium rounded-md border bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border-amber-400/35 transition-colors cursor-pointer"
                    >
                      +100 créditos
                    </button>
                    <button
                      type="button"
                      onClick={onDebugFillInventory}
                      className="px-2.5 py-1 text-[11px] font-medium rounded-md border bg-sky-500/15 hover:bg-sky-500/25 text-sky-200 border-sky-400/35 transition-colors cursor-pointer"
                    >
                      Encher inventário
                    </button>
                    <button
                      type="button"
                      onClick={onDebugDamageHull}
                      className="px-2.5 py-1 text-[11px] font-medium rounded-md border bg-rose-500/15 hover:bg-rose-500/25 text-rose-200 border-rose-400/35 transition-colors cursor-pointer"
                    >
                      Dano de 30 no casco
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'backdrop' && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                <SliderRow
                  id="starCount"
                  label="Estrelas"
                  value={config.backdrop.starCount}
                  min={200}
                  max={4500}
                  step={200}
                  activeSliderId={activeSliderId}
                  onStartDrag={onActiveSliderChange}
                  onChange={(v) =>
                    onUpdateConfig((prev) => ({
                      ...prev,
                      backdrop: { ...prev.backdrop, starCount: v },
                    }))
                  }
                />
                <SliderRow
                  id="maxStarSize"
                  label="Tam. Estrela"
                  value={config.backdrop.maxStarSize}
                  min={2}
                  max={8}
                  step={0.5}
                  decimals={1}
                  activeSliderId={activeSliderId}
                  onStartDrag={onActiveSliderChange}
                  onChange={(v) =>
                    onUpdateConfig((prev) => ({
                      ...prev,
                      backdrop: { ...prev.backdrop, maxStarSize: v },
                    }))
                  }
                />
                <SliderRow
                  id="nebulaOpacity"
                  label="Nebulosa"
                  value={config.backdrop.nebulaOpacity}
                  min={0}
                  max={1}
                  step={0.05}
                  decimals={2}
                  activeSliderId={activeSliderId}
                  onStartDrag={onActiveSliderChange}
                  onChange={(v) =>
                    onUpdateConfig((prev) => ({
                      ...prev,
                      backdrop: { ...prev.backdrop, nebulaOpacity: v },
                    }))
                  }
                />
                <SliderRow
                  id="indicatorMargin"
                  label="Margem Seta"
                  value={config.backdrop.indicatorMargin}
                  min={0.04}
                  max={0.22}
                  step={0.01}
                  decimals={2}
                  activeSliderId={activeSliderId}
                  onStartDrag={onActiveSliderChange}
                  onChange={(v) =>
                    onUpdateConfig((prev) => ({
                      ...prev,
                      backdrop: { ...prev.backdrop, indicatorMargin: v },
                    }))
                  }
                />
              </div>
            )}

            {activeTab === 'camera' && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {cameraModes.map((mode) => (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() =>
                          onUpdateConfig((prev) => ({
                            ...prev,
                            cameraMode: mode.id,
                          }))
                        }
                        className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          config.cameraMode === mode.id
                            ? 'bg-amber-500 text-slate-950 border-amber-400 font-semibold'
                            : 'bg-slate-800/90 text-slate-200 border-white/10 hover:border-white/25'
                        }`}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] text-slate-400">Astronauta:</span>
                    {(
                      [
                        { id: 'third', label: '3ª Pessoa (NMS)' },
                        { id: 'first', label: '1ª Pessoa' },
                      ] as Array<{ id: CharacterCameraMode; label: string }>
                    ).map((mode) => (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() =>
                          onUpdateConfig((prev) => ({
                            ...prev,
                            characterCamera: mode.id,
                          }))
                        }
                        className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          config.characterCamera === mode.id
                            ? 'bg-sky-500 text-slate-950 border-sky-300 font-semibold'
                            : 'bg-slate-800/90 text-slate-200 border-white/10 hover:border-white/25'
                        }`}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-slate-400">
                  {config.cameraMode === 'orbit'
                    ? 'Arraste para girar a câmera e use pinça/scroll para zoom.'
                    : 'Nave: W/S/A/D/E/Q · Espaço Turbo · T Alvo · L Pousar/Decolar · Astronauta: Arraste p/ olhar · WASD · X Jetpack · Z Inercial · V 1ª/3ª Pessoa.'}
                </p>
              </div>
            )}
          </div>

          {/* Footer: Qualidade automática + Mostrar FPS switches + performance telemetry */}
          <div
            className={`mt-3 pt-2.5 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs transition-opacity duration-150 ${
              isDraggingAny ? 'opacity-15 pointer-events-none' : 'opacity-100'
            }`}
          >
            <div className="flex flex-wrap items-center gap-4">
              <button
                type="button"
                role="switch"
                aria-checked={autoQuality}
                onClick={onToggleAutoQuality}
                className="flex items-center gap-2 text-slate-200 hover:text-white cursor-pointer"
              >
                <span
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
                    autoQuality
                      ? 'bg-emerald-500/85 border-emerald-300/70'
                      : 'bg-slate-800 border-white/15'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      autoQuality ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </span>
                <span className="font-medium">Qualidade automática</span>
              </button>

              <button
                type="button"
                role="switch"
                aria-checked={config.showFps}
                onClick={() =>
                  onUpdateConfig((prev) => ({
                    ...prev,
                    showFps: !prev.showFps,
                  }))
                }
                className="flex items-center gap-2 text-slate-200 hover:text-white cursor-pointer"
              >
                <span
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
                    config.showFps
                      ? 'bg-sky-500/85 border-sky-300/70'
                      : 'bg-slate-800 border-white/15'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      config.showFps ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </span>
                <span className="font-medium">Mostrar FPS</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono-tabular text-[11px] text-slate-300">
              <span className="text-slate-400">
                Flora:{' '}
                <strong className="text-slate-200 font-medium">
                  FPS {fps} · pior {worstFps} · CPU {cpuFrameMs.toFixed(1)} ms · {floraGroups} grupos · {floraInstances} inst · {renderCalls} draws (terreno {terrainDraws} · flora {floraDraws} · outros {otherDraws})
                </strong>
              </span>
              <span className="text-slate-400">
                outros:{' '}
                <strong className="text-slate-200 font-medium">
                  nave {otherBreakdown.nave} · alvo {otherBreakdown.alvo} · fundo {otherBreakdown.fundo} · atm/lua {otherBreakdown.atmLua} · fx {otherBreakdown.fx}
                </strong>
              </span>
              <span>
                Qualidade:{' '}
                <strong className="text-sky-300 font-medium">{qualityLevel}</strong>
              </span>
            </div>
          </div>
        </section>
      </div>
    );
  },
);

ControlDock.displayName = 'ControlDock';
