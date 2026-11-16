import { encodePNG } from './png'
import {
  cellRandom,
  computeLayout,
  gradientGeometry,
  isPalette,
  resolvePaints,
  toQR,
  type Feature,
  type Layout,
  type Paint,
  type Point,
  type QRInput,
  type Radii,
  type RenderOptions,
} from './style'

export interface SVGOptions extends RenderOptions {
  /** Width and height attribute in pixels. Omit for an SVG that scales to its container. */
  size?: number
  /** Accessible title, also exposed as aria-label. */
  title?: string
}

const f = (v: number): string => {
  const s = (Math.round(v * 1000) / 1000).toString()
  return s.startsWith('0.') ? s.slice(1) : s.startsWith('-0.') ? '-' + s.slice(2) : s
}

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Path for a rectangle with independent corner radii (tl, tr, br, bl). */
export function roundRectPath(x: number, y: number, w: number, h: number, radii: ArrayLike<number>): string {
  const max = Math.min(w, h) / 2
  const tl = Math.min(radii[0], max)
  const tr = Math.min(radii[1], max)
  const br = Math.min(radii[2], max)
  const bl = Math.min(radii[3], max)
  if (!tl && !tr && !br && !bl) return `M${f(x)} ${f(y)}h${f(w)}v${f(h)}h${f(-w)}z`
  const arc = (r: number, dx: number, dy: number) => (r ? `a${f(r)} ${f(r)} 0 0 1 ${f(dx)} ${f(dy)}` : '')
  const line = (c: string, len: number) => (Math.abs(len) > 1e-6 ? c + f(len) : '')
  return (
    `M${f(x + tl)} ${f(y)}` +
    line('h', w - tl - tr) + arc(tr, tr, tr) +
    line('v', h - tr - br) + arc(br, -br, br) +
    line('h', -(w - br - bl)) + arc(bl, -bl, -bl) +
    line('v', -(h - bl - tl)) + arc(tl, tl, -tl) +
    'z'
  )
}

function polygonPath(points: Point[], x: number, y: number, w: number, h: number): string {
  return points.map(([px, py], i) => `${i ? 'L' : 'M'}${f(x + px * w)} ${f(y + py * h)}`).join('') + 'z'
}

/** One path string per palette color (a single entry when no palette is used). */
function dotPaths(l: Layout, groups: number): string[] {
  const { grid, margin: m, kind, geom } = l
  const out = new Array<string>(groups).fill('')
  const group = (i: number) => (groups > 1 ? Math.floor(cellRandom(l.seed, i, 3) * groups) : 0)
  const full = (i: number) => kind[i] === 1 && geom[i * 8 + 2] === 1 && geom[i * 8 + 3] === 1 && !geom[i * 8 + 4] && !geom[i * 8 + 5] && !geom[i * 8 + 6] && !geom[i * 8 + 7]
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const i = y * grid + x
      if (!kind[i]) continue
      const g = i * 8
      const gi = group(i)
      if (full(i)) {
        // Merge a horizontal run of full squares of the same color into one rectangle.
        let end = x
        while (end + 1 < grid && full(y * grid + end + 1) && group(y * grid + end + 1) === gi) end++
        out[gi] += `M${x + m} ${y + m}h${end - x + 1}v1h${x - end - 1}z`
        x = end
      } else if (kind[i] === 2) {
        out[gi] += polygonPath(l.polygon!, x + m + geom[g], y + m + geom[g + 1], geom[g + 2], geom[g + 3])
      } else {
        out[gi] += roundRectPath(x + m + geom[g], y + m + geom[g + 1], geom[g + 2], geom[g + 3], geom.subarray(g + 4, g + 8))
      }
    }
  }
  return out
}

function framePath(ft: Feature, m: number): string {
  return roundRectPath(ft.x + m, ft.y + m, ft.size, ft.size, ft.frame) + roundRectPath(ft.x + m + 1, ft.y + m + 1, ft.size - 2, ft.size - 2, ft.hole)
}

function pupilPath(ft: Feature, m: number): string {
  const s = ft.size - 4
  return ft.pupilPolygon ? polygonPath(ft.pupilPolygon, ft.x + m + 2, ft.y + m + 2, s, s) : roundRectPath(ft.x + m + 2, ft.y + m + 2, s, s, ft.pupil as Radii)
}

function base64(bytes: Uint8Array): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let s = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    s += abc[b >> 18] + abc[(b >> 12) & 63] + (i + 1 < bytes.length ? abc[(b >> 6) & 63] : '=') + (i + 2 < bytes.length ? abc[b & 63] : '=')
  }
  return s
}

export function toDataURL(mime: string, content: string | Uint8Array): string {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
  return `data:${mime};base64,${base64(bytes)}`
}

