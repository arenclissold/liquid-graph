import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveOptions, normalizeData } from '../src/options';
import { createLayout, generateTargets, nearestPoint, surfaceY, circleY, boundaryDistance } from '../src/layout';
import { createParticle, retarget, stepParticles, matchParticles } from '../src/physics';
import type { Pointer } from '../src/physics';

const data = [{ x: 0, y: 20 }, { x: 5, y: 80 }, { x: 10, y: 40 }];
const inactive: Pointer = { x: 0, y: 0, vx: 0, vy: 0, active: false };
test('sorts and clones data without modifying caller-owned values', () => {
  const input = [{ x: 2, y: 3 }, { x: 1, y: 2 }];
  const result = normalizeData(input);
  assert.equal(input[0]!.x, 2); assert.equal(result[0]!.x, 1);
  result[0]!.y = 99; assert.equal(input[1]!.y, 2);
});
test('rejects nonfinite data, duplicate positions, and invalid domains', () => {
  assert.throws(() => normalizeData([{ x: NaN, y: 1 }]), /finite/);
  assert.throws(() => normalizeData([{ x: 0, y: Infinity }]), /finite/);
  assert.throws(() => normalizeData([{ x: 1, y: 1 }, { x: 1, y: 2 }]), /unique/);
  assert.throws(() => resolveOptions({ data, yDomain: [2, 2] }), /domains/);
  for (const particleCount of [-1, 0.5, 20001, NaN]) assert.throws(() => resolveOptions({ data, particleCount }), /particleCount/);
  assert.throws(() => resolveOptions({ data, padding: { left: -1 } }), /padding/);
  assert.throws(() => resolveOptions({ data, damping: 0 }), /damping/);
});
test('preserves the linear data edge and supports negative domains', () => {
  const options = resolveOptions({ data: [{ x: 0, y: -50 }, { x: 10, y: 50 }] });
  const layout = createLayout(options, 600, 400);
  assert.deepEqual(layout.yDomain, [-50, 50]);
  assert.equal(surfaceY(layout.points, (layout.left + layout.right) / 2), (layout.top + layout.bottom) / 2);
  assert.equal(surfaceY(layout.points, -100), layout.bottom);
});
test('flat, zero, tiny, empty, and single-point layouts remain finite', () => {
  for (const input of [[], [{ x: 0, y: 0 }], [{ x: 1, y: 5 }, { x: 2, y: 5 }]]) {
    const options = resolveOptions({ data: input, particleCount: 80 });
    const layout = createLayout(options, 4, 4);
    assert.ok(layout.left < layout.right && layout.top < layout.bottom);
    for (const target of generateTargets(layout, options)) assert.ok(Number.isFinite(target.x) && Number.isFinite(target.y));
  }
  const o = resolveOptions({ data: [{ x: 1, y: 5 }] });
  assert.equal(generateTargets(createLayout(o, 600, 400), o).length, 1);
});
test('sampling is deterministic, stays below the edge, and honors its budget', () => {
  const options = resolveOptions({ data, particleCount: 600 });
  const layout = createLayout(options, 600, 400);
  const a = generateTargets(layout, options), b = generateTargets(layout, options);
  assert.deepEqual(a, b); assert.equal(a.length, 600);
  for (const p of a) {
    assert.ok(p.x >= layout.left && p.x <= layout.right);
    assert.ok(p.y >= surfaceY(layout.points, p.x) - 1e-7);
    assert.ok(p.y <= layout.bottom + options.padding.bottom * 0.5);
    assert.ok(p.alpha > 0 && p.alpha <= 1);
  }
  assert.ok(a.some((p) => p.alpha < 0.2));
  assert.ok(a.some((p) => p.alpha > 0.8));
});
test('empty datasets, zero particles, and excluded x ranges have no targets', () => {
  for (const input of [{ data: [] }, { data, particleCount: 0 }, { data, xDomain: [20, 30] as const }]) {
    const options = resolveOptions(input);
    assert.deepEqual(generateTargets(createLayout(options, 600, 400), options), []);
  }
});
test('nearest sample selection clamps and resolves ties consistently', () => {
  assert.equal(nearestPoint(data, -100), 0); assert.equal(nearestPoint(data, 100), 2);
  assert.equal(nearestPoint(data, 2.5), 0); assert.equal(nearestPoint(data, 4), 1);
  assert.equal(nearestPoint([], 4), -1);
});
test('springs converge and alpha settles to its target', () => {
  const options = resolveOptions({ data, turbulence: 0 });
  const particle = createParticle({ x: 100, y: 80, alpha: 0.8, radius: 1, phase: 0 }, 400);
  for (let i = 0; i < 360; i++) stepParticles([particle], inactive, options, 1 / 120, i / 120);
  assert.ok(Math.abs(particle.y - 80) < 0.001);
  assert.ok(Math.abs(particle.vy) < 0.001);
  assert.ok(Math.abs(particle.alpha - 0.8) < 0.001);
});
test('interrupted transitions preserve live position and velocity', () => {
  const p = createParticle({ x: 10, y: 10, alpha: 1, radius: 1, phase: 0 });
  p.vx = 20; p.vy = -10;
  retarget(p, { x: 100, y: 50, alpha: 0.5, radius: 1.2, phase: 0 });
  assert.equal(p.x, 10); assert.equal(p.y, 10); assert.equal(p.vx, 20); assert.equal(p.vy, -10);
  assert.equal(p.tx, 100); assert.equal(p.ty, 50);
});
test('pointer displacement is bounded and leaving restores the fill', () => {
  const options = resolveOptions({ data, turbulence: 0 });
  const p = createParticle({ x: 10, y: 0, alpha: 1, radius: 1, phase: 0 });
  const pointer = { x: 0, y: 0, vx: 1200, vy: 0, active: true };
  for (let i = 0; i < 30; i++) stepParticles([p], pointer, options, 1 / 120, 0);
  assert.ok(p.x > options.hoverRadius * 0.4 && p.x < options.hoverRadius);
  for (let i = 0; i < 360; i++) stepParticles([p], inactive, options, 1 / 120, 0);
  assert.ok(Math.abs(p.x - 10) < 0.001);
});
test('a pointer directly on a particle does not create NaN velocity', () => {
  const options = resolveOptions({ data });
  const p = createParticle({ x: 0, y: 0, alpha: 1, radius: 1, phase: 1 });
  stepParticles([p], { ...inactive, active: true }, options, 1 / 120, 0);
  assert.ok(Number.isFinite(p.vx) && Number.isFinite(p.vy));
});
test('hover spreads particles within 100ms without enlarging the settled opening', () => {
  const options = resolveOptions({ data, turbulence: 0 });
  const p = createParticle({ x: 10, y: 0, alpha: 1, radius: 1, phase: 0 });
  const pointer = { ...inactive, active: true };
  for (let i = 0; i < 12; i++) stepParticles([p], pointer, options, 1 / 120, 0);
  assert.ok(p.x - p.tx > 15);
  for (let i = 0; i < 360; i++) stepParticles([p], pointer, options, 1 / 120, 0);
  const hole = Math.min(options.hoverRadius * 0.6, options.hoverStrength / options.springStrength * 2.2);
  const destination = p.tx + (hole + p.radius) * (1 - p.tx / options.hoverRadius);
  assert.ok(Math.abs(p.x - destination) < 0.001);
});
test('soft collisions separate overlapping neighbors', () => {
  const options = resolveOptions({ data, turbulence: 0 });
  const a = createParticle({ x: 0, y: 0, alpha: 1, radius: 2, phase: 0 });
  const b = createParticle({ x: 1, y: 0, alpha: 1, radius: 2, phase: 0 });
  stepParticles([a, b], inactive, options, 1 / 120, 0);
  assert.ok(b.x - a.x > 1);
});

