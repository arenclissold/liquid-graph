import assert from 'node:assert/strict';
import test from 'node:test';
import { ParticleLayer } from '../src/particle-layer';
import { rechartsSeries, createRechartsPlugin } from '../src/recharts';
import type { LiquidReactRuntime, LiquidRechartsRuntime } from '../src/recharts';
import { createTanStackPlugin, tanstackProjection } from '../src/tanstack';
import type { LiquidTanStackScene, LiquidSceneNode } from '../src/tanstack';
import { FakeCanvas, FakeDocument, FakeElement, pointer, frame } from './helpers/particle-dom';

function environment() {
  const doc = new FakeDocument(), svg = new FakeElement('svg', doc), canvas = new FakeCanvas(doc);
  svg.append(canvas);
  const layer = new ParticleLayer(canvas as unknown as HTMLCanvasElement, svg as unknown as Element);
  return { doc, svg, canvas, layer };
}
test('overlay preserves the surface wave and opens a hover hole in host coordinates', () => {
  const { doc, svg, canvas, layer } = environment();
  try {
    layer.update(frame(220)); const initial = Math.min(...canvas.arcs.map((a) => a.y));
    layer.update(frame(70)); assert.ok(Math.min(...canvas.arcs.map((a) => a.y)) > initial - 5);
    doc.advance(120); const settled = Math.min(...canvas.arcs.map((a) => a.y));
    assert.ok(settled < initial - 100);
    pointer(svg, 200, 70); doc.advance(30);
    assert.ok(canvas.arcs.every((a) => Math.hypot(a.x - 200, a.y - 70) > 24));
    svg.dispatchEvent(new Event('pointerleave')); doc.advance(120);
    assert.ok(canvas.arcs.some((a) => Math.hypot(a.x - 200, a.y - 70) < 30));
  } finally { layer.destroy(); }
  assert.equal(doc.pending.size, 0);
  assert.ok([...svg.listeners.values()].every((listeners) => listeners.size === 0));
});
test('overlay sizes backing stores for DPR and snaps after responsive resizing', () => {
  const { canvas, layer } = environment();
  try {
    layer.update(frame()); assert.equal(canvas.width, 800); assert.equal(canvas.height, 600);
    const next = frame(30); next.width = 200; next.bounds.width = 160; next.series = [{ key: 'balance', points: [{ x: 20, y: 30 }, { x: 180, y: 30 }] }];
    layer.update(next); assert.equal(canvas.width, 400);
    assert.ok(Math.min(...canvas.arcs.map((a) => a.y)) < 40);
  } finally { layer.destroy(); }
});
test('reduced motion, hidden documents, and destruction cancel animation work', () => {
  const { doc, layer, canvas } = environment();
  layer.update({ ...frame(), options: { ...frame().options, reducedMotion: 'auto' } }); assert.equal(doc.pending.size, 1);
  doc.query.matches = true; doc.query.dispatchEvent(new Event('change')); assert.equal(doc.pending.size, 0);
  const before = JSON.stringify(canvas.arcs); doc.advance(20); assert.equal(JSON.stringify(canvas.arcs), before);
  doc.query.matches = false; doc.query.dispatchEvent(new Event('change')); assert.equal(doc.pending.size, 1);
  doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange')); assert.equal(doc.pending.size, 0);
  doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange')); assert.equal(doc.pending.size, 1);
  layer.destroy(); layer.destroy(); assert.equal(doc.pending.size, 0);
  assert.throws(() => layer.update(frame()), /destroyed/);
});
test('empty data and zero budget stop the simulation; bad updates preserve the old layer', () => {
  const { doc, canvas, layer } = environment();
  try {
    layer.update(frame()); const before = JSON.stringify(canvas.arcs);
    assert.throws(() => layer.update({ ...frame(), width: NaN }), /finite/);
    assert.equal(JSON.stringify(canvas.arcs), before);
    assert.throws(() => layer.update({ ...frame(), series: [...frame().series, ...frame().series] }), /unique/);
    assert.throws(() => layer.update({ ...frame(), series: [{ key: 'x', points: [{ x: NaN, y: 0 }] }] }), /finite/);
    layer.update({ ...frame(), options: { particleCount: 0 } }); assert.equal(canvas.arcs.length, 0); assert.equal(doc.pending.size, 0);
    layer.update({ ...frame(), series: [] }); assert.equal(canvas.arcs.length, 0);
  } finally { layer.destroy(); }
});
test('series keep their particle origins when reordered', () => {
  const { canvas, layer } = environment();
  const base = frame();
  const a = { key: 'a', points: [{ x: 20, y: 200 }, { x: 150, y: 200 }], color: 'red' };
  const b = { key: 'b', points: [{ x: 230, y: 50 }, { x: 380, y: 50 }], color: 'blue' };
  try {
    layer.update({ ...base, series: [a, b] });
    layer.update({ ...base, series: [{ ...b, points: b.points.map((p) => ({ ...p, y: 150 })) }, { ...a, points: a.points.map((p) => ({ ...p, y: 100 })) }] });
    assert.ok(Math.min(...canvas.arcs.filter((a) => a.color === 'red').map((a) => a.y)) > 190);
    assert.ok(Math.min(...canvas.arcs.filter((a) => a.color === 'blue').map((a) => a.y)) < 60);
    assert.ok(canvas.arcs.length <= 300);
  } finally { layer.destroy(); }
});
test('Recharts projection uses category/reversed scales and preserves null gaps', () => {
  const props = { data: [{ month: 'A', balance: 5 }, { month: 'B', balance: null }, { month: 'C', balance: 10 }], xDataKey: 'month' as const, dataKey: 'balance' as const };
  const xs = (v: unknown) => ({ A: 300, B: 200, C: 100 })[String(v) as 'A' | 'B' | 'C'];
  const ys = (v: unknown) => 200 - Number(v) * 10;
  const gaps = rechartsSeries(props, xs, ys);
  assert.deepEqual(gaps.map((g) => g.points), [[{ x: 300, y: 150 }], [{ x: 100, y: 100 }]]);
  assert.equal(rechartsSeries({ ...props, connectNulls: true }, xs, ys).length, 1);
  assert.equal(rechartsSeries({ ...props, data: [] }, xs, ys).length, 0);
});
function scene(): LiquidTanStackScene {
  const line = (key: string, markId: string, y: number): LiquidSceneNode => ({ kind: 'polyline', key, points: [[20, y], [180, y]], interaction: { points: [{ markId }] }, style: { stroke: '#75d5f1' } });
  return { width: 400, height: 300, chart: { x: 20, y: 20, width: 360, height: 260 }, nodes: [
    { kind: 'rule', key: 'axis' }, line('savings:0', 'savings', 100), line('other:0', 'other', 200),
    { kind: 'group', key: 'translated', translateX: 100, translateY: 50, clip: { x: 0, y: 0, width: 180, height: 100 }, children: [line('savings:1', 'savings', 50)] },
    { kind: 'group', key: 'focus', focus: {}, children: [line('focus-line', 'savings', 20)] },
  ] };
}
test('TanStack projection retains native segments, translations, clipping, and scene immutability', () => {
  const original = scene(), copy = JSON.stringify(original);
  const result = tanstackProjection(original, { markId: 'savings', particleCount: 200 });
  assert.deepEqual([...result.hiddenKeys], ['savings:0', 'savings:1']);
  assert.deepEqual(result.frame.series[1]!.points, [{ x: 120, y: 100 }, { x: 280, y: 100 }]);
  assert.deepEqual(result.frame.series[1]!.bounds, { x: 100, y: 50, width: 180, height: 100 });
  assert.equal(JSON.stringify(original), copy);
  assert.equal(tanstackProjection(original, { markId: ['savings', 'other'] }).frame.series.length, 3);
  assert.equal(tanstackProjection(original, { markId: 'missing' }).frame.series.length, 0);
});
test('TanStack attaches one non-intercepting layer, restores paths, and releases resources', () => {
  const doc = new FakeDocument(), svg = new FakeElement('svg', doc), native = new FakeElement('path', doc), other = new FakeElement('path', doc);
  native.setAttribute('data-ts-key', 'savings:0'); other.setAttribute('data-ts-key', 'other:0');
  svg.append(native, other);
  const plugin = createTanStackPlugin({ markId: 'savings', particleCount: 200 });
  const context = { scene: scene(), surface: { element: svg as unknown as Element } };
  plugin.onRender(context);
  assert.equal(native.style.visibility, 'hidden'); assert.equal(other.style.visibility, '');
  const overlay = svg.children.find((e) => e.tagName === 'foreignObject')!;
  assert.equal(overlay.style.pointerEvents, 'none'); assert.equal(overlay.getAttribute('aria-hidden'), 'true');
  const canvas = overlay.children[0] as FakeCanvas; assert.ok(canvas.arcs.length > 0);
  overlay.remove(); plugin.onRender(context);
  assert.equal(svg.children.filter((e) => e.tagName === 'foreignObject').length, 1);
  plugin.update({ markId: 'other' }); assert.equal(native.style.visibility, ''); assert.equal(other.style.visibility, 'hidden');
  plugin.destroy(); plugin.destroy(); assert.equal(other.style.visibility, ''); assert.equal(doc.pending.size, 0);
  assert.equal(svg.children.length, 2);
  // React StrictMode may attach the same plugin again after effect cleanup.
  plugin.onRender(context); plugin.destroy(); assert.equal(doc.pending.size, 0);
});
test('Recharts factory uses public hooks and stays DOM-free during server rendering', () => {
  interface Element { type: string; props: Record<string, unknown> | null; children: Element[] }
  const effects: (() => void | (() => void))[] = [];
  const React: LiquidReactRuntime<Element> = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useRef: <T>(initial: T) => ({ current: initial }),
    useEffect: (effect) => { effects.push(effect); },
  };
  const axisIds: (string | number | undefined)[] = [];
  const hooks: LiquidRechartsRuntime = { usePlotArea: () => ({ x: 20, y: 20, width: 360, height: 260 }),
    useXAxisScale: (id) => { axisIds.push(id); return Number; }, useYAxisScale: (id) => { axisIds.push(id); return Number; } };
  const LiquidLine = createRechartsPlugin(React, hooks);
  const output = LiquidLine({ data: [{ x: 1, y: 2 }], xDataKey: 'x', dataKey: 'y', xAxisId: 'time', yAxisId: 'balance' });
  assert.equal(output?.type, 'foreignObject'); assert.equal(output?.props?.pointerEvents, 'none');
  assert.deepEqual(axisIds, ['time', 'balance']); assert.equal(effects.length, 2);
  assert.equal(createRechartsPlugin(React, { ...hooks, usePlotArea: () => undefined })({ data: [], dataKey: 'y' }), null);
  assert.throws(() => createRechartsPlugin(React, {} as LiquidRechartsRuntime), /3.8/);
});

