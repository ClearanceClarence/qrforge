import { buildTemplate, zigzag } from './encode'
import { rsCorrect } from './gf'
import { ALPHANUMERIC, charCountBits, type Mode } from './segments'
import {
  ECC_CODEWORDS_PER_BLOCK,
  ECC_ORDER,
  formatBits,
  maskBit,
  NUM_ECC_BLOCKS,
  numRawDataModules,
  type Ecc,
} from './tables'

export interface DecodeResult {
  text: string
  bytes: Uint8Array
  version: number
  ecc: Ecc
  mask: number
  /** Codewords that had to be repaired by error correction. */
  errorsCorrected: number
  /** Total codewords that could have been repaired. */
  errorCapacity: number
  /** Share of correction capacity used in the most damaged block, 0-1. */
  eccLoad: number
}

export class QRDecodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QRDecodeError'
  }
}

function popcount(v: number): number {
  let c = 0
  for (; v; v &= v - 1) c++
  return c
}

function readFormat(m: Uint8Array, size: number): { ecc: Ecc; mask: number } {
  const get = (x: number, y: number) => m[y * size + x]
  let a = 0
  let b = 0
  const put = (i: number, v1: number, v2: number) => {
    a |= v1 << i
    b |= v2 << i
  }
  for (let i = 0; i <= 5; i++) put(i, get(8, i), get(size - 1 - i, 8))
  put(6, get(8, 7), get(size - 7, 8))
  put(7, get(8, 8), get(size - 8, 8))
  put(8, get(7, 8), get(8, size - 7))
  for (let i = 9; i < 15; i++) put(i, get(14 - i, 8), get(8, size - 15 + i))

  let best: { ecc: Ecc; mask: number } | null = null
  let bestDist = 4
  for (const ecc of ECC_ORDER) {
    for (let mask = 0; mask < 8; mask++) {
      const f = formatBits(ecc, mask)
      const d = Math.min(popcount(f ^ a), popcount(f ^ b))
      if (d < bestDist) {
        bestDist = d
        best = { ecc, mask }
      }
    }
  }
  if (!best) throw new QRDecodeError('Format information is unreadable')
  return best
}

let sjis: TextDecoder | null | undefined
function decodeKanji(codes: number[]): string {
  if (sjis === undefined) {
    try {
      sjis = new TextDecoder('shift_jis')
    } catch {
      sjis = null
    }
  }
  const bytes = new Uint8Array(codes.length * 2)
  codes.forEach((c, i) => {
    bytes[i * 2] = c >> 8
    bytes[i * 2 + 1] = c & 0xff
  })
  return sjis ? sjis.decode(bytes) : '�'.repeat(codes.length)
}

function decodeBytes(bytes: Uint8Array, eci: number): string {
  if (eci === 20) return decodeKanji(Array.from({ length: bytes.length >> 1 }, (_, i) => (bytes[i * 2] << 8) | bytes[i * 2 + 1]))
  if (eci !== 3) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      /* fall through to Latin-1 */
    }
  }
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return s
}

