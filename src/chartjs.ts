import type { Chart, ChartType, Plugin, PointElement } from 'chart.js';
import { generateTargets } from './layout';
import type { Layout } from './layout';
import { resolveOptions } from './options';
import { matchParticles, stepParticles } from './physics';
import type { Particle, Pointer } from './physics';
import { drawParticles } from './render';
import type { LiquidGraphOptions, ResolvedOptions } from './types';

/** Particle styling/physics; Chart.js owns the data, scales, legend, and tooltip. */
export type LiquidGraphPluginOptions = Pick<LiquidGraphOptions,
  'color' | 'particleCount' | 'particleRadius' | 'capHeight' | 'falloffHeight' |
  'springStrength' | 'damping' | 'hoverRadius' | 'hoverStrength' | 'turbulence' |
  'seed' | 'reducedMotion'> & {
  /** Index of the line dataset to replace with particles. Defaults to 0. */
  datasetIndex?: number;
};

declare module 'chart.js' {
  interface PluginOptionsByType<TType extends ChartType> {
    liquidgraph?: TType extends 'line' ? LiquidGraphPluginOptions | false : never;
  }
}

interface Group { layout: Layout; particles: Particle[] }
interface State {
  options: ResolvedOptions;
  groups: Group[];
  datasetIndex: number;
  signature: string;
  pointer: Pointer;
  raf: number;
  lastTime: number;
  accumulator: number;
  time: number;
  transitioning: boolean;
  settled: number;
  visible: boolean;
  reduced: boolean;
  query: MediaQueryList | undefined;
  view: Window | null;
  dispose: (() => void)[];
}
const states = new WeakMap<Chart, State>();
const defaults = resolveOptions({ data: [] });

function stop(state: State): void {
  if (state.raf) state.view?.cancelAnimationFrame(state.raf);
  state.raf = 0; state.lastTime = 0; state.accumulator = 0;
}
function snap(state: State): void {
  for (const group of state.groups) for (const p of group.particles) {
    p.x = p.tx; p.y = p.ty; p.vx = 0; p.vy = 0;
    p.alpha = p.targetAlpha; p.radius = p.targetRadius;
    delete p.motion;
  }
  state.transitioning = false;
}
function start(chart: Chart, state: State): void {
  const view = state.view;
  if (!view || state.raf || state.reduced || !state.visible || chart.canvas.ownerDocument?.hidden || !chart.attached || !state.groups.some((g) => g.particles.length)) return;
  const frame = (now: number) => {
    state.raf = 0;
    if (states.get(chart) !== state) return;
    if (!state.visible || state.reduced || chart.canvas.ownerDocument?.hidden || !chart.attached) { stop(state); return; }
    state.accumulator += state.lastTime ? Math.min(1 / 30, (now - state.lastTime) / 1000) : 1 / 60;
    state.lastTime = now;
    while (state.accumulator >= 1 / 120) {
      state.time += 1 / 120;
      let energy = 0;
      for (const group of state.groups) {
        energy += stepParticles(group.particles, state.pointer, state.options, 1 / 120, state.time,
          state.transitioning ? undefined : group.layout.points);
      }
      if (state.transitioning) {
        state.settled = energy < Math.max(4, state.options.turbulence ** 2 * 5) && !state.pointer.active ? state.settled + 1 : 0;
        if (state.settled >= 20) state.transitioning = false;
      }
      state.accumulator -= 1 / 120;
    }
    chart.draw();
    state.raf = view.requestAnimationFrame(frame);
  };
  state.raf = view.requestAnimationFrame(frame);
}
function setup(chart: Chart): State {
  const found = states.get(chart);
  if (found) return found;
  const view = chart.canvas.ownerDocument?.defaultView ?? null;
  const query = view?.matchMedia?.('(prefers-reduced-motion: reduce)');
  const state: State = {
    options: defaults, groups: [], datasetIndex: -1, signature: '', pointer: { x: 0, y: 0, vx: 0, vy: 0, active: false },
    raf: 0, lastTime: 0, accumulator: 0, time: 0, transitioning: false, settled: 0, visible: true,
    reduced: !view || !!query?.matches, query, view, dispose: [],
  };
  states.set(chart, state);
  const motion = () => {
    state.reduced = !view || (state.options.reducedMotion === 'auto' ? !!query?.matches : state.options.reducedMotion);
    state.pointer.active = false;
    stop(state);
    if (state.reduced) { snap(state); chart.draw(); } else start(chart, state);
  };
  query?.addEventListener('change', motion);
  state.dispose.push(() => query?.removeEventListener('change', motion));
  const doc = chart.canvas.ownerDocument;
  const visibility = () => { stop(state); start(chart, state); };
  doc?.addEventListener('visibilitychange', visibility);
  state.dispose.push(() => doc?.removeEventListener('visibilitychange', visibility));
  if (typeof IntersectionObserver !== 'undefined') {
    const observer = new IntersectionObserver(([entry]) => {
      state.visible = entry?.isIntersecting ?? true;
      stop(state); start(chart, state);
    });
    observer.observe(chart.canvas);
    state.dispose.push(() => observer.disconnect());
  }
  return state;
}
function cleanup(chart: Chart): void {
  const state = states.get(chart);
  if (!state) return;
  stop(state);
  state.dispose.forEach((dispose) => dispose());
  states.delete(chart);
}

