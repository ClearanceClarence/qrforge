# qrforge

A zero-dependency QR code toolkit for JavaScript and TypeScript: compact encoding, styled SVG and PNG output, and a built-in check that the styled code still scans.

**[Try the playground](https://clearanceclarence.github.io/qrforge/)** to style a code in the browser, see whether it scans, and copy the matching code.

```sh
npm install qrforge
```

```ts
import { renderSVG, renderPNG, verify } from 'qrforge'

const svg = renderSVG('https://example.com')

const style = {
  dots: 'fluid',
  color: { type: 'linear', angle: 45, stops: [{ offset: 0, color: '#7c3aed' }, { offset: 1, color: '#0f766e' }] },
  logo: { href: '/logo.svg', size: 0.22 },
} as const

const png = renderPNG('https://example.com', { ...style, size: 1024 }) // Uint8Array
const report = verify('https://example.com', style)
if (!report.ok) console.warn(report.issues)
```

## Why another QR library

Existing packages make you choose. The small, modern encoders draw plain squares. The styling libraries need a DOM or canvas and offer no way to tell whether the pretty result still works. qrforge puts the three parts in one package:

- **Encoder.** Versions 1-40, all four error correction levels, automatic mask selection. Text is split into the shortest mix of numeric, alphanumeric, kanji and byte segments, so the same content often fits a smaller symbol. Output is checked module for module against the Nayuki reference implementation for every version and level.
- **Renderers.** SVG, PNG and terminal text from the same style options: 15 dot shapes, separately styled finder frames and centers, styled alignment patterns, gradients and palettes, a circular outline, a center logo. The PNG writer is pure JavaScript, so it runs in Node, browsers, workers and edge runtimes without canvas.
- **Scannability check.** `verify()` rasterizes the styled code, reads it back with a built-in scanner, and reports contrast, polarity, quiet zone and how much error correction the styling consumed.

No runtime dependencies, ESM and CommonJS builds, full type definitions, tree-shakable. About 10 kB gzipped for encode plus SVG.

## Styling

Every option is optional and they all combine. `verify()` tells you when a combination goes too far.

```ts
renderSVG(data, {
  // encoding
  ecc: 'M',                 // 'L' | 'M' | 'Q' | 'H'. Default 'M', or 'H' when a logo is set
  boostEcc: true,           // raise the level for free when the symbol has room

  // overall
  shape: 'square',          // 'square' | 'circle' (circle surrounds the symbol with decorative modules)
  margin: 4,                // quiet zone in modules
  background: '#fff',       // color, gradient, or 'transparent'
  backgroundRadius: 0.08,   // rounded corners, 0-0.5 of the width

  // data modules
  dots: 'rounded',          // see the list below
  dotScale: 0.9,            // 0.3-1, size within the cell
  dotScaleVariance: 0.3,    // 0-0.6, stable random variation in size
  color: '#0f172a',         // color, gradient, or palette

  // finder patterns (the three corner marks)
  finder: 'rounded',        // 'square' | 'rounded' | 'extra-rounded' | 'circle' | 'leaf'
  finderInner: 'circle',    // 'square' | 'rounded' | 'circle' | 'leaf' | 'diamond' | 'hexagon' | 'heart'
  finderColor: '#7c3aed',   // color or gradient
  finderInnerColor: '#111', // color or gradient

  // alignment patterns (the small marks in larger codes)
  alignment: 'circle',      // 'default' | 'square' | 'rounded' | 'circle'
  alignmentColor: '#7c3aed',

  // logo
  logo: {
    href: 'logo.svg',       // or image: { data, width, height } with RGBA pixels
    size: 0.22,             // 0.05-0.4 of the symbol width
    aspectRatio: 1,         // width / height of the logo area
    padding: 0.5,           // modules between the area's edge and the artwork
    shape: 'square',        // 'square' | 'circle'
    excavate: true,         // remove the modules under the logo
    background: '#fff',     // fill behind the artwork
  },

  // SVG only
  size: 512,                // omit to scale with the container
  title: 'Link to example.com',
})
```

**Dot styles:** `square`, `rounded`, `extra-rounded`, `dots`, `fluid`, `classy`, `classy-rounded`, `leaf`, `bars-vertical`, `bars-horizontal`, `diamond`, `star`, `cross`, `hexagon`, `heart`.

**Colors** come in three forms:

```ts
color: '#1d4ed8'
color: { type: 'linear', angle: 45, stops: [{ offset: 0, color: '#7c3aed' }, { offset: 1, color: '#0f766e' }] }  // or type: 'radial'
color: { type: 'palette', colors: ['#be123c', '#1d4ed8', '#047857'] }  // one per module, stable for the same content
```

Gradients work for `color`, `finderColor`, `finderInnerColor`, `alignmentColor` and `background`. Palettes apply to data modules.

**Presets** are plain option objects you can spread and override: `classic`, `soft`, `bubbles`, `liquid`, `classy`, `blueprint`, `confetti`, `barcode`, `gem`, `badge`, `sunset`, `love`.

```ts
import { presets, renderSVG } from 'qrforge'
renderSVG(data, { ...presets.liquid, logo: { href: 'logo.svg' } })
```

`renderPNG` takes the same options plus `size` in pixels. Raster output needs colors as hex or `rgb()`. For a logo in PNG output pass raw pixels as `logo.image`; the same pixels also work for SVG.

## Checking that it scans

```ts
const report = verify('https://example.com', { dots: 'dots', dotScale: 0.6, logo: { size: 0.35 } })
// {
//   ok: false,
//   readable: true,         // decoded at 8 px per module
//   readableSmall: true,    // decoded at 3 px per module
//   eccLoad: 1,             // share of error correction already used up
//   contrast: 21,
//   issues: [{ level: 'error', code: 'low-headroom', message: 'Styling already uses 100% of the error correction, ...' }]
// }
```

What it does: draws the code exactly as `renderPNG` would, at a comfortable size and at a small one, then runs a real read pipeline on the pixels: thresholding, finder pattern detection, grid sampling, Reed-Solomon correction. It also flags low contrast, light-on-dark colors and a thin quiet zone.

What it does not do: it is not a guarantee for every scanner app, camera and print surface. A logo passed only as `href` cannot be inspected and is treated as a blank area. Treat a failing report as a definite problem and a passing one as strong evidence.

### Automatic repair

`makeScannable()` adjusts a failing style until it passes while staying close to what you asked for: it raises error correction, then finds the smallest change in logo and dot size that works, and touches shapes only as a last resort. It never changes colors.

```ts
import { makeScannable, renderSVG } from 'qrforge'

const { options, report, changes } = makeScannable(data, { dots: 'dots', dotScale: 0.5, logo: { href: 'logo.svg', size: 0.4 } })
// changes: ['Reduced logo size from 0.4 to 0.3']
const svg = renderSVG(data, options)
```

The scanner is exported too. It reads flat images such as renders and screenshots, not perspective-distorted camera photos.

```ts
import { scan, decodeMatrix } from 'qrforge'
scan({ data, width, height }).text   // RGBA pixels, e.g. canvas ImageData
decodeMatrix(qr.modules, qr.size)    // straight from a module grid
```

## Payload helpers

```ts
import { wifi, vcard, email, sms, tel, geo, event } from 'qrforge'

renderSVG(wifi({ ssid: 'Cafe Guest', password: 's3cret' }))
renderSVG(vcard({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' }))
renderSVG(event({ title: 'Launch', start: new Date('2027-01-05T09:00Z') }))
```

Each returns a string with the escaping the format requires.

## React and Vue

```tsx
import { QRCode } from 'qrforge/react'

<QRCode value="https://example.com" size={200} dots="rounded" title="Link to example.com" />
```

```vue
<script setup>
import { QRCode } from 'qrforge/vue'
</script>

<template>
  <QRCode value="https://example.com" :size="200" :options="{ dots: 'rounded' }" />
</template>
```

Both render an inline `<svg>` and work with server-side rendering.

## Command line

```sh
npx qrforge "https://example.com"                         # print in the terminal
npx qrforge "https://example.com" -o code.svg --dots fluid --color "#0f766e"
npx qrforge "https://example.com" -o code.png --size 1024 --logo logo.png --verify
echo "piped text" | npx qrforge -o out.svg
```

`--verify` prints the report and exits with status 1 when the code does not scan. `--fix` adjusts the style until it does. `--preset liquid` starts from a preset. Run `qrforge --help` for all options.

## Lower-level API

```ts
import { encode, renderText, rasterize, encodePNG, toDataURL } from 'qrforge'

const qr = encode('HELLO 12345', { ecc: 'Q' })
qr.version   // 1
qr.size      // 21
qr.modules   // Uint8Array, row-major, 1 = dark
qr.segments  // [{ mode: 'alphanumeric', numChars: 11 }]

renderText(qr)                       // block characters; { style: 'ansi' } for explicit colors
rasterize(qr, { size: 400 })         // { data, width, height } RGBA
toDataURL('image/svg+xml', renderSVG(qr))
```

Every renderer accepts a string, a `Uint8Array`, or an already encoded `QRCode`.

Encoding options: `ecc`, `boostEcc`, `minVersion`, `maxVersion`, `mask`, `kanji` (default on; used only when every non-ASCII character exists in Shift JIS, so other text is never affected) and `eci` (prefix a UTF-8 ECI header for scanners that need it).

## Playground

The [playground](https://clearanceclarence.github.io/qrforge/) exposes every option with a live preview, the scan check, auto-fix, and SVG and PNG downloads. Its source is in [`docs/`](docs/), and it runs entirely in the browser from a bundled copy of the library.

## Not included yet

Micro QR, rMQR, Structured Append, and decoding of camera photos.

## License

MIT
