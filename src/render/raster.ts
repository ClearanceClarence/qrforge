import type { RGBAImage } from '../scan/locate'
import { encodePNG } from './png'
import {
  cellRandom,
  computeLayout,
  gradientGeometry,
  isPalette,
  mustParseColor,
  resolvePaints,
  toQR,
  type Paint,
  type Palette,
  type Point,
  type QRInput,
  type RenderOptions,
  type RGBA,
} from './style'

export interface RasterOptions extends RenderOptions {
  /** Width and height in pixels. Default: 10 pixels per module. */
  size?: number
}

function inRoundRect(x: number, y: number, x0: number, y0: number, w: number, h: number, r: ArrayLike<number>, ro = 0): boolean {
  const lx = x - x0
  const ly = y - y0
  if (lx < 0 || ly < 0 || lx > w || ly > h) return false
  const max = Math.min(w, h) / 2
  const tl = Math.min(r[ro], max)
  const tr = Math.min(r[ro + 1], max)
  const br = Math.min(r[ro + 2], max)
  const bl = Math.min(r[ro + 3], max)
  if (lx < tl && ly < tl) return (lx - tl) ** 2 + (ly - tl) ** 2 <= tl * tl
  if (lx > w - tr && ly < tr) return (lx - (w - tr)) ** 2 + (ly - tr) ** 2 <= tr * tr
  if (lx > w - br && ly > h - br) return (lx - (w - br)) ** 2 + (ly - (h - br)) ** 2 <= br * br
  if (lx < bl && ly > h - bl) return (lx - bl) ** 2 + (ly - (h - bl)) ** 2 <= bl * bl
  return true
}

