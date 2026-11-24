import { QualityLevel } from '../types/simulation';

export interface QualityPreset {
  level: QualityLevel;
  pixelRatio: number;
  starRatio: number;
  shadowsEnabled: boolean;
  particleRatio: number;
}

const STAR_RATIOS: Record<QualityLevel, number> = {
  0: 1.0,
  1: 1.0,
  2: 0.7,
  3: 0.4,
};

const PIXEL_RATIO_CAPS: Record<QualityLevel, number> = {
  0: 1.5,
  1: 1.0,
  2: 0.85,
  3: 0.7,
};

/**
 * Adaptive frame-time quality scaler with hysteresis:
 * - Level 0 (best) -> Level 3 (lightest)
 * - Ignores initial 3s warmup, dt > 0.2s hitches, hidden tabs, and slider drags
 * - Disabled on software WebGL renderers
 */
export class QualityScaler {
  private readonly isSoftwareGl: boolean;
  private readonly basePixelRatio: number;
  private readonly baseShadowsEnabled: boolean;
  private readonly onLevelApplied: (preset: QualityPreset) => void;

  private enabled = true;
  private sliderDragging = false;
  private level: QualityLevel = 0;

  private warmupElapsed = 0;
  private avgDt = 1 / 60;
  private hasSample = false;
  private lowFpsDuration = 0;
  private highFpsDuration = 0;
  private cooldownRemaining = 0;

  constructor(options: {
    isSoftwareGl: boolean;
    basePixelRatio: number;
    baseShadowsEnabled: boolean;
    onLevelApplied: (preset: QualityPreset) => void;
  }) {
    this.isSoftwareGl = options.isSoftwareGl;
    this.basePixelRatio = options.basePixelRatio;
    this.baseShadowsEnabled = options.baseShadowsEnabled;
    this.onLevelApplied = options.onLevelApplied;
  }

  public getLevel(): QualityLevel {
    return this.level;
  }

  public getCurrentPreset(): QualityPreset {
    return this.buildPreset(this.level);
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.lowFpsDuration = 0;
    this.highFpsDuration = 0;
    if (!enabled && this.level !== 0) {
      this.level = 0;
      this.cooldownRemaining = 0;
      this.onLevelApplied(this.buildPreset(0));
    }
  }

  public setSliderDragging(dragging: boolean): void {
    this.sliderDragging = dragging;
  }

  public update(rawDt: number, hidden: boolean): void {
    if (this.isSoftwareGl || !this.enabled || hidden) return;
    if (!Number.isFinite(rawDt) || rawDt <= 0 || rawDt > 0.2) return;

    if (this.warmupElapsed < 3.0) {
      this.warmupElapsed += rawDt;
      return;
    }

    this.cooldownRemaining = Math.max(0, this.cooldownRemaining - rawDt);

    // ~2s exponential moving average of frame time
    if (!this.hasSample) {
      this.avgDt = rawDt;
      this.hasSample = true;
    } else {
      const alpha = 1 - Math.exp(-rawDt / 2.0);
      this.avgDt += (rawDt - this.avgDt) * alpha;
    }

    if (this.sliderDragging) return;

    const avgFps = 1 / Math.max(this.avgDt, 0.0001);
    if (avgFps < 40) {
      this.lowFpsDuration += rawDt;
      this.highFpsDuration = 0;
    } else if (avgFps > 57) {
      this.highFpsDuration += rawDt;
      this.lowFpsDuration = 0;
    } else {
      this.lowFpsDuration = 0;
      this.highFpsDuration = 0;
    }

    if (this.cooldownRemaining > 0) return;

    if (this.lowFpsDuration >= 3.0 && this.level < 3) {
      this.setLevel((this.level + 1) as QualityLevel);
    } else if (this.highFpsDuration >= 10.0 && this.level > 0) {
      this.setLevel((this.level - 1) as QualityLevel);
    }
  }

  private setLevel(next: QualityLevel): void {
    if (this.level === next) return;
    this.level = next;
    this.lowFpsDuration = 0;
    this.highFpsDuration = 0;
    this.cooldownRemaining = 5.0;
    this.onLevelApplied(this.buildPreset(next));
  }

  private buildPreset(level: QualityLevel): QualityPreset {
    const pixelRatio =
      level === 0
        ? this.basePixelRatio
        : Math.min(this.basePixelRatio, PIXEL_RATIO_CAPS[level]);
    return {
      level,
      pixelRatio,
      starRatio: STAR_RATIOS[level],
      shadowsEnabled: this.baseShadowsEnabled && level < 2,
      particleRatio: level === 3 ? 0.5 : 1.0,
    };
  }
}
