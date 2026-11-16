export type Mode = 'numeric' | 'alphanumeric' | 'byte' | 'kanji' | 'eci'

export interface Segment {
  mode: Mode
  /** Character count as written to the count field (bytes for byte mode). */
  numChars: number
  bits: number[]
}

export const MODE_INDICATOR: Record<Mode, number> = { numeric: 1, alphanumeric: 2, byte: 4, kanji: 8, eci: 7 }
const CC_BITS: Record<Mode, readonly [number, number, number]> = {
  numeric: [10, 12, 14],
  alphanumeric: [9, 11, 13],
  byte: [8, 16, 16],
  kanji: [8, 10, 12],
  eci: [0, 0, 0],
}

export const ALPHANUMERIC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:'

/** 0 for versions 1-9, 1 for 10-26, 2 for 27-40. */
export function versionGroup(ver: number): number {
  return ver <= 9 ? 0 : ver <= 26 ? 1 : 2
}

export function charCountBits(mode: Mode, ver: number): number {
  return CC_BITS[mode][versionGroup(ver)]
}

export function pushBits(out: number[], value: number, len: number): void {
  for (let i = len - 1; i >= 0; i--) out.push((value >>> i) & 1)
}

const utf8 = /* @__PURE__ */ new TextEncoder()

// --- Kanji (Shift JIS) support, built lazily from the platform's TextDecoder ---

let kanjiMap: Map<number, number> | null | undefined

export function getKanjiMap(): Map<number, number> | null {
  if (kanjiMap !== undefined) return kanjiMap
  try {
    const dec = new TextDecoder('shift_jis', { fatal: true })
    const map = new Map<number, number>()
    const pair = new Uint8Array(2)
    const scan = (from: number, to: number) => {
      for (let hi = from; hi <= to; hi++) {
        for (let lo = 0x40; lo <= 0xfc; lo++) {
          if (lo === 0x7f) continue
          pair[0] = hi
          pair[1] = lo
          let s: string
          try {
            s = dec.decode(pair)
          } catch {
            continue
          }
          if (s.length !== 1) continue
          const cp = s.charCodeAt(0)
          if (cp < 0x80 || cp === 0xfffd || map.has(cp)) continue
          map.set(cp, (hi << 8) | lo)
        }
      }
    }
    scan(0x81, 0x9f)
    scan(0xe0, 0xeb)
    kanjiMap = map.size > 1000 ? map : null
  } catch {
    kanjiMap = null
  }
  return kanjiMap
}

function kanjiValue(sjis: number): number {
  const c = sjis - (sjis >= 0xe040 ? 0xc140 : 0x8140)
  return (c >> 8) * 0xc0 + (c & 0xff)
}

// --- Segment builders ---

export function byteSegment(data: Uint8Array): Segment {
  const bits: number[] = []
  for (const b of data) pushBits(bits, b, 8)
  return { mode: 'byte', numChars: data.length, bits }
}

function numericSegment(digits: string): Segment {
  const bits: number[] = []
  for (let i = 0; i < digits.length; ) {
    const n = Math.min(digits.length - i, 3)
    pushBits(bits, parseInt(digits.slice(i, i + n), 10), n * 3 + 1)
    i += n
  }
  return { mode: 'numeric', numChars: digits.length, bits }
}

function alphanumericSegment(text: string): Segment {
  const bits: number[] = []
  let i = 0
  for (; i + 2 <= text.length; i += 2) {
    pushBits(bits, ALPHANUMERIC.indexOf(text[i]) * 45 + ALPHANUMERIC.indexOf(text[i + 1]), 11)
  }
  if (i < text.length) pushBits(bits, ALPHANUMERIC.indexOf(text[i]), 6)
  return { mode: 'alphanumeric', numChars: text.length, bits }
}

function kanjiSegment(text: string, map: Map<number, number>): Segment {
  const bits: number[] = []
  for (let i = 0; i < text.length; i++) pushBits(bits, kanjiValue(map.get(text.charCodeAt(i))!), 13)
  return { mode: 'kanji', numChars: text.length, bits }
}

