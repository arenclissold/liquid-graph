import { generateTargets } from './layout';
import type { Layout } from './layout';
import { resolveOptions } from './options';
import { matchParticles, stepParticles } from './physics';
import type { Particle, Pointer } from './physics';
import { drawParticles } from './render';
import type { LiquidGraphOptions, ResolvedOptions } from './types';

/** Host adapters own data, scales, axes, tooltips, and accessible semantics. */
export type ParticleStyleOptions = Pick<LiquidGraphOptions,
  'color' | 'particleCount' | 'particleRadius' | 'capHeight' | 'falloffHeight' |
  'springStrength' | 'damping' | 'hoverRadius' | 'hoverStrength' | 'turbulence' |
  'seed' | 'reducedMotion'>;
export interface PixelPoint { x: number; y: number }
export interface PlotBounds { x: number; y: number; width: number; height: number }
export interface ParticleSeries {
  /** Stable across updates; separate paths/gaps need separate keys. */
  key: string;
  points: readonly PixelPoint[];
  bounds?: PlotBounds;
  color?: string | undefined;
}
export interface ParticleFrame {
  width: number;
  height: number;
  bounds: PlotBounds;
  series: readonly ParticleSeries[];
  options?: ParticleStyleOptions;
}
interface Group { key: string; layout: Layout; particles: Particle[]; color: string }

