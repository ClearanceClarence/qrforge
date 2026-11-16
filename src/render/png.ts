import type { RGBAImage } from '../scan/locate'

// A small self-contained PNG writer: RGBA, 8 bits per channel, with a
// fixed-Huffman DEFLATE compressor (LZ77 with a single-entry hash table).

const CRC = /* @__PURE__ */ (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff
  for (let i = start; i < end; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]

function reverse(v: number, len: number): number {
  let r = 0
  for (let i = 0; i < len; i++) r = (r << 1) | ((v >>> i) & 1)
  return r
}

/** zlib stream (RFC 1950) containing one fixed-Huffman DEFLATE block. */
export function deflate(input: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(input.length * 1.13) + 32)
  let o = 0
  let acc = 0
  let nbits = 0
  const bits = (v: number, len: number) => {
    acc |= v << nbits
    nbits += len
    while (nbits >= 8) {
      out[o++] = acc & 0xff
      acc >>>= 8
      nbits -= 8
    }
  }
  const symbol = (s: number) => {
    if (s < 144) bits(reverse(0x30 + s, 8), 8)
    else if (s < 256) bits(reverse(0x190 + s - 144, 9), 9)
    else if (s < 280) bits(reverse(s - 256, 7), 7)
    else bits(reverse(0xc0 + s - 280, 8), 8)
  }

  out[o++] = 0x78
  out[o++] = 0x01
  bits(1, 1) // final block
  bits(1, 2) // fixed Huffman

  const head = new Int32Array(1 << 15).fill(-1)
  const n = input.length
  let i = 0
  while (i < n) {
    let matchLen = 0
    let matchDist = 0
    if (i + 2 < n) {
      const h = ((input[i] << 10) ^ (input[i + 1] << 5) ^ input[i + 2]) & 0x7fff
      const cand = head[h]
      head[h] = i
      if (cand >= 0 && i - cand <= 32768) {
        const max = Math.min(258, n - i)
        let len = 0
        while (len < max && input[cand + len] === input[i + len]) len++
        if (len >= 3) {
          matchLen = len
          matchDist = i - cand
        }
      }
    }
    if (matchLen) {
      let lc = 28
      while (LEN_BASE[lc] > matchLen) lc--
      symbol(257 + lc)
      if (LEN_EXTRA[lc]) bits(matchLen - LEN_BASE[lc], LEN_EXTRA[lc])
      let dc = 29
      while (DIST_BASE[dc] > matchDist) dc--
      bits(reverse(dc, 5), 5)
      if (DIST_EXTRA[dc]) bits(matchDist - DIST_BASE[dc], DIST_EXTRA[dc])
      i += matchLen
    } else {
      symbol(input[i++])
    }
  }
  symbol(256)
  if (nbits) bits(0, 8 - nbits)

  let a = 1
  let b = 0
  for (let k = 0; k < n; k++) {
    a = (a + input[k]) % 65521
    b = (b + a) % 65521
  }
  out[o++] = b >>> 8
  out[o++] = b & 0xff
  out[o++] = a >>> 8
  out[o++] = a & 0xff
  return out.subarray(0, o)
}

/**
 * Encodes RGBA pixels as a PNG file. Images with at most 256 distinct colors
 * are stored with a palette, fully opaque images as RGB, anything else as RGBA.
 */
export function encodePNG(image: RGBAImage): Uint8Array {
  const { width, height, data } = image
  const count = width * height

  // Try to build a palette.
  const palette = new Map<number, number>()
  const indexed = new Uint8Array(count)
  let opaque = true
  let usePalette = true
  for (let i = 0; i < count; i++) {
    const o = i * 4
    if (data[o + 3] !== 255) opaque = false
    if (!usePalette) continue
    const key = ((data[o] << 24) | (data[o + 1] << 16) | (data[o + 2] << 8) | data[o + 3]) >>> 0
    let idx = palette.get(key)
    if (idx === undefined) {
      if (palette.size === 256) {
        usePalette = false
        continue
      }
      idx = palette.size
      palette.set(key, idx)
    }
    indexed[i] = idx
  }

  const channels = usePalette ? 1 : opaque ? 3 : 4
  const stride = width * channels + 1
  const raw = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const row = y * stride + 1
    if (usePalette) raw.set(indexed.subarray(y * width, (y + 1) * width), row)
    else if (channels === 4) raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), row)
    else {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4
        raw[row + x * 3] = data[o]
        raw[row + x * 3 + 1] = data[o + 1]
        raw[row + x * 3 + 2] = data[o + 2]
      }
    }
  }
  const z = deflate(raw)

  const plte = new Uint8Array(usePalette ? palette.size * 3 : 0)
  const trns = new Uint8Array(usePalette && !opaque ? palette.size : 0)
  if (usePalette) {
    for (const [key, idx] of palette) {
      plte[idx * 3] = key >>> 24
      plte[idx * 3 + 1] = (key >>> 16) & 0xff
      plte[idx * 3 + 2] = (key >>> 8) & 0xff
      if (trns.length) trns[idx] = key & 0xff
    }
  }

  const extra = (plte.length ? 12 + plte.length : 0) + (trns.length ? 12 + trns.length : 0)
  const out = new Uint8Array(8 + 25 + extra + 12 + z.length + 12)
  const view = new DataView(out.buffer)
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  let p = 8
  const chunk = (type: string, body: Uint8Array) => {
    view.setUint32(p, body.length)
    for (let i = 0; i < 4; i++) out[p + 4 + i] = type.charCodeAt(i)
    out.set(body, p + 8)
    view.setUint32(p + 8 + body.length, crc32(out, p + 4, p + 8 + body.length))
    p += 12 + body.length
  }
  const ihdr = new Uint8Array(13)
  const iv = new DataView(ihdr.buffer)
  iv.setUint32(0, width)
  iv.setUint32(4, height)
  ihdr[8] = 8
  ihdr[9] = usePalette ? 3 : opaque ? 2 : 6
  chunk('IHDR', ihdr)
  if (plte.length) chunk('PLTE', plte)
  if (trns.length) chunk('tRNS', trns)
  chunk('IDAT', z)
  chunk('IEND', new Uint8Array(0))
  return out
}
