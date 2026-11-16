import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { ALIGNMENT_STYLES, DOT_STYLES, FINDER_INNER_STYLES, FINDER_STYLES, decodeMatrix, encode, makeScannable, payload, presets, rasterize, renderPNG, renderSVG, renderText, scan, verify } from '../src/index'
import { deflate } from '../src/render/png'

describe('decodeMatrix', () => {
  it('round-trips every kind of segment', () => {
    for (const text of ['hello', '0123456789', 'HELLO WORLD 123', 'こんにちは世界', 'Blåbærsyltetøy 🎉', 'https://example.com/?q=1234567890123', 'x'.repeat(2000)]) {
      const qr = encode(text)
      const res = decodeMatrix(qr.modules, qr.size)
      expect(res.text).toBe(text)
      expect(res.errorsCorrected).toBe(0)
      expect(res.ecc).toBe(qr.ecc)
    }
  })
  it('round-trips binary data and ECI', () => {
    const bytes = Uint8Array.from({ length: 300 }, (_, i) => (i * 37) & 0xff)
    expect(Array.from(decodeMatrix(encode(bytes).modules, encode(bytes).size).bytes)).toEqual(Array.from(bytes))
    const qr = encode('héllo', { eci: true })
    expect(qr.segments[0].mode).toBe('eci')
    expect(decodeMatrix(qr.modules, qr.size).text).toBe('héllo')
  })
  it('repairs damaged modules', () => {
    const qr = encode('damage me please', { ecc: 'H' })
    const m = qr.modules.slice()
    for (let y = 10; y < 14; y++) for (let x = 10; x < 14; x++) m[y * qr.size + x] ^= 1
    const res = decodeMatrix(m, qr.size)
    expect(res.text).toBe('damage me please')
    expect(res.errorsCorrected).toBeGreaterThan(0)
  })
})

describe('scan', () => {
  const styles = [
    {},
    { dots: 'rounded' as const },
    { dots: 'dots' as const, finder: 'circle' as const },
    { dots: 'fluid' as const, color: '#1d4ed8' },
    { dots: 'dots' as const, dotScale: 0.8, color: { type: 'linear' as const, angle: 45, stops: [{ offset: 0, color: '#7c3aed' }, { offset: 1, color: '#0f766e' }] } },
    { logo: { size: 0.25 }, dots: 'rounded' as const },
  ]
  it('reads back every style at several sizes', () => {
    for (const style of styles) {
      for (const text of ['https://example.com', 'A longer payload with some more text in it, 1234567890 '.repeat(4)]) {
        for (const ppm of [3, 5, 10]) {
          const qr = encode(text, { ecc: style.logo ? 'H' : 'M' })
          const img = rasterize(qr, { ...style, size: (qr.size + 8) * ppm })
          expect(scan(img).text, JSON.stringify(style) + ppm).toBe(text)
        }
      }
    }
  })
  it('reads light-on-dark codes and reports the inversion', () => {
    const res = scan(rasterize('inverted', { color: '#fff', background: '#111' }))
    expect(res.text).toBe('inverted')
    expect(res.inverted).toBe(true)
  })
})

describe('verify', () => {
  it('passes sensible styles', () => {
    const r = verify('https://example.com', { dots: 'rounded', color: '#0f172a', logo: { size: 0.2 } })
    expect(r.ok).toBe(true)
    expect(r.eccLoad).toBeGreaterThan(0)
  })
  it('fails an oversized logo at low error correction', () => {
    const r = verify('https://example.com/some/long/path/that/needs/room', { ecc: 'L', boostEcc: false, logo: { size: 0.4 } })
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.level === 'error')).toBe(true)
  })
  it('fails unreadable colors', () => {
    const r = verify('https://example.com', { color: '#f5f5f5', background: '#ffffff' })
    expect(r.issues.map((i) => i.code)).toContain('low-contrast')
    expect(r.ok).toBe(false)
  })
  it('warns on inverted colors and a missing quiet zone', () => {
    const codes = verify('x', { color: '#fff', background: '#000', margin: 0 }).issues.map((i) => i.code)
    expect(codes).toContain('inverted')
    expect(codes).toContain('quiet-zone')
  })
})

describe('style options', () => {
  const text = 'https://example.com/qrforge?ref=style-test'
  it('every shape passes the scan check', () => {
    for (const dots of DOT_STYLES) expect(verify(text, { dots }).ok, dots).toBe(true)
    for (const finder of FINDER_STYLES) expect(verify(text, { dots: 'rounded', finder }).ok, finder).toBe(true)
    for (const finderInner of FINDER_INNER_STYLES) expect(verify(text, { dots: 'rounded', finderInner }).ok, finderInner).toBe(true)
    for (const alignment of ALIGNMENT_STYLES) expect(verify(text, { dots: 'dots', alignment }).ok, alignment).toBe(true)
  })
  it('every preset passes cleanly and renders to both formats', () => {
    for (const [name, style] of Object.entries(presets)) {
      const report = verify(text, style)
      expect(report.ok, name).toBe(true)
      expect(report.issues, name).toEqual([])
      expect(renderSVG(text, style)).toContain('<path')
      expect(renderPNG(text, { ...style, size: 200 }).length).toBeGreaterThan(500)
    }
  })
  it('supports the circle shape, palettes, variance and background options', () => {
    expect(verify(text, { shape: 'circle', dots: 'fluid' }).ok).toBe(true)
    expect(verify(text, { dots: 'dots', dotScaleVariance: 0.5 }).ok).toBe(true)
    const svg = renderSVG(text, { color: { type: 'palette', colors: ['#111', '#00f', '#080'] }, backgroundRadius: 0.1, alignment: 'circle', alignmentColor: '#b00' })
    expect(svg.match(/<path/g)!.length).toBe(6) // 3 palette colors, alignment, finder frames, finder centers
    expect(svg).toContain('rx="')
    const bg = { type: 'linear' as const, stops: [{ offset: 0, color: '#fef3c7' }, { offset: 1, color: '#e0e7ff' }] }
    expect(renderSVG(text, { background: bg })).toContain('<linearGradient')
    expect(verify(text, { background: bg }).ok).toBe(true)
  })
  it('handles logo shapes, plates and aspect ratios', () => {
    expect(verify(text, { logo: { size: 0.26, shape: 'circle', background: '#fde68a' } }).ok).toBe(true)
    expect(verify(text, { logo: { size: 0.3, aspectRatio: 2.5, background: '#111827' } }).ok).toBe(true)
    expect(renderSVG(text, { logo: { href: 'x.png', shape: 'circle', background: '#fff' } })).toContain('<ellipse')
  })
  it('rejects unknown style names', () => {
    expect(() => renderSVG(text, { dots: 'blob' as never })).toThrow(/Unknown dots style/)
  })
})

