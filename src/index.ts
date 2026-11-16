export { encode, QRDataTooLongError, type EncodeOptions, type QRCode } from './core/encode'
export { decodeMatrix, QRDecodeError, type DecodeResult } from './core/decode'
export type { Ecc } from './core/tables'
export type { Mode } from './core/segments'
export { renderSVG, svgParts, toDataURL, type SVGOptions, type SVGParts } from './render/svg'
export { renderPNG, rasterize, type RasterOptions } from './render/raster'
export { encodePNG } from './render/png'
export { renderText, type TextOptions } from './render/text'
export {
  ALIGNMENT_STYLES,
  DOT_STYLES,
  FINDER_INNER_STYLES,
  FINDER_STYLES,
  type AlignmentStyle,
  type DotStyle,
  type FinderInnerStyle,
  type FinderStyle,
  type Gradient,
  type GradientStop,
  type LogoOptions,
  type Paint,
  type Palette,
  type QRInput,
  type RenderOptions,
  type StyleOptions,
} from './render/style'
export { makeScannable, type ScannableResult } from './optimize'
export { presets, type PresetName } from './presets'
export { scan, type RGBAImage, type ScanResult } from './scan/locate'
export { verify, type VerifyIssue, type VerifyReport } from './verify'
export * as payload from './payload'
export { wifi, vcard, email, sms, tel, geo, event } from './payload'
