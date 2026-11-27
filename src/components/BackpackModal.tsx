import React from 'react';
import {
  Backpack,
  Coins,
  Fuel,
  Shield,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import {
  CRYSTAL_FUEL_REFILL,
  CURRENCY_NAME,
  RESOURCE_ORDER,
  RESOURCES,
  ResourceId,
  SCRAP_HULL_REPAIR,
} from '../engine/economy';
import { PlayerStateSnapshot } from '../engine/playerState';
import { LandingState, PlayerMode } from '../types/simulation';

interface BackpackModalProps {
  open: boolean;
  player: PlayerStateSnapshot;
  playerMode: PlayerMode;
  landingState: LandingState;
  onClose: () => void;
  onSellResource: (id: ResourceId, amount?: number) => void;
  onSellAll: () => void;
  onUseCrystal: () => void;
  onRepairHull: () => void;
}

export const BackpackModal: React.FC<BackpackModalProps> = React.memo(
  ({
    open,
    player,
    playerMode,
    landingState,
    onClose,
    onSellResource,
    onSellAll,
    onUseCrystal,
    onRepairHull,
  }) => {
    if (!open) return null;

    const totalSellValue = RESOURCE_ORDER.reduce(
      (sum, id) => sum + player.inventory[id] * RESOURCES[id].baseValue,
      0,
    );
    const fuelPct = Math.round(
      Math.min(100, Math.max(0, (player.fuel / player.maxFuel) * 100)),
    );
    const hullPct = Math.round(
      Math.min(100, Math.max(0, (player.hull / player.maxHull) * 100)),
    );
    const capacityPct = Math.round(
      Math.min(
        100,
        Math.max(0, (player.inventoryCount / player.inventoryCapacity) * 100),
      ),
    );

    const canRefuelContext =
      playerMode === 'ship' || landingState === 'landed';
    const canUseCrystal =
      canRefuelContext &&
      player.inventory.crystal > 0 &&
      player.fuel < player.maxFuel - 0.01;
    const canRepairHull =
      player.inventory.scrap > 0 && player.hull < player.maxHull - 0.01;

    return (
      <div
        className="fixed inset-0 z-40 flex items-center justify-center bg-[#05050d]/85 p-3 sm:p-5"
        role="dialog"
        aria-modal="true"
        aria-label="Mochila e Carga da Nave"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="w-full max-w-lg max-h-[88dvh] overflow-y-auto bg-[#090c16] border border-white/15 rounded-xl p-4 sm:p-5 shadow-2xl text-slate-100">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 pb-3 border-b border-white/10">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-amber-500/15 border border-amber-400/35 flex items-center justify-center text-amber-300">
                <Backpack className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-display text-sm sm:text-base font-semibold text-slate-100 leading-tight">
                  Mochila &amp; Carga
                </h2>
                <p className="text-[11px] text-slate-400 font-mono-tabular">
                  {player.inventoryCount} / {player.inventoryCapacity} itens armazenados
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="px-2.5 py-1 rounded-lg bg-slate-900 border border-amber-400/30 flex items-center gap-1.5 text-xs font-mono-tabular">
                <Coins className="w-3.5 h-3.5 text-amber-400" />
                <span className="font-semibold text-amber-300">
                  {player.credits}
                </span>
                <span className="text-slate-400 text-[11px]">
                  {CURRENCY_NAME}
                </span>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-8 h-8 rounded-lg bg-slate-900 hover:bg-slate-800 border border-white/10 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                aria-label="Fechar mochila"
                title="Fechar (B)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Capacity progress bar */}
          <div className="mt-3">
            <div className="flex items-center justify-between text-[11px] font-mono-tabular text-slate-400 mb-1">
              <span>Capacidade da mochila</span>
              <span
                className={
                  player.inventoryCount >= player.inventoryCapacity
                    ? 'text-amber-300 font-semibold'
                    : 'text-slate-300'
                }
              >
                {player.inventoryCount}/{player.inventoryCapacity}
              </span>
            </div>
            <div className="w-full h-2 rounded-sm bg-slate-800 overflow-hidden">
              <div
                className={`h-full transition-[width] duration-150 ${
                  player.inventoryCount >= player.inventoryCapacity
                    ? 'bg-amber-400'
                    : 'bg-sky-400'
                }`}
                style={{ width: `${capacityPct}%` }}
              />
            </div>
          </div>

          {/* Ship Fuel & Hull Maintenance */}
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="bg-slate-900/80 border border-white/10 rounded-lg p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-medium text-slate-200">
                  <Fuel className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Combustível</span>
                </span>
                <span className="font-mono-tabular text-cyan-300 font-semibold">
                  {fuelPct}%
                  {player.reserveMode && (
                    <span className="ml-1 text-[10px] text-rose-400">
                      RESERVA
                    </span>
                  )}
                </span>
              </div>
              <div className="w-full h-2 rounded-sm bg-slate-800 overflow-hidden">
                <div
                  className={`h-full ${
                    player.reserveMode
                      ? 'bg-rose-500'
                      : fuelPct < 25
                        ? 'bg-amber-400'
                        : 'bg-cyan-400'
                  }`}
                  style={{ width: `${fuelPct}%` }}
                />
              </div>
              <button
                type="button"
                disabled={!canUseCrystal}
                onClick={onUseCrystal}
                className="w-full px-2.5 py-1.5 text-[11px] font-medium rounded-md border bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 border-cyan-400/35 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                title={
                  canRefuelContext
                    ? 'Consumir 1 Cristal Etéreo para recarregar combustível'
                    : 'Disponível na nave ou com a nave pousada'
                }
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Usar cristal (+{CRYSTAL_FUEL_REFILL})</span>
              </button>
            </div>

            <div className="bg-slate-900/80 border border-white/10 rounded-lg p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-medium text-slate-200">
                  <Shield className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Casco da Nave</span>
                </span>
                <span className="font-mono-tabular text-emerald-300 font-semibold">
                  {hullPct}%
                </span>
              </div>
              <div className="w-full h-2 rounded-sm bg-slate-800 overflow-hidden">
                <div
                  className={`h-full ${
                    hullPct < 35
                      ? 'bg-rose-500'
                      : hullPct < 65
                        ? 'bg-amber-400'
                        : 'bg-emerald-400'
                  }`}
                  style={{ width: `${hullPct}%` }}
                />
              </div>
              <button
                type="button"
                disabled={!canRepairHull}
                onClick={onRepairHull}
                className="w-full px-2.5 py-1.5 text-[11px] font-medium rounded-md border bg-orange-500/15 hover:bg-orange-500/25 text-orange-200 border-orange-400/35 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                title="Consumir 1 Sucata Metálica para reparar o casco"
              >
                <Wrench className="w-3.5 h-3.5" />
                <span>Reparar casco (+{SCRAP_HULL_REPAIR})</span>
              </button>
            </div>
          </div>

          {/* Resource Rows */}
          <div className="mt-4 flex flex-col gap-2">
            {RESOURCE_ORDER.map((id) => {
              const def = RESOURCES[id];
              const count = player.inventory[id];
              const stackValue = count * def.baseValue;
              return (
                <div
                  key={id}
                  className="bg-slate-900/65 border border-white/10 rounded-lg px-3 py-2.5 flex flex-wrap items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="w-3 h-3 rounded-sm shrink-0 border border-white/20"
                      style={{ backgroundColor: def.color }}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs sm:text-sm font-medium text-slate-100 truncate">
                          {def.name}
                        </span>
                        <span className="text-[11px] font-mono-tabular text-slate-400">
                          {def.baseValue} cr/un
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 truncate max-w-[260px]">
                        {def.description}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="px-2 py-0.5 rounded bg-slate-950 border border-white/10 text-xs font-mono-tabular text-slate-100 min-w-[34px] text-center">
                      {count}
                    </span>
                    <button
                      type="button"
                      disabled={count <= 0}
                      onClick={() => onSellResource(id, 1)}
                      className="px-2 py-1 text-[11px] font-medium rounded-md border bg-slate-800 hover:bg-slate-700 text-slate-200 border-white/10 disabled:opacity-35 disabled:cursor-not-allowed transition-colors cursor-pointer"
                    >
                      Vender 1
                    </button>
                    <button
                      type="button"
                      disabled={count <= 0}
                      onClick={() => onSellResource(id)}
                      className="px-2 py-1 text-[11px] font-medium rounded-md border bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border-amber-400/35 disabled:opacity-35 disabled:cursor-not-allowed transition-colors font-mono-tabular cursor-pointer"
                    >
                      +{stackValue}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between gap-3">
            <span className="text-xs text-slate-400 font-mono-tabular">
              Valor da carga:{' '}
              <strong className="text-amber-300 font-semibold">
                {totalSellValue} {CURRENCY_NAME}
              </strong>
            </span>
            <button
              type="button"
              disabled={player.inventoryCount <= 0}
              onClick={onSellAll}
              className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Coins className="w-3.5 h-3.5" />
              <span>Vender tudo (+{totalSellValue})</span>
            </button>
          </div>
        </div>
      </div>
    );
  },
);

BackpackModal.displayName = 'BackpackModal';