function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

export interface SVGParts {
  /** Side length of the viewBox, in modules (symbol plus margins). */
  viewSize: number
  /** Markup that goes inside the `<svg>` element. */
  body: string
  /** True when the output is made of axis-aligned squares only. */
  crisp: boolean
}

/** Builds the inner SVG markup; used by `renderSVG` and the framework components. */
export function svgParts(input: QRInput, options: SVGOptions = {}): SVGParts {
  const qr = toQR(input, options)
  const l = computeLayout(qr, options)
  const paints = resolvePaints(options)
  const t = l.total
  const m = l.margin

  const defs = new Map<string, string>()
  const fill = (paint: Paint, origin: number, span: number): string => {
    if (typeof paint === 'string') return esc(paint)
    const id = 'qrf' + hash(JSON.stringify(paint) + origin + ':' + span)
    if (!defs.has(id)) {
      const g = gradientGeometry(paint, origin, span)
      const stops = paint.stops.map((s) => `<stop offset="${f(s.offset)}" stop-color="${esc(s.color)}"/>`).join('')
      defs.set(
        id,
        g.kind === 'radial'
          ? `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${f(g.cx)}" cy="${f(g.cy)}" r="${f(g.r)}">${stops}</radialGradient>`
          : `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(g.x1)}" y1="${f(g.y1)}" x2="${f(g.x2)}" y2="${f(g.y2)}">${stops}</linearGradient>`,
      )
    }
    return `url(#${id})`
  }
  const symbol = (paint: Paint) => fill(paint, m, l.grid)

  let body = ''
  if (paints.background !== 'transparent') {
    const rx = l.backgroundRadius ? ` rx="${f(l.backgroundRadius)}"` : ''
    body += `<rect width="${t}" height="${t}"${rx} fill="${fill(paints.background, 0, t)}"/>`
  }

  if (isPalette(paints.dots)) {
    const colors = paints.dots.colors
    dotPaths(l, colors.length).forEach((d, i) => {
      if (d) body += `<path fill="${esc(colors[i])}" d="${d}"/>`
    })
  } else {
    const d = dotPaths(l, 1)[0]
    if (d) body += `<path fill="${symbol(paints.dots)}" d="${d}"/>`
  }

  const finders = l.features.filter((ft) => ft.kind === 'finder')
  const aligns = l.features.filter((ft) => ft.kind === 'alignment')
  if (aligns.length) {
    body += `<path fill="${symbol(paints.alignment)}" fill-rule="evenodd" d="${aligns.map((a) => framePath(a, m) + pupilPath(a, m)).join('')}"/>`
  }
  body += `<path fill="${symbol(paints.finder)}" fill-rule="evenodd" d="${finders.map((a) => framePath(a, m)).join('')}"/>`
  body += `<path fill="${symbol(paints.finderInner)}" d="${finders.map((a) => pupilPath(a, m)).join('')}"/>`

  const logo = options.logo
  if (logo && l.logo) {
    const b = l.logo
    if (logo.background) {
      body += b.circle
        ? `<ellipse cx="${f(b.x + m + b.w / 2)}" cy="${f(b.y + m + b.h / 2)}" rx="${f(b.w / 2)}" ry="${f(b.h / 2)}" fill="${esc(logo.background)}"/>`
        : `<rect x="${f(b.x + m)}" y="${f(b.y + m)}" width="${b.w}" height="${b.h}" rx="${f(Math.min(b.w, b.h) * 0.12)}" fill="${esc(logo.background)}"/>`
    }
    const href = logo.href ?? (logo.image ? toDataURL('image/png', encodePNG(logo.image)) : undefined)
    if (href) {
      body += `<image href="${esc(href)}" x="${f(b.x + m + b.pad)}" y="${f(b.y + m + b.pad)}" width="${f(b.w - b.pad * 2)}" height="${f(b.h - b.pad * 2)}" preserveAspectRatio="xMidYMid meet"/>`
    }
  }

  const head = (options.title ? `<title>${esc(options.title)}</title>` : '') + (defs.size ? `<defs>${[...defs.values()].join('')}</defs>` : '')
  return { viewSize: t, body: head + body, crisp: l.crisp }
}

/** Renders a QR code as an SVG string. */
export function renderSVG(input: QRInput, options: SVGOptions = {}): string {
  const { viewSize: t, body, crisp } = svgParts(input, options)
  const size = options.size ? ` width="${options.size}" height="${options.size}"` : ''
  const label = options.title ? ` aria-label="${esc(options.title)}"` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${t} ${t}"${size} role="img"${label}${crisp ? ' shape-rendering="crispEdges"' : ''}>${body}</svg>`
}