/** Canvas overlay shared by the Recharts and TanStack integrations. */
export class ParticleLayer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly view: Window | null;
  private readonly query: MediaQueryList | undefined;
  private readonly dispose: (() => void)[] = [];
  private options: ResolvedOptions = resolveOptions({ data: [] });
  private groups: Group[] = [];
  private frame: ParticleFrame | undefined;
  private pointer: Pointer = { x: 0, y: 0, vx: 0, vy: 0, active: false };
  private signature = '';
  private raf = 0;
  private lastTime = 0;
  private accumulator = 0;
  private time = 0;
  private visible = true;
  private destroyed = false;
  private transitioning = false;
  private settled = 0;
  private dpr = 1;

  constructor(private readonly canvas: HTMLCanvasElement, pointerTarget: Element) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('liquid-graph: Canvas 2D is unavailable.');
    this.ctx = ctx;
    this.view = canvas.ownerDocument.defaultView;
    this.query = this.view?.matchMedia?.('(prefers-reduced-motion: reduce)');
    const move = (event: Event) => {
      const e = event as PointerEvent;
      const rect = canvas.getBoundingClientRect();
      if (!this.frame || rect.width <= 0 || rect.height <= 0) return;
      const x = (e.clientX - rect.left) * this.frame.width / rect.width;
      const y = (e.clientY - rect.top) * this.frame.height / rect.height;
      const b = this.frame.bounds;
      this.pointer = { x, y, vx: 0, vy: 0, active: !this.reduced && x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height };
      this.start();
    };
    const leave = () => { this.pointer.active = false; this.start(); };
    this.listen(pointerTarget, 'pointermove', move);
    this.listen(pointerTarget, 'pointerdown', move);
    this.listen(pointerTarget, 'pointerleave', leave);
    this.listen(pointerTarget, 'pointercancel', leave);
    this.listen(pointerTarget, 'pointerup', (event) => { if ((event as PointerEvent).pointerType !== 'mouse') leave(); });
    this.listen(canvas.ownerDocument, 'visibilitychange', () => { leave(); this.stop(); this.start(); });
    if (this.query) this.listen(this.query, 'change', () => {
      this.pointer.active = false; this.stop();
      if (this.reduced) { this.snap(); this.draw(); } else this.start();
    });
    if (typeof IntersectionObserver !== 'undefined') {
      const observer = new IntersectionObserver(([entry]) => {
        this.visible = entry?.isIntersecting ?? true;
        this.stop(); this.start();
      });
      observer.observe(canvas);
      this.dispose.push(() => observer.disconnect());
    }
  }
  private listen(target: EventTarget, name: string, handler: EventListener): void {
    target.addEventListener(name, handler, { passive: true });
    this.dispose.push(() => target.removeEventListener(name, handler));
  }
  private get reduced(): boolean {
    return !this.view || (this.options.reducedMotion === 'auto' ? !!this.query?.matches : this.options.reducedMotion);
  }
  update(frame: ParticleFrame, animate = true): void {
    if (this.destroyed) throw new Error('liquid-graph: this layer has been destroyed.');
    const { width, height, bounds } = frame;
    if (![width, height, bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || width < 0 || height < 0 || bounds.width < 0 || bounds.height < 0) {
      throw new RangeError('liquid-graph: host dimensions must be finite and nonnegative.');
    }
    const options = resolveOptions({ ...frame.options, data: [] });
    const dpr = Math.min(3, Math.max(1, this.view?.devicePixelRatio || 1));
    const signature = JSON.stringify([width, height, bounds, frame.series, options, dpr]);
    if (signature === this.signature) return;
    const resize = !this.frame || width !== this.frame.width || height !== this.frame.height || dpr !== this.dpr || JSON.stringify(bounds) !== JSON.stringify(this.frame.bounds);
    const moving = animate && !resize && !this.reduced && options.reducedMotion !== true;
    const old = new Map(this.groups.map((g) => [g.key, g]));
    // Invalid coordinates split paths in the host adapter, never bridge gaps here.
    const series = frame.series.filter((s) => s.points.length > 0);
    const keys = new Set<string>();
    for (const s of series) {
      if (keys.has(s.key)) throw new Error('liquid-graph: particle series keys must be unique.');
      keys.add(s.key);
      if (s.bounds && (![s.bounds.x, s.bounds.y, s.bounds.width, s.bounds.height].every(Number.isFinite) || s.bounds.width < 0 || s.bounds.height < 0)) throw new RangeError('liquid-graph: series bounds must be finite and nonnegative.');
      if (s.points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new RangeError('liquid-graph: pixel coordinates must be finite.');
    }
    const lengths = series.map((s) => s.points.reduce((n, p, i) => n + (i ? Math.hypot(p.x - s.points[i - 1]!.x, p.y - s.points[i - 1]!.y) : 1), 0));
    const total = lengths.reduce((a, b) => a + b, 0);
    let remaining = options.particleCount;
    const groups = series.map((s, i) => {
      const count = i === series.length - 1 ? remaining : Math.min(remaining, Math.round(options.particleCount * lengths[i]! / Math.max(1, total)));
      remaining -= count;
      const b = s.bounds ?? bounds;
      const layout: Layout = { left: b.x, right: b.x + b.width, top: b.y, bottom: b.y + b.height,
        xDomain: [0, 1], yDomain: [0, 1], points: s.points.map((p) => ({ ...p })).sort((a, b) => a.x - b.x) };
      const targets = width > 0 && height > 0 && b.width > 0 && b.height > 0
        ? generateTargets(layout, { ...options, particleCount: count, seed: options.seed + i }) : [];
      return { key: s.key, layout, particles: matchParticles(old.get(s.key)?.particles ?? [], targets, moving, options.particleRadius), color: frame.options?.color ?? s.color ?? options.color };
    });
    this.stop(); this.frame = frame; this.options = options; this.signature = signature; this.groups = groups; this.dpr = dpr;
    this.pointer.active = false; this.transitioning = moving; this.settled = 0;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.canvas.style.width = `${width}px`; this.canvas.style.height = `${height}px`;
    if (!moving || this.reduced) this.snap();
    this.draw(); this.start();
  }
  private snap(): void {
    for (const g of this.groups) for (const p of g.particles) {
      p.x = p.tx; p.y = p.ty; p.vx = 0; p.vy = 0; p.alpha = p.targetAlpha; p.radius = p.targetRadius; delete p.motion;
    }
    this.transitioning = false;
  }
  private draw(): void {
    if (!this.frame) return;
    const ctx = this.ctx, { width, height, bounds: b } = this.frame;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.save(); ctx.beginPath(); ctx.rect(b.x, b.y, b.width, b.height); ctx.clip();
    for (const group of this.groups) {
      const l = group.layout;
      ctx.save(); ctx.beginPath(); ctx.rect(l.left, l.top, l.right - l.left, l.bottom - l.top); ctx.clip();
      drawParticles(ctx, group.particles, group.color); ctx.restore();
    }
    ctx.restore();
  }
  private stop(): void {
    if (this.raf) this.view?.cancelAnimationFrame(this.raf);
    this.raf = 0; this.lastTime = 0; this.accumulator = 0;
  }
  private start(): void {
    if (this.destroyed || !this.view || this.raf || this.reduced || !this.visible || this.canvas.ownerDocument.hidden || !this.groups.some((g) => g.particles.length)) return;
    this.raf = this.view.requestAnimationFrame(this.tick);
  }
  private tick = (now: number): void => {
    this.raf = 0;
    if (this.destroyed || this.reduced || !this.visible || this.canvas.ownerDocument.hidden) return;
    this.accumulator += this.lastTime ? Math.min(1 / 30, (now - this.lastTime) / 1000) : 1 / 60;
    this.lastTime = now;
    while (this.accumulator >= 1 / 120) {
      this.time += 1 / 120;
      let energy = 0;
      for (const g of this.groups) energy += stepParticles(g.particles, this.pointer, this.options, 1 / 120, this.time, this.transitioning ? undefined : g.layout.points);
      this.settled = energy < Math.max(4, this.options.turbulence ** 2 * 5) && !this.pointer.active ? this.settled + 1 : 0;
      if (this.settled >= 20) this.transitioning = false;
      this.accumulator -= 1 / 120;
    }
    this.draw(); this.start();
  };
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true; this.stop(); this.dispose.forEach((fn) => fn()); this.groups = [];
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
