import { createLiquidGraph } from '../src/index';
import type { DataPoint } from '../src/index';

const get = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing demo element: ${selector}`);
  return element;
};
const currency = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
const date = (value: number) => new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(value);
const day = 86400000;
const end = Date.UTC(2026, 9, 22);
const definitions = {
  house: { name: 'House deposit', caption: 'A year of getting a little closer.', color: '#75d5f1',
    milestones: [[0, 3200], [20, 3200], [21, 4650], [48, 4650], [49, 5900], [76, 5900],
      [77, 7400], [104, 7400], [105, 10800], [130, 10800], [148, 12100], [162, 12100],
      [163, 7800], [181, 7800], [182, 9400], [209, 9400], [210, 11200], [237, 11200],
      [238, 15600], [259, 15600], [280, 18200], [302, 18200], [303, 20500], [331, 20500],
      [332, 22200], [348, 22200], [349, 23400], [359, 23400], [360, 24200], [363, 24200], [365, 24680]] },
  holiday: { name: 'Japan trip', caption: 'Saved for the trip. Spent on the memories.', color: '#b9a2f7',
    milestones: [[0, 2100], [28, 2100], [29, 3200], [70, 4100], [85, 4100], [86, 5900],
      [122, 5900], [123, 7300], [162, 8500], [190, 8500], [191, 5100], [206, 5100],
      [207, 4600], [233, 4600], [234, 2900], [250, 1800], [270, 1800], [271, 320],
      [290, 320], [291, 0], [310, 0], [311, 1600], [335, 1600], [336, 2850],
      [348, 2850], [349, 2100], [359, 2100], [360, 1450], [362, 1450], [363, 920], [365, 920]] },
  rainy: { name: 'Rainy day', caption: 'A little peace of mind, one deposit at a time.', color: '#9cdeb2',
    milestones: [[0, 3900], [18, 3900], [19, 6400], [45, 6400], [46, 7200], [65, 7200],
      [66, 900], [94, 900], [95, 2400], [118, 2400], [140, 4600], [157, 4600],
      [158, 9800], [185, 9800], [186, 5600], [215, 5600], [216, 6800], [241, 6800],
      [242, 1500], [268, 1500], [269, 4200], [292, 4200], [293, 7900], [320, 7900],
      [321, 10200], [345, 10200], [346, 11800], [359, 11800], [360, 11050], [362, 11050], [363, 12450], [365, 12450]] },
} as const;
const formatValue = (value: number) => `$${Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}`;
function renderMetric(value: number): void {
  const formatted = currency.format(value), split = formatted.lastIndexOf('.');
  const decimals = document.createElement('span'); decimals.textContent = formatted.slice(split);
  get('#metric').replaceChildren(document.createTextNode(formatted.slice(0, split)), decimals);
}
type Dataset = keyof typeof definitions;
type Period = 'week' | 'month' | 'year' | 'all';
let dataset: Dataset = 'house', period: Period = 'year', paused = false;
let density = 2400;
const chartHost = get('#chart');
const responsivePadding = () => ({ left: chartHost.clientWidth < 480 ? 16 : 88, right: 24, top: 28, bottom: 54 });
const responsiveCount = () => Math.round(density * Math.min(1.5, Math.max(0.2, chartHost.clientWidth / 1000)));
const updateParticleCaption = () => { get('#particle-caption').textContent = `${chart.getStats().particles.toLocaleString('en')} PARTICLES · CANVAS 2D`; };
function makeData(): DataPoint[] {
  const milestones = definitions[dataset].milestones;
  const all = Array.from({ length: 731 }, (_, i) => {
    const recent = Math.max(0, i - 365);
    let segment = 0;
    while (segment < milestones.length - 2 && milestones[segment + 1]![0] <= recent) segment++;
    const [fromDay, fromValue] = milestones[segment]!;
    const [toDay, toValue] = milestones[segment + 1]!;
    const fraction = (recent - fromDay) / (toDay - fromDay);
    // Flat stretches, one-day transactions, and gradual rebuilds tell distinct stories.
    const value = i < 365
      ? milestones[0][1] * (0.25 + 0.75 * Math.floor(i / 28) / 13)
      : fromValue + (toValue - fromValue) * fraction;
    const x = end - (730 - i) * day;
    return { x, y: Math.round(value), label: date(x) };
  });
  const length = { week: 7, month: 30, year: 365, all: 731 }[period];
  return all.slice(-length);
}
const chart = createLiquidGraph(chartHost, {
  data: makeData(), color: definitions[dataset].color, particleCount: responsiveCount(),
  padding: responsivePadding(),
  gridColor: 'rgba(160, 170, 175, 0.07)', turbulence: 0.18,
  label: 'House deposit savings over time', formatX: date,
  formatY: formatValue,
  onHover: (hover) => {
    if (hover) {
      renderMetric(hover.point.y);
      get('#metric-caption').textContent = `${hover.point.label} · ${definitions[dataset].name}`;
    } else updateMetric();
  },
});
function updateMetric(): void {
  const data = makeData(), last = data.at(-1)!, first = data[0]!;
  renderMetric(last.y);
  get('#metric-label').textContent = definitions[dataset].name.toUpperCase();
  get('#metric-caption').textContent = definitions[dataset].caption;
  const percentage = (last.y - first.y) / Math.max(1, Math.abs(first.y)) * 100;
  const change = get('#change');
  change.textContent = `${percentage >= 0 ? '↗' : '↘'} ${Math.abs(percentage).toFixed(1)}%`;
  change.classList.toggle('negative', percentage < 0);
}
function refresh(color?: string): void {
  chart.update({ ...(color ? { color } : {}), data: makeData(), label: `${definitions[dataset].name} savings over time` });
  updateMetric();
}
function setColor(color: string): void {
  document.documentElement.style.setProperty('--accent', color);
  chart.update({ color }, { animate: false });
  document.querySelectorAll<HTMLButtonElement>('[data-color]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.color === color)));
}
document.querySelectorAll<HTMLButtonElement>('[data-period]').forEach((button) => button.addEventListener('click', () => {
  period = button.dataset.period as Period;
  document.querySelectorAll('[data-period]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
  refresh();
}));
document.querySelectorAll<HTMLButtonElement>('[data-dataset]').forEach((button) => button.addEventListener('click', () => {
  dataset = button.dataset.dataset as Dataset;
  document.querySelectorAll('[data-dataset]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
  // Apply color and data together to keep a single continuous transition.
  const color = definitions[dataset].color;
  document.documentElement.style.setProperty('--accent', color);
  document.querySelectorAll<HTMLButtonElement>('[data-color]').forEach((item) => item.setAttribute('aria-pressed', String(item.dataset.color === color)));
  refresh(color);
}));
document.querySelectorAll<HTMLButtonElement>('[data-color]').forEach((button) => button.addEventListener('click', () => setColor(button.dataset.color!)));
function updateMotionStatus(): void {
  const reduced = chart.getStats().reducedMotion;
  get('#motion-status').textContent = reduced ? 'Taking it slow. Reduced motion is on.' : paused ? 'A moment of stillness.' : 'A graph that feels like something.';
  get('#motion-dot').classList.toggle('still', reduced || paused);
}
get('#pause').addEventListener('click', () => {
  paused = !paused;
  if (paused) chart.pause(); else chart.resume();
  get('#pause').setAttribute('aria-pressed', String(paused));
  get('#pause').textContent = paused ? '▷ Resume motion' : 'Ⅱ Pause motion';
  updateMotionStatus();
});
get<HTMLInputElement>('#density').addEventListener('input', (event) => {
  const value = Number((event.target as HTMLInputElement).value);
  get('#density-value').textContent = `${(value / 1000).toFixed(1)}k`;
  density = value;
  chart.update({ particleCount: responsiveCount() }, { animate: false });
  updateParticleCaption();
});
const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const motion = get<HTMLInputElement>('#reduced-motion'); motion.checked = motionQuery.matches;
motion.addEventListener('change', () => { chart.update({ reducedMotion: motion.checked }); updateMotionStatus(); });
motionQuery.addEventListener('change', () => { motion.checked = motionQuery.matches; chart.update({ reducedMotion: 'auto' }); updateMotionStatus(); });
get('#copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(get('#example-code').textContent ?? '');
    get('#copy').textContent = 'Copied ✓';
    window.setTimeout(() => { get('#copy').textContent = 'Copy code ⧉'; }, 1800);
  } catch { get('#copy').textContent = 'Select the code to copy'; }
});
const densityObserver = new ResizeObserver(() => {
  const count = responsiveCount();
  if (chart.getStats().particles !== count) chart.update({ particleCount: count, padding: responsivePadding() }, { animate: false });
  updateParticleCaption();
});
densityObserver.observe(chartHost);
updateMetric(); updateMotionStatus(); updateParticleCaption();
// Vite cleans up the instance before re-running this module during development.
if (import.meta.hot) import.meta.hot.dispose(() => { densityObserver.disconnect(); chart.destroy(); });
