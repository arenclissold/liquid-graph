import { ParticleLayer } from './particle-layer';
import type { ParticleStyleOptions, PlotBounds, ParticleSeries, PixelPoint } from './particle-layer';
export type { ParticleStyleOptions } from './particle-layer';

/** Pass your application's React instance; no duplicate React runtime is bundled. */
export interface LiquidReactRuntime<TElement> {
  createElement(type: string, props: Record<string, unknown> | null, ...children: TElement[]): TElement;
  useRef<T>(initial: T): { current: T };
  useEffect(effect: () => void | (() => void), dependencies?: readonly unknown[]): void;
}
/** Public Recharts 3.8+ hooks. */
export interface LiquidRechartsRuntime {
  usePlotArea(): PlotBounds | undefined;
  useXAxisScale(axisId?: string | number): ((value: unknown) => number | undefined) | undefined;
  useYAxisScale(axisId?: string | number): ((value: unknown) => number | undefined) | undefined;
}
export type LiquidDataKey<T> = keyof T | ((row: T, index: number) => unknown);
export interface LiquidLineProps<T> extends ParticleStyleOptions {
  /** Use the same rows as the host chart (or its visible Brush slice). */
  data: readonly T[];
  dataKey: LiquidDataKey<T>;
  /** Category/numeric x field; defaults to the row index. */
  xDataKey?: LiquidDataKey<T>;
  xAxisId?: string | number;
  yAxisId?: string | number;
  connectNulls?: boolean;
  animate?: boolean;
}
function value<T>(row: T, key: LiquidDataKey<T>, index: number): unknown {
  return typeof key === 'function' ? key(row, index) : row[key];
}
/** Project through the actual host scales, including categorical and reversed axes. */
export function rechartsSeries<T>(props: LiquidLineProps<T>, xScale: (v: unknown) => number | undefined, yScale: (v: unknown) => number | undefined): ParticleSeries[] {
  const segments: ParticleSeries[] = [];
  let points: PixelPoint[] = [];
  const flush = () => { if (points.length) segments.push({ key: `line:${segments.length}`, points }); points = []; };
  props.data.forEach((row, index) => {
    const xv = props.xDataKey === undefined ? index : value(row, props.xDataKey, index);
    const yv = value(row, props.dataKey, index);
    const x = xv == null ? undefined : xScale(xv), y = yv == null ? undefined : yScale(yv);
    if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
      if (!props.connectNulls) flush();
    } else points.push({ x, y });
  });
  flush(); return segments;
}

/** Create once at module scope, then render <LiquidLine> inside a Recharts chart. */
export function createRechartsPlugin<TElement>(React: LiquidReactRuntime<TElement>, Recharts: LiquidRechartsRuntime) {
  for (const key of ['usePlotArea', 'useXAxisScale', 'useYAxisScale'] as const) {
    if (typeof Recharts[key] !== 'function') throw new Error(`liquid-graph: Recharts 3.8+ is required (${key} is missing).`);
  }
  return function LiquidLine<T>(props: LiquidLineProps<T>): TElement | null {
    const bounds = Recharts.usePlotArea();
    const xScale = Recharts.useXAxisScale(props.xAxisId);
    const yScale = Recharts.useYAxisScale(props.yAxisId);
    const canvas = React.useRef<HTMLCanvasElement | null>(null);
    const layer = React.useRef<ParticleLayer | null>(null);
    const available = !!bounds && !!xScale && !!yScale && bounds.width > 0 && bounds.height > 0;
    // Recreate only when the canvas is mounted/unmounted, not when data changes.
    React.useEffect(() => {
      if (!available || !canvas.current) return;
      layer.current = new ParticleLayer(canvas.current, canvas.current.closest('svg') ?? canvas.current);
      return () => { layer.current?.destroy(); layer.current = null; };
    }, [available]);
    React.useEffect(() => {
      if (!bounds || !xScale || !yScale || !layer.current) return;
      layer.current.update({ width: Math.max(0, bounds.x + bounds.width), height: Math.max(0, bounds.y + bounds.height), bounds,
        series: rechartsSeries(props, xScale, yScale), options: props }, props.animate !== false);
    });
    if (!available || !bounds) return null;
    return React.createElement('foreignObject', {
      x: 0, y: 0, width: Math.max(0, bounds.x + bounds.width), height: Math.max(0, bounds.y + bounds.height),
      pointerEvents: 'none', 'aria-hidden': true,
    }, React.createElement('div', { xmlns: 'http://www.w3.org/1999/xhtml', style: { width: '100%', height: '100%', pointerEvents: 'none' } },
      React.createElement('canvas', { ref: canvas, 'aria-hidden': true, style: { display: 'block', pointerEvents: 'none' } })));
  };
}