function parse(data: Uint8Array, version: number): { text: string; bytes: Uint8Array } {
  let pos = 0
  const total = data.length * 8
  const read = (n: number): number => {
    if (pos + n > total) throw new QRDecodeError('Unexpected end of data')
    let v = 0
    for (let i = 0; i < n; i++, pos++) v = (v << 1) | ((data[pos >>> 3] >>> (7 - (pos & 7))) & 1)
    return v
  }
  const count = (mode: Mode) => read(charCountBits(mode, version))
  const enc = new TextEncoder()
  let text = ''
  const out: number[] = []
  let eci = 26
  while (total - pos >= 4) {
    const mode = read(4)
    if (mode === 0) break
    let part = ''
    if (mode === 1) {
      let n = count('numeric')
      for (; n >= 3; n -= 3) part += String(read(10)).padStart(3, '0')
      if (n === 2) part += String(read(7)).padStart(2, '0')
      else if (n === 1) part += String(read(4))
    } else if (mode === 2) {
      let n = count('alphanumeric')
      for (; n >= 2; n -= 2) {
        const v = read(11)
        part += ALPHANUMERIC[Math.floor(v / 45)] + ALPHANUMERIC[v % 45]
      }
      if (n === 1) part += ALPHANUMERIC[read(6)]
    } else if (mode === 4) {
      const n = count('byte')
      const bytes = new Uint8Array(n)
      for (let i = 0; i < n; i++) bytes[i] = read(8)
      text += decodeBytes(bytes, eci)
      for (const b of bytes) out.push(b)
      continue
    } else if (mode === 8) {
      const n = count('kanji')
      const codes: number[] = []
      for (let i = 0; i < n; i++) {
        const v = read(13)
        const c = (Math.floor(v / 0xc0) << 8) | v % 0xc0
        codes.push(c + (c < 0x1f00 ? 0x8140 : 0xc140))
      }
      part = decodeKanji(codes)
    } else if (mode === 7) {
      const first = read(8)
      eci = first < 0x80 ? first : first < 0xc0 ? ((first & 0x3f) << 8) | read(8) : ((first & 0x1f) << 16) | read(16)
      continue
    } else if (mode === 3) {
      read(16)
      continue
    } else if (mode === 5) {
      continue
    } else if (mode === 9) {
      read(8)
      continue
    } else {
      throw new QRDecodeError(`Unknown mode indicator ${mode}`)
    }
    text += part
    for (const b of enc.encode(part)) out.push(b)
  }
  return { text, bytes: Uint8Array.from(out) }
}

/** Decodes a module grid (row-major, 1 = dark) back into its payload. */
export function decodeMatrix(modules: Uint8Array | ArrayLike<number>, size: number): DecodeResult {
  const version = (size - 17) / 4
  if (!Number.isInteger(version) || version < 1 || version > 40 || modules.length !== size * size) {
    throw new QRDecodeError('Invalid matrix size')
  }
  const m = Uint8Array.from(modules as ArrayLike<number>, (v) => (v ? 1 : 0))
  const { ecc, mask } = readFormat(m, size)
  const { functionModules } = buildTemplate(version)

  const raw = Math.floor(numRawDataModules(version) / 8)
  const codewords = new Uint8Array(raw)
  let i = 0
  zigzag(size, functionModules, (idx) => {
    if (i < raw * 8) {
      const x = idx % size
      const y = (idx - x) / size
      const bit = m[idx] ^ (maskBit(mask, x, y) ? 1 : 0)
      codewords[i >>> 3] |= bit << (7 - (i & 7))
      i++
    }
  })

  const numBlocks = NUM_ECC_BLOCKS[ecc][version]
  const eccLen = ECC_CODEWORDS_PER_BLOCK[ecc][version]
  const numShort = numBlocks - (raw % numBlocks)
  const shortLen = Math.floor(raw / numBlocks)
  const blocks: Uint8Array[] = []
  for (let b = 0; b < numBlocks; b++) blocks.push(new Uint8Array(shortLen + (b < numShort ? 0 : 1)))
  let o = 0
  for (let k = 0; k <= shortLen - eccLen; k++) {
    for (const blk of blocks) if (k < blk.length - eccLen) blk[k] = codewords[o++]
  }
  for (let k = 0; k < eccLen; k++) {
    for (const blk of blocks) blk[blk.length - eccLen + k] = codewords[o++]
  }

  const perBlock = Math.floor(eccLen / 2)
  let errorsCorrected = 0
  let worst = 0
  const dataLen = raw - eccLen * numBlocks
  const data = new Uint8Array(dataLen)
  let d = 0
  for (const blk of blocks) {
    const fixed = rsCorrect(blk, eccLen)
    if (fixed < 0) throw new QRDecodeError('Too many errors to correct')
    errorsCorrected += fixed
    worst = Math.max(worst, fixed / perBlock)
    data.set(blk.subarray(0, blk.length - eccLen), d)
    d += blk.length - eccLen
  }

  const { text, bytes } = parse(data, version)
  return { text, bytes, version, ecc, mask, errorsCorrected, errorCapacity: perBlock * numBlocks, eccLoad: worst }
}