test('edge particles hold the data shape, open locally on hover, and restore on leave', () => {
  const options = resolveOptions({ data, particleCount: 600, turbulence: 3 });
  const layout = createLayout(options, 600, 400);
  const particles = generateTargets(layout, options).map((target) => createParticle(target));
  const edge = particles.filter((p) => p.edge);
  assert.ok(edge.length > 1);
  for (const p of edge) assert.ok(Math.abs(p.y - Math.min(layout.bottom, circleY(layout.points, p.x, p.radius))) < 1e-7);
  const middle = edge[Math.floor(edge.length / 2)]!;
  const pointer = { x: middle.x, y: middle.y, vx: 1200, vy: 1200, active: true };
  for (let i = 0; i < 240; i++) stepParticles(particles, pointer, options, 1 / 120, i / 120);
  assert.ok(Math.hypot(middle.x - pointer.x, middle.y - pointer.y) > options.hoverRadius * 0.5);
  for (const p of edge.filter((p) => Math.hypot(p.tx - pointer.x, p.ty - pointer.y) > options.hoverRadius)) {
    assert.equal(p.x, p.tx); assert.equal(p.y, p.ty);
  }
  for (let i = 0; i < 360; i++) stepParticles(particles, inactive, options, 1 / 120, i / 120);
  for (const p of edge) assert.ok(Math.hypot(p.x - p.tx, p.y - p.ty) < 0.001);
});
test('stationary hover opens a circular hole and leaving restores the particles', () => {
  const options = resolveOptions({ data, turbulence: 0 });
  const particles = Array.from({ length: 32 }, (_, i) => {
    const angle = i * Math.PI * 2 / 32;
    return createParticle({ x: Math.cos(angle) * 10, y: Math.sin(angle) * 10, alpha: 1, radius: 1, phase: angle });
  });
  particles.push(createParticle({ x: 0, y: 0, alpha: 1, radius: 1, phase: 1 }));
  for (let i = 0; i < 600; i++) stepParticles(particles, { ...inactive, active: true }, options, 1 / 120, i / 120);
  for (const p of particles) {
    assert.ok(Math.hypot(p.x, p.y) - p.radius > options.hoverRadius * 0.5, 'particle rims must clear the hovered opening');
    assert.ok(Math.hypot(p.x, p.y) < options.hoverRadius);
  }
  for (let i = 0; i < 360; i++) stepParticles(particles, inactive, options, 1 / 120, i / 120);
  for (const p of particles) assert.ok(Math.hypot(p.x - p.tx, p.y - p.ty) < 0.001);
});
test('steep edges receive more samples without exceeding the particle budget', () => {
  const flat = resolveOptions({ data: [{ x: 0, y: 50 }, { x: 1, y: 50 }], yDomain: [0, 100], particleCount: 2400 });
  const steep = resolveOptions({ ...flat, data: [{ x: 0, y: 0 }, { x: 1, y: 100 }] });
  const targets = generateTargets(createLayout(steep, 300, 600), steep);
  assert.equal(targets.length, 2400);
  assert.ok(targets.filter((p) => p.edge).length > generateTargets(createLayout(flat, 300, 600), flat).filter((p) => p.edge).length);
});

