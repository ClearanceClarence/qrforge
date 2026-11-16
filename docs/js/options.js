// Translates between the form controls and a qrforge options object.

import { $ } from './dom.js'

function gradient(type, from, to) {
  const stops = [
    { offset: 0, color: from },
    { offset: 1, color: to },
  ]
  return type === 'linear' ? { type, angle: Number($('angle').value), stops } : { type, stops }
}

/**
 * Reads the controls into an options object. Values that match the library
 * defaults are left out so the generated code stays short.
 */
export function readOptions(logo) {
  const o = {}

  // Encoding
  if ($('ecc').value) o.ecc = $('ecc').value
  if (!$('boostEcc').checked) o.boostEcc = false
  if ($('mask').value) o.mask = Number($('mask').value)
  if (Number($('minVersion').value) > 1) o.minVersion = Math.min(40, Number($('minVersion').value))
  if (!$('kanji').checked) o.kanji = false
  if ($('eci').checked) o.eci = true

  // Shape and background
  if ($('shape').value !== 'square') o.shape = $('shape').value
  const margin = Math.max(0, Number($('margin').value) || 0)
  if (margin !== (o.shape === 'circle' ? 1 : 4)) o.margin = margin
  const bgMode = $('bgMode').value
  if (bgMode === 'transparent') o.background = 'transparent'
  else if (bgMode !== 'solid') o.background = gradient(bgMode, $('background').value, $('background2').value)
  else if ($('background').value !== '#ffffff') o.background = $('background').value
  if (Number($('bgRadius').value)) o.backgroundRadius = Number($('bgRadius').value)

  // Dots
  if ($('dots').value !== 'square') o.dots = $('dots').value
  if (Number($('scale').value) !== 1) o.dotScale = Number($('scale').value)
  if (Number($('variance').value)) o.dotScaleVariance = Number($('variance').value)
  const colorMode = $('colorMode').value
  if (colorMode === 'palette') {
    o.color = { type: 'palette', colors: ['color', 'color2', 'color3', 'color4'].map((id) => $(id).value) }
  } else if (colorMode !== 'solid') {
    o.color = gradient(colorMode, $('color').value, $('color2').value)
  } else if ($('color').value !== '#000000') {
    o.color = $('color').value
  }

  // Finder and alignment patterns
  if ($('finder').value) o.finder = $('finder').value
  if ($('finderInner').value) o.finderInner = $('finderInner').value
  if ($('useFinderColor').checked) o.finderColor = $('finderColor').value
  if ($('useFinderInnerColor').checked) o.finderInnerColor = $('finderInnerColor').value
  if ($('alignment').value !== 'default') o.alignment = $('alignment').value
  if ($('useAlignmentColor').checked) o.alignmentColor = $('alignmentColor').value

  // Logo
  if (logo) {
    o.logo = { href: logo.href, image: logo.image, size: Number($('logoSize').value) }
    if (Number($('logoPad').value) !== 0.5) o.logo.padding = Number($('logoPad').value)
    if ($('logoShape').value !== 'square') o.logo.shape = 'circle'
    if (!$('logoExcavate').checked) o.logo.excavate = false
    if ($('useLogoBg').checked) o.logo.background = $('logoBg').value
    const { width, height } = logo.image
    if ($('logoAspect').checked && width !== height) o.logo.aspectRatio = Math.round((width / height) * 100) / 100
  }
  return o
}

/** Color inputs only accept the #rrggbb form. */
function toHex(color) {
  if (/^#[0-9a-f]{3}$/i.test(color)) return '#' + [...color.slice(1)].map((c) => c + c).join('')
  return /^#[0-9a-f]{6}$/i.test(color) ? color : '#000000'
}

function resetStyleControls() {
  $('dots').value = 'square'
  $('scale').value = 1
  $('variance').value = 0
  $('colorMode').value = 'solid'
  $('color').value = '#000000'
  $('finder').value = ''
  $('finderInner').value = ''
  $('useFinderColor').checked = false
  $('useFinderInnerColor').checked = false
  $('alignment').value = 'default'
  $('useAlignmentColor').checked = false
  $('shape').value = 'square'
  $('margin').value = 4
  $('bgMode').value = 'solid'
  $('background').value = '#ffffff'
  $('bgRadius').value = 0
}

function writeColor(color) {
  if (typeof color === 'string') {
    $('colorMode').value = 'solid'
    $('color').value = toHex(color)
  } else if (color.type === 'palette') {
    $('colorMode').value = 'palette'
    ;['color', 'color2', 'color3', 'color4'].forEach((id, i) => {
      $(id).value = toHex(color.colors[i % color.colors.length])
    })
  } else {
    $('colorMode').value = color.type
    $('color').value = toHex(color.stops[0].color)
    $('color2').value = toHex(color.stops[color.stops.length - 1].color)
    if (color.angle !== undefined) $('angle').value = color.angle
  }
}

function writeOptionalColor(checkboxId, inputId, color) {
  if (typeof color !== 'string') return
  $(checkboxId).checked = true
  $(inputId).value = toHex(color)
}

/**
 * Writes a style object (a preset or an auto-fix result) into the controls.
 * With `reset`, style controls the object does not mention go back to defaults.
 */
export function writeOptions(o, reset = false) {
  if (reset) resetStyleControls()

  if (o.ecc) $('ecc').value = o.ecc
  if (o.dots) $('dots').value = o.dots
  if (o.dotScale !== undefined) $('scale').value = o.dotScale
  if (o.dotScaleVariance !== undefined) $('variance').value = o.dotScaleVariance
  if (o.color) writeColor(o.color)

  if (o.finder) $('finder').value = o.finder
  if (o.finderInner) $('finderInner').value = o.finderInner
  writeOptionalColor('useFinderColor', 'finderColor', o.finderColor)
  writeOptionalColor('useFinderInnerColor', 'finderInnerColor', o.finderInnerColor)
  if (o.alignment) $('alignment').value = o.alignment
  writeOptionalColor('useAlignmentColor', 'alignmentColor', o.alignmentColor)

  if (o.shape) {
    $('shape').value = o.shape
    $('margin').value = o.margin ?? (o.shape === 'circle' ? 1 : 4)
  } else if (o.margin !== undefined) {
    $('margin').value = o.margin
  }
  if (typeof o.background === 'string' && o.background !== 'transparent') {
    $('bgMode').value = 'solid'
    $('background').value = toHex(o.background)
  }
  if (o.backgroundRadius !== undefined) $('bgRadius').value = o.backgroundRadius
  if (o.logo?.size !== undefined) $('logoSize').value = o.logo.size
}
