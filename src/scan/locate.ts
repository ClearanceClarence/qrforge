import { decodeMatrix, QRDecodeError, type DecodeResult } from '../core/decode'

/** Anything shaped like the DOM's ImageData (RGBA, 4 bytes per pixel). */
export interface RGBAImage {
  data: Uint8Array | Uint8ClampedArray
  width: number
  height: number
}

export interface ScanResult extends DecodeResult {
  /** True when the code was only readable as light-on-dark. */
  inverted: boolean
  /** Estimated module size in pixels. */
  moduleSize: number
}

interface Candidate {
  x: number
  y: number
  ms: number
  hits: number
}

function toGray(img: RGBAImage): Uint8Array {
  const n = img.width * img.height
  const gray = new Uint8Array(n)
  const d = img.data
  for (let i = 0; i < n; i++) {
    const a = d[i * 4 + 3] / 255
    const l = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
    gray[i] = Math.round(l * a + 255 * (1 - a))
  }
  return gray
}

function otsu(gray: Uint8Array): number {
  const hist = new Float64Array(256)
  for (const g of gray) hist[g]++
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0
  let wB = 0
  let best = 0
  let threshold = 127
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = gray.length - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const diff = sumB / wB - (sum - sumB) / wF
    const between = wB * wF * diff * diff
    if (between > best) {
      best = between
      threshold = t
    }
  }
  return threshold
}

function ratioOk(c: number[]): boolean {
  const total = c[0] + c[1] + c[2] + c[3] + c[4]
  if (total < 7) return false
  const ms = total / 7
  const tol = ms / 2
  return (
    Math.abs(ms - c[0]) < tol &&
    Math.abs(ms - c[1]) < tol &&
    Math.abs(3 * ms - c[2]) < 3 * tol &&
    Math.abs(ms - c[3]) < tol &&
    Math.abs(ms - c[4]) < tol
  )
}

/** Walks outward from a point along one axis and returns the 1:1:3:1:1 run lengths. */
function crossCheck(bin: Uint8Array, w: number, h: number, cx: number, cy: number, vertical: boolean): { center: number; total: number } | null {
  const len = vertical ? h : w
  const at = (p: number) => (vertical ? bin[p * w + cx] : bin[cy * w + p])
  const start = vertical ? cy : cx
  if (!at(start)) return null
  const c = [0, 0, 0, 0, 0]
  let p = start
  while (p >= 0 && at(p)) (c[2]++, p--)
  while (p >= 0 && !at(p)) (c[1]++, p--)
  while (p >= 0 && at(p)) (c[0]++, p--)
  let q = start + 1
  while (q < len && at(q)) (c[2]++, q++)
  while (q < len && !at(q)) (c[3]++, q++)
  while (q < len && at(q)) (c[4]++, q++)
  if (!ratioOk(c)) return null
  return { center: q - c[4] - c[3] - c[2] / 2, total: c[0] + c[1] + c[2] + c[3] + c[4] }
}

function findFinders(bin: Uint8Array, w: number, h: number): Candidate[] {
  const found: Candidate[] = []
  for (let y = 0; y < h; y++) {
    // Run-length encode the row.
    const starts: number[] = []
    const lens: number[] = []
    const colors: number[] = []
    let x = 0
    while (x < w) {
      const color = bin[y * w + x]
      const s = x
      while (x < w && bin[y * w + x] === color) x++
      starts.push(s)
      lens.push(x - s)
      colors.push(color)
    }
    for (let i = 0; i + 4 < lens.length; i++) {
      if (!colors[i]) continue
      const c = [lens[i], lens[i + 1], lens[i + 2], lens[i + 3], lens[i + 4]]
      if (!ratioOk(c)) continue
      const cx = Math.floor(starts[i + 2] + lens[i + 2] / 2)
      const v = crossCheck(bin, w, h, cx, y, true)
      if (!v) continue
      const hz = crossCheck(bin, w, h, cx, Math.floor(v.center), false)
      if (!hz) continue
      const ms = (v.total + hz.total) / 14
      const px = hz.center
      const py = v.center
      const hit = found.find((f) => Math.abs(f.x - px) < f.ms * 1.5 && Math.abs(f.y - py) < f.ms * 1.5)
      if (hit) {
        hit.x = (hit.x * hit.hits + px) / (hit.hits + 1)
        hit.y = (hit.y * hit.hits + py) / (hit.hits + 1)
        hit.ms = (hit.ms * hit.hits + ms) / (hit.hits + 1)
        hit.hits++
      } else {
        found.push({ x: px, y: py, ms, hits: 1 })
      }
    }
  }
  return found.sort((a, b) => b.hits - a.hits).slice(0, 3)
}