describe('makeScannable', () => {
  it('leaves a working style alone', () => {
    const r = makeScannable('https://example.com', { dots: 'rounded' })
    expect(r.changes).toEqual([])
    expect(r.report.ok).toBe(true)
  })
  it('repairs an over-styled code with the smallest changes that work', () => {
    const style = { ecc: 'L' as const, boostEcc: false, dots: 'dots' as const, dotScale: 0.5, logo: { size: 0.4 } }
    expect(verify('https://example.com/some/long/path/that/needs/room', style).ok).toBe(false)
    const r = makeScannable('https://example.com/some/long/path/that/needs/room', style)
    expect(r.report.ok).toBe(true)
    expect(r.changes[0]).toMatch(/error correction/)
    // Error correction alone is enough here, so the requested sizes are kept.
    expect(r.options.dotScale).toBe(0.5)
    expect(r.options.logo!.size).toBe(0.4)
    const logoFix = makeScannable('https://example.com', { dots: 'dots', dotScale: 0.5, logo: { size: 0.4 } })
    expect(logoFix.report.ok).toBe(true)
    expect(logoFix.changes).toEqual(['Reduced logo size from 0.4 to 0.3'])
  })
  it('does not touch colors', () => {
    const r = makeScannable('x', { color: '#eee' })
    expect(r.report.ok).toBe(false)
    expect(r.options.color).toBe('#eee')
  })
})

describe('output formats', () => {
  it('writes valid PNG data', () => {
    const png = renderPNG('png test', { size: 300, dots: 'dots' })
    expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const idat = png.findIndex((_, i) => png[i] === 0x49 && png[i + 1] === 0x44 && png[i + 2] === 0x41 && png[i + 3] === 0x54)
    const idatLen = new DataView(png.buffer, png.byteOffset).getUint32(idat - 4)
    const raw = inflateSync(png.subarray(idat + 4, idat + 4 + idatLen))
    expect(raw.length).toBe(300 * (300 + 1)) // palette image: one byte per pixel
    expect(png.length).toBeLessThan(15_000)
  })
  it('deflate round-trips arbitrary data', () => {
    let seed = 7
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff)
    const data = Uint8Array.from({ length: 70_000 }, (_, i) => (i % 500 < 250 ? rnd() & 0xff : (i >> 4) & 3))
    expect(Buffer.compare(inflateSync(deflate(data)), Buffer.from(data))).toBe(0)
  })
  it('writes compact SVG', () => {
    const svg = renderSVG('https://example.com', { title: 'Example' })
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 33 33" role="img" aria-label="Example" shape-rendering="crispEdges"><title>Example<\/title>/)
    expect(svg.length).toBeLessThan(2500)
    expect(renderSVG('x', { dots: 'fluid', color: { type: 'radial', stops: [{ offset: 0, color: '#000' }, { offset: 1, color: '#00f' }] } })).toContain('<radialGradient')
    expect(renderSVG('x', { logo: { href: 'logo.svg' } })).toContain('<image href="logo.svg"')
  })
  it('writes terminal text', () => {
    const lines = renderText('hi', { margin: 1 }).split('\n')
    expect(lines.length).toBe(Math.ceil(23 / 2))
    expect(lines[0].length).toBe(23)
  })
})

describe('payload', () => {
  it('escapes Wi-Fi fields', () => {
    expect(payload.wifi({ ssid: 'My;Net', password: 'p:a"ss' })).toBe('WIFI:T:WPA;S:My\\;Net;P:p\\:a\\"ss;;')
    expect(payload.wifi({ ssid: 'Open' })).toBe('WIFI:T:nopass;S:Open;;')
  })
  it('builds the other formats', () => {
    expect(payload.email({ to: 'a@b.co', subject: 'Hi there' })).toBe('mailto:a@b.co?subject=Hi%20there')
    expect(payload.geo({ lat: 59.2, lng: 9.6 })).toBe('geo:59.2,9.6')
    expect(payload.vcard({ firstName: 'Ada', lastName: 'Lovelace' })).toContain('FN:Ada Lovelace')
    expect(payload.event({ title: 'Launch', start: new Date(Date.UTC(2027, 0, 5, 9, 0)) })).toContain('DTSTART:20270105T090000Z')
  })
})
