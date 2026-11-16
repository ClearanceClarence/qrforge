import { createElement, useMemo, type CSSProperties, type ReactElement } from 'react'
import { svgParts } from './render/svg'
import type { RenderOptions } from './render/style'

export interface QRCodeProps extends RenderOptions {
  /** Content to encode. */
  value: string | Uint8Array
  /** Width and height in pixels. Omit to size with CSS. */
  size?: number
  /** Accessible name for the image. */
  title?: string
  className?: string
  style?: CSSProperties
}

/** Renders a QR code as an inline SVG element. */
export function QRCode({ value, size, title, className, style, ...options }: QRCodeProps): ReactElement {
  const key = JSON.stringify(options)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const parts = useMemo(() => svgParts(value, { ...options, title }), [value, title, key])
  return createElement('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: `0 0 ${parts.viewSize} ${parts.viewSize}`,
    width: size,
    height: size,
    role: 'img',
    'aria-label': title,
    shapeRendering: parts.crisp ? 'crispEdges' : undefined,
    className,
    style,
    dangerouslySetInnerHTML: { __html: parts.body },
  })
}

export default QRCode