function segmentsFor(chart: Chart, index: number): Layout['points'][] {
  const meta = chart.getDatasetMeta(index);
  const segments: Layout['points'][] = [];
  let points: Layout['points'] = [];
  const spanGaps = (meta.dataset as { options?: { spanGaps?: boolean | number } } | null)?.options?.spanGaps === true;
  for (const element of meta.data) {
    const point = element as PointElement;
    const { x, y } = point.getProps(['x', 'y'], true);
    if (point.skip || x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) {
      if (!spanGaps && points.length) { segments.push(points); points = []; }
      continue;
    }
    points.push({ x, y });
  }
  if (points.length) segments.push(points);
  return segments.map((segment) => segment.sort((a, b) => a.x - b.x));
}

/** Chart.js 4 plugin. Importing this module never imports Chart.js at runtime. */
export const liquidGraphPlugin: Plugin<ChartType, LiquidGraphPluginOptions> & { descriptors: { _scriptable: boolean; _indexable: boolean } } = {
  id: 'liquidgraph',
  defaults: {
    datasetIndex: 0, particleCount: defaults.particleCount, particleRadius: defaults.particleRadius,
    capHeight: defaults.capHeight, falloffHeight: defaults.falloffHeight,
    springStrength: defaults.springStrength, damping: defaults.damping,
    hoverRadius: defaults.hoverRadius, hoverStrength: defaults.hoverStrength,
    turbulence: defaults.turbulence, seed: defaults.seed, reducedMotion: 'auto',
  },
  descriptors: { _scriptable: false, _indexable: false },
  afterDatasetsUpdate(chart, args, options) {
    const index = options.datasetIndex ?? 0;
    if (!Number.isInteger(index) || index < 0) throw new RangeError('liquid-graph: datasetIndex must be a nonnegative integer.');
    const state = setup(chart);
    const meta = chart.data.datasets[index] ? chart.getDatasetMeta(index) : undefined;
    // Non-line and horizontal charts retain their native renderer.
    if (!meta || meta.type !== 'line' || meta.iScale?.axis !== 'x' || !chart.isDatasetVisible(index)) {
      state.groups = []; state.datasetIndex = -1; state.signature = ''; stop(state); return;
    }
    const color = (meta.dataset as { options?: { borderColor?: unknown } } | null)?.options?.borderColor;
    const resolved = resolveOptions({ data: [], ...options,
      color: options.color ?? (typeof color === 'string' ? color : defaults.color),
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    const segments = segmentsFor(chart, index);
    const { left, right, top, bottom } = chart.chartArea;
    const signature = JSON.stringify([index, left, right, top, bottom, segments, resolved]);
    state.options = resolved;
    state.reduced = !state.view || (resolved.reducedMotion === 'auto' ? !!state.query?.matches : resolved.reducedMotion);
    if (signature === state.signature) { start(chart, state); return; }
    const animate = state.groups.length > 0 && !state.reduced && args.mode !== 'none' && args.mode !== 'resize' && args.mode !== 'reset';
    const weights = segments.map((points) => points.reduce((sum, p, i) => sum + (i ? Math.hypot(p.x - points[i - 1]!.x, p.y - points[i - 1]!.y) : 1), 0));
    const total = weights.reduce((sum, n) => sum + n, 0);
    let remaining = resolved.particleCount;
    state.groups = segments.map((points, i) => {
      const layout: Layout = { left, right, top, bottom, xDomain: [0, 1], yDomain: [0, 1], points };
      const count = i === segments.length - 1 ? remaining : Math.min(remaining, Math.round(resolved.particleCount * weights[i]! / Math.max(1, total)));
      remaining -= count;
      const targets = right > left && bottom > top ? generateTargets(layout, { ...resolved, particleCount: count, seed: resolved.seed + i }) : [];
      const particles = matchParticles(state.groups[i]?.particles ?? [], targets, animate, resolved.particleRadius);
      return { layout, particles };
    });
    state.datasetIndex = index; state.signature = signature;
    state.pointer.active = false; state.transitioning = animate; state.settled = 0;
    if (!animate) snap(state);
    stop(state); start(chart, state);
  },
  beforeDatasetDraw(chart, args) {
    const state = states.get(chart);
    if (!state || args.index !== state.datasetIndex) return;
    const { ctx, chartArea: area } = chart;
    ctx.save(); ctx.beginPath(); ctx.rect(area.left, area.top, area.right - area.left, area.bottom - area.top); ctx.clip();
    for (const group of state.groups) drawParticles(ctx, group.particles, state.options.color);
    ctx.restore();
    return false;
  },
  afterEvent(chart, args) {
    const state = states.get(chart);
    if (!state || state.datasetIndex < 0) return;
    const { event } = args;
    state.pointer.active = !state.reduced && args.inChartArea && event.type !== 'mouseout' && event.x !== null && event.y !== null;
    if (event.x !== null && event.y !== null) { state.pointer.x = event.x; state.pointer.y = event.y; }
    args.changed = true;
    start(chart, state);
  },
  stop: cleanup,
  afterDestroy: cleanup,
};

export default liquidGraphPlugin;
