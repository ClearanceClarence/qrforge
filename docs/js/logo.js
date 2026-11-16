// Loads a logo image and keeps it in the two forms qrforge needs.

const MAX_SIDE = 256

/**
 * Resolves to { href, image }: the URL for SVG output, and raw RGBA pixels
 * for PNG output and the scan check.
 */
export function loadLogo(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.width * scale))
      canvas.height = Math.max(1, Math.round(img.height * scale))
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
      resolve({ href: src, image: { data: pixels.data, width: pixels.width, height: pixels.height } })
    }
    img.onerror = () => reject(new Error('That file could not be read as an image.'))
    img.src = src
  })
}

/** Reads a File from an <input type="file"> as a data URL. */
export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
