import { loadIntegration } from './integration-hosts';
import { highlightCode } from './highlight';
import type { IntegrationDemo, IntegrationLibrary } from './integration-hosts';
import { integrationSeries, integrationMoney } from './integration-data';

const snippets: Record<IntegrationLibrary, string> = {
  chartjs: `import Chart from 'chart.js/auto';
import { liquidGraphPlugin } from 'liquid-graph/chartjs';

Chart.register(liquidGraphPlugin);

const chart = new Chart(canvas, {
  type: 'line',
  data: { labels, datasets: [{ data: balances }] },
  options: {
    animation: false,
    plugins: { liquidgraph: { particleCount: 2400 } },
  },
});

chart.data.datasets[0].data = nextBalances;
chart.update();`,
  tanstack: `import { mountChart } from '@tanstack/charts/dom';
import { createTanStackPlugin } from 'liquid-graph/tanstack';

// Give your lineY mark the id 'savings'.
const particles = createTanStackPlugin({
  markId: 'savings',
  particleCount: 2400,
});

const chart = mountChart(container, {
  definition,
  ariaLabel: 'Monthly savings',
  onRender: particles.onRender,
});

// On unmount:
particles.destroy();
chart.destroy();`,
  recharts: `import * as React from 'react';
import * as Recharts from 'recharts';
import { createRechartsPlugin } from 'liquid-graph/recharts';

const LiquidLine = createRechartsPlugin(React, Recharts);

// Inside your LineChart, after its axes and tooltip:
<Recharts.Line
  dataKey="balance" strokeOpacity={0}
  dot={false} isAnimationActive={false}
/>
<LiquidLine
  data={rows} xDataKey="month" dataKey="balance"
  color="#75d5f1" particleCount={2400}
/>`,
};
const descriptions: Record<IntegrationLibrary, string> = {
  chartjs: 'Native Chart.js axes and tooltips. A particle surface that flows with your data.',
  tanstack: 'TanStack’s SVG axes and scene, with Liquid Graph bringing the line to life.',
  recharts: 'A React component inside your Recharts chart. Same scales. A little more motion.',
};
const titles: Record<IntegrationLibrary, string> = { chartjs: 'Chart.js', tanstack: 'TanStack Charts', recharts: 'Recharts' };
const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-library]')];
const host = document.querySelector<HTMLElement>('#integration-chart')!;
const status = document.querySelector<HTMLElement>('#integration-status')!;
const retry = document.querySelector<HTMLButtonElement>('#integration-retry')!;
const toggle = document.querySelector<HTMLButtonElement>('#integration-toggle')!;
const code = document.querySelector<HTMLElement>('#integration-code')!;
const copy = document.querySelector<HTMLButtonElement>('#integration-copy')!;
const datasets = [...document.querySelectorAll<HTMLButtonElement>('[data-integration-dataset]')];
const requestedLibrary = new URL(window.location.href).searchParams.get('library');
let library: IntegrationLibrary = requestedLibrary === 'tanstack' || requestedLibrary === 'recharts' ? requestedLibrary : 'chartjs';
let dataset = 0, enabled = true, generation = 0;
let active: IntegrationDemo | undefined;
const state = () => ({ dataset: integrationSeries[dataset]!, enabled });
const updateMetric = () => {
  const series = integrationSeries[dataset]!;
  document.querySelector('#integration-label')!.textContent = series.label;
  document.querySelector('#integration-value')!.textContent = integrationMoney(series.values.at(-1)!);
  document.querySelector<HTMLElement>('#integrations')!.style.setProperty('--integration-accent', series.color);
};
async function select(next: IntegrationLibrary): Promise<void> {
  library = next;
  const url = new URL(window.location.href); url.searchParams.set('library', next);
  window.history.replaceState(null, '', url);
  const token = ++generation;
  active?.destroy(); active = undefined; host.replaceChildren();
  for (const tab of tabs) {
    const selected = tab.dataset.library === next;
    tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
  }
  document.querySelector('#integration-panel')!.setAttribute('aria-labelledby', `library-${next}`);
  document.querySelector('#integration-description')!.textContent = descriptions[next];
  document.querySelector('#integration-file')!.textContent = next === 'recharts' ? 'your-chart.tsx' : 'your-chart.ts';
  highlightCode(code, snippets[next]);
  status.hidden = false; status.textContent = `Loading ${titles[next]}…`; retry.hidden = true;
  host.setAttribute('aria-busy', 'true'); toggle.disabled = true;
  try {
    const mount = await loadIntegration(next);
    if (token !== generation) return;
    active = mount(host, state());
    status.hidden = true; toggle.disabled = false;
  } catch (error) {
    if (token !== generation) return;
    active?.destroy(); active = undefined; host.replaceChildren();
    status.textContent = `This example couldn’t load. Check your connection, then reload to try again.`;
    retry.hidden = false;
    console.error(`Unable to load ${titles[next]} example`, error);
  } finally { if (token === generation) host.setAttribute('aria-busy', 'false'); }
}
for (const [index, tab] of tabs.entries()) {
  tab.addEventListener('click', () => { void select(tab.dataset.library as IntegrationLibrary); });
  tab.addEventListener('keydown', (event) => {
    const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!offset && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const next = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + offset + tabs.length) % tabs.length]!;
    next.focus(); void select(next.dataset.library as IntegrationLibrary);
  });
}
for (const button of datasets) button.addEventListener('click', () => {
  dataset = Number(button.dataset.integrationDataset);
  datasets.forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
  updateMetric(); active?.update(state());
});
toggle.addEventListener('click', () => {
  enabled = !enabled; toggle.setAttribute('aria-pressed', String(enabled)); toggle.textContent = enabled ? 'Particles on' : 'Particles off';
  active?.update(state());
});
retry.addEventListener('click', () => { window.location.reload(); });
copy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(snippets[library]); copy.textContent = 'Copied';
    window.setTimeout(() => { copy.textContent = 'Copy code'; }, 1500);
  } catch { copy.textContent = 'Select code to copy'; }
});
updateMetric();
highlightCode(code, snippets[library]);
// Initialize when the section comes into view, keeping the first chart lightweight.
if (typeof IntersectionObserver === 'undefined') void select(library);
else {
  const observer = new IntersectionObserver(([entry]) => {
    if (entry?.isIntersecting) { observer.disconnect(); if (!generation) void select(library); }
  }, { rootMargin: '200px' });
  observer.observe(document.querySelector('#integrations')!);
  window.addEventListener('pagehide', (event) => { if (!event.persisted) observer.disconnect(); });
}
window.addEventListener('pagehide', (event) => { if (!event.persisted) { generation++; active?.destroy(); } });
