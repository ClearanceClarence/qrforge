import { encode, type EncodeOptions, type QRCode } from '../core/encode'
import { alignmentPositions } from '../core/tables'
import type { RGBAImage } from '../scan/locate'

export type DotStyle =
  | 'square'
  | 'rounded'
  | 'extra-rounded'
  | 'dots'
  | 'fluid'
  | 'classy'
  | 'classy-rounded'
  | 'leaf'
  | 'bars-vertical'
  | 'bars-horizontal'
  | 'diamond'
  | 'star'
  | 'cross'
  | 'hexagon'
  | 'heart'
export type FinderStyle = 'square' | 'rounded' | 'extra-rounded' | 'circle' | 'leaf'
export type FinderInnerStyle = 'square' | 'rounded' | 'circle' | 'leaf' | 'diamond' | 'hexagon' | 'heart'
export type AlignmentStyle = 'default' | 'square' | 'rounded' | 'circle'

export const DOT_STYLES: readonly DotStyle[] = ['square', 'rounded', 'extra-rounded', 'dots', 'fluid', 'classy', 'classy-rounded', 'leaf', 'bars-vertical', 'bars-horizontal', 'diamond', 'star', 'cross', 'hexagon', 'heart']
export const FINDER_STYLES: readonly FinderStyle[] = ['square', 'rounded', 'extra-rounded', 'circle', 'leaf']
export const FINDER_INNER_STYLES: readonly FinderInnerStyle[] = ['square', 'rounded', 'circle', 'leaf', 'diamond', 'hexagon', 'heart']
export const ALIGNMENT_STYLES: readonly AlignmentStyle[] = ['default', 'square', 'rounded', 'circle']

export interface GradientStop {
  /** Position along the gradient, 0-1. */
  offset: number
  color: string
}

export interface Gradient {
  type: 'linear' | 'radial'
  /** Direction in degrees for linear gradients; 0 = left to right, 90 = top to bottom. */
  angle?: number
  stops: GradientStop[]
}

/** Each data module gets one of the colors, chosen by a stable hash of its position. */
export interface Palette {
  type: 'palette'
  colors: string[]
}

export type Paint = string | Gradient

export interface LogoOptions {
  /** Image URL or data URI. Used by SVG output. */
  href?: string
  /** Raw RGBA pixels. Used by PNG output and the scan check, and by SVG when `href` is absent. */
  image?: RGBAImage
  /** Longest side of the logo area as a fraction of the symbol width, 0.05-0.4. Default 0.22. */
  size?: number
  /** Width divided by height of the logo area. Default 1. */
  aspectRatio?: number
  /** Gap between the edge of the logo area and the artwork, in modules. Default 0.5. */
  padding?: number
  /** Shape of the cleared area. Default `'square'`. */
  shape?: 'square' | 'circle'
  /** Remove the modules under the logo. Default `true`. */
  excavate?: boolean
  /** Fill drawn behind the artwork, e.g. `'#fff'`. Default: none. */
  background?: string
}

export interface StyleOptions {
  /** Overall outline. `'circle'` surrounds the symbol with decorative modules. Default `'square'`. */
  shape?: 'square' | 'circle'
  /** Quiet zone width in modules. Default 4 (1 for the circle shape, outside the decoration). */
  margin?: number
  /** Shape of data modules. Default `'square'`. */
  dots?: DotStyle
  /** Size of each module relative to its cell, 0.3-1. Ignored by `'fluid'`. Default 1. */
  dotScale?: number
  /** Random shrink per module, 0-0.6 of its size. Stable for the same content. Default 0. */
  dotScaleVariance?: number
  /** Shape of the outer frame of the three finder patterns. Default follows `dots`. */
  finder?: FinderStyle
  /** Shape of the center block of the finder patterns. Default follows `finder`. */
  finderInner?: FinderInnerStyle
  /** Draw alignment patterns as small finder-like marks. Default `'default'` (same as data modules). */
  alignment?: AlignmentStyle
  /** Module color: a CSS color, a gradient, or a palette. Default `'#000'`. */
  color?: Paint | Palette
  /** Finder frame color or gradient. Default: same as `color`. */
  finderColor?: Paint
  /** Finder center color or gradient. Default: same as `finderColor`. */
  finderInnerColor?: Paint
  /** Alignment pattern color or gradient (when `alignment` is set). Default: same as `color`. */
  alignmentColor?: Paint
  /** Background color or gradient, or `'transparent'`. Default `'#fff'`. */
  background?: Paint
  /** Corner radius of the background as a fraction of its width, 0-0.5. Default 0. */
  backgroundRadius?: number
  /** Logo placed in the center. */
  logo?: LogoOptions
}