export function eciSegment(designator: number): Segment {
  const bits: number[] = []
  if (designator < 1 << 7) pushBits(bits, designator, 8)
  else if (designator < 1 << 14) {
    pushBits(bits, 0b10, 2)
    pushBits(bits, designator, 14)
  } else {
    pushBits(bits, 0b110, 3)
    pushBits(bits, designator, 21)
  }
  return { mode: 'eci', numChars: 0, bits }
}

/** Total encoded length in bits, or Infinity when a count field overflows. */
export function totalBits(segs: readonly Segment[], ver: number): number {
  let total = 0
  for (const seg of segs) {
    const cc = charCountBits(seg.mode, ver)
    if (seg.numChars >= 1 << cc && seg.mode !== 'eci') return Infinity
    total += 4 + cc + seg.bits.length
  }
  return total
}

type TextMode = 'byte' | 'alphanumeric' | 'numeric' | 'kanji'
const TEXT_MODES: readonly TextMode[] = ['byte', 'alphanumeric', 'numeric', 'kanji']

/**
 * Splits text into the sequence of segments with the fewest total bits for
 * the given version group, using dynamic programming over mode switches.
 */
export function optimalSegments(text: string, group: number, allowKanji: boolean): Segment[] {
  const cps = Array.from(text)
  if (cps.length === 0) return []

  let kmap = allowKanji ? getKanjiMap() : null
  if (kmap) {
    // Kanji mode is only used when every non-ASCII character is representable,
    // so byte segments stay pure ASCII and decode identically in any charset.
    for (const ch of cps) {
      const cp = ch.codePointAt(0)!
      if (cp >= 0x80 && !kmap.has(cp)) {
        kmap = null
        break
      }
    }
  }

  // Costs are in sixths of a bit so numeric (10/3) and alphanumeric (11/2) stay integral.
  const head = TEXT_MODES.map((m) => (4 + CC_BITS[m][group]) * 6)
  const choice: Int8Array[] = []
  let prev = head.slice()
  for (let i = 0; i < cps.length; i++) {
    const ch = cps[i]
    const cp = ch.codePointAt(0)!
    const cur = [Infinity, Infinity, Infinity, Infinity]
    const from = new Int8Array(4).fill(-1)
    cur[0] = prev[0] + utf8.encode(ch).length * 48
    from[0] = 0
    if (ALPHANUMERIC.includes(ch)) {
      cur[1] = prev[1] + 33
      from[1] = 1
    }
    if (cp >= 48 && cp <= 57) {
      cur[2] = prev[2] + 20
      from[2] = 2
    }
    if (kmap && kmap.has(cp)) {
      cur[3] = prev[3] + 78
      from[3] = 3
    }
    // Consider ending a segment after this character and starting another mode.
    for (let j = 0; j < 4; j++) {
      for (let k = 0; k < 4; k++) {
        if (from[k] !== k) continue
        const cost = Math.ceil(cur[k] / 6) * 6 + head[j]
        if (cost < cur[j]) {
          cur[j] = cost
          from[j] = k
        }
      }
    }
    choice.push(from)
    prev = cur
  }

  let mode = 0
  for (let j = 1; j < 4; j++) if (prev[j] < prev[mode]) mode = j
  const modes = new Array<number>(cps.length)
  for (let i = cps.length - 1; i >= 0; i--) {
    mode = choice[i][mode]
    modes[i] = mode
  }

  const segs: Segment[] = []
  for (let i = 0; i < cps.length; ) {
    let j = i
    while (j < cps.length && modes[j] === modes[i]) j++
    const part = cps.slice(i, j).join('')
    const m = TEXT_MODES[modes[i]]
    segs.push(
      m === 'byte'
        ? byteSegment(utf8.encode(part))
        : m === 'numeric'
          ? numericSegment(part)
          : m === 'alphanumeric'
            ? alphanumericSegment(part)
            : kanjiSegment(part, kmap!),
    )
    i = j
  }
  return segs
}