test('Recharts effect mounts with real row props and tolerates StrictMode effect replay', () => {
  interface Element { type: string; props: Record<string, unknown> | null; children: Element[] }
  const doc = new FakeDocument(), svg = new FakeElement('svg', doc);
  const effects: (() => void | (() => void))[] = [];
  const React: LiquidReactRuntime<Element> = {
    createElement: (type, props, ...children) => {
      if (type === 'canvas') {
        const canvas = new FakeCanvas(doc); svg.append(canvas);
        (props!.ref as { current: HTMLCanvasElement | null }).current = canvas as unknown as HTMLCanvasElement;
      }
      return { type, props, children };
    },
    useRef: <T>(initial: T) => ({ current: initial }),
    useEffect: (effect) => { effects.push(effect); },
  };
  const hooks: LiquidRechartsRuntime = { usePlotArea: () => ({ x: 20, y: 20, width: 360, height: 260 }),
    useXAxisScale: () => (v) => 20 + Number(v) * 360, useYAxisScale: () => (v) => 280 - Number(v) * 2 };
  const LiquidLine = createRechartsPlugin(React, hooks);
  LiquidLine({ data: [{ month: 0, balance: 50 }, { month: 1, balance: 80 }], xDataKey: 'month', dataKey: 'balance', particleCount: 200 });
  const commit = () => effects.map((effect) => effect()).filter((cleanup): cleanup is () => void => typeof cleanup === 'function');
  const first = commit(); assert.ok((svg.children[0] as FakeCanvas).arcs.length > 0); assert.equal(doc.pending.size, 1);
  first.forEach((cleanup) => cleanup()); assert.equal(doc.pending.size, 0);
  const replay = commit(); assert.equal(doc.pending.size, 1);
  replay.forEach((cleanup) => cleanup()); assert.equal(doc.pending.size, 0);
});
