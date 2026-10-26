import type { Chart as ChartInstance } from 'chart.js';
import chartScript from '../node_modules/chart.js/dist/chart.umd.js?url';
import { liquidGraphPlugin } from '../src/chartjs';
import { createRechartsPlugin } from '../src/recharts';
import type { LiquidReactRuntime, LiquidRechartsRuntime } from '../src/recharts';
import { createTanStackPlugin } from '../src/tanstack';
import type { LiquidTanStackRenderContext } from '../src/tanstack';
import { integrationMonths, integrationMoney, integrationRows } from './integration-data';
import type { IntegrationDataset } from './integration-data';

export type IntegrationLibrary = 'chartjs' | 'tanstack' | 'recharts';
export interface IntegrationState { dataset: IntegrationDataset; enabled: boolean }
export interface IntegrationDemo { update(state: IntegrationState): void; destroy(): void }
export type MountIntegration = (container: HTMLElement, state: IntegrationState) => IntegrationDemo;
let chartPromise: Promise<typeof ChartInstance> | undefined;
function chartJs(): Promise<typeof ChartInstance> {
  if (!chartPromise) {
    chartPromise = new Promise<typeof ChartInstance>((resolve, reject) => {
      const existing = (window as unknown as { Chart?: typeof ChartInstance }).Chart;
      if (existing) { resolve(existing); return; }
      const script = document.createElement('script'); script.src = chartScript;
      script.onload = () => resolve((window as unknown as { Chart: typeof ChartInstance }).Chart);
      script.onerror = () => { script.remove(); chartPromise = undefined; reject(new Error('Could not load Chart.js')); };
      document.head.append(script);
    });
  }
  return chartPromise;
}
async function chartJsDemo(): Promise<MountIntegration> {
  const Chart = await chartJs(); Chart.register(liquidGraphPlugin);
  return (container, state) => {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'Monthly savings balance'); container.append(canvas);
    const chart = new Chart(canvas, {
      type: 'line', data: { labels: integrationMonths, datasets: [{ label: state.dataset.label, data: [...state.dataset.values], borderColor: state.dataset.color, pointRadius: 0, borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, color: '#929fa3',
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, liquidgraph: state.enabled ? { particleCount: 1800, turbulence: 0.18 } : false,
          tooltip: { callbacks: { label: (item) => integrationMoney(item.parsed.y ?? 0) } } },
        scales: { x: { grid: { display: false } }, y: { min: 0, max: 26000, grid: { color: '#ffffff0b' }, ticks: { callback: (v) => `$${Number(v) / 1000}k` } } } },
    });
    return {
      update(next) {
        Object.assign(chart.data.datasets[0]!, { label: next.dataset.label, data: [...next.dataset.values], borderColor: next.dataset.color });
        chart.options.plugins!.liquidgraph = next.enabled ? { particleCount: 1800, turbulence: 0.18 } : false;
        chart.update();
      },
      destroy: () => chart.destroy(),
    };
  };
}

