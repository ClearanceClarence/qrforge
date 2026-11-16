// Wires the controls to qrforge: preview, scan check, downloads and code sample.

import {
  ALIGNMENT_STYLES,
  DOT_STYLES,
  FINDER_INNER_STYLES,
  FINDER_STYLES,
  encode,
  makeScannable,
  presets,
  renderPNG,
  renderSVG,
  verify,
} from './qrforge.js'
import { $, copyWithFeedback, download, fillSelect, setList } from './dom.js'
import { loadLogo, readFileAsDataUrl } from './logo.js'
import { readOptions, writeOptions } from './options.js'
import { sampleContents, sampleLogoUrl } from './samples.js'
import { buildSnippet } from './snippet.js'

const RANGE_IDS = ['scale', 'variance', 'angle', 'bgRadius', 'logoSize', 'logoPad']

let logo = null // { href, image } once a logo is loaded

const currentText = () => $('text').value
const currentOptions = () => readOptions(logo)

// --- Rendering ---

function syncControlStates() {
  for (const id of RANGE_IDS) $(id + 'Val').textContent = $(id).value
  const colorMode = $('colorMode').value
  const bgMode = $('bgMode').value
  $('color2').disabled = colorMode === 'solid'
  $('color3').disabled = colorMode !== 'palette'
  $('color4').disabled = colorMode !== 'palette'
  $('background2').disabled = bgMode !== 'linear' && bgMode !== 'radial'
  $('angleWrap').classList.toggle('hidden', colorMode !== 'linear' && bgMode !== 'linear')
}

function showReport(qr, report) {
  $('status').textContent = report.ok ? '✓ Scans' : '✗ Does not scan reliably'
  $('status').className = report.ok ? 'ok' : 'bad'
  $('fix').classList.toggle('hidden', report.ok)
  setList('issues', report.issues.map((issue) => ({ text: issue.message, className: issue.level })))

  const facts = {
    'Version': `${qr.version} (${qr.size} × ${qr.size} modules)`,
    'Error correction': qr.ecc,
    'Mask': qr.mask,
    'Segments': qr.segments.map((s) => `${s.mode} × ${s.numChars}`).join(', '),
    'Contrast': report.contrast === null ? 'n/a' : `${report.contrast}:1`,
    'Error correction used by styling': `${Math.round(report.eccLoad * 100)}%`,
    'Reads at 8 px / module': report.readable ? 'yes' : 'no',
    'Reads at 3 px / module': report.readableSmall ? 'yes' : 'no',
  }
  $('facts').replaceChildren()
  for (const [name, value] of Object.entries(facts)) {
    const dt = document.createElement('dt')
    dt.textContent = name
    const dd = document.createElement('dd')
    dd.textContent = value
    $('facts').append(dt, dd)
  }
}

function showError(message) {
  $('preview').replaceChildren()
  $('status').textContent = ''
  $('status').className = ''
  $('issues').replaceChildren()
  $('facts').replaceChildren()
  $('code').textContent = ''
  $('fix').classList.add('hidden')
  $('error').textContent = message
}

function draw() {
  syncControlStates()
  const text = currentText()
  const options = currentOptions()
  $('error').textContent = ''
  $('fixes').replaceChildren()
  try {
    $('preview').innerHTML = renderSVG(text, options)
    const qr = encode(text, { ...options, ecc: options.ecc ?? (options.logo ? 'H' : 'M') })
    showReport(qr, verify(text, options))
    $('code').textContent = buildSnippet(text, options)
  } catch (error) {
    showError(error.message)
  }
}

// Coalesces bursts of input events (dragging a slider) into one redraw per frame.
let redrawQueued = false
function scheduleDraw() {
  if (redrawQueued) return
  redrawQueued = true
  requestAnimationFrame(() => {
    redrawQueued = false
    draw()
  })
}

// --- Actions ---

function applyAutoFix() {
  const result = makeScannable(currentText(), currentOptions())
  writeOptions(result.options)
  draw()
  if (result.changes.length) {
    setList('fixes', result.changes.map((text) => ({ text, className: 'fixed' })))
  } else {
    setList('fixes', [{ text: 'No automatic fix available. Colors are never changed; adjust contrast by hand.', className: 'warning' }])
  }
}

async function useLogo(src) {
  try {
    logo = await loadLogo(src)
    scheduleDraw()
  } catch (error) {
    $('error').textContent = error.message
  }
}

function clampedPngSize() {
  return Math.min(4096, Math.max(64, Number($('pngSize').value) || 1024))
}

// --- Setup ---

function init() {
  fillSelect('dots', DOT_STYLES)
  fillSelect('finder', FINDER_STYLES)
  fillSelect('finderInner', FINDER_INNER_STYLES)
  fillSelect('alignment', ALIGNMENT_STYLES)
  fillSelect('preset', Object.keys(presets))
  $('dots').value = 'fluid'

  for (const button of document.querySelectorAll('[data-content]')) {
    button.addEventListener('click', () => {
      $('text').value = sampleContents[button.dataset.content]
      scheduleDraw()
    })
  }

  $('preset').addEventListener('change', () => {
    if ($('preset').value) writeOptions(presets[$('preset').value], true)
    scheduleDraw()
  })

  // The circle outline uses a smaller default quiet zone.
  $('shape').addEventListener('change', () => {
    $('margin').value = $('shape').value === 'circle' ? 1 : 4
    scheduleDraw()
  })

  $('fix').addEventListener('click', applyAutoFix)

  $('dlSvg').addEventListener('click', () => {
    download('qr.svg', 'image/svg+xml', renderSVG(currentText(), currentOptions()))
  })
  $('dlPng').addEventListener('click', () => {
    download('qr.png', 'image/png', renderPNG(currentText(), { ...currentOptions(), size: clampedPngSize() }))
  })
  $('copySvg').addEventListener('click', () => copyWithFeedback($('copySvg'), renderSVG(currentText(), currentOptions())))
  $('copyCode').addEventListener('click', () => copyWithFeedback($('copyCode'), $('code').textContent))

  $('logoFile').addEventListener('change', async () => {
    const file = $('logoFile').files[0]
    if (file) useLogo(await readFileAsDataUrl(file))
  })
  $('sampleLogo').addEventListener('click', () => useLogo(sampleLogoUrl))
  $('clearLogo').addEventListener('click', () => {
    logo = null
    $('logoFile').value = ''
    scheduleDraw()
  })

  for (const control of document.querySelectorAll('textarea, select, input:not([type="file"])')) {
    control.addEventListener('input', scheduleDraw)
  }

  draw()
}

init()
