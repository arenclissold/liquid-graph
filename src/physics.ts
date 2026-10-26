import { circleY } from './layout';
import type { Layout, Target } from './layout';
import type { ResolvedOptions } from './types';
interface TransitionMotion { age: number; delay: number; startX: number; startY: number; flowX: number; spring: number; damping: number }
export interface Particle extends Target {
  tx: number; ty: number; vx: number; vy: number; targetAlpha: number; targetRadius: number;
  motion?: TransitionMotion;
}
export interface Pointer { x: number; y: number; vx: number; vy: number; active: boolean }
export function createParticle(target: Target, fromBottom?: number): Particle {
  return { ...target, y: fromBottom ?? target.y, tx: target.x, ty: target.y,
    vx: 0, vy: 0, alpha: fromBottom === undefined ? target.alpha : 0, targetAlpha: target.alpha, targetRadius: target.radius };
}
export function retarget(particle: Particle, target: Target): void {
  particle.tx = target.x; particle.ty = target.y; particle.targetAlpha = target.alpha;
  particle.targetRadius = target.radius; particle.phase = target.phase;
  particle.edge = target.edge ?? false;
  particle.band = target.band ?? 'cap';
}
/** Keep particle identity local in x and within its edge/cap/falloff layer. */
export function matchParticles(particles: Particle[], targets: Target[], animate: boolean, radius: number): Particle[] {
  const result: Particle[] = new Array(targets.length);
  const layer = (p: Target) => p.edge ? 'edge' : p.band ?? 'cap';
  const maxTravel = Math.max(4, radius * 8);
  let minX = Infinity, maxX = -Infinity;
  for (const target of targets) { minX = Math.min(minX, target.x); maxX = Math.max(maxX, target.x); }
  for (const band of ['edge', 'cap', 'falloff']) {
    const existing = particles.filter((p) => layer(p) === band).sort((a, b) => a.x - b.x);
    const destinations = targets.map((target, index) => ({ target, index }))
      .filter(({ target }) => layer(target) === band).sort((a, b) => a.target.x - b.target.x);
    const originAt = (x: number) => {
      if (!existing.length) return undefined;
      let low = 0, high = existing.length - 1;
      while (low + 1 < high) {
        const mid = (low + high) >>> 1;
        if (existing[mid]!.x <= x) low = mid; else high = mid;
      }
      const a = existing[low]!, b = existing[high]!;
      const mix = Math.max(0, Math.min(1, (x - a.x) / Math.max(0.001, b.x - a.x)));
      return { y: a.y + (b.y - a.y) * mix, vx: a.vx + (b.vx - a.vx) * mix,
        vy: a.vy + (b.vy - a.vy) * mix, radius: a.radius + (b.radius - a.radius) * mix };
    };
    let cursor = 0;
    for (const { target, index } of destinations) {
      while (cursor < existing.length && existing[cursor]!.x < target.x - maxTravel) cursor++;
      while (cursor + 1 < existing.length && Math.abs(existing[cursor + 1]!.x - target.x) < Math.abs(existing[cursor]!.x - target.x)) cursor++;
      const candidate = existing[cursor];
      const particle = candidate && Math.abs(candidate.x - target.x) <= maxTravel ? existing[cursor++]! : createParticle(target);
      // New dots start on the current layer, not on the final curve. Otherwise
      // their fade reveals the destination outline ahead of the moving wave.
      if (particle !== candidate && animate) {
        const origin = originAt(target.x);
        if (origin) {
          particle.y = origin.y; particle.radius = origin.radius;
          particle.vx = origin.vx; particle.vy = origin.vy;
        }
        particle.alpha = 0;
      }
      retarget(particle, target);
      if (animate) {
        const progress = (target.x - minX) / Math.max(1, maxX - minX);
        const endFade = Math.min(1, Math.max(0, Math.min(target.x - minX, maxX - target.x)) / 48);
        const variation = (Math.sin(target.phase) + 1) / 2;
        particle.motion = {
          age: 0, delay: progress * 0.13 + variation * 0.035 + (band === 'falloff' ? 0.075 : 0.035),
          startX: particle.x, startY: particle.y,
          flowX: Math.sin(target.x * 0.014 + target.phase * 0.25) * Math.min(14, Math.abs(target.y - particle.y) * 0.1) * endFade,
          spring: 0.62 + variation * 0.25, damping: 0.62 + variation * 0.12,
        };
      } else delete particle.motion;
      result[index] = particle;
    }
  }
  return result;
}
/** Semi-implicit Euler springs, exponential damping, and local pointer forces. */
export function stepParticles(particles: Particle[], pointer: Pointer, options: ResolvedOptions, dt: number, time: number, boundary?: Layout['points']): number {
  const damping = Math.exp(-options.damping * dt);
  let energy = 0;
  for (const p of particles) {
    const drift = p.edge ? 0 : options.turbulence;
    let tx = p.tx + Math.sin(time * 0.8 + p.phase) * drift;
    let ty = p.ty + Math.cos(time * 0.65 + p.phase * 1.3) * drift;
    let response = 1;
    let springScale = 1, dampingScale = 1;
    if (p.motion) {
      const motion = p.motion;
      motion.age += dt;
      const elapsed = motion.age - motion.delay;
      springScale = motion.spring; dampingScale = motion.damping;
      if (elapsed < 0) { tx = motion.startX; ty = motion.startY; }
      else tx += motion.flowX * Math.sin(Math.PI * Math.min(1, elapsed / 0.7));
      if (elapsed > 1.8) delete p.motion;
    }
    if (pointer.active && options.hoverRadius > 0 && options.hoverStrength > 0) {
      // Expand resting positions into an annulus around the pointer. The
      // spring opens a real hole, including the boundary, without runaway force.
      const dx = p.tx - pointer.x, dy = p.ty - pointer.y;
      const distance = Math.hypot(dx, dy);
      if (distance < options.hoverRadius) {
        response = 2.5;
        springScale = 1; dampingScale = 1;
        const hole = Math.min(options.hoverRadius * 0.6, options.hoverStrength / options.springStrength * 2.2);
        const offset = (hole + p.radius) * (1 - distance / options.hoverRadius);
        const nx = distance > 0.001 ? dx / distance : Math.cos(p.phase);
        const ny = distance > 0.001 ? dy / distance : Math.sin(p.phase);
        tx = p.tx + nx * offset;
        ty = p.ty + ny * offset;
      }
    }
    // Speed up the hover spring and its damping together, preserving the
    // opening's size and keeping the usual return/data-transition motion.
    const spring = options.springStrength * response ** 2 * springScale;
    const localDamping = response === 1 && dampingScale === 1 ? damping : Math.exp(-options.damping * response * dampingScale * dt);
    p.vx += (tx - p.x) * spring * dt;
    p.vy += (ty - p.y) * spring * dt;
    p.vx *= localDamping; p.vy *= localDamping;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.alpha += (p.targetAlpha - p.alpha) * (1 - Math.exp(-9 * dt));
    p.radius += (p.targetRadius - p.radius) * (1 - Math.exp(-8 * dt));
    energy += (p.tx - p.x) ** 2 + (p.ty - p.y) ** 2 + (p.vx ** 2 + p.vy ** 2) * 0.02;
  }
  // A spatial hash keeps soft particle collisions local rather than O(n²).
  const cellSize = Math.max(1, ...particles.map((p) => p.radius * 2));
  const cells = new Map<string, number[]>();
  for (let i = 0; i < particles.length; i++) {
    const a = particles[i]!;
    const cx = Math.floor(a.x / cellSize), cy = Math.floor(a.y / cellSize);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const j of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
        const b = particles[j]!, ox = a.x - b.x, oy = a.y - b.y;
        const distance = Math.hypot(ox, oy), minimum = (a.radius + b.radius) * 0.82;
        if (distance < minimum && distance > 0.001) {
          const push = (minimum - distance) / distance * 0.15;
          // The data edge is a boundary; only the fill yields to collisions.
          if (!a.edge) { a.x += ox * push; a.y += oy * push; }
          if (!b.edge) { b.x -= ox * push; b.y -= oy * push; }
        }
      }
    }
    const k = `${cx},${cy}`, cell = cells.get(k); if (cell) cell.push(i); else cells.set(k, [i]);
  }
  // Dense fill collisions must yield into the graph, never through its rim.
  // Leave the active hover opening free to deform the boundary locally.
  if (boundary?.length) {
    for (const p of particles) {
      if (pointer.active && options.hoverStrength > 0 && Math.hypot(p.tx - pointer.x, p.ty - pointer.y) < options.hoverRadius) continue;
      const floor = circleY(boundary, p.x, p.radius);
      if (p.y < floor) { p.y = floor; p.vy = Math.max(0, p.vy); }
    }
  }
  return energy / Math.max(1, particles.length);
}
