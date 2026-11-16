import { rsDivisor, rsRemainder } from './gf'
import {
  byteSegment,
  eciSegment,
  MODE_INDICATOR,
  charCountBits,
  optimalSegments,
  pushBits,
  totalBits,
  type Mode,
  type Segment,
} from './segments'
import {
  alignmentPositions,
  ECC_CODEWORDS_PER_BLOCK,
  ECC_ORDER,
  formatBits,
  maskBit,
  NUM_ECC_BLOCKS,
  numDataCodewords,
  numRawDataModules,
  versionBits,
  type Ecc,
} from './tables'

export interface EncodeOptions {
  /** Error correction level. Default `'M'`. */
  ecc?: Ecc
  /** Raise the ECC level when it fits in the same version. Default `true`. */
  boostEcc?: boolean
  /** Smallest version to use (1-40). Default 1. */
  minVersion?: number
  /** Largest version to use (1-40). Default 40. */
  maxVersion?: number
  /** Force a mask pattern (0-7). Default: lowest penalty. */
  mask?: number
  /** Use kanji mode for Shift JIS text when it is safe to do so. Default `true`. */
  kanji?: boolean
  /** Prefix an ECI header declaring UTF-8. Default `false`. */
  eci?: boolean
}

export interface QRCode {
  /** Version 1-40. */
  version: number
  /** Modules per side. */
  size: number
  /** Error correction level actually used (may be boosted). */
  ecc: Ecc
  /** Mask pattern 0-7. */
  mask: number
  /** Row-major module grid, 1 = dark. */
  modules: Uint8Array
  /** Row-major grid, 1 = function pattern (finder, timing, alignment, format, version). */
  functionModules: Uint8Array
  /** Segments chosen by the encoder. */
  segments: { mode: Mode; numChars: number }[]
}

export class QRDataTooLongError extends RangeError {
  constructor(message: string) {
    super(message)
    this.name = 'QRDataTooLongError'
  }
}

/** Draws all function patterns for a version. Format bits are reserved but left blank. */
export function buildTemplate(version: number): { modules: Uint8Array; functionModules: Uint8Array } {
  const size = version * 4 + 17
  const modules = new Uint8Array(size * size)
  const fn = new Uint8Array(size * size)
  const set = (x: number, y: number, dark: boolean | number) => {
    modules[y * size + x] = dark ? 1 : 0
    fn[y * size + x] = 1
  }

  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }

  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx
        const y = cy + dy
        if (x < 0 || x >= size || y < 0 || y >= size) continue
        const dist = Math.max(Math.abs(dx), Math.abs(dy))
        set(x, y, dist !== 2 && dist !== 4)
      }
    }
  }
  finder(3, 3)
  finder(size - 4, 3)
  finder(3, size - 4)

  const align = alignmentPositions(version)
  const n = align.length
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) set(align[i] + dx, align[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
      }
    }
  }

  // Reserve format information areas.
  for (let i = 0; i < 9; i++) {
    if (!fn[i * size + 8]) set(8, i, 0)
    if (!fn[8 * size + i]) set(i, 8, 0)
  }
  for (let i = 0; i < 8; i++) {
    set(size - 1 - i, 8, 0)
    set(8, size - 1 - i, 0)
  }
  set(8, size - 8, 1)

  if (version >= 7) {
    const bits = versionBits(version)
    for (let i = 0; i < 18; i++) {
      const bit = (bits >>> i) & 1
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      set(a, b, bit)
      set(b, a, bit)
    }
  }
  return { modules, functionModules: fn }
}

export function drawFormatBits(modules: Uint8Array, size: number, ecc: Ecc, mask: number): void {
  const bits = formatBits(ecc, mask)
  const bit = (i: number) => (bits >>> i) & 1
  const set = (x: number, y: number, v: number) => {
    modules[y * size + x] = v
  }
  for (let i = 0; i <= 5; i++) set(8, i, bit(i))
  set(8, 7, bit(6))
  set(8, 8, bit(7))
  set(7, 8, bit(8))
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i))
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i))
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i))
  set(8, size - 8, 1)
}

/** Visits every non-function module in codeword placement order. */
export function zigzag(size: number, fn: Uint8Array, visit: (index: number) => void): void {
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        const idx = y * size + x
        if (!fn[idx]) visit(idx)
      }
    }
  }
}

function addEccAndInterleave(data: Uint8Array, version: number, ecc: Ecc): Uint8Array {
  const numBlocks = NUM_ECC_BLOCKS[ecc][version]
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecc][version]
  const rawCodewords = Math.floor(numRawDataModules(version) / 8)
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks)
  const shortBlockLen = Math.floor(rawCodewords / numBlocks)
  const divisor = rsDivisor(blockEccLen)

  const blocks: Uint8Array[] = []
  const eccs: Uint8Array[] = []
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const len = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1)
    const dat = data.subarray(k, k + len)
    k += len
    blocks.push(dat)
    eccs.push(rsRemainder(dat, divisor))
  }

  const result = new Uint8Array(rawCodewords)
  let o = 0
  for (let i = 0; i <= shortBlockLen - blockEccLen; i++) {
    for (const b of blocks) if (i < b.length) result[o++] = b[i]
  }
  for (let i = 0; i < blockEccLen; i++) {
    for (const e of eccs) result[o++] = e[i]
  }
  return result
}

function addHistory(run: number, h: Int32Array, size: number): void {
  if (h[0] === 0) run += size
  h[6] = h[5]
  h[5] = h[4]
  h[4] = h[3]
  h[3] = h[2]
  h[2] = h[1]
  h[1] = h[0]
  h[0] = run
}

