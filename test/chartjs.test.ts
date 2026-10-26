import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';
import type { Chart as ChartInstance, ChartConfiguration, ChartItem } from 'chart.js';
import { liquidGraphPlugin } from '../src/chartjs';

// The official UMD build includes Chart.js's color dependency and exercises its
// actual plugin lifecycle with BasicPlatform, without a DOM or native canvas.
const sandbox = createContext({ console });
runInContext(readFileSync(new URL('../node_modules/chart.js/dist/chart.umd.js', import.meta.url), 'utf8'), sandbox);
const Chart = sandbox.Chart as typeof import('chart.js').Chart;
Chart.register(liquidGraphPlugin);
function fixture(data: (number | null)[] = [20, 70, 35, 90], extra: Partial<ChartConfiguration<'line'>['options']> = {}, ownerDocument?: Document) {
  const arcs: number[][] = [];
  const context = new Proxy({
    canvas: undefined as unknown as HTMLCanvasElement,
    measureText: (text: string) => ({ width: String(text).length * 7 }),
    arc: (...args: number[]) => arcs.push(args),
    setLineDash: () => {}, getLineDash: () => [],
  }, { get(target, key) { return key in target ? target[key as keyof typeof target] : () => {}; },
    set(target, key, value) { Reflect.set(target, key, value); return true; } });
  const canvas = { width: 800, height: 400, getContext: () => context, ownerDocument };
  context.canvas = canvas as unknown as HTMLCanvasElement;
  const chart = new Chart(canvas as unknown as ChartItem, {
    type: 'line', data: { labels: ['Jan', 'Feb', 'Mar', 'Apr'], datasets: [{ data, borderColor: '#75d5f1' }] },
    options: { responsive: false, animation: false, plugins: { liquidgraph: { particleCount: 300, reducedMotion: true } }, ...extra },
  });
  return { chart, arcs };
}
function particleDraw(chart: ChartInstance, arcs: number[][]): boolean | void {
  arcs.length = 0;
  return liquidGraphPlugin.beforeDatasetDraw!(chart, { index: 0, meta: chart.getDatasetMeta(0) }, {});
}
test('Chart.js draws particles in place of the selected native dataset', () => {
  const { chart, arcs } = fixture();
  try {
    assert.equal(particleDraw(chart, arcs), false);
    assert.ok(arcs.length > 100);
    assert.ok(arcs.length <= 300);
    for (const [x, y, radius] of arcs) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y) && radius! > 0);
    }
    assert.equal(chart.getDatasetMeta(0).data.length, 4, 'native points remain available to tooltips');
  } finally { chart.destroy(); }
});
test('updates follow the actual Chart.js scale coordinates', () => {
  const { chart, arcs } = fixture();
  try {
    particleDraw(chart, arcs); const before = JSON.stringify(arcs);
    chart.data.datasets[0]!.data = [90, 20, 80, 10]; chart.update('none');
    particleDraw(chart, arcs); assert.notEqual(JSON.stringify(arcs), before);
    const p = chart.getDatasetMeta(0).data[0]!;
    assert.equal(p.y, chart.scales.y!.getPixelForValue(90));
  } finally { chart.destroy(); }
});
test('null gaps do not gain a connecting particle surface', () => {
  const { chart, arcs } = fixture([20, null, null, 90]);
  try { particleDraw(chart, arcs); assert.equal(arcs.length, 2); }
  finally { chart.destroy(); }
});
test('zero budget, empty data, and hidden datasets render safely', () => {
  const { chart, arcs } = fixture();
  try {
    chart.options.plugins!.liquidgraph = { particleCount: 0 }; chart.update('none');
    particleDraw(chart, arcs); assert.equal(arcs.length, 0);
    chart.data.datasets[0]!.data = []; chart.update('none');
    particleDraw(chart, arcs); assert.equal(arcs.length, 0);
    chart.setDatasetVisibility(0, false); chart.update('none');
    assert.equal(particleDraw(chart, arcs), undefined);
  } finally { chart.destroy(); }
});
test('disabling and re-enabling the plugin restores native rendering and rebuilds particles', () => {
  const { chart, arcs } = fixture();
  try {
    chart.options.plugins!.liquidgraph = false; chart.update('none');
    assert.equal(particleDraw(chart, arcs), undefined);
    chart.options.plugins!.liquidgraph = { particleCount: 200 }; chart.update('none');
    assert.equal(particleDraw(chart, arcs), false); assert.ok(arcs.length > 0);
  } finally { chart.destroy(); }
  assert.equal(particleDraw(chart, arcs), undefined);
});
test('unselected datasets keep their native renderer', () => {
  const { chart } = fixture();
  try {
    chart.data.datasets.push({ data: [40, 30, 70, 60] }); chart.update('none');
    assert.equal(liquidGraphPlugin.beforeDatasetDraw!(chart, { index: 1, meta: chart.getDatasetMeta(1) }, {}), undefined);
    chart.options.plugins!.liquidgraph = { datasetIndex: 1 }; chart.update('none');
    assert.equal(liquidGraphPlugin.beforeDatasetDraw!(chart, { index: 0, meta: chart.getDatasetMeta(0) }, {}), undefined);
  } finally { chart.destroy(); }
});

