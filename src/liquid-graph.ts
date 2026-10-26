import { clamp, createLayout, generateTargets, nearestPoint } from './layout';
import type { Layout } from './layout';
import { resolveOptions } from './options';
import { drawParticles } from './render';
import { matchParticles, stepParticles } from './physics';
import type { Particle, Pointer } from './physics';
import type { DataPoint, GraphStats, HoverPoint, LiquidGraphOptions, ResolvedOptions, TransitionOptions } from './types';

let instanceId = 0;
const hiddenStyles = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0';

/** A dependency-free Canvas 2D particle graph. Safe to import during server rendering. */
export class LiquidGraph {
  private options: ResolvedOptions;
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly tooltip: HTMLDivElement;
  private readonly table: HTMLTableElement;
  private readonly announcement: HTMLDivElement;
  private readonly abort = new AbortController();
  private readonly resizeObserver: ResizeObserver;
  private readonly intersectionObserver: IntersectionObserver | undefined;
  private readonly motionQuery: MediaQueryList;
  private particles: Particle[] = [];
  private layout: Layout;
  private pointer: Pointer = { x: 0, y: 0, vx: 0, vy: 0, active: false };
  private selection: HoverPoint | null = null;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private raf = 0;
  private lastTime = 0;
  private simulationTime = 0;
  private accumulator = 0;
  private pointerTime = 0;
  private paused = false;
  private visible = true;
  private destroyed = false;
  private transitioning = false;
  private settleFrames = 0;

