import { toQR, type QRInput } from './style'
import type { EncodeOptions } from '../core/encode'

export interface TextOptions extends EncodeOptions {
  /** Quiet zone in modules. Default 2. */
  margin?: number
  /**
   * `'ansi'` sets explicit black and white colors, so it reads correctly on any theme.
   * `'unicode'` uses plain block characters and assumes light text on a dark background.
   * Default `'unicode'`.
   */
  style?: 'unicode' | 'ansi'
  /** Swap light and dark, for `'unicode'` output on light-background terminals. */
  invert?: boolean
}

/** Renders a QR code as text, two module rows per line, for terminals and logs. */
export function renderText(input: QRInput, options: TextOptions = {}): string {
  const qr = toQR(input, options)
  const margin = options.margin ?? 2
  const n = qr.size
  const dark = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && qr.modules[y * n + x] === 1
  const lines: string[] = []
  for (let y = -margin; y < n + margin; y += 2) {
    let line = ''
    for (let x = -margin; x < n + margin; x++) {
      const top = dark(x, y)
      const bottom = y + 1 < n + margin ? dark(x, y + 1) : false
      if (options.style === 'ansi') {
        line += `\x1b[${top ? 30 : 97};${bottom ? 40 : 107}m▀`
      } else {
        // A "lit" character cell is a light module unless inverted.
        const t = top === !!options.invert
        const b = bottom === !!options.invert
        line += t && b ? '█' : t ? '▀' : b ? '▄' : ' '
      }
    }
    lines.push(options.style === 'ansi' ? line + '\x1b[0m' : line)
  }
  return lines.join('\n')
}