test('native Chart.js tooltips still resolve the selected dataset values', () => {
  const { chart } = fixture();
  try {
    const point = chart.getDatasetMeta(0).data[1]!;
    chart.tooltip!.setActiveElements([{ datasetIndex: 0, index: 1 }], { x: point.x, y: point.y });
    chart.draw();
    assert.equal(chart.tooltip!.dataPoints[0]!.parsed.y, 70);
  } finally { chart.destroy(); }
});
test('browser animation preserves the wave, responds to hover, and cancels on destroy', () => {
  let next = 0, now = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  const listeners = new Map<string, unknown>();
  const view = {
    requestAnimationFrame: (callback: FrameRequestCallback) => { callbacks.set(++next, callback); return next; },
    cancelAnimationFrame: (id: number) => callbacks.delete(id),
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  };
  const doc = { defaultView: view, hidden: false,
    addEventListener: (name: string, listener: unknown) => listeners.set(name, listener),
    removeEventListener: (name: string) => listeners.delete(name) } as unknown as Document;
  const { chart, arcs } = fixture([20, 20, 20, 20], {
    plugins: { liquidgraph: { particleCount: 300, reducedMotion: false, turbulence: 0 } },
    scales: { y: { min: 0, max: 100 } },
  }, doc);
  const advance = (frames: number) => {
    for (let i = 0; i < frames; i++) {
      const current = [...callbacks.values()]; callbacks.clear(); now += 1000 / 60;
      for (const callback of current) callback(now);
    }
  };
  try {
    assert.equal(callbacks.size, 1);
    particleDraw(chart, arcs); const initialY = arcs.map((a) => a[1]!);
    chart.data.datasets[0]!.data = [90, 90, 90, 90]; chart.update();
    particleDraw(chart, arcs);
    assert.ok(Math.abs(Math.min(...arcs.map((a) => a[1]!)) - Math.min(...initialY)) < 5, 'surface starts on the old curve');
    advance(120); particleDraw(chart, arcs);
    assert.ok(Math.min(...arcs.map((a) => a[1]!)) < Math.min(...initialY) - 100, 'surface travels with the particles');
    const point = chart.getDatasetMeta(0).data[1]!;
    const before = JSON.stringify(arcs);
    liquidGraphPlugin.afterEvent!(chart, { event: { type: 'mousemove', x: point.x, y: point.y, native: null }, replay: false, cancelable: false, inChartArea: true }, {});
    advance(10); particleDraw(chart, arcs);
    assert.notEqual(JSON.stringify(arcs), before, 'hover moves the particle surface');
  } finally { chart.destroy(); }
  assert.equal(callbacks.size, 0);
  assert.equal(listeners.size, 0);
});

test('resize rebuilds particles using the new native chart area', () => {
  const { chart, arcs } = fixture(undefined, { maintainAspectRatio: false });
  try {
    chart.resize(360, 280); particleDraw(chart, arcs);
    assert.equal(chart.width, 360);
    assert.equal(chart.height, 280);
    assert.ok(arcs.length > 0);
    assert.ok(arcs.every((a) => a[0]! >= chart.chartArea.left && a[0]! <= chart.chartArea.right));
  } finally { chart.destroy(); }
});
test('horizontal line charts retain their native renderer', () => {
  const { chart, arcs } = fixture([20, 70, 35, 90], { indexAxis: 'y' });
  try { assert.equal(particleDraw(chart, arcs), undefined); assert.equal(arcs.length, 0); }
  finally { chart.destroy(); }
});
