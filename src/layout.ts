import type { DataPoint, ResolvedOptions } from './types';

export interface Layout {
  left: number; right: number; top: number; bottom: number;
  xDomain: readonly [number, number]; yDomain: readonly [number, number];
  points: { x: number; y: number }[];
}
export interface Target { x: number; y: number; alpha: number; radius: number; phase: number; edge?: boolean; band?: 'cap' | 'falloff' }
export const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));
export function random(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
function extent(min: number, max: number): readonly [number, number] {
  if (min === max) { const delta = Math.abs(min) * 0.1 || 1; return [min - delta, max + delta]; }
  return [min, max];
}
export function createLayout(options: ResolvedOptions, width: number, height: number): Layout {
  const { data, padding } = options;
  const xDomain = options.xDomain ?? extent(data[0]?.x ?? 0, data.at(-1)?.x ?? 1);
  let yMin = 0, yMax = 0;
  for (const point of data) { yMin = Math.min(yMin, point.y); yMax = Math.max(yMax, point.y); }
  const yDomain = options.yDomain ?? extent(yMin, yMax);
  // Scale padding on tiny containers so the plot never inverts.
  const sx = Math.min(1, width / Math.max(1, padding.left + padding.right + 24));
  const sy = Math.min(1, height / Math.max(1, padding.top + padding.bottom + 24));
  const left = padding.left * sx, right = Math.max(left + 1, width - padding.right * sx);
  const top = padding.top * sy, bottom = Math.max(top + 1, height - padding.bottom * sy);
  return {
    left, right, top, bottom, xDomain, yDomain,
    points: data.map((point) => ({
      x: left + (point.x - xDomain[0]) / (xDomain[1] - xDomain[0]) * (right - left),
      y: bottom - (point.y - yDomain[0]) / (yDomain[1] - yDomain[0]) * (bottom - top),
    })),
  };
}
/** Piecewise linear interpolation preserves sharp changes in the source data. */
export function surfaceY(points: Layout['points'], x: number): number {
  if (points.length === 0) return 0;
  if (x <= points[0]!.x) return points[0]!.y;
  let low = 0, high = points.length - 1;
  while (low + 1 < high) { const mid = (low + high) >>> 1; if (points[mid]!.x <= x) low = mid; else high = mid; }
  const a = points[low]!, b = points[high]!;
  const t = clamp((x - a.x) / Math.max(0.0001, b.x - a.x), 0, 1);
  return a.y + (b.y - a.y) * t;
}

/** Lowest circle center that keeps its entire upper rim beneath the polyline. */
export function circleY(points: Layout['points'], x: number, radius: number): number {
  let low = 0, high = points.length - 1;
  while (low + 1 < high) {
    const mid = (low + high) >>> 1;
    if (points[mid]!.x < x - radius) low = mid; else high = mid;
  }
  let y = surfaceY(points, x) + radius;
  for (let i = low; i < points.length - 1 && points[i]!.x <= x + radius; i++) {
    const a = points[i]!, b = points[i + 1]!;
    const slope = (b.y - a.y) / Math.max(0.0001, b.x - a.x);
    const left = Math.max(a.x, x - radius), right = Math.min(b.x, x + radius);
    if (left > right) continue;
    const u = clamp(x + slope * radius / Math.hypot(1, slope), left, right);
    y = Math.max(y, a.y + (u - a.x) * slope + Math.sqrt(Math.max(0, radius ** 2 - (u - x) ** 2)));
  }
  return y;
}

/** Distance to the polyline, including the round offset region beneath valleys. */
export function boundaryDistance(points: Layout['points'], x: number, y: number, limit: number): number {
  let low = 0, high = points.length - 1;
  while (low + 1 < high) {
    const mid = (low + high) >>> 1;
    if (points[mid]!.x < x - limit) low = mid; else high = mid;
  }
  let squared = Infinity;
  for (let i = low; i < points.length - 1 && points[i]!.x <= x + limit; i++) {
    const a = points[i]!, b = points[i + 1]!;
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / Math.max(1e-9, dx * dx + dy * dy), 0, 1);
    squared = Math.min(squared, (x - a.x - t * dx) ** 2 + (y - a.y - t * dy) ** 2);
  }
  return Math.sqrt(squared);
}