function countPatterns(h: Int32Array): number {
  const n = h[1]
  const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n
  return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0)
}

/** Penalty score from the QR specification; lower is better. */
export function penaltyScore(m: Uint8Array, size: number): number {
  let result = 0
  const hist = new Int32Array(7)
  for (let pass = 0; pass < 2; pass++) {
    const stepA = pass === 0 ? size : 1
    const stepB = pass === 0 ? 1 : size
    for (let a = 0; a < size; a++) {
      let color = 0
      let run = 0
      hist.fill(0)
      for (let b = 0, idx = a * stepA; b < size; b++, idx += stepB) {
        const v = m[idx]
        if (v === color) {
          run++
          if (run === 5) result += 3
          else if (run > 5) result++
        } else {
          addHistory(run, hist, size)
          if (!color) result += countPatterns(hist) * 40
          color = v
          run = 1
        }
      }
      if (color) {
        addHistory(run, hist, size)
        run = 0
      }
      run += size
      addHistory(run, hist, size)
      result += countPatterns(hist) * 40
    }
  }
  let dark = 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = m[y * size + x]
      dark += c
      if (x + 1 < size && y + 1 < size && c === m[y * size + x + 1] && c === m[(y + 1) * size + x] && c === m[(y + 1) * size + x + 1]) {
        result += 3
      }
    }
  }
  const total = size * size
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1
  return result + k * 10
}

function checkInt(name: string, v: number, lo: number, hi: number): void {
  if (!Number.isInteger(v) || v < lo || v > hi) throw new RangeError(`${name} must be an integer from ${lo} to ${hi}`)
}

/**
 * Encodes text or binary data into a QR Code symbol.
 * Text is split into the most compact mix of numeric, alphanumeric, kanji and byte segments.
 */
export function encode(data: string | Uint8Array, options: EncodeOptions = {}): QRCode {
  const { boostEcc = true, minVersion = 1, maxVersion = 40, kanji = true, eci = false } = options
  let ecc = options.ecc ?? 'M'
  if (!ECC_ORDER.includes(ecc)) throw new RangeError(`ecc must be one of L, M, Q, H`)
  checkInt('minVersion', minVersion, 1, 40)
  checkInt('maxVersion', maxVersion, minVersion, 40)
  if (options.mask !== undefined) checkInt('mask', options.mask, 0, 7)

  const prefix = eci && typeof data === 'string' ? [eciSegment(26)] : []
  let version = 0
  let segs: Segment[] = []
  let usedBits = 0
  for (let group = 0; group < 3 && !version; group++) {
    const lo = Math.max(minVersion, [1, 10, 27][group])
    const hi = Math.min(maxVersion, [9, 26, 40][group])
    if (lo > hi) continue
    const candidate =
      typeof data === 'string' ? [...prefix, ...optimalSegments(data, group, kanji)] : [byteSegment(data)]
    for (let v = lo; v <= hi; v++) {
      const bits = totalBits(candidate, v)
      if (bits <= numDataCodewords(v, ecc) * 8) {
        version = v
        segs = candidate
        usedBits = bits
        break
      }
    }
  }
  if (!version) {
    throw new QRDataTooLongError(`Data does not fit in a version ${maxVersion} QR code at ECC level ${ecc}`)
  }

  if (boostEcc) {
    for (const level of ECC_ORDER) {
      if (ECC_ORDER.indexOf(level) > ECC_ORDER.indexOf(ecc) && usedBits <= numDataCodewords(version, level) * 8) ecc = level
    }
  }

  // Assemble the data bit stream.
  const bits: number[] = []
  for (const seg of segs) {
    pushBits(bits, MODE_INDICATOR[seg.mode], 4)
    pushBits(bits, seg.numChars, charCountBits(seg.mode, version))
    for (const b of seg.bits) bits.push(b)
  }
  const capacity = numDataCodewords(version, ecc) * 8
  pushBits(bits, 0, Math.min(4, capacity - bits.length))
  pushBits(bits, 0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) pushBits(bits, pad, 8)

  const dataCodewords = new Uint8Array(bits.length / 8)
  for (let i = 0; i < bits.length; i++) dataCodewords[i >>> 3] |= bits[i] << (7 - (i & 7))
  const codewords = addEccAndInterleave(dataCodewords, version, ecc)

  const size = version * 4 + 17
  const { modules, functionModules } = buildTemplate(version)
  let i = 0
  zigzag(size, functionModules, (idx) => {
    if (i < codewords.length * 8) {
      modules[idx] = (codewords[i >>> 3] >>> (7 - (i & 7))) & 1
      i++
    }
  })

  const applyMask = (target: Uint8Array, mask: number) => {
    for (let y = 0, idx = 0; y < size; y++) {
      for (let x = 0; x < size; x++, idx++) {
        if (!functionModules[idx] && maskBit(mask, x, y)) target[idx] ^= 1
      }
    }
  }

  let mask = options.mask ?? -1
  if (mask < 0) {
    let best = Infinity
    const trial = new Uint8Array(modules.length)
    for (let m = 0; m < 8; m++) {
      trial.set(modules)
      applyMask(trial, m)
      drawFormatBits(trial, size, ecc, m)
      const score = penaltyScore(trial, size)
      if (score < best) {
        best = score
        mask = m
      }
    }
  }
  applyMask(modules, mask)
  drawFormatBits(modules, size, ecc, mask)

  return {
    version,
    size,
    ecc,
    mask,
    modules,
    functionModules,
    segments: segs.map((s) => ({ mode: s.mode, numChars: s.numChars })),
  }
}