export type RenderOptions = EncodeOptions & StyleOptions
export type QRInput = string | Uint8Array | QRCode

export function isQRCode(v: unknown): v is QRCode {
  return typeof v === 'object' && v !== null && 'modules' in v && 'size' in v
}

/** Encodes the input unless it is already a QRCode. A logo raises the default ECC level to H. */
export function toQR(input: QRInput, options: RenderOptions): QRCode {
  if (isQRCode(input)) return input
  return encode(input, { ...options, ecc: options.ecc ?? (options.logo ? 'H' : 'M') })
}

export type Point = [number, number]
export type Radii = [number, number, number, number]

function regular(points: number, rotate: number, inner?: number): Point[] {
  const out: Point[] = []
  const count = inner === undefined ? points : points * 2
  for (let i = 0; i < count; i++) {
    const a = rotate + (i * Math.PI * 2) / count
    const r = inner !== undefined && i % 2 === 1 ? inner : 0.5
    out.push([0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)])
  }
  return out
}

function heart(): Point[] {
  const pts: Point[] = []
  for (let i = 0; i < 28; i++) {
    const t = (i / 28) * Math.PI * 2
    const x = 16 * Math.sin(t) ** 3
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
    // The notch is kept shallow so a scan line through the middle still sees a solid shape.
    pts.push([0.5 + x / 34, Math.abs(x) < 7 && y > 0 ? Math.min(0.47 - y / 34, 0.2) : 0.47 - y / 34])
  }
  return pts
}

const t = 1 / 3
/** Polygon module shapes, defined inside a unit square. */
export const POLYGONS: Record<string, Point[]> = {
  diamond: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]],
  star: regular(5, -Math.PI / 2, 0.24),
  cross: [[t, 0], [2 * t, 0], [2 * t, t], [1, t], [1, 2 * t], [2 * t, 2 * t], [2 * t, 1], [t, 1], [t, 2 * t], [0, 2 * t], [0, t], [t, t]],
  hexagon: regular(6, 0),
  heart: heart(),
}

export interface Feature {
  kind: 'finder' | 'alignment'
  /** Top-left corner in grid coordinates. */
  x: number
  y: number
  /** 7 for finders, 5 for alignment patterns. */
  size: number
  frame: Radii
  hole: Radii
  pupil: Radii
  pupilPolygon: Point[] | null
}

export interface Layout {
  /** Modules per side of the symbol. */
  n: number
  /** Cells per side of the drawing grid (larger than `n` for the circle shape). */
  grid: number
  /** Offset of the symbol inside the grid. */
  off: number
  margin: number
  /** Side length of the canvas in modules. */
  total: number
  /** Per grid cell: 0 = nothing, 1 = rounded rectangle, 2 = polygon. */
  kind: Uint8Array
  /** Per grid cell: x, y, width, height (relative to the cell) and four corner radii. */
  geom: Float32Array
  polygon: Point[] | null
  /** Per grid cell: 0, or the index + 1 of the feature that owns it. */
  zone: Int16Array
  features: Feature[]
  logo: { x: number; y: number; w: number; h: number; pad: number; circle: boolean } | null
  backgroundRadius: number
  /** True when everything drawn is an axis-aligned square. */
  crisp: boolean
  seed: number
}