test('boundary and cap both contain a broad range of circle sizes', () => {
  const options = resolveOptions({ data, particleCount: 1200 });
  const targets = generateTargets(createLayout(options, 800, 500), options);
  for (const band of [targets.filter((p) => p.edge), targets.filter((p) => !p.edge)]) {
    const radii = band.map((p) => p.radius);
    assert.ok(Math.max(...radii) / Math.min(...radii) > 10);
    assert.ok(radii.some((r) => r > options.particleRadius * 3));
  }
});
test('circle rims remain beneath flat, sloped, and cornered data boundaries', () => {
  for (const points of [ [{ x: 0, y: 10 }, { x: 100, y: 10 }],
    [{ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 10 }] ]) {
    for (let x = 5; x <= 95; x += 5) {
      const r = 4, y = circleY(points, x, r);
      for (let offset = -r; offset <= r; offset += 0.1) {
        assert.ok(y - Math.sqrt(Math.max(0, r * r - offset * offset)) >= surfaceY(points, x + offset) - 1e-7);
      }
    }
  }
});

test('zero hover strength disables the pointer opening', () => {
  const options = resolveOptions({ data, turbulence: 0, hoverStrength: 0 });
  const p = createParticle({ x: 10, y: 0, alpha: 1, radius: 1, phase: 0 });
  for (let i = 0; i < 240; i++) stepParticles([p], { ...inactive, active: true, vx: 1200 }, options, 1 / 120, i / 120);
  assert.equal(p.x, 10); assert.equal(p.y, 0);
});

test('falloff circles become smaller and fainter with distance from the boundary', () => {
  const options = resolveOptions({ data: [{ x: 0, y: 50 }, { x: 1, y: 50 }], yDomain: [0, 100], particleCount: 1800 });
  const layout = createLayout(options, 1000, 500);
  const targets = generateTargets(layout, options);
  const surface = surfaceY(layout.points, layout.left);
  const near = targets.filter((p) => !p.edge && p.y - surface < 25);
  const far = targets.filter((p) => p.y - surface > 80);
  const average = (band: typeof targets, property: 'radius' | 'alpha') => band.reduce((sum, p) => sum + p[property], 0) / band.length;
  assert.ok(far.length > 10);
  assert.ok(near.length > far.length * 2);
  assert.ok(average(far, 'alpha') < average(near, 'alpha') * 0.4);
  assert.ok(average(far, 'radius') < average(near, 'radius'));
});
test('mobile, tablet, and desktop layouts retain a packed edge and a sparse tail', () => {
  for (const [width, height] of [[240, 340], [390, 390], [768, 360], [1440, 480]]) {
    const options = resolveOptions({ data, particleCount: Math.round(2400 * width! / 1000) });
    const layout = createLayout(options, width!, height!);
    const targets = generateTargets(layout, options);
    assert.equal(targets.length, options.particleCount);
    assert.ok(targets.some((p) => p.edge && p.alpha > 0.9));
    assert.ok(targets.some((p) => p.alpha < 0.2));
    for (const p of targets) assert.ok(Number.isFinite(p.x + p.y + p.radius));
  }
});

