import type { Particle } from './physics';

/** Shared Canvas renderer for standalone graphs and host-chart adapters. */
export function drawParticles(ctx: CanvasRenderingContext2D, particles: readonly Particle[], color: string): void {
  ctx.fillStyle = color;
  for (let bucket = 0; bucket < 10; bucket++) {
    ctx.globalAlpha = (bucket + 1) / 10;
    ctx.beginPath();
    for (const p of particles) {
      if (p.alpha < 0.025 || Math.min(9, Math.floor(p.alpha * 10)) !== bucket) continue;
      ctx.moveTo(p.x + p.radius, p.y);
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
