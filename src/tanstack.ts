import { ParticleLayer } from './particle-layer';
import type { ParticleFrame, ParticleSeries, ParticleStyleOptions, PlotBounds } from './particle-layer';
export type { ParticleStyleOptions } from './particle-layer';

/** Structural subset of the public TanStack Charts scene contract. */
export interface LiquidSceneNode {
  kind: string;
  key: string;
  children?: readonly LiquidSceneNode[] | undefined;
  translateX?: number | undefined;
  translateY?: number | undefined;
  clip?: PlotBounds | undefined;
  focus?: unknown;
  points?: readonly (readonly [number, number])[] | undefined;
  interaction?: { points?: readonly { markId: string }[] | undefined; point?: { markId: string } | undefined } | undefined;
  style?: { stroke?: string | undefined; opacity?: number | undefined; strokeOpacity?: number | undefined } | undefined;
}
export interface LiquidTanStackScene {
  width: number;
  height: number;
  chart: PlotBounds;
  nodes: readonly LiquidSceneNode[];
}
export interface LiquidTanStackRenderContext {
  scene: LiquidTanStackScene;
  surface: { element: Element; defaultElement?: Element | undefined };
}
export interface TanStackPluginOptions extends ParticleStyleOptions {
  /** Stable id(s) authored on lineY marks. */
  markId: string | readonly string[];
  animate?: boolean;
}
interface Projection { frame: ParticleFrame; hiddenKeys: Set<string> }
function intersect(a: PlotBounds, b: PlotBounds): PlotBounds {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
}
/** Read native polyline segments so missing rows stay gaps and groups stay separate. */
export function tanstackProjection(scene: LiquidTanStackScene, options: TanStackPluginOptions): Projection {
  const ids = new Set(typeof options.markId === 'string' ? [options.markId] : options.markId);
  const series: ParticleSeries[] = [], hiddenKeys = new Set<string>();
  const walk = (nodes: readonly LiquidSceneNode[], dx: number, dy: number, clip: PlotBounds) => {
    for (const node of nodes) {
      // Focus-only geometry remains owned by TanStack's focus renderer.
      if (node.focus || node.style?.opacity === 0) continue;
      if (node.kind === 'group') {
        const x = dx + (node.translateX ?? 0), y = dy + (node.translateY ?? 0);
        const bounds = node.clip ? intersect(clip, { ...node.clip, x: node.clip.x + x, y: node.clip.y + y }) : clip;
        walk(node.children ?? [], x, y, bounds);
      } else if (node.kind === 'polyline' && node.points && node.interaction?.points?.some((p) => ids.has(p.markId))) {
        if ((node.style?.opacity ?? 1) === 0 || (node.style?.strokeOpacity ?? 1) === 0) continue;
        series.push({ key: node.key, points: node.points.map(([x, y]) => ({ x: x + dx, y: y + dy })), color: node.style?.stroke, bounds: clip });
        hiddenKeys.add(node.key);
      }
    }
  };
  walk(scene.nodes, 0, 0, scene.chart);
  return { frame: { width: scene.width, height: scene.height, bounds: scene.chart, series, options }, hiddenKeys };
}

/**
 * Attach to the public onRender callback of a TanStack Charts 1.x SVG host.
 * The host keeps all semantic points, axes, tooltips, focus, and keyboard input.
 */
export function createTanStackPlugin(initialOptions: TanStackPluginOptions) {
  let options = { ...initialOptions };
  let root: Element | undefined;
  let overlay: SVGForeignObjectElement | undefined;
  let layer: ParticleLayer | undefined;
  let lastContext: LiquidTanStackRenderContext | undefined;
  const hidden = new Map<SVGElement, string>();
  const restore = () => { for (const [element, visibility] of hidden) element.style.visibility = visibility; hidden.clear(); };
  const destroy = () => {
    layer?.destroy(); layer = undefined; overlay?.remove(); overlay = undefined;
    restore(); root = undefined; lastContext = undefined;
  };
  const onRender = (context: LiquidTanStackRenderContext): void => {
    const element = context.surface.defaultElement ?? context.surface.element;
    const svg = element.tagName.toLowerCase() === 'svg' ? element : element.querySelector('svg.ts-chart');
    if (!svg) throw new Error('liquid-graph: the TanStack plugin requires the default SVG renderer.');
    const { frame, hiddenKeys } = tanstackProjection(context.scene, options);
    if (root !== svg) {
      destroy(); root = svg;
      const doc = svg.ownerDocument;
      overlay = doc.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
      overlay.setAttribute('data-liquid-graph', ''); overlay.setAttribute('aria-hidden', 'true');
      overlay.style.pointerEvents = 'none';
      const canvas = doc.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true'); canvas.style.pointerEvents = 'none'; canvas.style.display = 'block';
      overlay.append(canvas); svg.append(overlay);
      try { layer = new ParticleLayer(canvas, svg); }
      catch (error) { destroy(); throw error; }
    }
    lastContext = context;
    // The native reconciler may replace an overlay on a scene update.
    if (overlay?.parentNode !== svg) svg.append(overlay!);
    overlay!.setAttribute('width', String(frame.width)); overlay!.setAttribute('height', String(frame.height));
    const elements = [...svg.querySelectorAll<SVGElement>('[data-ts-key]')].filter((element) => hiddenKeys.has(element.getAttribute('data-ts-key') ?? ''));
    // Native computed stroke resolves palette CSS variables before Canvas painting.
    const paint = new Map(elements.map((element) => [element.getAttribute('data-ts-key'), svg.ownerDocument.defaultView?.getComputedStyle?.(element).stroke]));
    for (const series of frame.series) {
      const color = paint.get(series.key);
      if (color && color !== 'none') series.color = color;
    }
    // Generate the replacement successfully before hiding any native paths.
    layer!.update(frame, options.animate !== false);
    restore();
    for (const element of elements) {
      hidden.set(element, element.style.visibility); element.style.visibility = 'hidden';
    }
  };
  return {
    onRender,
    update(next: Partial<TanStackPluginOptions>): void { options = { ...options, ...next }; if (lastContext) onRender(lastContext); },
    /** Call alongside host.destroy() or from the component's effect cleanup. */
    destroy,
  };
}