function inPolygon(x: number, y: number, pts: Point[]): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Rasterizes a QR code to RGBA pixels with anti-aliasing, without any canvas. */
export function rasterize(input: QRInput, options: RasterOptions = {}): RGBAImage {
  const qr = toQR(input, options)
  const l = computeLayout(qr, options)
  const { grid, margin, kind, geom, zone, features, total } = l
  const size = Math.round(options.size ?? total * 10)
  if (!(size >= 1) || size > 16384) throw new RangeError('size must be between 1 and 16384 pixels')
  const step = total / size
  const paints = resolvePaints(options)
  const bgRadius = l.backgroundRadius
  const bgR = [bgRadius, bgRadius, bgRadius, bgRadius]

  const makePaint = (paint: Paint | Palette, origin: number, span: number): ((u: number, v: number) => RGBA) => {
    if (typeof paint === 'string') {
      const c = mustParseColor(paint)
      return () => c
    }
    if (isPalette(paint)) {
      const colors = paint.colors.map(mustParseColor)
      return (u, v) => {
        const cx = Math.min(grid - 1, Math.max(0, Math.floor(u - margin)))
        const cy = Math.min(grid - 1, Math.max(0, Math.floor(v - margin)))
        return colors[Math.floor(cellRandom(l.seed, cy * grid + cx, 3) * colors.length)]
      }
    }
    const stops = paint.stops.map((s) => ({ t: s.offset, c: mustParseColor(s.color) })).sort((a, b) => a.t - b.t)
    if (!stops.length) throw new TypeError('gradient needs at least one stop')
    const g = gradientGeometry(paint, origin, span)
    return (u, v) => {
      let t: number
      if (g.kind === 'radial') t = Math.hypot(u - g.cx, v - g.cy) / g.r
      else {
        const dx = g.x2 - g.x1
        const dy = g.y2 - g.y1
        t = ((u - g.x1) * dx + (v - g.y1) * dy) / (dx * dx + dy * dy)
      }
      if (t <= stops[0].t) return stops[0].c
      for (let i = 1; i < stops.length; i++) {
        if (t <= stops[i].t) {
          const a = stops[i - 1]
          const b = stops[i]
          const k = (t - a.t) / (b.t - a.t || 1)
          return [0, 1, 2, 3].map((j) => a.c[j] + (b.c[j] - a.c[j]) * k) as RGBA
        }
      }
      return stops[stops.length - 1].c
    }
  }
  const layerPaint = [
    makePaint(paints.dots, margin, grid),
    makePaint(paints.alignment, margin, grid),
    makePaint(paints.finder, margin, grid),
    makePaint(paints.finderInner, margin, grid),
  ]
  const bgPaint = makePaint(paints.background, 0, total)
  const plateColor = options.logo?.background ? mustParseColor(options.logo.background) : null
  const plate = plateColor && l.logo ? l.logo : null
  const plateR = plate ? Math.min(plate.w, plate.h) * 0.12 : 0
  const plateRadii = [plateR, plateR, plateR, plateR]

  // Cells that are either empty or a full square can skip supersampling.
  const simple = new Uint8Array(grid * grid)
  for (let i = 0; i < simple.length; i++) {
    const g = i * 8
    simple[i] = !zone[i] && (!kind[i] || (kind[i] === 1 && geom[g + 2] === 1 && geom[g + 3] === 1 && !geom[g + 4] && !geom[g + 5] && !geom[g + 6] && !geom[g + 7])) ? 1 : 0
  }

  // Layer index: 0 = nothing, 1 = dots, 2 = alignment, 3 = finder frame, 4 = finder center, 5 = logo plate.
  const sample = (u: number, v: number): number => {
    const gx = u - margin
    const gy = v - margin
    if (plate) {
      if (plate.circle) {
        const dx = (gx - plate.x - plate.w / 2) / (plate.w / 2)
        const dy = (gy - plate.y - plate.h / 2) / (plate.h / 2)
        if (dx * dx + dy * dy <= 1) return 5
      } else if (inRoundRect(gx, gy, plate.x, plate.y, plate.w, plate.h, plateRadii)) return 5
    }
    if (gx < 0 || gy < 0 || gx >= grid || gy >= grid) return 0
    const cx = Math.floor(gx)
    const cy = Math.floor(gy)
    const i = cy * grid + cx
    const z = zone[i]
    if (z) {
      const ft = features[z - 1]
      const finder = ft.kind === 'finder'
      if (inRoundRect(gx, gy, ft.x, ft.y, ft.size, ft.size, ft.frame) && !inRoundRect(gx, gy, ft.x + 1, ft.y + 1, ft.size - 2, ft.size - 2, ft.hole)) return finder ? 3 : 2
      const ps = ft.size - 4
      const inPupil = ft.pupilPolygon
        ? inPolygon((gx - ft.x - 2) / ps, (gy - ft.y - 2) / ps, ft.pupilPolygon)
        : inRoundRect(gx, gy, ft.x + 2, ft.y + 2, ps, ps, ft.pupil)
      return inPupil ? (finder ? 4 : 2) : 0
    }
    if (!kind[i]) return 0
    const g = i * 8
    if (kind[i] === 2) return inPolygon((gx - cx - geom[g]) / geom[g + 2], (gy - cy - geom[g + 1]) / geom[g + 3], l.polygon!) ? 1 : 0
    return inRoundRect(gx, gy, cx + geom[g], cy + geom[g + 1], geom[g + 2], geom[g + 3], geom, g + 4) ? 1 : 0
  }

  const data = new Uint8ClampedArray(size * size * 4)
  const SS = 4
  const cov = new Float64Array(6)
  for (let py = 0; py < size; py++) {
    const v0 = py * step
    const cy0 = Math.floor(v0 - margin)
    const cy1 = Math.floor(v0 + step - margin - 1e-9)
    for (let px = 0; px < size; px++) {
      const u0 = px * step
      const cx0 = Math.floor(u0 - margin)
      const cx1 = Math.floor(u0 + step - margin - 1e-9)
      const inside = cx0 >= 0 && cy0 >= 0 && cx0 < grid && cy0 < grid
      const nearEdge = bgRadius > 0 && (u0 < bgRadius || v0 < bgRadius || u0 + step > total - bgRadius || v0 + step > total - bgRadius)
      const nearPlate = plate !== null && cx1 >= plate.x - 1 && cx0 <= plate.x + plate.w && cy1 >= plate.y - 1 && cy0 <= plate.y + plate.h
      cov.fill(0)
      let bgCov = 1
      if (!nearEdge && !nearPlate && cx0 === cx1 && cy0 === cy1 && (!inside || simple[cy0 * grid + cx0])) {
        if (inside && kind[cy0 * grid + cx0]) cov[1] = 1
      } else {
        let bgHits = 0
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            const u = u0 + ((sx + 0.5) / SS) * step
            const v = v0 + ((sy + 0.5) / SS) * step
            cov[sample(u, v)]++
            if (nearEdge && inRoundRect(u, v, 0, 0, total, total, bgR)) bgHits++
          }
        }
        for (let k = 1; k < 6; k++) cov[k] /= SS * SS
        if (nearEdge) bgCov = bgHits / (SS * SS)
      }

      // Source-over compositing, starting from transparent.
      let r = 0, g = 0, b = 0, a = 0
      const over = (c: RGBA, alpha: number) => {
        if (alpha <= 0) return
        const outA = alpha + a * (1 - alpha)
        r = (c[0] * alpha + r * a * (1 - alpha)) / outA
        g = (c[1] * alpha + g * a * (1 - alpha)) / outA
        b = (c[2] * alpha + b * a * (1 - alpha)) / outA
        a = outA
      }
      const uc = u0 + step / 2
      const vc = v0 + step / 2
      const bg = bgPaint(uc, vc)
      over(bg, (bgCov * bg[3]) / 255)
      for (let k = 1; k <= 4; k++) {
        if (cov[k]) {
          const c = layerPaint[k - 1](uc, vc)
          over(c, (cov[k] * c[3]) / 255)
        }
      }
      if (cov[5]) over(plateColor!, (cov[5] * plateColor![3]) / 255)
      const o = (py * size + px) * 4
      data[o] = r
      data[o + 1] = g
      data[o + 2] = b
      data[o + 3] = a * 255
    }
  }

  const art = options.logo?.image
  if (art && l.logo) {
    // Fit the artwork inside the logo area, preserving its aspect ratio.
    const boxW = (l.logo.w - l.logo.pad * 2) / step
    const boxH = (l.logo.h - l.logo.pad * 2) / step
    const k = Math.min(boxW / art.width, boxH / art.height)
    const w = art.width * k
    const h = art.height * k
    const center = total / 2 / step
    const x0 = center - w / 2
    const y0 = center - h / 2
    for (let py = Math.max(0, Math.floor(y0)); py < Math.min(size, Math.ceil(y0 + h)); py++) {
      for (let px = Math.max(0, Math.floor(x0)); px < Math.min(size, Math.ceil(x0 + w)); px++) {
        const sx = Math.min(art.width - 1, Math.max(0, Math.floor((px + 0.5 - x0) / k)))
        const sy = Math.min(art.height - 1, Math.max(0, Math.floor((py + 0.5 - y0) / k)))
        const s = (sy * art.width + sx) * 4
        const alpha = art.data[s + 3] / 255
        if (alpha <= 0) continue
        const o = (py * size + px) * 4
        const da = data[o + 3] / 255
        const outA = alpha + da * (1 - alpha)
        for (let j = 0; j < 3; j++) data[o + j] = (art.data[s + j] * alpha + data[o + j] * da * (1 - alpha)) / outA
        data[o + 3] = outA * 255
      }
    }
  }
  return { data, width: size, height: size }
}

/** Renders a QR code as PNG file bytes. Works in Node, browsers, workers and edge runtimes. */
export function renderPNG(input: QRInput, options: RasterOptions = {}): Uint8Array {
  return encodePNG(rasterize(input, options))
}
