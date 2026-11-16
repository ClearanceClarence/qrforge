import { describe, expect, it } from 'vitest'
import { encode as uqrEncode } from 'uqr'
import { encode } from '../src/core/encode'
import { rsCorrect, rsDivisor, rsRemainder } from '../src/core/gf'
import { ECC_ORDER } from '../src/core/tables'

function grid(qr: { size: number; modules: Uint8Array }): string {
  let s = ''
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) s += qr.modules[y * qr.size + x] ? '#' : '.'
    s += '\n'
  }
  return s
}

function uqrGrid(text: string, ecc: any, minVersion: number): string {
  const r = uqrEncode(text, { ecc, boostEcc: false, border: 0, minVersion, maxVersion: minVersion })
  return r.data.map((row) => row.map((v) => (v ? '#' : '.')).join('')).join('\n') + '\n'
}

describe('encoder matches the Nayuki reference implementation', () => {
  // Pure digit / pure byte payloads have exactly one sensible segmentation,
  // so the full matrix (including the automatically chosen mask) must be identical.
  it('every version and ECC level', () => {
    for (let v = 1; v <= 40; v++) {
      for (const ecc of ECC_ORDER) {
        const text = 'ab-' + 'cdefghijkl'.repeat(v).slice(0, v * 2)
        const mine = encode(text.toLowerCase(), { ecc, boostEcc: false, minVersion: v, maxVersion: v, kanji: false })
        expect(mine.version).toBe(v)
        expect(grid(mine), `v${v}-${ecc}`).toBe(uqrGrid(text.toLowerCase(), ecc, v))
      }
    }
  })
  it('numeric and alphanumeric payloads', () => {
    for (const text of ['0123456789012345678901234567890', '8675309', 'HELLO WORLD', 'HTTPS://EXAMPLE.COM/A-B.C']) {
      const mine = encode(text, { boostEcc: false })
      expect(grid(mine)).toBe(uqrGrid(text, 'M', mine.version))
    }
  })
})

describe('segmentation', () => {
  it('mixes modes when that is shorter', () => {
    const qr = encode('https://example.com/order/00012345678901234567890123456789')
    expect(qr.segments.map((s) => s.mode)).toEqual(['byte', 'numeric'])
  })
  it('never produces more bits than plain byte mode', () => {
    const samples = ['A1b2C3', 'ABC123abc456DEF', '12345a', 'HELLO world 0000000000', 'a'.repeat(50) + '1'.repeat(50)]
    for (const s of samples) {
      const opt = encode(s, { ecc: 'L', boostEcc: false })
      const plain = encode(new TextEncoder().encode(s), { ecc: 'L', boostEcc: false })
      expect(opt.version).toBeLessThanOrEqual(plain.version)
    }
  })
  it('uses kanji mode for Shift JIS text', () => {
    const qr = encode('こんにちは世界')
    expect(qr.segments).toEqual([{ mode: 'kanji', numChars: 7 }])
  })
  it('falls back to bytes when text mixes kanji with other scripts', () => {
    const qr = encode('こんにちは 🎉')
    expect(qr.segments.every((s) => s.mode !== 'kanji')).toBe(true)
  })
  it('throws when data is too long', () => {
    expect(() => encode('x'.repeat(3000))).toThrow(/does not fit/)
  })
})

describe('reed-solomon', () => {
  it('corrects up to nsym/2 byte errors and rejects more', () => {
    let seed = 12345
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    for (const nsym of [7, 10, 18, 30]) {
      for (let trial = 0; trial < 50; trial++) {
        const data = Uint8Array.from({ length: 40 }, () => Math.floor(rnd() * 256))
        const block = new Uint8Array(40 + nsym)
        block.set(data)
        block.set(rsRemainder(data, rsDivisor(nsym)), 40)
        const original = block.slice()
        const nerr = Math.floor(rnd() * (Math.floor(nsym / 2) + 1))
        const hit = new Set<number>()
        while (hit.size < nerr) hit.add(Math.floor(rnd() * block.length))
        for (const p of hit) block[p] ^= 1 + Math.floor(rnd() * 255)
        expect(rsCorrect(block, nsym)).toBe(nerr)
        expect(Array.from(block)).toEqual(Array.from(original))
      }
    }
  })
})
