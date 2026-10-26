/** Numeric x coordinates may be timestamps, indices, or any increasing quantity. */
export interface DataPoint {
  x: number;
  y: number;
  label?: string;
}
export interface Padding { top: number; right: number; bottom: number; left: number }
export interface HoverPoint {
  point: Readonly<DataPoint>;
  index: number;
  /** Position in CSS pixels relative to the graph. */
  x: number;
  y: number;
}
export interface LiquidGraphOptions {
  data: readonly DataPoint[];
  color?: string;
  particleCount?: number;
  particleRadius?: number;
  /** Thickness in CSS pixels of the densely packed band, measured inward from the curve. */
  capHeight?: number;
  /** Thickness in CSS pixels of the sparse, fading region beyond the band. */
  falloffHeight?: number;
  springStrength?: number;
  damping?: number;
  hoverRadius?: number;
  hoverStrength?: number;
  /** Ambient fill movement amplitude in CSS pixels. The data edge stays still. Set to 0 for a still resting graph. */
  turbulence?: number;
  padding?: Partial<Padding>;
  xDomain?: readonly [number, number] | null;
  yDomain?: readonly [number, number] | null;
  grid?: boolean;
  labels?: boolean;
  gridColor?: string;
  textColor?: string;
  font?: string;
  formatX?: (value: number) => string;
  formatY?: (value: number) => string;
  label?: string;
  reducedMotion?: boolean | 'auto';
  seed?: number;
  onHover?: ((point: HoverPoint | null) => void) | undefined;
  onTransitionEnd?: (() => void) | undefined;
}
export interface TransitionOptions { animate?: boolean }
export interface GraphStats {
  particles: number;
  width: number;
  height: number;
  running: boolean;
  reducedMotion: boolean;
}
export interface ResolvedOptions {
  data: DataPoint[];
  color: string;
  particleCount: number;
  particleRadius: number;
  capHeight: number;
  falloffHeight: number;
  springStrength: number;
  damping: number;
  hoverRadius: number;
  hoverStrength: number;
  turbulence: number;
  padding: Padding;
  xDomain: readonly [number, number] | null;
  yDomain: readonly [number, number] | null;
  grid: boolean;
  labels: boolean;
  gridColor: string;
  textColor: string;
  font: string;
  formatX: (value: number) => string;
  formatY: (value: number) => string;
  label: string;
  reducedMotion: boolean | 'auto';
  seed: number;
  onHover: ((point: HoverPoint | null) => void) | undefined;
  onTransitionEnd: (() => void) | undefined;
}
