import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import {
  BenchmarkProgress,
  BenchmarkStepResult,
  DescentBenchmarkRun,
  DescentBenchmarkSummary,
} from '../types/simulation';

interface BenchmarkOverlayProps {
  progress: BenchmarkProgress | null;
  results: BenchmarkStepResult[] | null;
  descentRuns: DescentBenchmarkRun[] | null;
  descentError: string | null;
  showDescentModal: boolean;
  onCancel: () => void;
  onCloseResults: () => void;
}

function formatSigned(val: number, decimals = 1): string {
  const rounded = Number(val.toFixed(decimals));
  if (Object.is(rounded, -0) || rounded === 0) {
    return (0).toFixed(decimals);
  }
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(decimals)}`;
}

function formatQualityState(level: number, paused: boolean): string {
  return `${level} (${paused ? 'Paus' : 'Auto'})`;
}

function formatSummaryQuality(s: DescentBenchmarkSummary): string {
  const lvl =
    s.qualityLevel === s.qualityLevelEnd
      ? `${s.qualityLevel}`
      : `${s.qualityLevel}->${s.qualityLevelEnd}`;
  return `${lvl} (${s.qualityPaused ? 'Paus' : 'Auto'})`;
}

function formatSummaryNumberRange(
  start: number,
  end: number,
  decimals = 2,
): string {
  const a = start.toFixed(decimals);
  const b = end.toFixed(decimals);
  return a === b ? a : `${a}->${b}`;
}

function formatSummaryCanvas(s: DescentBenchmarkSummary): string {
  const start = `${s.canvasWidth}x${s.canvasHeight}`;
  const end = `${s.canvasWidthEnd}x${s.canvasHeightEnd}`;
  return start === end ? start : `${start}->${end}`;
}

function formatSummaryBool(start: boolean, end: boolean, ascii = false): string {
  const yes = 'Sim';
  const no = ascii ? 'Nao' : 'Não';
  const a = start ? yes : no;
  const b = end ? yes : no;
  return a === b ? a : `${a}->${b}`;
}

function formatSummaryDescentScale(s: DescentBenchmarkSummary): string {
  const start = s.descentScaleStart.toFixed(2);
  const min = s.descentScaleMin.toFixed(2);
  const end = s.descentScaleEnd.toFixed(2);
  if (start === min && min === end) return start;
  if (min === end) return `${start}->${end}`;
  return `${start}->${min}->${end}`;
}

function buildPlainTextReport(results: BenchmarkStepResult[]): string {
  if (results.length === 0) return '';
  const base1 = results[0];
  const baseLast = results[results.length - 1];
  const lines: string[] = [
    `Benchmark de Desempenho (${results.length} passos)`,
    'Passo | FPS | Pior 1s | Travadas | Diff Base(1) | CPU (ms) | PoiUpd med/pior (ms) | PoiHUD med/pior (ms) | Save med/pior (ms) | Draws | Triangulos | Qualidade | dScale | PixelRatio | Canvas (px) | Sombras | FloraDens | FloraView',
  ];

  for (const r of results) {
    const diffStr =
      r.stepNumber === 1 ? '-' : formatSigned(r.avgFps - base1.avgFps, 1);
    lines.push(
      `${r.stepNumber}. ${r.label} | ${r.avgFps.toFixed(1)} | ${r.worstFps.toFixed(1)} | ${r.hitches} | ${diffStr} | ${r.avgCpuMs.toFixed(1)} | ${r.poiUpdateAvgMs.toFixed(2)}/${r.poiUpdateWorstMs.toFixed(2)} | ${r.poiHudAvgMs.toFixed(2)}/${r.poiHudWorstMs.toFixed(2)} | ${r.autosaveAvgMs.toFixed(2)}/${r.autosaveWorstMs.toFixed(2)} | ${r.drawCalls} | ${r.triangles} | ${formatQualityState(r.qualityLevel, r.qualityPaused)} | ${r.descentScale.toFixed(2)} | ${r.pixelRatio.toFixed(2)} | ${r.canvasWidth}x${r.canvasHeight} | ${r.shadowMapEnabled ? 'Sim' : 'Nao'} | ${r.floraDensityRatio.toFixed(2)} | ${r.floraViewRatio.toFixed(2)}`,
    );
  }

  if (baseLast && results.length >= 2) {
    const drift = baseLast.avgFps - base1.avgFps;
    lines.push('');
    lines.push(
      `Diferenca Base (1) vs Base (${baseLast.stepNumber}): ${base1.avgFps.toFixed(1)} -> ${baseLast.avgFps.toFixed(1)} FPS (${formatSigned(drift, 1)} FPS)`,
    );
  }

  return lines.join('\n');
}

function buildDescentPlainTextReport(runs: DescentBenchmarkRun[]): string {
  if (runs.length === 0) return '';
  const baseRun = runs[0];
  const lines: string[] = [
    `Resumo do Benchmark de Descida (${runs.length} execucoes apos aquecimento descartado)`,
    'Execucao | FPS med | Δ FPS | FPS min | Δ FPS min | FPS chao (5s) | Pior frame (ms) | Pior culpado | CPU med (ms) | Travadas | Δ Travadas | Reent max | Patches | Flora | Qualidade | descentScale | PixelRatio | Canvas (px) | Sombras | FloraDens | FloraView',
  ];

  for (const run of runs) {
    const sm = run.summary;
    const dAvg = run.id === 1 ? '-' : formatSigned(sm.avgFps - baseRun.summary.avgFps, 1);
    const dMin = run.id === 1 ? '-' : formatSigned(sm.minFps - baseRun.summary.minFps, 1);
    const dHitch =
      run.id === 1
        ? '-'
        : formatSigned(sm.totalHitches - baseRun.summary.totalHitches, 0);
    lines.push(
      `${run.id}. ${run.label} | ${sm.avgFps.toFixed(1)} | ${dAvg} | ${sm.minFps.toFixed(1)} | ${dMin} | ${sm.groundAvgFps.toFixed(1)} | ${sm.worstFrameMs.toFixed(1)} | ${sm.worstCulprit} | ${sm.avgCpuMs.toFixed(1)} | ${sm.totalHitches} | ${dHitch} | ${sm.peakReentry.toFixed(2)} | ${sm.totalPatchesBuilt} | ${sm.totalFloraCellsBuilt} | ${formatSummaryQuality(sm)} | ${formatSummaryDescentScale(sm)} | ${formatSummaryNumberRange(sm.pixelRatio, sm.pixelRatioEnd, 2)} | ${formatSummaryCanvas(sm)} | ${formatSummaryBool(sm.shadowMapEnabled, sm.shadowMapEnabledEnd, true)} | ${formatSummaryNumberRange(sm.floraDensityRatio, sm.floraDensityRatioEnd, 2)} | ${formatSummaryNumberRange(sm.floraViewRatio, sm.floraViewRatioEnd, 2)}`,
    );
  }
  lines.push('');

  for (const run of runs) {
    lines.push(
      `${run.id}. ${run.label} (Duracao: ${run.summary.durationSec.toFixed(1)}s | FPS chao 5s: ${run.summary.groundAvgFps.toFixed(1)})`,
    );
    lines.push(
      't (s) | Alt (m) | Vel (m/s) | ATM % | Reent | Brilho | Banner | Part.Reent | FPS | Pior ms | CPU ms | Culpado | Trav | Draws | Tris | Part | Patches | Flora | Qualidade | dScale | PixelRatio | Canvas (px) | Sombras | FloraDens | FloraView',
    );
    for (const s of run.samples) {
      lines.push(
        `${s.second.toFixed(1)} | ${s.altitude.toFixed(0)} | ${s.speed.toFixed(0)} | ${s.atmospherePct}% | ${s.reentryIntensity.toFixed(2)} | ${s.reentryGlowActive ? 'Sim' : 'Nao'} | ${s.reentryBannerActive ? 'Sim' : 'Nao'} | ${s.reentryParticlesActive ? 'Sim' : 'Nao'} | ${s.fps.toFixed(1)} | ${s.worstFrameMs.toFixed(1)} | ${s.cpuMs.toFixed(1)} | ${s.culprit} | ${s.hitches} | ${s.drawCalls} | ${s.triangles} | ${s.activeParticles} | ${s.terrainPatchesBuilt} | ${s.floraCellsBuilt} | ${formatQualityState(s.qualityLevel, s.qualityPaused)} | ${s.descentScale.toFixed(2)} | ${s.pixelRatio.toFixed(2)} | ${s.canvasWidth}x${s.canvasHeight} | ${s.shadowMapEnabled ? 'Sim' : 'Nao'} | ${s.floraDensityRatio.toFixed(2)} | ${s.floraViewRatio.toFixed(2)}`,
      );
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

export const BenchmarkOverlay: React.FC<BenchmarkOverlayProps> = React.memo(
  ({
    progress,
    results,
    descentRuns,
    descentError,
    showDescentModal,
    onCancel,
    onCloseResults,
  }) => {
    const [copyState, setCopyState] = useState<'idle' | 'copied' | 'manual'>(
      'idle',
    );
    const [showFallbackText, setShowFallbackText] = useState(false);
    const fallbackTextareaRef = useRef<HTMLTextAreaElement | null>(null);

    const isDescentView = Boolean(
      showDescentModal && descentRuns && descentRuns.length > 0,
    );

    const plainText = useMemo(() => {
      if (isDescentView && descentRuns) {
        return buildDescentPlainTextReport(descentRuns);
      }
      return results ? buildPlainTextReport(results) : '';
    }, [isDescentView, descentRuns, results]);

    useEffect(() => {
      setCopyState('idle');
      setShowFallbackText(false);
    }, [results, descentRuns, showDescentModal, descentError]);

    useEffect(() => {
      if (showFallbackText && fallbackTextareaRef.current) {
        fallbackTextareaRef.current.focus();
        fallbackTextareaRef.current.select();
      }
    }, [showFallbackText]);

    const handleCopy = async () => {
      if (!plainText) return;
      try {
        if (
          navigator.clipboard &&
          typeof navigator.clipboard.writeText === 'function'
        ) {
          await navigator.clipboard.writeText(plainText);
          setCopyState('copied');
          setShowFallbackText(false);
          return;
        }
      } catch {
        // Fallback to manual selection below
      }
      setShowFallbackText(true);
      setCopyState('manual');
      requestAnimationFrame(() => {
        if (fallbackTextareaRef.current) {
          fallbackTextareaRef.current.focus();
          fallbackTextareaRef.current.select();
        }
      });
    };

    if (progress?.active) {
      return (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 pointer-events-auto max-w-[94vw]">
          <div className="bg-[#090c16]/95 border border-amber-400/50 rounded-lg px-3 py-1.5 flex items-center gap-2.5 shadow-xl text-xs font-mono-tabular">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
            <span className="text-slate-100 truncate">
              {progress.kind === 'descent' ? (
                <>
                  Benchmark de descida {progress.stepIndex + 1}/
                  {progress.totalSteps} ·{' '}
                  <strong className="text-amber-300 font-semibold">
                    {progress.label}
                  </strong>{' '}
                  · ALT {Math.round(progress.altitude ?? 0)} m · não toque na tela
                </>
              ) : (
                <>
                  Benchmark {progress.stepIndex + 1}/{progress.totalSteps} ·{' '}
                  <strong className="text-amber-300 font-semibold">
                    {progress.label}
                  </strong>{' '}
                  · não toque na tela
                </>
              )}
            </span>
            <button
              type="button"
              onClick={onCancel}
              className="px-2 py-0.5 text-[11px] font-medium rounded border border-rose-400/50 bg-rose-500/20 text-rose-200 hover:bg-rose-500/35 transition-colors cursor-pointer shrink-0"
            >
              Cancelar
            </button>
          </div>
        </div>
      );
    }

    if (descentError) {
      return (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#05050d]/85 p-4 pointer-events-auto"
          role="dialog"
          aria-modal="true"
          aria-label="Erro no Benchmark de Descida"
        >
          <div className="w-full max-w-md bg-[#090c16] border border-rose-400/50 rounded-xl p-4 shadow-2xl text-slate-200">
            <h2 className="font-display text-sm sm:text-base font-semibold text-rose-300">
              Benchmark de Descida Abortado
            </h2>
            <p className="mt-2 text-xs sm:text-sm font-mono-tabular text-slate-100">
              {descentError}
            </p>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={onCloseResults}
                className="px-3 py-1.5 text-xs font-medium rounded-md border bg-slate-800 text-slate-200 border-white/15 hover:bg-slate-700 transition-colors cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (isDescentView && descentRuns && descentRuns.length > 0) {
      const baseRun = descentRuns[0];

      return (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#05050d]/85 p-3 sm:p-5 pointer-events-auto"
          role="dialog"
          aria-modal="true"
          aria-label="Resultados do Benchmark de Descida"
        >
          <div className="w-full max-w-[96vw] max-h-[90vh] flex flex-col bg-[#090c16] border border-white/15 rounded-xl p-3 sm:p-4 shadow-2xl text-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-white/10">
              <div>
                <h2 className="font-display text-sm sm:text-base font-semibold text-slate-100">
                  Benchmark de Descida · Comparação ({descentRuns.length} execuções)
                </h2>
                <p className="text-[11px] text-slate-400 font-mono-tabular">
                  Órbita fixa + espera de 2 s → descida controlada → 5 s parado a ~10 m sem reentrada · amostras a cada 0,5 s (após aquecimento descartado)
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="px-2.5 py-1.5 text-xs font-medium rounded-md border bg-sky-500/20 text-sky-200 border-sky-400/45 hover:bg-sky-500/30 transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  {copyState === 'copied' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-300" />
                      <span>Copiado</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copiar resultado</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={onCloseResults}
                  className="px-2.5 py-1.5 text-xs font-medium rounded-md border bg-slate-800 text-slate-200 border-white/15 hover:bg-slate-700 transition-colors cursor-pointer flex items-center gap-1"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Fechar</span>
                </button>
              </div>
            </div>

            <div className="mt-2.5 overflow-auto flex-1 space-y-4">
              {/* Summary Table */}
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-300 mb-1.5">
                  Resumo Comparativo
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse font-mono-tabular text-[11px] sm:text-xs bg-white/[0.02] rounded-lg overflow-hidden">
                    <thead>
                      <tr className="border-b border-white/15 text-slate-400">
                        <th className="py-1.5 px-2 font-medium whitespace-nowrap">
                          Execução
                        </th>
                        <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">
                          FPS médio
                        </th>
                        <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">
                          Δ FPS
                        </th>
                        <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">
                          FPS mín
                        </th>
                        <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">
                          Δ FPS mín
                        </th>
                        <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">
                          FPS chão (5s)
                        </th>
                        <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">
                          Pior frame
                        </th>
                        <th className="py-1.5 px-2 font-medium text-left whitespace-nowrap">
                          Culpado (pior)
                        </th>
                        <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">
                          CPU médio
                        </th>
                        <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">
                          Travadas
                        </th>
                        <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">
                          Δ Travadas
                        </th>
                        <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">
                          Reent máx
                        </th>
                        <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">
                          Patches
                        </th>
                        <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">
                          Flora
                        </th>
                        <th className="py-1.5 px-2 font-medium text-left whitespace-nowrap">
                          Qualidade
                        </th>
                        <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">
                          descentScale
                        </th>
                        <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">
                          PixelRatio
                        </th>
                        <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">
                          Canvas (px)
                        </th>
                        <th className="py-1.5 px-2 font-medium text-center whitespace-nowrap">
                          Sombras
                        </th>
                        <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">
                          FloraDens
                        </th>
                        <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">
                          FloraView
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {descentRuns.map((run) => {
                        const sm = run.summary;
                        const diff = sm.avgFps - baseRun.summary.avgFps;
                        const diffMin = sm.minFps - baseRun.summary.minFps;
                        const diffHitches =
                          sm.totalHitches - baseRun.summary.totalHitches;
                        return (
                          <tr
                            key={run.id}
                            className="border-b border-white/5 hover:bg-white/[0.03]"
                          >
                            <td className="py-1.5 px-2 text-slate-100 font-medium whitespace-nowrap">
                              {run.id}. {run.label}
                            </td>
                            <td className="py-1.5 px-2 text-right text-sky-300 font-semibold whitespace-nowrap">
                              {sm.avgFps.toFixed(1)}
                            </td>
                            <td
                              className={`py-1.5 px-2 text-right font-medium whitespace-nowrap ${
                                run.id === 1
                                  ? 'text-slate-500'
                                  : diff > 1
                                    ? 'text-emerald-300'
                                    : diff < -1
                                      ? 'text-rose-300'
                                      : 'text-slate-300'
                              }`}
                            >
                              {run.id === 1 ? '—' : formatSigned(diff, 1)}
                            </td>
                            <td className="py-1.5 px-2 text-right text-slate-200 whitespace-nowrap">
                              {sm.minFps.toFixed(1)}
                            </td>
                            <td
                              className={`py-1.5 px-2 text-right font-medium whitespace-nowrap ${
                                run.id === 1
                                  ? 'text-slate-500'
                                  : diffMin > 1
                                    ? 'text-emerald-300'
                                    : diffMin < -1
                                      ? 'text-rose-300'
                                      : 'text-slate-300'
                              }`}
                            >
                              {run.id === 1 ? '—' : formatSigned(diffMin, 1)}
                            </td>
                            <td
                              className={`py-1.5 px-2 text-right font-semibold whitespace-nowrap ${
                                sm.groundAvgFps >= 50
                                  ? 'text-emerald-300'
                                  : sm.groundAvgFps >= 35
                                    ? 'text-amber-300'
                                    : 'text-rose-300'
                              }`}
                            >
                              {sm.groundAvgFps.toFixed(1)}
                            </td>
                            <td
                              className={`py-1.5 px-2 text-right whitespace-nowrap ${
                                sm.worstFrameMs > 40
                                  ? 'text-rose-300 font-medium'
                                  : 'text-slate-200'
                              }`}
                            >
                              {sm.worstFrameMs.toFixed(1)} ms
                            </td>
                            <td
                              className={`py-1.5 px-2 text-left whitespace-nowrap ${
                                sm.worstFrameMs > 40
                                  ? 'text-rose-300 font-medium'
                                  : sm.worstFrameMs > 20
                                    ? 'text-amber-300'
                                    : 'text-slate-300'
                              }`}
                            >
                              {sm.worstCulprit}
                            </td>
                            <td className="py-1.5 px-2 text-right text-amber-300 whitespace-nowrap">
                              {sm.avgCpuMs.toFixed(1)} ms
                            </td>
                            <td
                              className={`py-1.5 px-2 text-right whitespace-nowrap ${
                                sm.totalHitches > 0
                                  ? 'text-rose-300 font-medium'
                                  : 'text-slate-400'
                              }`}
                            >
                              {sm.totalHitches}
                            </td>
                            <td
                              className={`py-1.5 px-2 text-right font-medium whitespace-nowrap ${
                                run.id === 1
                                  ? 'text-slate-500'
                                  : diffHitches < 0
                                    ? 'text-emerald-300'
                                    : diffHitches > 0
                                      ? 'text-rose-300'
                                      : 'text-slate-300'
                              }`}
                            >
                              {run.id === 1 ? '—' : formatSigned(diffHitches, 0)}
                            </td>
                            <td
                              className={`py-1.5 px-2 text-right whitespace-nowrap ${
                                sm.peakReentry > 0.3
                                  ? 'text-orange-300 font-semibold'
                                  : 'text-rose-300 font-semibold'
                              }`}
                            >
                              {sm.peakReentry.toFixed(2)}
                            </td>
                            <td className="py-1.5 px-2 text-right text-slate-300 whitespace-nowrap">
                              {sm.totalPatchesBuilt}
                            </td>
                            <td className="py-1.5 px-2 text-right text-slate-300 whitespace-nowrap">
                              {sm.totalFloraCellsBuilt}
                            </td>
                            <td className="py-1.5 px-2 text-left text-cyan-200 whitespace-nowrap">
                              {formatSummaryQuality(sm)}
                            </td>
                            <td className="py-1.5 px-2 text-right text-sky-200 whitespace-nowrap">
                              {formatSummaryDescentScale(sm)}
                            </td>
                            <td className="py-1.5 px-2 text-right text-slate-300 whitespace-nowrap">
                              {formatSummaryNumberRange(
                                sm.pixelRatio,
                                sm.pixelRatioEnd,
                                2,
                              )}
                            </td>
                            <td className="py-1.5 px-2 text-right text-slate-300 whitespace-nowrap">
                              {formatSummaryCanvas(sm)}
                            </td>
                            <td className="py-1.5 px-2 text-center text-slate-300 whitespace-nowrap">
                              {formatSummaryBool(
                                sm.shadowMapEnabled,
                                sm.shadowMapEnabledEnd,
                              )}
                            </td>
                            <td className="py-1.5 px-2 text-right text-slate-300 whitespace-nowrap">
                              {formatSummaryNumberRange(
                                sm.floraDensityRatio,
                                sm.floraDensityRatioEnd,
                                2,
                              )}
                            </td>
                            <td className="py-1.5 px-2 text-right text-slate-300 whitespace-nowrap">
                              {formatSummaryNumberRange(
                                sm.floraViewRatio,
                                sm.floraViewRatioEnd,
                                2,
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Per-0.5s tables stacked below */}
              {descentRuns.map((run) => (
                <div key={run.id} className="pt-2 border-t border-white/10">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                    <span className="text-xs font-semibold text-slate-100">
                      {run.id}. {run.label}
                    </span>
                    <span className="text-[11px] font-mono-tabular text-slate-400">
                      Duração {run.summary.durationSec.toFixed(1)}s · FPS chão (5s){' '}
                      {run.summary.groundAvgFps.toFixed(1)} · Reent máx{' '}
                      {run.summary.peakReentry.toFixed(2)}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse font-mono-tabular text-[11px]">
                      <thead>
                        <tr className="border-b border-white/15 text-slate-400">
                          <th className="py-1 pr-2 font-medium text-right whitespace-nowrap">
                            t (s)
                          </th>
                          <th className="py-1 px-1.5 font-medium text-right whitespace-nowrap">
                            Alt
                          </th>
                          <th className="py-1 px-1.5 font-medium text-right whitespace-nowrap">
                            Vel
                          </th>
                          <th className="py-1 px-1.5 font-medium text-right whitespace-nowrap">
                            ATM %
                          </th>
                          <th className="py-1 px-1.5 font-medium text-right whitespace-nowrap">
                            Reent
                          </th>
                          <th className="py-1 px-1.5 font-medium text-center whitespace-nowrap">
                            Brilho
                          </th>
                          <th className="py-1 px-1.5 font-medium text-center whitespace-nowrap">
                            Banner
                          </th>
                          <th className="py-1 px-1.5 font-medium text-center whitespace-nowrap">
                            Part.Reent
                          </th>
                          <th className="py-1 px-1.5 font-medium text-right whitespace-nowrap">
                            FPS
                          </th>
                          <th className="py-1 px-1.5 font-medium text-right whitespace-nowrap">
                            Pior ms
                          </th>
                          <th className="py-1 px-1.5 font-medium text-right whitespace-nowrap">
                            CPU ms
                          </th>
                          <th className="py-1 px-1.5 font-medium text-left whitespace-nowrap">
                            Culpado
                          </th>
                          <th className="py-1 px-1.5 font-medium text-right whitespace-nowrap">
                            Trav
                          </th>
                          <th className="py-1 px-1.5 font-medium text-right whitespace-nowrap">
                            Draws
                          </th>
                          <th className="py-1 px-1.5 font-medium text-right whitespace-nowrap">
                            Tris
                          </th>
                          <th className="py-1 px-1.5 font-medium text-right whitespace-nowrap">
                            Part
                          </th>
                          <th className="py-1 px-1.5 font-medium text-right whitespace-nowrap">
                            Patches
                          </th>
                          <th className="py-1 px-1.5 font-medium text-right whitespace-nowrap">
                            Flora
                          </th>
                          <th className="py-1 px-1.5 font-medium text-left whitespace-nowrap">
                            Qualidade
                          </th>
                          <th className="py-1 px-1.5 font-medium text-right whitespace-nowrap">
                            dScale
                          </th>
                          <th className="py-1 px-1.5 font-medium text-right whitespace-nowrap">
                            PR
                          </th>
                          <th className="py-1 px-1.5 font-medium text-right whitespace-nowrap">
                            Canvas
                          </th>
                          <th className="py-1 px-1.5 font-medium text-center whitespace-nowrap">
                            Sombras
                          </th>
                          <th className="py-1 px-1.5 font-medium text-right whitespace-nowrap">
                            FDens
                          </th>
                          <th className="py-1 pl-1.5 font-medium text-right whitespace-nowrap">
                            FView
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {run.samples.map((s) => (
                          <tr
                            key={s.second}
                            className="border-b border-white/5 hover:bg-white/[0.03]"
                          >
                            <td className="py-1 pr-2 text-right text-slate-400 whitespace-nowrap">
                              {s.second.toFixed(1)}
                            </td>
                            <td className="py-1 px-1.5 text-right text-slate-200 whitespace-nowrap">
                              {s.altitude.toFixed(0)} m
                            </td>
                            <td className="py-1 px-1.5 text-right text-slate-300 whitespace-nowrap">
                              {s.speed.toFixed(0)}
                            </td>
                            <td className="py-1 px-1.5 text-right text-sky-300 whitespace-nowrap">
                              {s.atmospherePct}%
                            </td>
                            <td
                              className={`py-1 px-1.5 text-right whitespace-nowrap ${
                                s.reentryIntensity > 0.3
                                  ? 'text-orange-300 font-semibold'
                                  : 'text-slate-400'
                              }`}
                            >
                              {s.reentryIntensity.toFixed(2)}
                            </td>
                            <td
                              className={`py-1 px-1.5 text-center whitespace-nowrap ${
                                s.reentryGlowActive
                                  ? 'text-orange-300'
                                  : 'text-slate-500'
                              }`}
                            >
                              {s.reentryGlowActive ? 'Sim' : 'Não'}
                            </td>
                            <td
                              className={`py-1 px-1.5 text-center whitespace-nowrap ${
                                s.reentryBannerActive
                                  ? 'text-amber-300'
                                  : 'text-slate-500'
                              }`}
                            >
                              {s.reentryBannerActive ? 'Sim' : 'Não'}
                            </td>
                            <td
                              className={`py-1 px-1.5 text-center whitespace-nowrap ${
                                s.reentryParticlesActive
                                  ? 'text-fuchsia-300'
                                  : 'text-slate-500'
                              }`}
                            >
                              {s.reentryParticlesActive ? 'Sim' : 'Não'}
                            </td>
                            <td
                              className={`py-1 px-1.5 text-right font-medium whitespace-nowrap ${
                                s.fps >= 50
                                  ? 'text-emerald-300'
                                  : s.fps >= 35
                                    ? 'text-amber-300'
                                    : 'text-rose-300'
                              }`}
                            >
                              {s.fps.toFixed(1)}
                            </td>
                            <td
                              className={`py-1 px-1.5 text-right whitespace-nowrap ${
                                s.worstFrameMs > 40
                                  ? 'text-rose-300 font-medium'
                                  : 'text-slate-300'
                              }`}
                            >
                              {s.worstFrameMs.toFixed(1)}
                            </td>
                            <td className="py-1 px-1.5 text-right text-amber-300 whitespace-nowrap">
                              {s.cpuMs.toFixed(1)}
                            </td>
                            <td
                              title={s.worstFrameSubsystems}
                              className={`py-1 px-1.5 text-left whitespace-nowrap ${
                                s.worstFrameMs > 40
                                  ? 'text-rose-300 font-medium'
                                  : s.worstFrameMs > 20
                                    ? 'text-amber-300'
                                    : 'text-slate-300'
                              }`}
                            >
                              {s.culprit}
                            </td>
                            <td
                              className={`py-1 px-1.5 text-right whitespace-nowrap ${
                                s.hitches > 0
                                  ? 'text-rose-300 font-medium'
                                  : 'text-slate-400'
                              }`}
                            >
                              {s.hitches}
                            </td>
                            <td className="py-1 px-1.5 text-right text-slate-300 whitespace-nowrap">
                              {s.drawCalls}
                            </td>
                            <td className="py-1 px-1.5 text-right text-slate-300 whitespace-nowrap">
                              {s.triangles}
                            </td>
                            <td className="py-1 px-1.5 text-right text-slate-300 whitespace-nowrap">
                              {s.activeParticles}
                            </td>
                            <td className="py-1 px-1.5 text-right text-slate-300 whitespace-nowrap">
                              {s.terrainPatchesBuilt}
                            </td>
                            <td className="py-1 px-1.5 text-right text-slate-300 whitespace-nowrap">
                              {s.floraCellsBuilt}
                            </td>
                            <td className="py-1 px-1.5 text-left text-cyan-200 whitespace-nowrap">
                              {formatQualityState(s.qualityLevel, s.qualityPaused)}
                            </td>
                            <td className="py-1 px-1.5 text-right text-sky-200 whitespace-nowrap">
                              {s.descentScale.toFixed(2)}
                            </td>
                            <td className="py-1 px-1.5 text-right text-slate-300 whitespace-nowrap">
                              {s.pixelRatio.toFixed(2)}
                            </td>
                            <td className="py-1 px-1.5 text-right text-slate-300 whitespace-nowrap">
                              {s.canvasWidth}x{s.canvasHeight}
                            </td>
                            <td className="py-1 px-1.5 text-center text-slate-300 whitespace-nowrap">
                              {s.shadowMapEnabled ? 'Sim' : 'Não'}
                            </td>
                            <td className="py-1 px-1.5 text-right text-slate-300 whitespace-nowrap">
                              {s.floraDensityRatio.toFixed(2)}
                            </td>
                            <td className="py-1 pl-1.5 text-right text-slate-300 whitespace-nowrap">
                              {s.floraViewRatio.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>

            {showFallbackText && (
              <div className="mt-2.5 pt-2.5 border-t border-white/10">
                <div className="text-[11px] text-amber-300 mb-1">
                  Cópia automática indisponível — texto selecionado para copiar manualmente:
                </div>
                <textarea
                  ref={fallbackTextareaRef}
                  readOnly
                  value={plainText}
                  rows={5}
                  onFocus={(e) => e.currentTarget.select()}
                  className="w-full rounded-md bg-slate-950 border border-white/15 p-2 text-[11px] font-mono-tabular text-slate-200 focus:outline-none focus:border-sky-400"
                />
              </div>
            )}
          </div>
        </div>
      );
    }

    if (!results || results.length === 0) {
      return null;
    }

    const base1 = results[0];
    const baseLast = results[results.length - 1];
    const driftFps = baseLast.avgFps - base1.avgFps;

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-[#05050d]/85 p-3 sm:p-5 pointer-events-auto"
        role="dialog"
        aria-modal="true"
        aria-label="Resultados do Benchmark"
      >
        <div className="w-full max-w-[96vw] max-h-[88vh] flex flex-col bg-[#090c16] border border-white/15 rounded-xl p-3 sm:p-4 shadow-2xl text-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-white/10">
            <div>
              <h2 className="font-display text-sm sm:text-base font-semibold text-slate-100">
                Resultado do Benchmark
              </h2>
              <p className="text-[11px] text-slate-400 font-mono-tabular">
                Base (1) → Base ({baseLast.stepNumber}): {base1.avgFps.toFixed(1)} FPS →{' '}
                {baseLast.avgFps.toFixed(1)} FPS (
                <span
                  className={
                    driftFps < -2
                      ? 'text-rose-300'
                      : driftFps > 2
                        ? 'text-emerald-300'
                        : 'text-slate-200'
                  }
                >
                  {formatSigned(driftFps, 1)} FPS
                </span>
                )
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopy}
                className="px-2.5 py-1.5 text-xs font-medium rounded-md border bg-sky-500/20 text-sky-200 border-sky-400/45 hover:bg-sky-500/30 transition-colors cursor-pointer flex items-center gap-1.5"
              >
                {copyState === 'copied' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-300" />
                    <span>Copiado</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copiar resultado</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={onCloseResults}
                className="px-2.5 py-1.5 text-xs font-medium rounded-md border bg-slate-800 text-slate-200 border-white/15 hover:bg-slate-700 transition-colors cursor-pointer flex items-center gap-1"
              >
                <X className="w-3.5 h-3.5" />
                <span>Fechar</span>
              </button>
            </div>
          </div>

          <div className="mt-2.5 overflow-auto flex-1">
            <table className="w-full text-left border-collapse font-mono-tabular text-[11px] sm:text-xs">
              <thead>
                <tr className="border-b border-white/15 text-slate-400">
                  <th className="py-1.5 pr-2 font-medium whitespace-nowrap">
                    Passo
                  </th>
                  <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">
                    FPS
                  </th>
                  <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">
                    Pior 1s
                  </th>
                  <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">
                    Travadas
                  </th>
                  <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">
                    Δ Base(1)
                  </th>
                  <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">
                    CPU (ms)
                  </th>
                  <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">
                    PoiUpd (méd/pior)
                  </th>
                  <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">
                    PoiHUD (méd/pior)
                  </th>
                  <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">
                    Save (méd/pior)
                  </th>
                  <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">
                    Draws
                  </th>
                  <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">
                    Tris
                  </th>
                  <th className="py-1.5 px-2 font-medium text-left whitespace-nowrap">
                    Qualidade
                  </th>
                  <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">
                    dScale
                  </th>
                  <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">
                    PixelRatio
                  </th>
                  <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">
                    Canvas (px)
                  </th>
                  <th className="py-1.5 px-2 font-medium text-center whitespace-nowrap">
                    Sombras
                  </th>
                  <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">
                    FloraDens
                  </th>
                  <th className="py-1.5 pl-2 font-medium text-right whitespace-nowrap">
                    FloraView
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => {
                  const diff = r.avgFps - base1.avgFps;
                  const diffColor =
                    r.stepNumber === 1
                      ? 'text-slate-500'
                      : diff > 1
                        ? 'text-emerald-300'
                        : diff < -1
                          ? 'text-rose-300'
                          : 'text-slate-300';
                  return (
                    <tr
                      key={r.stepNumber}
                      className="border-b border-white/5 hover:bg-white/[0.03]"
                    >
                      <td className="py-1.5 pr-2 text-slate-100 whitespace-nowrap">
                        {r.stepNumber}. {r.label}
                      </td>
                      <td className="py-1.5 px-2 text-right text-sky-300 font-medium whitespace-nowrap">
                        {r.avgFps.toFixed(1)}
                      </td>
                      <td className="py-1.5 px-2 text-right text-slate-300 whitespace-nowrap">
                        {r.worstFps.toFixed(1)}
                      </td>
                      <td
                        className={`py-1.5 px-2 text-right font-medium whitespace-nowrap ${
                          r.hitches > 0 ? 'text-rose-300' : 'text-slate-400'
                        }`}
                      >
                        {r.hitches}
                      </td>
                      <td
                        className={`py-1.5 px-2 text-right font-medium whitespace-nowrap ${diffColor}`}
                      >
                        {r.stepNumber === 1 ? '—' : formatSigned(diff, 1)}
                      </td>
                      <td className="py-1.5 px-2 text-right text-amber-300 whitespace-nowrap">
                        {r.avgCpuMs.toFixed(1)}
                      </td>
                      <td className="py-1.5 px-2 text-right text-cyan-200 whitespace-nowrap">
                        {r.poiUpdateAvgMs.toFixed(2)}/{r.poiUpdateWorstMs.toFixed(2)}
                      </td>
                      <td className="py-1.5 px-2 text-right text-cyan-200 whitespace-nowrap">
                        {r.poiHudAvgMs.toFixed(2)}/{r.poiHudWorstMs.toFixed(2)}
                      </td>
                      <td className="py-1.5 px-2 text-right text-cyan-200 whitespace-nowrap">
                        {r.autosaveAvgMs.toFixed(2)}/{r.autosaveWorstMs.toFixed(2)}
                      </td>
                      <td className="py-1.5 px-2 text-right text-slate-300 whitespace-nowrap">
                        {r.drawCalls}
                      </td>
                      <td className="py-1.5 px-2 text-right text-slate-300 whitespace-nowrap">
                        {r.triangles}
                      </td>
                      <td className="py-1.5 px-2 text-left text-cyan-200 whitespace-nowrap">
                        {formatQualityState(r.qualityLevel, r.qualityPaused)}
                      </td>
                      <td className="py-1.5 px-2 text-right text-sky-200 whitespace-nowrap">
                        {r.descentScale.toFixed(2)}
                      </td>
                      <td className="py-1.5 px-2 text-right text-slate-300 whitespace-nowrap">
                        {r.pixelRatio.toFixed(2)}
                      </td>
                      <td className="py-1.5 px-2 text-right text-slate-300 whitespace-nowrap">
                        {r.canvasWidth}x{r.canvasHeight}
                      </td>
                      <td className="py-1.5 px-2 text-center text-slate-300 whitespace-nowrap">
                        {r.shadowMapEnabled ? 'Sim' : 'Não'}
                      </td>
                      <td className="py-1.5 px-2 text-right text-slate-300 whitespace-nowrap">
                        {r.floraDensityRatio.toFixed(2)}
                      </td>
                      <td className="py-1.5 pl-2 text-right text-slate-300 whitespace-nowrap">
                        {r.floraViewRatio.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {showFallbackText && (
            <div className="mt-2.5 pt-2.5 border-t border-white/10">
              <div className="text-[11px] text-amber-300 mb-1">
                Cópia automática indisponível — texto selecionado para copiar manualmente:
              </div>
              <textarea
                ref={fallbackTextareaRef}
                readOnly
                value={plainText}
                rows={5}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full rounded-md bg-slate-950 border border-white/15 p-2 text-[11px] font-mono-tabular text-slate-200 focus:outline-none focus:border-sky-400"
              />
            </div>
          )}
        </div>
      </div>
    );
  },
);

BenchmarkOverlay.displayName = 'BenchmarkOverlay';
