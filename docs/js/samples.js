// Example content for the "Content" buttons and the sample logo.

import { vcard, wifi } from './qrforge.js'

export const sampleContents = {
  url: 'https://example.com/qrforge',
  wifi: wifi({ ssid: 'Cafe Guest', password: 's3cret;pass' }),
  vcard: vcard({
    firstName: 'Ada',
    lastName: 'Lovelace',
    organization: 'Analytical Engines',
    email: 'ada@example.com',
    phone: '+47 400 00 000',
  }),
  kanji: 'こんにちは世界、QRコードです',
  long: 'ORDER 00012345678901234567890 / ' + 'The quick brown fox jumps over the lazy dog. '.repeat(6),
}

const sampleLogoSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">' +
  '<rect width="128" height="128" rx="28" fill="#ea580c"/>' +
  '<path d="M36 92V36h20l8 30 8-30h20v56H78V58l-9 34H59l-9-34v34z" fill="#fff"/>' +
  '</svg>'

export const sampleLogoUrl = 'data:image/svg+xml;base64,' + btoa(sampleLogoSvg)