function attempt(bin: Uint8Array, w: number, h: number): Omit<ScanResult, 'inverted'> {
  const f = findFinders(bin, w, h)
  if (f.length < 3) throw new QRDecodeError('Could not locate three finder patterns')
  const dist = (a: Candidate, b: Candidate) => Math.hypot(a.x - b.x, a.y - b.y)
  // The corner opposite the longest side is the top-left finder.
  const d01 = dist(f[0], f[1])
  const d02 = dist(f[0], f[2])
  const d12 = dist(f[1], f[2])
  let tl: Candidate, a: Candidate, b: Candidate
  if (d12 >= d01 && d12 >= d02) [tl, a, b] = [f[0], f[1], f[2]]
  else if (d02 >= d01 && d02 >= d12) [tl, a, b] = [f[1], f[0], f[2]]
  else [tl, a, b] = [f[2], f[0], f[1]]
  const cross = (a.x - tl.x) * (b.y - tl.y) - (a.y - tl.y) * (b.x - tl.x)
  const [tr, bl] = cross > 0 ? [a, b] : [b, a]

  const ms = (tl.ms + tr.ms + bl.ms) / 3
  const estimate = (dist(tl, tr) + dist(tl, bl)) / 2 / ms + 7
  const base = Math.round((estimate - 17) / 4) * 4 + 17
  let lastError: unknown = new QRDecodeError('Could not determine symbol size')
  for (const dim of [base, base + 4, base - 4]) {
    if (dim < 21 || dim > 177) continue
    const span = dim - 7
    const modules = new Uint8Array(dim * dim)
    for (let my = 0; my < dim; my++) {
      for (let mx = 0; mx < dim; mx++) {
        const u = (mx + 0.5 - 3.5) / span
        const v = (my + 0.5 - 3.5) / span
        const px = Math.floor(tl.x + u * (tr.x - tl.x) + v * (bl.x - tl.x))
        const py = Math.floor(tl.y + u * (tr.y - tl.y) + v * (bl.y - tl.y))
        if (px >= 0 && px < w && py >= 0 && py < h) modules[my * dim + mx] = bin[py * w + px]
      }
    }
    try {
      return { ...decodeMatrix(modules, dim), moduleSize: ms }
    } catch (e) {
      lastError = e
    }
  }
  throw lastError
}

/**
 * Reads a QR code from a flat RGBA image such as a render, screenshot or scan.
 * It locates the three finder patterns, samples the grid and applies error
 * correction. Perspective-distorted camera photos are out of scope.
 */
export function scan(image: RGBAImage): ScanResult {
  const { width: w, height: h } = image
  const gray = toGray(image)
  const t = otsu(gray)
  const bin = new Uint8Array(gray.length)
  for (let i = 0; i < gray.length; i++) bin[i] = gray[i] <= t ? 1 : 0
  try {
    return { ...attempt(bin, w, h), inverted: false }
  } catch (first) {
    for (let i = 0; i < bin.length; i++) bin[i] ^= 1
    try {
      return { ...attempt(bin, w, h), inverted: true }
    } catch {
      throw first
    }
  }
}