/** Seeded variable-radius packing: tangent boundary, dense cap, sparse falloff. */
export function generateTargets(layout: Layout, options: ResolvedOptions): Target[] {
  if (!layout.points.length || !options.particleCount) return [];
  if (layout.points.length === 1) {
    const point = layout.points[0]!;
    if (point.x < layout.left || point.x > layout.right) return [];
    return [{ ...point, alpha: 1, radius: options.particleRadius * 2, phase: 0 }];
  }
  const rng = random(options.seed), targets: Target[] = [];
  const count = options.particleCount, radius = options.particleRadius;
  const floor = layout.bottom + options.padding.bottom * 0.5;
  const minX = Math.max(layout.left, layout.points[0]!.x);
  const maxX = Math.min(layout.right, layout.points.at(-1)!.x);
  if (minX > maxX) return [];
  // Mostly small circles, medium circles throughout, and occasional large ones.
  // The same distribution is used at the boundary and throughout the cap.
  const sampleRadius = () => {
    const size = rng();
    return radius * (size < 0.65 ? 0.3 + rng() * 0.5
      : size < 0.92 ? 0.8 + rng() * 0.9
      : size < 0.99 ? 1.7 + rng() * 1.3 : 3 + rng() * 1.8);
  };
  const cellSize = Math.max(1, radius * 10);
  const cells = new Map<string, Target[]>();
  const insert = (target: Target) => {
    const key = `${Math.floor(target.x / cellSize)},${Math.floor(target.y / cellSize)}`;
    const cell = cells.get(key); if (cell) cell.push(target); else cells.set(key, [target]);
    targets.push(target);
  };
  const fits = (x: number, y: number, r: number, separation = 1) => {
    const cx = Math.floor(x / cellSize), cy = Math.floor(y / cellSize);
    const reach = Math.ceil((r + radius * 4.9) * separation / cellSize);
    for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) {
      for (const neighbor of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
        if (Math.hypot(neighbor.x - x, neighbor.y - y) < (neighbor.radius + r + radius * 0.12) * separation) return false;
      }
    }
    return true;
  };
  const path = [{ x: minX, y: surfaceY(layout.points, minX) },
    ...layout.points.filter((point) => point.x > minX && point.x < maxX),
    { x: maxX, y: surfaceY(layout.points, maxX) }];
  const lengths = [0];
  for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1]! + Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y));
  const length = lengths.at(-1)!;
  let segment = 1, distance = 0, edgeRadius = sampleRadius();
  // Scan the boundary, placing different-sized circles tangent to its underside.
  // Radius-aware exclusion naturally leaves small interstices for smaller dots.
  while (distance <= length && targets.length < Math.ceil(count * 0.4)) {
    while (segment < lengths.length - 1 && lengths[segment]! < distance) segment++;
    const a = path[segment - 1]!, b = path[segment]!;
    const t = (distance - lengths[segment - 1]!) / Math.max(0.001, lengths[segment]! - lengths[segment - 1]!);
    const x = a.x + (b.x - a.x) * t, r = edgeRadius;
    const y = Math.min(layout.bottom, circleY(layout.points, x, r));
    if (fits(x, y, r)) {
      insert({ x, y, radius: r, alpha: 0.9 + rng() * 0.1, phase: rng() * Math.PI * 2, edge: true });
      edgeRadius = sampleRadius();
    }
    distance += radius * (0.35 + rng() * 0.4);
  }
  const edgeCount = targets.length;
  const pack = (amount: number, falloff: boolean) => {
    // Large circles claim space first; smaller ones fill the gaps around them.
    const radii = Array.from({ length: amount }, sampleRadius).sort((a, b) => b - a);
    const band: Target[] = [];
    for (const initialRadius of radii) {
      let attempts = 0;
      while (true) {
        const x = minX + rng() * (maxX - minX);
        const surface = surfaceY(layout.points, x);
        const y = surface + rng() * Math.max(0, floor - surface);
        const reach = options.capHeight + (falloff ? options.falloffHeight : 0) + initialRadius;
        const depth = boundaryDistance(path, x, y, reach);
        const progress = falloff ? clamp((depth - options.capHeight) / Math.max(0.001, options.falloffHeight), 0, 1) : 0;
        const taper = falloff ? 1 - progress * 0.55 : 1;
        const r = initialRadius * taper * Math.max(0.18, 1 - Math.max(0, attempts - 80) / 100);
        // Sample the area, rather than extruding individual slope normals:
        // distance contours remain continuous where slopes diverge at a valley.
        const inBand = falloff ? depth >= options.capHeight && depth <= options.capHeight + options.falloffHeight : depth <= options.capHeight + r;
        const inside = inBand && y >= circleY(layout.points, x, r) - 0.05;
        const separation = falloff ? 1 + progress * 4 : 1;
        if ((!inside || !fits(x, y, r, separation)) && attempts++ < 160) continue;
        if (!inside) {
          // Degenerate plots still honor the budget without unbounded sampling.
          const safeX = clamp(x, minX, maxX);
          const safeY = clamp(circleY(layout.points, safeX, r), layout.top, floor);
          const target: Target = { x: safeX, y: safeY, radius: r, alpha: 0.05, phase: rng() * Math.PI * 2, band: falloff ? 'falloff' : 'cap' };
          insert(target); band.push(target); break;
        }
        const fade = falloff ? Math.pow(1 - progress, 1.25) : 1;
        const target: Target = { x, y, radius: r,
          alpha: falloff ? 0.04 + fade * 0.9 : 0.9 + rng() * 0.1,
          phase: rng() * Math.PI * 2, band: falloff ? 'falloff' : 'cap' };
        insert(target); band.push(target); break;
      }
    }
    band.sort((a, b) => a.x - b.x || a.y - b.y);
    targets.splice(targets.length - band.length, band.length, ...band);
  };
  pack(Math.round((count - edgeCount) * 0.5), false);
  pack(count - targets.length, true);
  return targets;
}
export function nearestPoint(data: readonly DataPoint[], value: number): number {
  if (!data.length) return -1;
  let low = 0, high = data.length - 1;
  while (low < high) { const mid = (low + high) >>> 1; if (data[mid]!.x < value) low = mid + 1; else high = mid; }
  return low > 0 && Math.abs(data[low - 1]!.x - value) <= Math.abs(data[low]!.x - value) ? low - 1 : low;
}
