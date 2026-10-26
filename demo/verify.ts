import { createLiquidGraph } from '../src/index';
const host = document.querySelector<HTMLElement>('#host')!;
const second = document.querySelector<HTMLElement>('#second')!;
const results = document.querySelector('#results')!;
let failures = 0;
const check = (condition: boolean, name: string) => {
  const row = document.createElement('li'); row.className = condition ? 'pass' : 'fail';
  row.textContent = `${condition ? 'PASS' : 'FAIL'} — ${name}`; results.append(row);
  if (!condition) failures++;
};
const frames = async (count: number) => { for (let i = 0; i < count; i++) await new Promise(requestAnimationFrame); };
const graph = createLiquidGraph(host, {
  data: [{ x: 0, y: 10, label: '<b>Start</b>' }, { x: 1, y: 60 }, { x: 2, y: 30 }],
  particleCount: 400, turbulence: 0, reducedMotion: false,
});
await frames(3);
const canvas = host.querySelector('canvas')!;
check(graph.getStats().particles === 400 && graph.getStats().width >= 640, 'constructs a responsive graph');
check(host.querySelectorAll('tbody tr').length === 3 && canvas.tabIndex === 0, 'exposes the complete accessible data table and keyboard focus');
canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
check(host.querySelector('[aria-live]')!.textContent!.includes('<b>Start</b>') && host.querySelector('.liquid-graph__tooltip b') === null, 'keyboard scrubbing announces plain-text labels safely');
canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
check(host.querySelector('[aria-live]')!.textContent!.includes('30'), 'End selects the last source sample');
canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
check((host.querySelector('.liquid-graph__tooltip') as HTMLElement).hidden, 'Escape clears selection');
graph.pause(); check(!graph.getStats().running, 'pause cancels the render loop');
graph.resume(); check(graph.getStats().running, 'resume restarts the render loop');
let complete = 0;
graph.update({ onTransitionEnd: () => { complete++; }, data: [{ x: 0, y: 70 }, { x: 1, y: 20 }, { x: 2, y: 90 }] });
check(host.querySelector('canvas') === canvas && host.querySelectorAll('tbody tr').length === 3, 'data updates reuse the existing canvas and update accessible values');
const deadline = performance.now() + 5000;
while (!complete && performance.now() < deadline) await frames(1);
check(complete === 1, `animated data changes settle and emit one completion callback (${complete})`);
let invalidRejected = false;
try { graph.setData([{ x: 0, y: NaN }]); } catch { invalidRejected = true; }
check(invalidRejected && graph.getStats().particles === 400, 'invalid updates leave the live graph intact');
graph.update({ reducedMotion: true });
check(graph.getStats().reducedMotion && !graph.getStats().running, 'reduced motion snaps and stops animation');
canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
check(!(host.querySelector('.liquid-graph__tooltip') as HTMLElement).hidden, 'reduced motion retains keyboard readouts');
canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
host.style.width = '420px'; await frames(3);
check(Math.abs(graph.getStats().width - 420) < 2, 'ResizeObserver tracks container size changes');
const other = createLiquidGraph(second, { data: [{ x: 0, y: 2 }], reducedMotion: true });
check(other.getStats().particles === 1 && second.querySelector('table')!.id !== host.querySelector('table')!.id, 'single points and multiple independent instances work');
graph.setData([]);
check(graph.getStats().particles === 0 && !graph.getStats().running && host.querySelectorAll('tbody tr').length === 0, 'empty data clears particles, animation, and accessible rows');
graph.destroy(); graph.destroy();
check(host.childElementCount === 0 && second.querySelectorAll('canvas').length === 1, 'idempotent destruction removes only the owning instance');
second.style.display = 'none'; await frames(3);
check(other.getStats().particles === 0 && !other.getStats().running, 'hidden zero-size containers skip sampling and simulation');
second.style.display = ''; await frames(3);
check(other.getStats().particles === 1, 'hidden containers rebuild when they become visible');
other.destroy();
let destroyedRejected = false;
try { graph.resume(); } catch { destroyedRejected = true; }
check(destroyedRejected, 'mutations after destruction are rejected');
document.querySelector('#status')!.textContent = failures ? `${failures} check(s) failed` : `All ${results.children.length} browser checks passed`;
