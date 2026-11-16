import { rasterize } from './render/raster'
import { computeLayout, paintColors, parseColor, resolvePaints, toQR, type QRInput, type RenderOptions, type RGBA } from './render/style'
import { scan } from './scan/locate'

export interface VerifyIssue {
  level: 'error' | 'warning'
  code: 'unreadable' | 'unreadable-small' | 'wrong-content' | 'low-contrast' | 'inverted' | 'quiet-zone' | 'low-headroom' | 'unknown-color'
  message: string
}

export interface VerifyReport {
  /** True when the code decoded correctly at both test sizes with workable contrast and at least 10% of error correction to spare. */
  ok: boolean
  /** Decoded at 8 pixels per module. */
  readable: boolean
  /** Decoded at 3 pixels per module, approximating a small or distant code. */
  readableSmall: boolean
  /** Share of error correction used up by the styling in the worst block, 0-1. */
  eccLoad: number
  /** Contrast ratio between the faintest module color and the background (1-21). */
  contrast: number | null
  issues: VerifyIssue[]
}

function luminance(c: RGBA, over: RGBA = [255, 255, 255, 255]): number {
  const a = c[3] / 255
  const ch = [0, 1, 2].map((i) => {
    const v = (c[i] * a + over[i] * (1 - a)) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}

/**
 * Checks that a styled QR code still scans. The code is rasterized exactly as
 * `renderPNG` would draw it, at a comfortable and at a small size, and read back
 * with the built-in scanner (finder detection, grid sampling, error correction).
 * Color contrast, polarity, quiet zone and remaining error-correction headroom
 * are reported as well.
 *
 * A logo given only as `href` cannot be inspected; its area is treated as blank.
 */
export function verify(input: QRInput, options: RenderOptions = {}): VerifyReport {
  const qr = toQR(input, options)
  const layout = computeLayout(qr, options)
  const issues: VerifyIssue[] = []

  // Static color checks: every module color against every background color.
  const paints = resolvePaints(options)
  const bgList = paintColors(paints.background).map(parseColor)
  const fgList = [paints.dots, paints.finder, paints.finderInner, paints.alignment].flatMap(paintColors).map(parseColor)
  let contrast: number | null = null
  if (bgList.some((c) => !c) || fgList.some((c) => !c)) {
    issues.push({ level: 'warning', code: 'unknown-color', message: 'A color could not be parsed, so the check cannot be run. Use hex or rgb() colors.' })
    return { ok: false, readable: false, readableSmall: false, eccLoad: 0, contrast, issues }
  }
  contrast = 21
  let inverted = false
  for (const bg of bgList as RGBA[]) {
    // A transparent background is assumed to sit on white.
    const bgL = luminance(bg)
    const under: RGBA = [bg[0] * (bg[3] / 255) + 255 - bg[3], bg[1] * (bg[3] / 255) + 255 - bg[3], bg[2] * (bg[3] / 255) + 255 - bg[3], 255]
    for (const c of fgList as RGBA[]) {
      const l = luminance(c, under)
      contrast = Math.min(contrast, (Math.max(l, bgL) + 0.05) / (Math.min(l, bgL) + 0.05))
      if (l > bgL) inverted = true
    }
  }
  contrast = Math.round(contrast * 100) / 100
  if (inverted) {
    issues.push({ level: 'warning', code: 'inverted', message: 'Modules are lighter than the background. Many scanner apps cannot read light-on-dark codes.' })
  }
  // A synthetic render binarizes perfectly at any contrast; a camera does not.
  // Below 2:1 the result is treated as a failure regardless of the read-back.
  const tooFaint = contrast < 2
  if (contrast < 4) {
    issues.push({ level: tooFaint ? 'error' : 'warning', code: 'low-contrast', message: `Contrast ratio is ${contrast}:1. Aim for at least 4:1 between modules and background.` })
  }
  if (layout.margin < 2 && options.shape !== 'circle') {
    issues.push({ level: 'warning', code: 'quiet-zone', message: `Quiet zone is ${layout.margin} modules. The specification asks for 4; below 2 often fails against busy surroundings.` })
  }

  const expected = typeof input === 'string' ? input : null
  const expectedBytes = input instanceof Uint8Array ? input : null
  const tryScan = (pxPerModule: number) => {
    try {
      const res = scan(rasterize(qr, { ...options, size: Math.round(layout.total * pxPerModule) }))
      let match = true
      if (expected !== null) match = res.text === expected
      else if (expectedBytes) match = res.bytes.length === expectedBytes.length && res.bytes.every((b, i) => b === expectedBytes[i])
      return { ok: match, wrong: !match, load: res.eccLoad, invertedRead: res.inverted }
    } catch {
      return { ok: false, wrong: false, load: 1, invertedRead: false }
    }
  }

  const big = tryScan(8)
  const small = tryScan(3)
  if (big.wrong || small.wrong) {
    issues.push({ level: 'error', code: 'wrong-content', message: 'The code decodes, but to different content than was encoded.' })
  } else if (!big.ok) {
    issues.push({ level: 'error', code: 'unreadable', message: 'The styled code could not be read back. Reduce the logo size, raise the ECC level, or increase contrast and dot size.' })
  } else if (!small.ok) {
    issues.push({ level: 'error', code: 'unreadable-small', message: 'The code reads at large sizes but fails when small. Use larger dots, more contrast, or a smaller logo.' })
  } else if (Math.max(big.load, small.load) > 0.75) {
    issues.push({ level: Math.max(big.load, small.load) > 0.9 ? 'error' : 'warning', code: 'low-headroom', message: `Styling already uses ${Math.round(Math.max(big.load, small.load) * 100)}% of the error correction, leaving little margin for print damage or glare.` })
  }

  const eccLoad = Math.round(Math.max(big.load, small.load) * 100) / 100
  return { ok: big.ok && small.ok && !tooFaint && eccLoad <= 0.9, readable: big.ok, readableSmall: small.ok, eccLoad, contrast, issues }
}
