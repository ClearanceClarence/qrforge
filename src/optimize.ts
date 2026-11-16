import type { QRInput, RenderOptions } from './render/style'
import { isQRCode, POLYGONS } from './render/style'
import { verify, type VerifyReport } from './verify'

export interface ScannableResult {
  /** Options adjusted until the check passed (or the original ones if it already did). */
  options: RenderOptions
  /** Report for the returned options. */
  report: VerifyReport
  /** What was changed. Empty when nothing needed fixing. */
  changes: string[]
}

const round = (v: number) => Math.round(v * 100) / 100

/**
 * Adjusts a style until `verify()` passes while staying as close to the
 * request as it can. It raises error correction first, then finds the
 * smallest increase in dot size and the smallest reduction in logo size that
 * work, and changes shapes only as a last resort. Colors are never changed;
 * if contrast is the problem the result comes back with `report.ok === false`.
 */
export function makeScannable(input: QRInput, options: RenderOptions = {}): ScannableResult {
  const original: RenderOptions = { ...options, logo: options.logo ? { ...options.logo } : undefined }
  const changes: string[] = []
  let o = original
  let report = verify(input, o)
  const hopeless = () => report.issues.some((i) => (i.code === 'low-contrast' && i.level === 'error') || i.code === 'unknown-color')
  const failing = () => !report.ok && !hopeless()
  const attempt = (next: RenderOptions): boolean => {
    const r = verify(input, next)
    if (r.ok) {
      o = next
      report = r
    }
    return r.ok
  }
  const force = (change: string, next: RenderOptions) => {
    o = next
    report = verify(input, o)
    changes.push(change)
  }
  if (!failing()) return { options: o, report, changes }

  // 1. Error correction costs nothing visually.
  const effectiveEcc = o.ecc ?? (o.logo ? 'H' : 'M')
  if (!isQRCode(input) && effectiveEcc !== 'H') force('Raised error correction to H', { ...o, ecc: 'H' })

  // 2. Dot size and logo size: go to the safe extreme, then walk back toward the request.
  const dot0 = o.dotScale ?? 1
  const var0 = o.dotScaleVariance ?? 0
  const logo0 = o.logo ? (o.logo.size ?? 0.22) : 0
  if (failing() && (dot0 < 1 || var0 > 0 || logo0 > 0.1)) {
    const withSizes = (dot: number, variance: number, logo: number): RenderOptions => ({
      ...o,
      dotScale: dot,
      dotScaleVariance: variance,
      logo: o.logo ? { ...o.logo, size: logo } : undefined,
    })
    const safeLogo = Math.min(logo0, 0.1)
    if (attempt(withSizes(1, 0, safeLogo))) {
      let dot = 1
      let variance = 0
      let logo = safeLogo
      while (logo < logo0 && attempt(withSizes(dot, variance, Math.min(logo0, round(logo + 0.02))))) logo = Math.min(logo0, round(logo + 0.02))
      while (dot > dot0 && attempt(withSizes(Math.max(dot0, round(dot - 0.1)), variance, logo))) dot = Math.max(dot0, round(dot - 0.1))
      if (var0 > 0 && attempt(withSizes(dot, var0, logo))) variance = var0
      report = verify(input, (o = withSizes(dot, variance, logo)))
      if (dot !== dot0) changes.push(`Increased dot size from ${dot0} to ${dot}`)
      if (variance !== var0) changes.push('Removed dot size variance')
      if (logo !== logo0) changes.push(`Reduced logo size from ${logo0} to ${logo}`)
    } else {
      o = withSizes(1, 0, safeLogo)
      report = verify(input, o)
      if (dot0 !== 1) changes.push(`Increased dot size from ${dot0} to 1`)
      if (var0 !== 0) changes.push('Removed dot size variance')
      if (logo0 !== safeLogo) changes.push(`Reduced logo size from ${logo0} to ${safeLogo}`)
    }
  }

  // 3. Shapes, only if sizes were not enough.
  if (failing() && o.finderInner && o.finderInner in POLYGONS) force('Changed finder centers to rounded', { ...o, finderInner: 'rounded' })
  if (failing() && o.dots && o.dots in POLYGONS) force('Changed dots to rounded', { ...o, dots: 'rounded' })
  if (failing() && o.shape === 'circle') force('Changed shape to square', { ...o, shape: 'square', margin: undefined })
  if (failing() && (o.margin ?? 4) < 4) force('Increased quiet zone to 4', { ...o, margin: 4 })
  return { options: o, report, changes }
}