/** Stable pseudo-random value in [0, 1) for a cell. */
export function cellRandom(seed: number, index: number, salt: number): number {
  let h = (Math.imul(index + 1, 2654435761) ^ seed ^ Math.imul(salt, 40503)) >>> 0
  h ^= h >>> 16
  h = Math.imul(h, 0x45d9f3b)
  h ^= h >>> 16
  h = Math.imul(h, 0x45d9f3b)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const all = (r: number): Radii => [r, r, r, r]

const FRAME_RADIUS: Record<Exclude<FinderStyle, 'leaf'>, number> = { square: 0, rounded: 1.5, 'extra-rounded': 2.5, circle: 3.5 }
const PUPIL_RADIUS: Record<string, number> = { square: 0, rounded: 0.75, circle: 1.5 }

export function computeLayout(qr: QRCode, o: StyleOptions): Layout {
  const n = qr.size
  const circle = o.shape === 'circle'
  const margin = o.margin ?? (circle ? 1 : 4)
  if (!(margin >= 0)) throw new RangeError('margin must be 0 or greater')
  const dots = o.dots ?? 'square'
  if (!DOT_STYLES.includes(dots)) throw new RangeError(`Unknown dots style "${dots}"`)
  const finder = o.finder ?? (dots === 'square' ? 'square' : 'rounded')
  if (!FINDER_STYLES.includes(finder)) throw new RangeError(`Unknown finder style "${finder}"`)
  const finderInner = o.finderInner ?? (finder === 'extra-rounded' ? 'rounded' : finder)
  if (!FINDER_INNER_STYLES.includes(finderInner)) throw new RangeError(`Unknown finderInner style "${finderInner}"`)
  const alignment = o.alignment ?? 'default'
  if (!ALIGNMENT_STYLES.includes(alignment)) throw new RangeError(`Unknown alignment style "${alignment}"`)

  let seed = 2166136261
  for (let i = 0; i < qr.modules.length; i++) seed = Math.imul(seed ^ qr.modules[i], 16777619) >>> 0

  // The circle shape needs a grid whose inscribed circle covers the whole symbol.
  let grid = n
  if (circle) {
    grid = Math.ceil(n * Math.SQRT2 + 2)
    if ((grid - n) % 2) grid++
  }
  const off = (grid - n) / 2
  const total = grid + margin * 2

  // Finder and (optionally) alignment features.
  const zone = new Int16Array(grid * grid)
  const features: Feature[] = []
  const addFeature = (f: Feature) => {
    features.push(f)
    for (let y = 0; y < f.size; y++) for (let x = 0; x < f.size; x++) zone[(f.y + y) * grid + f.x + x] = features.length
  }
  // Polygon centers are drawn slightly oversized so scanners still see a solid 3-module core.
  const grow = finderInner === 'diamond' ? 1.25 : finderInner === 'heart' ? 1.2 : 1
  const polygonPupil = finderInner in POLYGONS ? POLYGONS[finderInner].map(([px, py]): Point => [0.5 + (px - 0.5) * grow, 0.5 + (py - 0.5) * grow]) : null
  const corners: [number, number][] = [[0, 0], [n - 7, 0], [0, n - 7]]
  corners.forEach(([fx, fy], i) => {
    // Leaf shapes round the outer corner and the corner facing the symbol's center.
    const diag: Radii = i === 0 ? [1, 0, 1, 0] : [0, 1, 0, 1]
    const frame: Radii = finder === 'leaf' ? (diag.map((d) => d * 2.5) as Radii) : all(FRAME_RADIUS[finder])
    const pupil: Radii = finderInner === 'leaf' ? (diag.map((d) => d * 1.2) as Radii) : all(PUPIL_RADIUS[finderInner] ?? 0)
    addFeature({ kind: 'finder', x: fx + off, y: fy + off, size: 7, frame, hole: frame.map((r) => Math.max(0, r - 1)) as Radii, pupil, pupilPolygon: polygonPupil })
  })
  if (alignment !== 'default') {
    const pos = alignmentPositions(qr.version)
    const last = pos.length - 1
    const fr = alignment === 'square' ? 0 : alignment === 'rounded' ? 1 : 2.5
    for (let i = 0; i <= last; i++) {
      for (let j = 0; j <= last; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue
        addFeature({ kind: 'alignment', x: pos[i] - 2 + off, y: pos[j] - 2 + off, size: 5, frame: all(fr), hole: all(Math.max(0, fr - 1)), pupil: all(fr / 5), pupilPolygon: null })
      }
    }
  }

  // Logo area, snapped to whole cells so it stays centered on the grid.
  let logo: Layout['logo'] = null
  if (o.logo) {
    const frac = clamp(o.logo.size ?? 0.22, 0.05, 0.4)
    const aspect = o.logo.aspectRatio && o.logo.aspectRatio > 0 ? o.logo.aspectRatio : 1
    const odd = (v: number) => {
      const c = Math.max(1, Math.ceil(v))
      return c % 2 ? c : c + 1
    }
    const w = odd(frac * n * Math.min(1, aspect))
    const h = odd((frac * n) / Math.max(1, aspect))
    logo = { x: off + (n - w) / 2, y: off + (n - h) / 2, w, h, pad: Math.max(0, o.logo.padding ?? 0.5), circle: o.logo.shape === 'circle' }
  }
  const excavate = logo && o.logo!.excavate !== false ? logo : null
  const center = grid / 2

  const kind = new Uint8Array(grid * grid)
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const i = y * grid + x
      if (zone[i]) continue
      const sx = x - off
      const sy = y - off
      let dark: boolean
      if (sx >= 0 && sy >= 0 && sx < n && sy < n) dark = qr.modules[sy * n + sx] === 1
      else {
        // Decorative modules around the symbol, kept one module away from it.
        const outsideGap = sx < -1 || sy < -1 || sx > n || sy > n
        dark = circle && outsideGap && Math.hypot(x + 0.5 - center, y + 0.5 - center) <= grid / 2 - 0.5 && cellRandom(seed, i, 1) < 0.5
      }
      if (!dark) continue
      if (excavate) {
        if (excavate.circle) {
          const dx = (x + 0.5 - center) / (excavate.w / 2)
          const dy = (y + 0.5 - center) / (excavate.h / 2)
          if (dx * dx + dy * dy <= 1) continue
        } else if (x >= excavate.x && x < excavate.x + excavate.w && y >= excavate.y && y < excavate.y + excavate.h) continue
      }
      kind[i] = 1
    }
  }

  const baseScale = dots === 'fluid' ? 1 : clamp(o.dotScale ?? 1, 0.3, 1)
  const variance = dots === 'fluid' ? 0 : clamp(o.dotScaleVariance ?? 0, 0, 0.6)
  const polygon = dots in POLYGONS ? POLYGONS[dots] : null
  const geom = new Float32Array(grid * grid * 8)
  const dot = (x: number, y: number) => x >= 0 && y >= 0 && x < grid && y < grid && kind[y * grid + x] !== 0
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const i = y * grid + x
      if (!kind[i]) continue
      const s = baseScale * (1 - variance * cellRandom(seed, i, 2))
      const g = i * 8
      const set = (x0: number, y0: number, w: number, h: number, r: Radii) => {
        geom[g] = x0
        geom[g + 1] = y0
        geom[g + 2] = w
        geom[g + 3] = h
        geom.set(r, g + 4)
      }
      const inset = (1 - s) / 2
      if (polygon) {
        kind[i] = 2
        set(inset, inset, s, s, [0, 0, 0, 0])
        continue
      }
      const T = !dot(x, y - 1)
      const R = !dot(x + 1, y)
      const B = !dot(x, y + 1)
      const L = !dot(x - 1, y)
      switch (dots) {
        case 'rounded': set(inset, inset, s, s, all(0.25 * s)); break
        case 'extra-rounded': set(inset, inset, s, s, all(0.4 * s)); break
        case 'dots': set(inset, inset, s, s, all(0.5 * s)); break
        case 'classy': set(inset, inset, s, s, [0.5 * s, 0, 0.5 * s, 0]); break
        case 'classy-rounded': set(inset, inset, s, s, [0.5 * s, 0.15 * s, 0.5 * s, 0.15 * s]); break
        case 'leaf': set(inset, inset, s, s, [0.5 * s, 0.5 * s, 0, 0.5 * s]); break
        case 'fluid': set(0, 0, 1, 1, [T && L ? 0.5 : 0, T && R ? 0.5 : 0, B && R ? 0.5 : 0, B && L ? 0.5 : 0]); break
        case 'bars-vertical': {
          const w = 0.75 * baseScale
          set((1 - w) / 2, 0, w, 1, [T ? w / 2 : 0, T ? w / 2 : 0, B ? w / 2 : 0, B ? w / 2 : 0])
          break
        }
        case 'bars-horizontal': {
          const h = 0.75 * baseScale
          set(0, (1 - h) / 2, 1, h, [L ? h / 2 : 0, R ? h / 2 : 0, R ? h / 2 : 0, L ? h / 2 : 0])
          break
        }
        default: set(inset, inset, s, s, [0, 0, 0, 0])
      }
    }
  }

  const squareFeatures = features.every((f) => !f.pupilPolygon && f.frame.every((r) => r === 0) && f.pupil.every((r) => r === 0))
  return {
    n,
    grid,
    off,
    margin,
    total,
    kind,
    geom,
    polygon,
    zone,
    features,
    logo,
    backgroundRadius: circle ? total / 2 : clamp(o.backgroundRadius ?? 0, 0, 0.5) * total,
    crisp: dots === 'square' && baseScale === 1 && variance === 0 && squareFeatures && !circle && !o.backgroundRadius,
    seed,
  }
}

