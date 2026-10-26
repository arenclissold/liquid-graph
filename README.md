# liquid-graph

A TypeScript particle graph inspired by [Up’s Saver Insights](https://up.com.au/blog/saver-insights/). Thousands of dots form the graph: a dense edge, a packed cap, and a sparse falloff. Varied-size circles nest beneath the data curve to form the boundary; the fill has spring motion and soft local collisions. Hovering opens a circular hole in the particles; they spring back when the pointer leaves. Updating data retargets nearby particles within the same layer, preserving their momentum. Newly needed particles fade in along the current graph and travel with the transition wave. Dataset changes use staggered springs, restrained curved paths, and smoothly changing circle sizes for a fluid settle.

An independent Canvas 2D implementation, not Up’s source code or a Box2D/LiquidFun port. No runtime dependencies, stylesheets, framework, or WebGL required.

## Run the playground

```sh
npm install
npm run dev
```

Open the URL printed by Vite. Switch datasets and time ranges, stir the graph, change colors and density, or pause the simulation. The main page’s Integrations section has interactive Chart.js, TanStack Charts, and Recharts examples, matching dataset controls, a native-line comparison toggle, and copyable setup code. TanStack/Recharts demo dependencies load on demand from pinned esm.sh modules; those two demos require an internet connection. The published library has no CDN dependency. `npm run demo:build` creates a static demo in `demo-dist/`.

## Build and install

```sh
npm run build
npm pack
# In another project:
npm install /path/to/liquid-graph/liquid-graph-0.1.0.tgz
```

The package builds ESM, CommonJS, source maps, and TypeScript declarations in `dist/`. It is ready to publish; this repository does not publish it automatically.

## Use

The example below charts a savings balance. Give the container an explicit height. The canvas follows its size and device pixel ratio automatically.

```ts
import { createLiquidGraph } from 'liquid-graph';
import type { DataPoint } from 'liquid-graph';

const container = document.querySelector<HTMLElement>('#graph')!;
container.style.height = '360px';

const data: DataPoint[] = [
  { x: 0, y: 4200, label: 'January' },
  { x: 1, y: 6100, label: 'February' },
  { x: 2, y: 5800, label: 'March' },
  { x: 3, y: 7900, label: 'April' },
];

const graph = createLiquidGraph(container, {
  data,
  color: '#75d5f1',
  particleCount: 2400,
  formatX: (x) => ['Jan', 'Feb', 'Mar', 'Apr'][Math.round(x)] ?? '',
  formatY: (y) => `$${Math.round(y).toLocaleString()}`,
  onHover: (hover) => console.log(hover?.point),
});

// Keeps the current positions and velocities, even mid-transition.
graph.setData(nextData);
// Snap immediately when needed.
graph.setData(nextData, { animate: false });
graph.update({ color: '#a4ddbe', hoverRadius: 80 });
graph.pause();
graph.resume();
graph.destroy(); // Call on unmount; removes the canvas, observers, and listeners.
```

`new LiquidGraph(container, options)` is equivalent to the factory. Importing the package during SSR is safe; construct a graph only after the container mounts in a browser. In React, create it in an effect and return `() => graph.destroy()`; call `setData` from a separate effect when props change. The library owns only the wrapper it appends to your container.

## Chart.js plugin

An optional adapter for Chart.js 4 is exported at `liquid-graph/chartjs`. The standalone entry point stays dependency-free.

```sh
npm install liquid-graph chart.js
```

```ts
import Chart from 'chart.js/auto';
import { liquidGraphPlugin } from 'liquid-graph/chartjs';

Chart.register(liquidGraphPlugin);

const chart = new Chart(canvas, {
  type: 'line',
  data: {
    labels: ['Jan', 'Feb', 'Mar', 'Apr'],
    datasets: [{
      label: 'Savings',
      data: [3200, 6100, 4800, 9200],
      borderColor: '#75d5f1',
    }],
  },
  options: {
    // Liquid Graph runs its own spring animation.
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { liquidgraph: { particleCount: 2400, hoverRadius: 48 } },
    scales: { y: { beginAtZero: true } },
  },
});

chart.data.datasets[0].data = [8000, 2600, 7400, 11000];
chart.update(); // Fluid particle transition.
// chart.update('none'); // Snap to the new values.
// chart.options.plugins.liquidgraph = false; // Restore the native line.
chart.destroy(); // On unmount: dispose animation, observers, and listeners.
```

Chart.js owns the canvas, responsive sizing, device pixel ratio, data parsing, axes, legend, and tooltips. Use a sized parent and `maintainAspectRatio: false` for a custom responsive height. See `/chartjs.html` in the playground for a working example, also included in the static demo build.

The plugin replaces dataset `0`; choose another with `datasetIndex`. Other datasets retain their native renderer. Particle color follows the selected dataset's `borderColor`, or set `plugins.liquidgraph.color` explicitly. The particle and physics options below are supported, including `reducedMotion`; Chart.js owns formatting, padding, and domains. Disabling the plugin or hiding its dataset stops its simulation. Offscreen/hidden charts pause, and reduced motion renders a static graph.

This adapter supports vertical line charts, connecting points with straight particle boundaries. Native `tension`, `stepped`, fill styles, and per-point colors do not change the particle surface. Null/omitted points split the surface unless `spanGaps: true`; numeric gap thresholds are treated as gaps. Registering the adapter alone does not register Chart.js controllers or scales; `chart.js/auto` in the example handles that.

## Recharts integration

For Recharts 3.8+ and React 18/19, create the component once outside your render function. The factory receives your application's existing React and Recharts instances, so the integration bundles neither dependency.

```tsx
import * as React from 'react';
import * as Recharts from 'recharts';
import { createRechartsPlugin } from 'liquid-graph/recharts';

const LiquidLine = createRechartsPlugin(React, Recharts);

function SavingsChart({ data }) {
  return (
    <Recharts.ResponsiveContainer width="100%" height={360}>
      <Recharts.LineChart data={data} accessibilityLayer>
        <Recharts.XAxis dataKey="month" />
        <Recharts.YAxis />
        <Recharts.Tooltip />
        {/* Retain native data registration, domains, legend, and tooltip. */}
        <Recharts.Line dataKey="balance" stroke="#75d5f1"
          strokeOpacity={0} dot={false} isAnimationActive={false} />
        <LiquidLine data={data} xDataKey="month" dataKey="balance"
          color="#75d5f1" particleCount={2400} />
      </Recharts.LineChart>
    </Recharts.ResponsiveContainer>
  );
}
```

Pass rows such as `{ month: 'Jan', balance: 3200 }`. `dataKey` and `xDataKey` accept a row key or `(row, index) => value`. Omitting `xDataKey` uses row indices. `xAxisId` and `yAxisId` select native axes; categorical, numeric, and reversed scales use the host's exact pixel mapping. Null or unmapped values create gaps; `connectNulls` joins across them. Pass the visible row slice when using a Brush. Update `data` to animate; set `animate={false}` to snap. Unmounting automatically cancels animation and listeners, including React StrictMode effect replay.

Render the component after your native Line, and keep that Line registered with `strokeOpacity={0}` rather than `hide`. This preserves native semantics while allowing the hover hole to show through. Use matching axis IDs and `connectNulls` on both components. The overlay uses a Canvas inside SVG `foreignObject` and does not intercept pointer events. It supports vertical Cartesian lines with straight boundaries; native curve/step shapes and stacked areas are outside its scope. Particle/physics options match the standalone graph.

## TanStack Charts integration

For the current `@tanstack/charts` 1.x library, use its default SVG host and the public `onRender` callback. This is separate from the older `react-charts` package.

```ts
import { defineChart, lineY } from '@tanstack/charts';
import { mountChart } from '@tanstack/charts/dom';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { createTanStackPlugin } from 'liquid-graph/tanstack';

const particles = createTanStackPlugin({
  markId: 'savings',
  particleCount: 2400,
});
const optionsFor = (rows) => ({
  ariaLabel: 'Monthly savings',
  onRender: particles.onRender,
  definition: defineChart({
    marks: [lineY(rows, {
      id: 'savings', x: 'month', y: 'balance', stroke: '#75d5f1',
    })],
    scales: { x: { scale: scaleLinear }, y: { scale: scaleLinear } },
  }),
});

// Numeric month indices for this linear-scale example.
const host = mountChart(container, optionsFor([
  { month: 0, balance: 3200 }, { month: 1, balance: 6100 },
]));
host.update(optionsFor(nextRows)); // Existing particles flow to the new scene.
particles.update({ hoverRadius: 36 });
// On unmount:
particles.destroy();
host.destroy();
```

The plugin reads native line segments and their final scene coordinates, preserving missing-data gaps, distinct groups, translations, and clipping. It replaces only the selected mark's ordinary line paths; axes, other marks, semantic interaction points, keyboard focus, and tooltips remain under TanStack's control. Native computed strokes resolve palette CSS variables. `markId` also accepts an array of mark IDs; `particleCount` is the total budget across their segments. Explicit `color` overrides native colors. `animate: false` snaps updates.

With React's default `Chart`, pass the same `onRender` callback and call `particles.destroy()` in effect cleanup. Keep one plugin per chart. Default SVG serialization with stable `data-ts-key` keys is required; full Canvas, custom serializers, curved boundaries, native mark motion, and scene/image export of the particle overlay are not supported. Disable host transition animations so they do not compete with the particle wave. Reduced motion, visibility pausing, responsive coordinates, and device pixel ratio are handled by the shared layer.

A complete React/Recharts and vanilla TanStack comparison lives in [`examples/adapters`](examples/adapters/README.md), with dataset buttons and responsive chart containers. Its dependencies install separately from the existing standalone/Chart.js playground.

## API

| Method | Behavior |
| --- | --- |
| `setData(data, { animate? })` | Update the sorted, cloned data; animation defaults to `true`. |
| `update(options, { animate? })` | Merge and validate options, then retarget particles. Padding merges by side. |
| `resize()` | Remeasure and snap to the container; also handled by ResizeObserver. |
| `pause()` / `resume()` | Pause/resume simulation. Updates still set destinations while paused. |
| `getStats()` | Actual particle count, CSS dimensions, running state, and reduced-motion state. |
| `destroy()` | Idempotent cleanup. Other mutation methods throw after destruction. |

Data uses `{ x: number, y: number, label?: string }`. Numeric timestamps work as x coordinates. Data is sorted by x without mutating the input. Coordinates must be finite and x values unique. Negative y values, empty data, and flat ranges are supported. A lone data point is drawn as a single dot. Explicit domains clip the graph to the visible range. Empty data renders an accessible empty state and stops animation.

### Options

| Option | Default | Purpose |
| --- | --- | --- |
| `data` | required | Readonly array of data points. |
| `color` | `'#75d5f1'` | Any Canvas-compatible CSS color. |
| `particleCount` | `2400` | Particle budget, integer 0–20,000. Start at 1,200–2,400 for mobile. |
| `particleRadius` | `1.15` | Particle size scale in CSS pixels; circles range from tiny specks to occasional large dots. |
| `capHeight` / `falloffHeight` | `12` / `110` | Dense band / sparse tail depth in CSS pixels, measured inward from the curve. |
| `springStrength` / `damping` | `95` / `12` | Attraction to targets / velocity damping. |
| `hoverRadius` / `hoverStrength` | `48` / `1800` | Pointer influence radius / hole strength. Set strength to 0 to disable displacement. |
| `turbulence` | `0.65` | Fill displacement amplitude; the data edge stays still. Set to 0 for a still resting shape. |
| `padding` | `{ top: 25, right: 24, bottom: 42, left: 58 }` | Partial padding in CSS pixels. |
| `xDomain` / `yDomain` | `null` (automatic) | `[min, max]`; pass `null` to reset to automatic. Automatic y includes zero. |
| `grid` / `labels` | `true` / `true` | Show grid lines / axis labels. |
| `gridColor` / `textColor` | translucent gray / `'#7f8b8f'` | Axis styling. |
| `font` | `11px ui-monospace, SFMono-Regular, monospace` | Canvas axis font. |
| `formatX` / `formatY` | numeric / compact numeric | Axis, tooltip, and accessible-table formatters. |
| `label` | `'Interactive particle graph'` | Accessible graph description and table caption. |
| `reducedMotion` | `'auto'` | Follow system preference, or override with `true` / `false`. |
| `seed` | `42` | Reproducible placement and particle identity. |
| `onHover` | — | `(hover: HoverPoint \| null) => void`; nearest source sample changes or selection clears. |
| `onTransitionEnd` | — | `() => void` after an animated update settles. Pointer activity delays completion. |

`HoverPoint` contains a frozen copy of `point`, sorted-data `index`, and `x`/`y` in CSS pixels relative to the graph. Hover readouts always use source data rather than displaced particle positions. Readouts follow the nearest sample, not interpolated values.

Particle count is a budget: empty data yields zero particles and a single-point dataset yields one. Layout generation uses seeded, radius-aware spatial packing. Circle rims follow the data boundary; large circles are placed first in the cap, with small dots filling their gaps. Oversized budgets in small containers reduce circle sizes and relax spacing. Keep spring and damping values near their defaults for a stable liquid feel.

## Interaction and motion

- Mouse/pen hover pushes both boundary and fill particles into a circular rim around the pointer. The opening follows the pointer, and leaving restores the original data shape.
- Touch scrubbing works through Pointer Events; vertical page scrolling remains available.
- Focus the chart and use **Left/Right**, **Home/End**, or **Escape** to inspect samples. A hidden data table and polite keyboard announcements expose the same values to assistive technology.
- Reduced motion snaps changes, disables ambient/pointer particle motion, and stops the animation loop. Tooltips and keyboard exploration remain available. System preference changes are observed live.
- Simulation uses fixed 120 Hz steps with bounded catch-up. Offscreen graphs and hidden documents suspend rendering. No background timers are used.

The renderer targets modern browsers with Canvas 2D, ResizeObserver, Pointer Events, and AbortSignal event listeners. No legacy-browser polyfills are bundled. This reproduces the particle-graph interaction described by Up; it does not simulate a free-floating liquid pool, device tilt, or Up’s private implementation.

## Verify

```sh
npm run check
npm pack --dry-run
```

Unit tests cover layout, deterministic placement, input validation, spring convergence, interrupted transitions, edge stability, and pointer openings and restoration. With the dev server running, `/verify.html` runs browser integration checks for animation, keyboard access, resize, reduced motion, empty states, cleanup, and multiple instances. It reports each result in the page.

MIT licensed.
