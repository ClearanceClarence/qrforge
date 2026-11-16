import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { extname } from 'node:path'
import { makeScannable, presets, renderPNG, renderSVG, renderText, toDataURL, verify, type RenderOptions } from './index'

const HELP = `qrforge - generate QR codes

Usage:
  qrforge <text> [options]
  echo "text" | qrforge [options]

Output:
  -o, --output <file>     Write a .svg or .png file (default: print to the terminal)
      --size <px>         Image width and height in pixels
      --invert            Terminal output for light-background terminals

Encoding:
      --ecc <L|M|Q|H>     Error correction level (default M, or H with a logo)
      --margin <n>        Quiet zone in modules (default 4; 2 in the terminal)

Style:
      --preset <name>       classic | soft | bubbles | liquid | classy | blueprint |
                            confetti | barcode | gem | badge | sunset | love
      --shape <s>           square | circle
      --dots <style>        square | rounded | extra-rounded | dots | fluid | classy |
                            classy-rounded | leaf | bars-vertical | bars-horizontal |
                            diamond | star | cross | hexagon | heart
      --scale <0.3-1>       Dot size relative to its cell
      --variance <0-0.6>    Random variation in dot size
      --finder <style>      square | rounded | extra-rounded | circle | leaf
      --finder-inner <s>    square | rounded | circle | leaf | diamond | hexagon | heart
      --alignment <style>   default | square | rounded | circle
      --color <css>         Module color (hex or rgb())
      --gradient <a,b[,x]>  Two colors plus an angle in degrees, or "radial"
      --palette <a,b,...>   Random color per module from this list
      --finder-color <c>    Finder frame color
      --finder-inner-color <c>
      --alignment-color <c>
      --background <css>    Background color, or "transparent"
      --bg-radius <0-0.5>   Rounded background corners
      --logo <file|url>     Center logo (SVG output; local files are embedded)
      --logo-size <0.05-0.4>
      --logo-shape <s>      square | circle
      --logo-bg <css>       Fill behind the logo

Checks:
      --verify              Read the styled code back and report whether it scans
      --fix                 Adjust the style until it scans, and say what changed

  -h, --help              Show this help
  -v, --version           Show the version
`

function fail(message: string): never {
  process.stderr.write(`qrforge: ${message}\n`)
  process.exit(2)
}

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif' }

function main(): void {
  const argv = process.argv.slice(2)
  const opts: RenderOptions = {}
  const text: string[] = []
  let output: string | undefined
  let size: number | undefined
  let invert = false
  let check = false
  let fix = false
  let logo: NonNullable<RenderOptions['logo']> | undefined
  const setLogo = (patch: NonNullable<RenderOptions['logo']>) => (logo = { ...logo, ...patch })

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => argv[++i] ?? fail(`${arg} needs a value`)
    const num = () => {
      const n = Number(value())
      return Number.isFinite(n) ? n : fail(`${arg} needs a number`)
    }
    switch (arg) {
      case '-h': case '--help': process.stdout.write(HELP); return
      case '-v': case '--version': process.stdout.write(`${process.env.QRFORGE_VERSION ?? ''}\n`); return
      case '-o': case '--output': output = value(); break
      case '--size': size = num(); break
      case '--invert': invert = true; break
      case '--ecc': opts.ecc = value().toUpperCase() as RenderOptions['ecc']; break
      case '--margin': opts.margin = num(); break
      case '--dots': opts.dots = value() as RenderOptions['dots']; break
      case '--finder': opts.finder = value() as RenderOptions['finder']; break
      case '--scale': opts.dotScale = num(); break
      case '--color': opts.color = value(); break
      case '--finder-color': opts.finderColor = value(); break
      case '--background': opts.background = value(); break
      case '--logo': {
        const v = value()
        const mime = MIME[extname(v).toLowerCase()]
        setLogo({ href: existsSync(v) && mime ? toDataURL(mime, readFileSync(v)) : v })
        break
      }
      case '--logo-size': setLogo({ size: num() }); break
      case '--logo-shape': setLogo({ shape: value() as 'square' | 'circle' }); break
      case '--logo-bg': setLogo({ background: value() }); break
      case '--preset': {
        const name = value()
        if (!(name in presets)) fail(`unknown preset ${name}`)
        Object.assign(opts, presets[name as keyof typeof presets])
        break
      }
      case '--shape': opts.shape = value() as RenderOptions['shape']; break
      case '--variance': opts.dotScaleVariance = num(); break
      case '--finder-inner': opts.finderInner = value() as RenderOptions['finderInner']; break
      case '--alignment': opts.alignment = value() as RenderOptions['alignment']; break
      case '--finder-inner-color': opts.finderInnerColor = value(); break
      case '--alignment-color': opts.alignmentColor = value(); break
      case '--bg-radius': opts.backgroundRadius = num(); break
      case '--gradient': {
        const [a, b, mode] = value().split(',')
        if (!a || !b) fail('--gradient needs two colors, e.g. "#7c3aed,#0f766e,45"')
        const stops = [{ offset: 0, color: a }, { offset: 1, color: b }]
        opts.color = mode === 'radial' ? { type: 'radial', stops } : { type: 'linear', angle: Number(mode) || 0, stops }
        break
      }
      case '--palette': opts.color = { type: 'palette', colors: value().split(',') }; break
      case '--fix': fix = true; break
      case '--verify': check = true; break
      case '--': text.push(...argv.slice(i + 1)); i = argv.length; break
      default:
        if (arg.startsWith('-') && arg.length > 1) fail(`unknown option ${arg} (see --help)`)
        text.push(arg)
    }
  }

  let data = text.join(' ')
  if (!data && !process.stdin.isTTY) data = readFileSync(0, 'utf8').replace(/\r?\n$/, '')
  if (!data) {
    process.stdout.write(HELP)
    process.exit(2)
  }

  if (logo) opts.logo = logo
  if (fix) {
    const fixed = makeScannable(data, opts)
    Object.assign(opts, fixed.options)
    for (const change of fixed.changes) process.stderr.write(`fixed: ${change}\n`)
    check = true
  }

  if (check) {
    const report = verify(data, opts)
    process.stderr.write(report.ok ? `\u2713 scans (contrast ${report.contrast}:1, ${Math.round(report.eccLoad * 100)}% of error correction used)\n` : '\u2717 does not scan reliably\n')
    for (const issue of report.issues) process.stderr.write(`  ${issue.level}: ${issue.message}\n`)
    if (!report.ok) process.exitCode = 1
  }

  if (!output) {
    process.stdout.write(renderText(data, { ...opts, margin: opts.margin ?? 2, invert, style: invert || !process.stdout.isTTY ? 'unicode' : 'ansi' }) + '\n')
    return
  }
  const ext = extname(output).toLowerCase()
  if (ext === '.svg') writeFileSync(output, renderSVG(data, { ...opts, size }))
  else if (ext === '.png') writeFileSync(output, renderPNG(data, { ...opts, size }))
  else fail('output file must end in .svg or .png')
}

try {
  main()
} catch (e) {
  fail(e instanceof Error ? e.message : String(e))
}