test('dense fill collisions and turbulence cannot push circles above the data boundary', () => {
  for (const [width, count] of [[360, 1800], [1184, 5674]]) {
    const options = resolveOptions({ data, particleCount: count!, turbulence: 0.65 });
    const layout = createLayout(options, width!, 400);
    const particles = generateTargets(layout, options).map((target) => createParticle(target));
    for (let frame = 0; frame < 45; frame++) {
      stepParticles(particles, inactive, options, 1 / 120, frame / 120, layout.points);
      for (const p of particles) assert.ok(p.y >= circleY(layout.points, p.x, p.radius) - 1e-7);
    }
    const p = particles.find((particle) => particle.edge)!;
    const pointer = { ...inactive, x: p.x, y: p.y, active: true };
    for (let frame = 0; frame < 120; frame++) stepParticles(particles, pointer, options, 1 / 120, frame / 120, layout.points);
    assert.ok(Math.hypot(p.x - pointer.x, p.y - pointer.y) > options.hoverRadius * 0.5, 'containment must preserve the hover opening');
  }
});

test('particle falloff fills the wedge beneath a sharp valley at every screen size', () => {
  for (const width of [360, 768, 1184]) {
    const options = resolveOptions({ data: [{ x: 0, y: 90 }, { x: 1, y: 40 }, { x: 2, y: 90 }],
      yDomain: [0, 100], particleCount: Math.round(width * 3), seed: 42 });
    const layout = createLayout(options, width, 440);
    const valley = layout.points[1]!;
    const targets = generateTargets(layout, options);
    const underValley = targets.filter((p) => Math.abs(p.x - valley.x) < 16 && p.y > valley.y + 18 && p.y < valley.y + 70);
    assert.ok(underValley.length >= 5, `missing falloff beneath valley at width ${width}: ${underValley.length}`);
    assert.ok(underValley.some((p) => p.alpha > 0.3));
    for (const p of underValley) assert.ok(boundaryDistance(layout.points, p.x, p.y, 150) <= options.capHeight + options.falloffHeight);
  }
});

test('dataset changes reuse nearby particles within their layer instead of sweeping across the graph', () => {
  const datasets = [
    [3200, 4900, 4650, 8100, 9400, 9000, 12300, 14000, 15700, 11100, 17300, 19500, 24680],
    [2100, 2700, 3100, 3800, 5400, 6000, 7900, 8300, 8500, 3900, 2600, 1500, 920],
    [3900, 4100, 6100, 6300, 6400, 8800, 9050, 5800, 6100, 8700, 9050, 9400, 12450],
  ];
  const layer = (p: { edge?: boolean; band?: string }) => p.edge ? 'edge' : p.band ?? 'cap';
  const targetsFor = (values: number[], width: number) => {
    const options = resolveOptions({ data: values.map((y, x) => ({ x, y })), particleCount: Math.round(width * 2.4) });
    return generateTargets(createLayout(options, width, 400), options);
  };
  for (const width of [360, 1184]) {
    let particles = targetsFor(datasets[0]!, width).map((target) => createParticle(target));
    for (const values of [...datasets.slice(1), datasets[0]!]) {
      const previous = new Map(particles.map((p) => [p, { x: p.x, y: p.y, layer: layer(p) }]));
      for (const p of particles) { p.vx = 3; p.vy = -2; }
      const targets = targetsFor(values, width);
      particles = matchParticles(particles, targets, true, 1.15);
      assert.equal(particles.length, targets.length);
      assert.equal(new Set(particles).size, particles.length);
      let reused = 0;
      for (const p of particles) {
        const before = previous.get(p);
        if (before) {
          reused++;
          assert.equal(layer(p), before.layer);
          assert.ok(Math.abs(p.tx - before.x) <= 1.15 * 8 + 1e-7);
          assert.equal(p.x, before.x); assert.equal(p.y, before.y);
          assert.equal(p.vx, 3); assert.equal(p.vy, -2);
        } else {
          assert.equal(p.x, p.tx);
          assert.equal(p.y, p.motion!.startY);
          assert.equal(p.alpha, 0);
        }
      }
      assert.ok(reused > particles.length * 0.4, 'most nearby particles should retain identity');
      // Interrupt the transition before it settles, as in rapid dataset switching.
      const options = resolveOptions({ data, turbulence: 0 });
      for (let i = 0; i < 12; i++) stepParticles(particles, inactive, options, 1 / 120, i / 120);
    }
  }
});
test('particles cannot swap between boundary and fill when their array positions change', () => {
  const edge = createParticle({ x: 10, y: 10, alpha: 1, radius: 1, phase: 0, edge: true });
  const fill = createParticle({ x: 90, y: 60, alpha: 1, radius: 1, phase: 0, band: 'cap' });
  const targets = [
    { x: 90, y: 30, alpha: 1, radius: 1, phase: 0, edge: true },
    { x: 10, y: 80, alpha: 1, radius: 1, phase: 0, band: 'cap' as const },
  ];
  const matched = matchParticles([edge, fill], targets, true, 1.15);
  assert.ok(matched.every((p) => p !== edge && p !== fill));
  assert.ok(matched.every((p) => p.x === p.tx && p.alpha === 0));
  assert.equal(matched[0]!.y, edge.y);
  assert.equal(matched[1]!.y, fill.y);
});