// --- Colors ---

export type RGBA = [number, number, number, number]

const NAMED: Record<string, string> = {
  black: '#000', white: '#fff', red: '#f00', green: '#008000', blue: '#00f', navy: '#000080',
  gray: '#808080', grey: '#808080', silver: '#c0c0c0', maroon: '#800000', purple: '#800080',
  teal: '#008080', olive: '#808000', orange: '#ffa500', yellow: '#ff0', lime: '#0f0',
  aqua: '#0ff', cyan: '#0ff', fuchsia: '#f0f', magenta: '#f0f', transparent: '#0000',
}

/** Parses hex, rgb()/rgba() and basic named colors. Returns null for anything else. */
export function parseColor(input: string): RGBA | null {
  let s = String(input).trim().toLowerCase()
  s = NAMED[s] ?? s
  if (s[0] === '#') {
    const h = s.slice(1)
    if (!/^[0-9a-f]+$/.test(h)) return null
    if (h.length === 3 || h.length === 4) {
      const v = Array.from(h, (c) => parseInt(c + c, 16))
      return [v[0], v[1], v[2], v[3] ?? 255]
    }
    if (h.length === 6 || h.length === 8) {
      const v = [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16))
      return [v[0], v[1], v[2], h.length === 8 ? v[3] : 255]
    }
    return null
  }
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s)
  if (!m) return null
  const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
  return [Math.min(255, +m[1]), Math.min(255, +m[2]), Math.min(255, +m[3]), Math.round(Math.min(1, alpha) * 255)]
}

