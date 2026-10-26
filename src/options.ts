import type { DataPoint, LiquidGraphOptions, ResolvedOptions } from './types';

export function normalizeData(data: readonly DataPoint[]): DataPoint[] {
  const result = data.map((point) => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new TypeError('liquid-graph: data coordinates must be finite numbers.');
    }
    return { ...point };
  }).sort((a, b) => a.x - b.x);
  for (let i = 1; i < result.length; i++) {
    if (result[i]!.x === result[i - 1]!.x) {
      throw new RangeError('liquid-graph: x coordinates must be unique.');
    }
  }
  return result;
}

export function resolveOptions(input: LiquidGraphOptions): ResolvedOptions {
  const result: ResolvedOptions = {
    data: normalizeData(input.data), color: input.color ?? '#75d5f1',
    particleCount: input.particleCount ?? 2400, particleRadius: input.particleRadius ?? 1.15,
    capHeight: input.capHeight ?? 12, falloffHeight: input.falloffHeight ?? 110,
    springStrength: input.springStrength ?? 95, damping: input.damping ?? 12,
    hoverRadius: input.hoverRadius ?? 48, hoverStrength: input.hoverStrength ?? 1800,
    turbulence: input.turbulence ?? 0.65,
    padding: { top: 25, right: 24, bottom: 42, left: 58, ...input.padding },
    xDomain: input.xDomain ?? null, yDomain: input.yDomain ?? null,
    grid: input.grid ?? true, labels: input.labels ?? true,
    gridColor: input.gridColor ?? 'rgba(160, 170, 175, 0.16)',
    textColor: input.textColor ?? '#7f8b8f',
    font: input.font ?? '11px ui-monospace, SFMono-Regular, monospace',
    formatX: input.formatX ?? ((value) => String(Math.round(value * 100) / 100)),
    formatY: input.formatY ?? ((value) => Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)),
    label: input.label ?? 'Interactive particle graph', reducedMotion: input.reducedMotion ?? 'auto',
    seed: input.seed ?? 42, onHover: input.onHover, onTransitionEnd: input.onTransitionEnd,
  };
  const positive = ['particleRadius', 'springStrength', 'damping'] as const;
  const nonnegative = ['capHeight', 'falloffHeight', 'hoverRadius', 'hoverStrength', 'turbulence'] as const;
  for (const key of [...positive, ...nonnegative]) {
    if (!Number.isFinite(result[key]) || result[key] < 0 || (positive.includes(key as typeof positive[number]) && result[key] === 0)) {
      throw new RangeError(`liquid-graph: invalid ${key}.`);
    }
  }
  if (!Number.isInteger(result.particleCount) || result.particleCount < 0 || result.particleCount > 20000) {
    throw new RangeError('liquid-graph: particleCount must be an integer between 0 and 20000.');
  }
  if (!Number.isFinite(result.seed)) throw new RangeError('liquid-graph: seed must be finite.');
  for (const value of Object.values(result.padding)) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError('liquid-graph: padding must be finite and nonnegative.');
  }
  for (const domain of [result.xDomain, result.yDomain]) {
    if (domain && (!domain.every(Number.isFinite) || domain[0] >= domain[1])) {
      throw new RangeError('liquid-graph: domains must contain two finite, increasing numbers.');
    }
  }
  return result;
}
