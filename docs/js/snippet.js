// Builds the copyable code sample for the current style.

const MAX_TEXT = 60

/** Formats a value as a JavaScript literal with single quotes and bare keys. */
function toLiteral(value) {
  return JSON.stringify(value, null, 2)
    .replace(/"([a-zA-Z]+)":/g, '$1:')
    .replace(/"/g, "'")
}

export function buildSnippet(text, options) {
  // Pixel data is too long to show, so the sample points at an image file instead.
  const shown = JSON.parse(
    JSON.stringify(options, (key, value) => (key === 'image' ? undefined : key === 'href' ? 'logo.png' : value)),
  )
  const shortText = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT - 3) + '...' : text
  const hasOptions = Object.keys(shown).length > 0
  const args = hasOptions ? `${JSON.stringify(shortText)}, ${toLiteral(shown)}` : JSON.stringify(shortText)
  return `import { renderSVG } from 'qrforge'\n\nconst svg = renderSVG(${args})`
}