export function mustParseColor(input: string): RGBA {
  const c = parseColor(input)
  if (!c) throw new TypeError(`Unsupported color "${input}" for raster output; use hex or rgb()`)
  return c
}

export function isPalette(p: Paint | Palette | undefined): p is Palette {
  return typeof p === 'object' && p.type === 'palette'
}

/** Every color string used by a paint. */
export function paintColors(p: Paint | Palette): string[] {
  return typeof p === 'string' ? [p] : isPalette(p) ? p.colors : p.stops.map((s) => s.color)
}

/** Resolves the paints for each drawn layer, applying the fallbacks between them. */
export function resolvePaints(o: StyleOptions) {
  const dots: Paint | Palette = o.color ?? '#000'
  if (isPalette(dots) && !dots.colors.length) throw new TypeError('palette needs at least one color')
  const base: Paint = isPalette(dots) ? dots.colors[0] : dots
  const finder = o.finderColor ?? base
  return { dots, finder, finderInner: o.finderInnerColor ?? finder, alignment: o.alignmentColor ?? base, background: o.background ?? '#fff' }
}

export type GradientGeometry =
  | { kind: 'radial'; cx: number; cy: number; r: number }
  | { kind: 'linear'; x1: number; y1: number; x2: number; y2: number }

/** Geometry of a gradient covering a square of side `span` whose top-left corner is at `origin`. */
export function gradientGeometry(g: Gradient, origin: number, span: number): GradientGeometry {
  const c = origin + span / 2
  if (g.type === 'radial') return { kind: 'radial', cx: c, cy: c, r: (span / 2) * Math.SQRT2 }
  const a = ((g.angle ?? 0) * Math.PI) / 180
  const dx = Math.cos(a)
  const dy = Math.sin(a)
  const half = (span / 2) * (Math.abs(dx) + Math.abs(dy))
  return { kind: 'linear', x1: c - dx * half, y1: c - dy * half, x2: c + dx * half, y2: c + dy * half }
}
