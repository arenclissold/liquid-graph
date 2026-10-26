import * as React from 'react';
import { createRoot } from 'react-dom/client';
import * as Recharts from 'recharts';
import { defineChart, lineY } from '@tanstack/charts';
import { mountChart } from '@tanstack/charts/dom';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { createRechartsPlugin } from 'liquid-graph/recharts';
import { createTanStackPlugin } from 'liquid-graph/tanstack';

const LiquidLine = createRechartsPlugin(React, Recharts);
const examples = [
  { name: 'House deposit', color: '#75d5f1', values: [3200, 5200, 5200, 8900, 9200, 7400, 13800, 13800, 11400, 17200, 16800, 24680] },
  { name: 'Japan trip', color: '#b9a2f7', values: [800, 800, 2600, 3100, 5600, 5800, 5800, 6400, 1800, 200, 0, 950] },
  { name: 'Rainy day', color: '#9cdeb2', values: [9100, 9100, 4300, 5100, 5700, 2400, 3000, 3000, 6900, 7500, 8100, 8100] },
];
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
function tanstackOptions(index: number, plugin: ReturnType<typeof createTanStackPlugin>) {
  const example = examples[index]!;
  return {
    ariaLabel: `${example.name} monthly savings`,
    onRender: plugin.onRender,
    definition: defineChart({
      marks: [lineY(example.values.map((balance, month) => ({ month, balance })), { id: 'savings', x: 'month', y: 'balance', stroke: example.color })],
      scales: { x: { scale: scaleLinear }, y: { scale: scaleLinear().domain([0, 26000]) } },
      theme: { foreground: '#dceaf1', muted: '#a6afb8', grid: '#32363f', background: 'transparent' },
    }),
  };
}
function App() {
  const [index, setIndex] = React.useState(0);
  const example = examples[index]!;
  const rows = example.values.map((balance, month) => ({ month: months[month]!, balance }));
  const container = React.useRef<HTMLDivElement>(null);
  const host = React.useRef<{ update(options: ReturnType<typeof tanstackOptions>): void } | null>(null);
  const plugin = React.useRef<ReturnType<typeof createTanStackPlugin> | null>(null);
  React.useEffect(() => {
    if (!container.current) return;
    const particles = createTanStackPlugin({ markId: 'savings', particleCount: 1800 });
    plugin.current = particles;
    const mounted = mountChart(container.current, tanstackOptions(0, particles));
    host.current = mounted;
    return () => { particles.destroy(); mounted.destroy(); host.current = null; };
  }, []);
  React.useEffect(() => {
    if (host.current && plugin.current) host.current.update(tanstackOptions(index, plugin.current));
  }, [index]);
  return <>
    <div role="group" aria-label="Savings examples">{examples.map((item, i) => <button key={item.name} aria-pressed={index === i} onClick={() => setIndex(i)}>{item.name}</button>)}</div>
    <section><h2>Recharts · {example.name}</h2><div className="chart"><Recharts.ResponsiveContainer width="100%" height="100%">
      <Recharts.LineChart data={rows} margin={{ top: 20, right: 16, bottom: 12, left: 8 }} accessibilityLayer>
        <Recharts.CartesianGrid stroke="#32363f" vertical={false} />
        <Recharts.XAxis dataKey="month" stroke="#a6afb8" />
        <Recharts.YAxis domain={[0, 26000]} tickFormatter={money} width={64} stroke="#a6afb8" />
        <Recharts.Tooltip formatter={(value) => money(Number(value))} contentStyle={{ background: '#262b34', borderColor: '#48515d' }} />
        <Recharts.Line dataKey="balance" name={example.name} stroke={example.color} strokeOpacity={0} dot={false} isAnimationActive={false} />
        <LiquidLine data={rows} xDataKey="month" dataKey="balance" color={example.color} particleCount={1800} />
      </Recharts.LineChart>
    </Recharts.ResponsiveContainer></div></section>
    <section><h2>TanStack Charts · {example.name}</h2><div className="chart" ref={container} /></section>
  </>;
}
createRoot(document.querySelector('#app')!).render(<React.StrictMode><App /></React.StrictMode>);
