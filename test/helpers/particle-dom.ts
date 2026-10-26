import type { ParticleFrame } from '../../src/particle-layer';
export interface Arc { x: number; y: number; radius: number; color: string }
export class FakeElement extends EventTarget {
  readonly style: Record<string, string> = { visibility: '', pointerEvents: '' };
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  parentNode: FakeElement | null = null;
  constructor(readonly tagName: string, readonly ownerDocument: FakeDocument) { super(); }
  override addEventListener(name: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean): void {
    super.addEventListener(name, listener, options);
    if (listener) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name)!.add(listener); }
  }
  override removeEventListener(name: string, listener: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean): void {
    super.removeEventListener(name, listener, options); if (listener) this.listeners.get(name)?.delete(listener);
  }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  append(...elements: FakeElement[]): void { for (const element of elements) { element.remove(); this.children.push(element); element.parentNode = this; } }
  remove(): void { if (this.parentNode) { const index = this.parentNode.children.indexOf(this); this.parentNode.children.splice(index, 1); this.parentNode = null; } }
  querySelectorAll(selector: string): FakeElement[] {
    const all = this.children.flatMap((child) => [child, ...child.querySelectorAll('*')]);
    if (selector === '[data-ts-key]') return all.filter((e) => e.attributes.has('data-ts-key'));
    return all;
  }
  querySelector(selector: string): FakeElement | null { return this.querySelectorAll('*').find((e) => selector === 'svg.ts-chart' ? e.tagName === 'svg' : e.tagName === selector) ?? null; }
  closest(selector: string): FakeElement | null { return this.tagName === selector ? this : this.parentNode?.closest(selector) ?? null; }
}
export class FakeCanvas extends FakeElement {
  width = 1; height = 1;
  readonly arcs: Arc[] = [];
  readonly context = new Proxy({
    fillStyle: '',
    clearRect: () => { this.arcs.length = 0; },
    arc: (x: number, y: number, radius: number) => { this.arcs.push({ x, y, radius, color: this.context.fillStyle }); },
  }, { get: (target, key) => Reflect.has(target, key) ? Reflect.get(target, key) : () => {} });
  constructor(doc: FakeDocument) { super('canvas', doc); }
  getContext(): unknown { return this.context; }
  getBoundingClientRect() { return { left: 0, top: 0, width: parseFloat(this.style.width ?? '400') * 2, height: parseFloat(this.style.height ?? '300') * 2 }; }
}
export class FakeDocument extends EventTarget {
  hidden = false;
  readonly pending = new Map<number, FrameRequestCallback>();
  readonly query = Object.assign(new EventTarget(), { matches: false });
  private id = 0;
  private now = 0;
  readonly defaultView = {
    devicePixelRatio: 2,
    matchMedia: () => this.query,
    requestAnimationFrame: (callback: FrameRequestCallback) => { this.pending.set(++this.id, callback); return this.id; },
    cancelAnimationFrame: (id: number) => this.pending.delete(id),
  };
  createElementNS(_namespace: string, tag: string) { return this.createElement(tag); }
  createElement(tag: string): FakeElement { return tag === 'canvas' ? new FakeCanvas(this) : new FakeElement(tag, this); }
  advance(frames: number): void {
    for (let i = 0; i < frames; i++) {
      this.now += 1000 / 60;
      const callbacks = [...this.pending.values()]; this.pending.clear();
      for (const callback of callbacks) callback(this.now);
    }
  }
}
export function pointer(element: FakeElement, x: number, y: number, type = 'pointermove'): void {
  element.dispatchEvent(Object.assign(new Event(type), { clientX: x * 2, clientY: y * 2, pointerType: 'mouse' }));
}
export function frame(y = 100): ParticleFrame {
  return { width: 400, height: 300, bounds: { x: 20, y: 20, width: 360, height: 260 },
    series: [{ key: 'balance', points: [{ x: 20, y }, { x: 380, y }] }], options: { particleCount: 300, turbulence: 0, reducedMotion: false } };
}
