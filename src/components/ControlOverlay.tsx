import React, { useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  Crosshair,
  LocateFixed,
  Maximize2,
  Minimize2,
  Orbit,
  RotateCcw,
  Settings,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  CameraMode,
  QualityLevel,
  SimulationConfig,
  TelemetrySnapshot,
} from '../types/simulation';

interface TelemetryHeaderProps {
  telemetry: TelemetrySnapshot;
  dockOpen: boolean;
  isFullscreen: boolean;
  isTouchDevice: boolean;
  targetLocked: boolean;
  isMuted: boolean;
  dimmed: boolean;
  onToggleDock: () => void;
  onToggleFullscreen: () => void;
  onToggleTargetLock: () => void;
  onToggleMute: () => void;
}

export const TelemetryHeader: React.FC<TelemetryHeaderProps> = React.memo(
  ({
    telemetry,
    dockOpen,
    isFullscreen,
    isTouchDevice,
    targetLocked,
    isMuted,
    dimmed,
    onToggleDock,
    onToggleFullscreen,
    onToggleTargetLock,
    onToggleMute,
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
      <div className="pointer-events-auto bg-[#090c16]/90 border border-white/10 rounded-lg px-3 py-1.5 sm:px-4 sm:py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="font-display text-xs sm:text-base font-semibold tracking-wide text-slate-100 whitespace-nowrap shrink-0">
          Aetheris Flight 3D
        </h1>
        <span className="hidden sm:inline text-slate-600" aria-hidden="true">
          |
        </span>
        <div className="flex flex-wrap items-center gap-x-2 sm:gap-x-2.5 gap-y-0.5 text-[11px] sm:text-xs text-slate-300 font-mono-tabular">
          <span>
            VEL{' '}
            <strong className="text-slate-100 font-medium">
              {telemetry.speed.toFixed(1)}
            </strong>{' '}
            m/s
          </span>
          <span className="text-slate-600" aria-hidden="true">
            ·
          </span>
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
          <span className="hidden sm:inline text-slate-600" aria-hidden="true">
            ·
          </span>
          <span className="hidden sm:inline">
            ALVO{' '}
            <strong className="text-amber-400 font-medium">
              {Math.round(telemetry.targetDistance)}m
            </strong>{' '}
            ({telemetry.targetZone === 'orbit'
              ? 'Órbita'
              : telemetry.targetZone === 'moon'
                ? 'Lua'
                : 'Solo'})
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

      {/* Top-Right: Travar Alvo (Desktop) + Tela Cheia + Engrenagem de Ajustes */}
      <div className="pointer-events-auto flex items-center gap-2">
        {!isTouchDevice && (
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
      </div>
    </header>
  ),
);

TelemetryHeader.displayName = 'TelemetryHeader';

interface ControlDockProps {
  config: SimulationConfig;
  dockOpen: boolean;
  activeSliderId: string | null;
  autoQuality: boolean;
  qualityLevel: QualityLevel;
  onActiveSliderChange: (id: string | null) => void;
  onToggleAutoQuality: () => void;
  onCloseDock: () => void;
  onUpdateConfig: (updater: (prev: SimulationConfig) => SimulationConfig) => void;
  onLandSurface: () => void;
  onLaunchOrbit: () => void;
  onRelocateTarget: () => void;
  onResetDefaults: () => void;
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
    dockOpen,
    activeSliderId,
    autoQuality,
    qualityLevel,
    onActiveSliderChange,
    onToggleAutoQuality,
    onCloseDock,
    onUpdateConfig,
    onLandSurface,
    onLaunchOrbit,
    onRelocateTarget,
    onResetDefaults,
  }) => {
    const [activeTab, setActiveTab] = useState<DockTab>('flight');

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
      { id: 'tactical', label: 'Tática' },
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
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-4 items-end">
                <SliderRow
                  id="planetRadius"
                  label="Raio Planeta"
                  value={config.planet.planetRadius}
                  min={100}
                  max={320}
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
                  max={24}
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
                  max={120}
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
                <div
                  className={`flex items-center gap-2 col-span-2 sm:col-span-1 transition-opacity duration-150 ${
                    isDraggingAny ? 'opacity-15' : 'opacity-100'
                  }`}
                >
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
                      className={`px-3.5 py-2 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        config.cameraMode === mode.id
                          ? 'bg-amber-500 text-slate-950 border-amber-400 font-semibold'
                          : 'bg-slate-800/90 text-slate-200 border-white/10 hover:border-white/25'
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-400">
                  {config.cameraMode === 'orbit'
                    ? 'Arraste para girar a câmera e use pinça/scroll para zoom.'
                    : 'Segure na tela para atirar · T Travar Alvo · W/S/A/D/E/Q Voar · Espaço Turbo.'}
                </p>
              </div>
            )}
          </div>

          {/* Footer: Qualidade automática switch + current quality level */}
          <div
            className={`mt-3 pt-2.5 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs transition-opacity duration-150 ${
              isDraggingAny ? 'opacity-15 pointer-events-none' : 'opacity-100'
            }`}
          >
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
            <span className="font-mono-tabular text-slate-300">
              Qualidade:{' '}
              <strong className="text-sky-300 font-medium">{qualityLevel}</strong>
            </span>
          </div>
        </section>
      </div>
    );
  },
);

ControlDock.displayName = 'ControlDock';