test('dataset transitions flow in a wave with curved travel and a soft bounded settle', () => {
  const options = resolveOptions({ data, turbulence: 0 });
  const original = [0, 40, 80, 120].map((x) => createParticle({ x, y: 0, alpha: 1, radius: 1, phase: 0, edge: true }));
  const targets = original.map((p) => ({ x: p.x, y: 100, alpha: 1, radius: 4, phase: 0, edge: true }));
  const particles = matchParticles(original, targets, true, options.particleRadius);
  assert.ok(particles.every((p) => p.radius === 1), 'sizes must not snap on retarget');
  for (let i = 0; i < 18; i++) stepParticles(particles, inactive, options, 1 / 120, i / 120);
  assert.ok(particles[0]!.y > particles[3]!.y + 10, 'neighbors should respond with a traveling wave');
  let bend = 0, overshoot = 0;
  for (let i = 18; i < 720; i++) {
    stepParticles(particles, inactive, options, 1 / 120, i / 120);
    bend = Math.max(bend, Math.abs(particles[1]!.x - 40));
    overshoot = Math.max(overshoot, ...particles.map((p) => p.y - 100));
    assert.equal(particles[0]!.x, 0); assert.equal(particles[3]!.x, 120);
  }
  assert.ok(bend > 1 && bend < 15, 'interior particles should follow restrained curved paths');
  assert.ok(overshoot > 2 && overshoot < 30, 'spring motion should retain a little weight without excessive bounce');
  for (const p of particles) {
    assert.ok(Math.hypot(p.x - p.tx, p.y - p.ty) < 0.001);
    assert.ok(Math.abs(p.radius - 4) < 0.001);
    assert.equal(p.motion, undefined);
  }
});

test('new outline dots travel from the existing curve instead of revealing the final line immediately', () => {
  const options = resolveOptions({ data, turbulence: 0 });
  const old = [0, 100].map((x) => createParticle({ x, y: 10, radius: 1, alpha: 1, phase: 0, edge: true }));
  const targets = [0, 25, 50, 75, 100].map((x) => ({ x, y: 110, radius: 2, alpha: 1, phase: 0, edge: true }));
  const particles = matchParticles(old, targets, true, options.particleRadius);
  assert.ok(particles.every((p) => p.y === 10));
  assert.equal(particles.filter((p) => p.alpha === 0).length, 3);
  for (let i = 0; i < 12; i++) stepParticles(particles, inactive, options, 1 / 120, i / 120);
  assert.ok(particles.every((p) => p.y < 30), 'no dots should draw the destination outline ahead of the wave');
  assert.ok(particles[2]!.alpha > 0, 'new dots should become visible on the moving graph');
  for (let i = 0; i < 720; i++) stepParticles(particles, inactive, options, 1 / 120, i / 120);
  assert.ok(particles.every((p) => Math.abs(p.y - 110) < 0.001));
});
