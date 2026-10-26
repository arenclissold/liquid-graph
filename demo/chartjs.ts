import type { Chart as ChartInstance } from 'chart.js';
// Use the official self-contained browser build for this script-tag example.
// Application bundlers can instead import Chart from 'chart.js/auto'.
import chartScript from '../node_modules/chart.js/dist/chart.umd.js?url';
import { liquidGraphPlugin } from '../src/chartjs';

const script = document.createElement('script');
script.src = chartScript;
await new Promise<void>((resolve, reject) => {
  script.onload = () => resolve(); script.onerror = () => reject(new Error('Unable to load Chart.js'));
  document.head.append(script);
});
const Chart = (window as unknown as { Chart: typeof ChartInstance }).Chart;
Chart.register(liquidGraphPlugin);
const series = [
  { label: 'House deposit', color: '#75d5f1', data: [3200, 5200, 5200, 8900, 9200, 7400, 13800, 13800, 11400, 17200, 16800, 24680] },
  { label: 'Japan trip', color: '#b9a2f7', data: [800, 800, 2600, 3100, 5600, 5800, 5800, 6400, 1800, 200, 0, 950] },
  { label: 'Rainy day', color: '#9cdeb2', data: [9100, 9100, 4300, 5100, 5700, 2400, 3000, 3000, 6900, 7500, 8100, 8100] },
];
const money = (value: number) => `$${value.toLocaleString()}`;
const chart = new Chart(document.querySelector<HTMLCanvasElement>('#chartjs')!, {
  type: 'line',
  data: { labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    datasets: [{ label: series[0]!.label, data: [...series[0]!.data], borderColor: series[0]!.color, pointRadius: 0, borderWidth: 2 }] },
  options: {
    responsive: true, maintainAspectRatio: false, animation: false,
    color: '#a2afb5', interaction: { mode: 'index', intersect: false },
    plugins: { liquidgraph: { particleCount: 2400 }, legend: { display: true },
      tooltip: { callbacks: { label: (item) => `${item.dataset.label}: ${money(item.parsed.y ?? 0)}` } } },
    scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: '#ffffff0b' }, ticks: { callback: (value) => money(Number(value)) } } },
  },
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-series]')) {
  button.addEventListener('click', () => {
    const selected = series[Number(button.dataset.series)]!;
    Object.assign(chart.data.datasets[0]!, { label: selected.label, data: [...selected.data], borderColor: selected.color });
    document.querySelector('#dataset-title')!.textContent = selected.label;
    document.querySelectorAll('[data-series]').forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
    chart.update();
  });
}
const toggle = document.querySelector<HTMLButtonElement>('#toggle-plugin')!;
toggle.addEventListener('click', () => {
  const enabled = toggle.getAttribute('aria-pressed') !== 'true';
  toggle.setAttribute('aria-pressed', String(enabled)); toggle.textContent = enabled ? 'Particles on' : 'Particles off';
  chart.options.plugins!.liquidgraph = enabled ? { particleCount: 2400 } : false;
  chart.update();
});
window.addEventListener('pagehide', (event) => { if (!event.persisted) chart.destroy(); });