// Only demo pages load these pinned browser modules. The npm library has no
// runtime dependency on React, Recharts, TanStack, or a CDN.
const browserModule = (url: string): Promise<unknown> => import(/* @vite-ignore */ url);
interface DemoElement { readonly type?: unknown }
interface DemoReact extends LiquidReactRuntime<DemoElement> {
  createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): DemoElement;
}
interface DemoRecharts extends LiquidRechartsRuntime {
  ResponsiveContainer: unknown; LineChart: unknown; Line: unknown; XAxis: unknown; YAxis: unknown; Tooltip: unknown; CartesianGrid: unknown;
}
interface DemoReactDom { createRoot(container: HTMLElement): { render(element: DemoElement): void; unmount(): void } }
async function rechartsDemo(): Promise<MountIntegration> {
  const [reactModule, domModule, rechartsModule] = await Promise.all([
    browserModule('https://esm.sh/react@19.2.3'),
    browserModule('https://esm.sh/react-dom@19.2.3/client?external=react'),
    browserModule('https://esm.sh/recharts@3.10.1?external=react,react-dom'),
  ]);
  const React = reactModule as DemoReact, ReactDom = domModule as DemoReactDom, Recharts = rechartsModule as DemoRecharts;
  const LiquidLine = createRechartsPlugin(React, Recharts);
  const element = React.createElement;
  return (container, state) => {
    const root = ReactDom.createRoot(container);
    const render = (next: IntegrationState) => {
      const rows = integrationRows(next.dataset);
      root.render(element(Recharts.ResponsiveContainer, { width: '100%', height: '100%', minWidth: 0 },
        element(Recharts.LineChart, { data: rows, margin: { top: 18, right: 12, bottom: 8, left: 0 }, accessibilityLayer: true },
          element(Recharts.CartesianGrid, { stroke: '#ffffff0b', vertical: false }),
          element(Recharts.XAxis, { dataKey: 'label', stroke: '#929fa3', fontSize: 11, tickLine: false, axisLine: false }),
          element(Recharts.YAxis, { domain: [0, 26000], stroke: '#929fa3', width: 52, fontSize: 11, tickLine: false, axisLine: false, tickFormatter: (v: number) => `$${v / 1000}k` }),
          element(Recharts.Tooltip, { formatter: (v: unknown) => integrationMoney(Number(v)), contentStyle: { background: '#202628', border: '1px solid #455053', borderRadius: 8, color: '#f6f3eb' } }),
          element(Recharts.Line, { dataKey: 'balance', name: next.dataset.label, stroke: next.dataset.color, strokeOpacity: next.enabled ? 0 : 1, dot: false, isAnimationActive: false }),
          next.enabled ? element(LiquidLine, { data: rows, xDataKey: 'label', dataKey: 'balance', color: next.dataset.color, particleCount: 1800, turbulence: 0.18 }) : null,
        )));
    };
    render(state); return { update: render, destroy: () => root.unmount() };
  };
}
interface ConfiguredScale { domain(values: readonly number[]): unknown }
interface TanStackOptions {
  ariaLabel: string; definition: unknown;
  onRender(context: LiquidTanStackRenderContext): void;
}
interface DemoTanStack {
  defineChart(spec: unknown): unknown;
  lineY(rows: ReturnType<typeof integrationRows>, options: Record<string, unknown>): unknown;
}
interface DemoTanStackDom { mountChart(container: HTMLElement, options: TanStackOptions): { update(options: TanStackOptions): void; destroy(): void } }
interface DemoTanStackScales { scaleLinear(): ConfiguredScale }
async function tanstackDemo(): Promise<MountIntegration> {
  const [grammarModule, domModule, scaleModule, tooltipModule] = await Promise.all([
    browserModule('https://esm.sh/@tanstack/charts@1.1.0'),
    browserModule('https://esm.sh/@tanstack/charts@1.1.0/dom'),
    browserModule('https://esm.sh/@tanstack/charts@1.1.0/scales/linear'),
    browserModule('https://esm.sh/@tanstack/charts@1.1.0/tooltip'),
  ]);
  const grammar = grammarModule as DemoTanStack, dom = domModule as DemoTanStackDom, scales = scaleModule as DemoTanStackScales;
  const tooltip = (tooltipModule as { tooltip: unknown }).tooltip;
  return (container, state) => {
    const plugin = createTanStackPlugin({ markId: 'savings', particleCount: 1800, turbulence: 0.18 });
    let current = state;
    const options = (): TanStackOptions => ({
      ariaLabel: `${current.dataset.label} monthly savings`,
      definition: grammar.defineChart({
        marks: [grammar.lineY(integrationRows(current.dataset), { id: 'savings', x: 'month', y: 'balance', stroke: current.dataset.color })],
        scales: {
          x: { scale: scales.scaleLinear().domain([0, 11]), axis: { ticks: { values: [0, 2, 4, 6, 8, 11], format: (month: number) => integrationMonths[month] ?? '' } } },
          y: { scale: scales.scaleLinear().domain([0, 26000]), grid: true, axis: { ticks: { format: (v: number) => `$${v / 1000}k` } } },
        },
        tooltip: { use: tooltip, className: 'integration-tooltip', format: (point: { datum: { month: number; balance: number } }) => `${integrationMonths[point.datum.month]} · ${integrationMoney(point.datum.balance)}` },
        theme: { foreground: '#929fa3', muted: '#929fa3', grid: '#ffffff0b', background: 'transparent' },
      }),
      onRender: (context) => { if (current.enabled) plugin.onRender(context); },
    });
    let host: ReturnType<DemoTanStackDom['mountChart']>;
    try { host = dom.mountChart(container, options()); } catch (error) { plugin.destroy(); throw error; }
    return {
      update(next) { current = next; if (!next.enabled) plugin.destroy(); host.update(options()); },
      destroy() { plugin.destroy(); host.destroy(); },
    };
  };
}
const factories = { chartjs: chartJsDemo, tanstack: tanstackDemo, recharts: rechartsDemo };
export async function loadIntegration(library: IntegrationLibrary): Promise<MountIntegration> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      factories[library](),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('The example took too long to load')), 20000); }),
    ]);
  } finally { clearTimeout(timer); }
}