  constructor(private readonly container: HTMLElement, options: LiquidGraphOptions) {
    if (typeof window === 'undefined' || typeof ResizeObserver === 'undefined') {
      throw new Error('liquid-graph: create a graph in a browser after mounting its container.');
    }
    this.options = resolveOptions(options);
    this.layout = createLayout(this.options, 1, 1);
    const doc = container.ownerDocument;
    this.root = doc.createElement('div');
    this.root.className = 'liquid-graph';
    this.root.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;isolation:isolate';
    this.canvas = doc.createElement('canvas');
    this.canvas.className = 'liquid-graph__canvas';
    this.canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:pan-y;border-radius:inherit;outline-offset:-2px';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-roledescription', 'interactive particle graph');
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('liquid-graph: Canvas 2D is unavailable.');
    this.context = context;
    this.tooltip = doc.createElement('div');
    this.tooltip.className = 'liquid-graph__tooltip';
    this.tooltip.hidden = true;
    this.tooltip.style.cssText = 'position:absolute;pointer-events:none;z-index:1;background:#202628;color:#f6f3eb;border:1px solid #455053;border-radius:8px;padding:9px 12px;font:12px/1.6 ui-monospace,monospace;white-space:pre;box-shadow:0 4px 18px #0003';
    this.table = doc.createElement('table');
    this.table.id = `liquid-graph-data-${++instanceId}`;
    this.table.style.cssText = hiddenStyles;
    this.canvas.setAttribute('aria-describedby', this.table.id);
    this.announcement = doc.createElement('div');
    this.announcement.style.cssText = hiddenStyles;
    this.announcement.setAttribute('aria-live', 'polite');
    this.announcement.setAttribute('aria-atomic', 'true');
    this.root.append(this.canvas, this.tooltip, this.table, this.announcement);
    container.append(this.root);
    this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.motionQuery.addEventListener('change', this.handleMotion, { signal: this.abort.signal });
    this.canvas.addEventListener('pointermove', this.handlePointer, { signal: this.abort.signal });
    this.canvas.addEventListener('pointerdown', this.handleDown, { signal: this.abort.signal });
    this.canvas.addEventListener('pointerleave', this.clearHover, { signal: this.abort.signal });
    this.canvas.addEventListener('pointercancel', this.clearHover, { signal: this.abort.signal });
    this.canvas.addEventListener('pointerup', this.handleUp, { signal: this.abort.signal });
    this.canvas.addEventListener('keydown', this.handleKey, { signal: this.abort.signal });
    this.canvas.addEventListener('blur', this.clearHover, { signal: this.abort.signal });
    doc.addEventListener('visibilitychange', this.handleVisibility, { signal: this.abort.signal });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    if (typeof IntersectionObserver !== 'undefined') {
      this.intersectionObserver = new IntersectionObserver(([entry]) => {
        this.visible = entry?.isIntersecting ?? true;
        this.stop(); this.start();
      });
      this.intersectionObserver.observe(container);
    }
    this.updateAccessibleData();
    this.resize();
  }

  /** Retarget existing particles without resetting their positions or momentum. */
  setData(data: readonly DataPoint[], transition: TransitionOptions = {}): void {
    this.update({ data }, transition);
  }

  /** Validate the entire update before changing the live graph. */
  update(options: Partial<LiquidGraphOptions>, transition: TransitionOptions = {}): void {
    this.assertAlive();
    const next = resolveOptions({ ...this.options, ...options,
      padding: { ...this.options.padding, ...options.padding },
    });
    this.options = next;
    this.clearHover();
    this.updateAccessibleData();
    this.rebuild(transition.animate !== false);
  }

  /** Normally called automatically by ResizeObserver. */
  resize(): void {
    this.assertAlive();
    const rect = this.root.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.clearHover();
    this.rebuild(false);
  }

  pause(): void { this.assertAlive(); this.paused = true; this.stop(); }
  resume(): void { this.assertAlive(); this.paused = false; this.start(); }
  getStats(): GraphStats {
    return { particles: this.particles.length, width: this.width, height: this.height,
      running: this.raf !== 0, reducedMotion: this.reducedMotion };
  }
  /** Disconnect all observers/listeners and remove only this instance's DOM. */
  destroy(): void {
    if (this.destroyed) return;
    this.stop(); this.abort.abort(); this.resizeObserver.disconnect();
    this.intersectionObserver?.disconnect(); this.root.remove(); this.particles = [];
    this.destroyed = true;
  }

  private get reducedMotion(): boolean {
    return this.options.reducedMotion === 'auto' ? this.motionQuery.matches : this.options.reducedMotion;
  }
  private assertAlive(): void { if (this.destroyed) throw new Error('liquid-graph: this graph has been destroyed.'); }
  private rebuild(animate: boolean): void {
    this.layout = createLayout(this.options, this.width, this.height);
    const targets = this.width <= 1 || this.height <= 1 ? [] : generateTargets(this.layout, this.options);
    // Match by local position and layer, preserving momentum without end-to-end sweeps.
    this.particles = matchParticles(this.particles, targets, animate, this.options.particleRadius);
    this.particles.forEach((particle, index) => {
      const target = targets[index]!;
      if (!animate || this.reducedMotion) {
        particle.x = target.x; particle.y = target.y;
        particle.vx = 0; particle.vy = 0; particle.alpha = target.alpha;
        particle.radius = target.radius;
        delete particle.motion;
      }
    });
    if (this.reducedMotion || !targets.length) this.stop();
    this.transitioning = animate && !this.reducedMotion && targets.length > 0;
    this.settleFrames = 0;
    this.render(); this.start();
  }
  private start(): void {
    if (this.raf || this.paused || !this.visible || this.container.ownerDocument.hidden || this.reducedMotion || this.destroyed || !this.particles.length) return;
    this.lastTime = 0; this.accumulator = 0;
    this.raf = requestAnimationFrame(this.frame);
  }
  private stop(): void { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; this.lastTime = 0; }
  private frame = (now: number): void => {
    this.raf = 0;
    if (this.destroyed) return;
    // A DPR change can happen without a container resize (for example, moving displays).
    if (this.dpr !== Math.min(3, window.devicePixelRatio || 1)) { this.resize(); return; }
    this.accumulator += this.lastTime ? Math.min(1 / 30, (now - this.lastTime) / 1000) : 1 / 60;
    this.lastTime = now;
    let energy = Infinity;
    while (this.accumulator >= 1 / 120) {
      this.simulationTime += 1 / 120;
      energy = stepParticles(this.particles, this.pointer, this.options, 1 / 120, this.simulationTime, this.transitioning ? undefined : this.layout.points);
      this.pointer.vx *= 0.88; this.pointer.vy *= 0.88;
      this.accumulator -= 1 / 120;
    }
    this.render();
    let ended = false;
    if (this.transitioning && Number.isFinite(energy)) {
      this.settleFrames = energy < Math.max(4, this.options.turbulence ** 2 * 5) && !this.pointer.active ? this.settleFrames + 1 : 0;
      if (this.settleFrames >= 10) { this.transitioning = false; ended = true; }
    }
    if (!this.paused && this.visible && !this.reducedMotion && !this.container.ownerDocument.hidden) this.raf = requestAnimationFrame(this.frame);
    if (ended) this.options.onTransitionEnd?.();
  };
  private render(): void {
    const ctx = this.context, o = this.options, l = this.layout;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.font = o.font;
    const ticks = this.width < 480 ? 2 : 4;
    ctx.lineWidth = 1; ctx.strokeStyle = o.gridColor;
    ctx.fillStyle = o.textColor;
    for (let i = 0; i <= ticks; i++) {
      const fraction = i / ticks, y = l.bottom - (l.bottom - l.top) * fraction;
      const x = l.left + (l.right - l.left) * fraction;
      if (o.grid) {
        ctx.setLineDash([2, 6]); ctx.beginPath();
        ctx.moveTo(l.left, y); ctx.lineTo(l.right, y);
        ctx.moveTo(x, l.top); ctx.lineTo(x, l.bottom); ctx.stroke(); ctx.setLineDash([]);
      }
      if (o.labels) {
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        if (this.width >= 480 || i === 0 || i === ticks) {
          ctx.fillText(o.formatY(l.yDomain[0] + (l.yDomain[1] - l.yDomain[0]) * fraction), this.width < 480 ? l.right : Math.max(0, l.left - 12), this.width < 480 ? y - 12 : y);
        }
        ctx.textAlign = i === 0 ? 'left' : i === ticks ? 'right' : 'center'; ctx.textBaseline = 'top';
        ctx.fillText(o.formatX(l.xDomain[0] + (l.xDomain[1] - l.xDomain[0]) * fraction), x, l.bottom + Math.max(15, o.padding.bottom * 0.72));
      }
    }
    ctx.save(); ctx.beginPath(); ctx.rect(l.left - 2, l.top - 3, l.right - l.left + 4, l.bottom - l.top + Math.max(5, o.padding.bottom * 0.5)); ctx.clip();
    drawParticles(ctx, this.particles, o.color);
    if (this.selection) {
      const { x, y } = this.selection;
      ctx.strokeStyle = o.color; ctx.lineWidth = 1; ctx.setLineDash([3, 5]);
      ctx.beginPath(); ctx.moveTo(x, l.top); ctx.lineTo(x, l.bottom); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.3; ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
    if (!this.options.data.length) {
      ctx.fillStyle = o.textColor; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('No data yet', (l.left + l.right) / 2, (l.top + l.bottom) / 2);
    }
  }
  private updateAccessibleData(): void {
    const doc = this.table.ownerDocument, o = this.options;
    this.canvas.setAttribute('aria-label', `${o.label}. ${o.data.length} data points. Use left and right arrow keys to explore; Escape to clear.`);
    const caption = doc.createElement('caption'); caption.textContent = o.label;
    const head = doc.createElement('thead'), headRow = doc.createElement('tr');
    for (const text of ['Position', 'Value']) { const th = doc.createElement('th'); th.scope = 'col'; th.textContent = text; headRow.append(th); }
    head.append(headRow);
    const body = doc.createElement('tbody');
    for (const point of o.data) {
      const row = doc.createElement('tr');
      for (const text of [point.label ?? o.formatX(point.x), o.formatY(point.y)]) {
        const cell = doc.createElement('td'); cell.textContent = text; row.append(cell);
      }
      body.append(row);
    }
    this.table.replaceChildren(caption, head, body);
  }
  private select(index: number, keyboard = false): void {
    const point = this.options.data[index], position = this.layout.points[index];
    if (!point || !position) return;
    const changed = this.selection?.index !== index;
    this.selection = { point: Object.freeze({ ...point }), index, ...position };
    this.tooltip.textContent = `${point.label ?? this.options.formatX(point.x)}\n${this.options.formatY(point.y)}`;
    this.tooltip.hidden = false;
    this.tooltip.style.left = `${clamp(position.x + 14, 4, Math.max(4, this.width - this.tooltip.offsetWidth - 4))}px`;
    this.tooltip.style.top = `${clamp(position.y - this.tooltip.offsetHeight - 14, 4, Math.max(4, this.height - this.tooltip.offsetHeight - 4))}px`;
    if (keyboard) this.announcement.textContent = this.tooltip.textContent;
    if (changed) this.options.onHover?.(this.selection);
    this.render();
  }
  private handlePointer = (event: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * this.width / Math.max(1, rect.width);
    const y = (event.clientY - rect.top) * this.height / Math.max(1, rect.height);
    const l = this.layout;
    if (x < l.left || x > l.right || y < l.top || y > l.bottom) { this.clearHover(); return; }
    const dt = Math.max(1 / 120, (event.timeStamp - this.pointerTime) / 1000);
    const active = this.pointer.active;
    this.pointer.vx = active ? clamp((x - this.pointer.x) / dt, -1200, 1200) : 0;
    this.pointer.vy = active ? clamp((y - this.pointer.y) / dt, -1200, 1200) : 0;
    this.pointer.x = x; this.pointer.y = y; this.pointer.active = !this.reducedMotion;
    this.pointerTime = event.timeStamp;
    const value = l.xDomain[0] + (x - l.left) / (l.right - l.left) * (l.xDomain[1] - l.xDomain[0]);
    this.select(nearestPoint(this.options.data, value)); this.start();
  };
  private handleDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') this.canvas.setPointerCapture(event.pointerId);
    this.handlePointer(event);
  };
  private handleUp = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') { this.clearHover(); if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId); }
  };
  private clearHover = (): void => {
    const hadSelection = this.selection !== null;
    this.pointer.active = false; this.pointer.vx = 0; this.pointer.vy = 0;
    this.selection = null; this.tooltip.hidden = true;
    this.announcement.textContent = '';
    if (hadSelection) this.options.onHover?.(null);
    this.render();
  };
  private handleKey = (event: KeyboardEvent): void => {
    const count = this.options.data.length;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) return;
    event.preventDefault(); this.pointer.active = false;
    if (event.key === 'Escape') { this.clearHover(); return; }
    if (!count) return;
    const current = this.selection?.index ?? (event.key === 'ArrowLeft' ? count : -1);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : clamp(current + (event.key === 'ArrowRight' ? 1 : -1), 0, count - 1);
    this.select(index, true);
  };
  private handleMotion = (): void => {
    if (this.reducedMotion) { this.stop(); this.pointer.active = false; this.rebuild(false); }
    else this.start();
  };
  private handleVisibility = (): void => { this.stop(); this.start(); };
}

export function createLiquidGraph(container: HTMLElement, options: LiquidGraphOptions): LiquidGraph {
  return new LiquidGraph(container, options);
}
