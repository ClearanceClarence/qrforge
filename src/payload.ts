// Builders for the text formats that phone cameras recognize.

const wifiEscape = (s: string) => s.replace(/([\;,:"])/g, '\\$1')

export interface WifiOptions {
  ssid: string
  password?: string
  /** Default `'WPA'` when a password is given, otherwise open. */
  encryption?: 'WPA' | 'WEP' | 'nopass'
  hidden?: boolean
}

/** Wi-Fi network login, e.g. `WIFI:T:WPA;S:name;P:secret;;` */
export function wifi(o: WifiOptions): string {
  const type = o.encryption ?? (o.password ? 'WPA' : 'nopass')
  let s = `WIFI:T:${type};S:${wifiEscape(o.ssid)};`
  if (type !== 'nopass' && o.password) s += `P:${wifiEscape(o.password)};`
  if (o.hidden) s += 'H:true;'
  return s + ';'
}

const vEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1')

export interface VCardOptions {
  firstName?: string
  lastName?: string
  organization?: string
  title?: string
  phone?: string
  email?: string
  url?: string
  address?: { street?: string; city?: string; region?: string; postalCode?: string; country?: string }
  note?: string
}

/** Contact card in vCard 3.0 format. */
export function vcard(o: VCardOptions): string {
  const first = o.firstName ?? ''
  const last = o.lastName ?? ''
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${vEscape(last)};${vEscape(first)};;;`, `FN:${vEscape([first, last].filter(Boolean).join(' ') || o.organization || '')}`]
  if (o.organization) lines.push(`ORG:${vEscape(o.organization)}`)
  if (o.title) lines.push(`TITLE:${vEscape(o.title)}`)
  if (o.phone) lines.push(`TEL;TYPE=CELL:${o.phone}`)
  if (o.email) lines.push(`EMAIL:${o.email}`)
  if (o.url) lines.push(`URL:${o.url}`)
  if (o.address) {
    const a = o.address
    lines.push(`ADR:;;${[a.street, a.city, a.region, a.postalCode, a.country].map((p) => vEscape(p ?? '')).join(';')}`)
  }
  if (o.note) lines.push(`NOTE:${vEscape(o.note)}`)
  lines.push('END:VCARD')
  return lines.join('\r\n')
}

/** `mailto:` link with optional subject and body. */
export function email(o: { to: string; subject?: string; body?: string }): string {
  const q = [o.subject && `subject=${encodeURIComponent(o.subject)}`, o.body && `body=${encodeURIComponent(o.body)}`].filter(Boolean)
  return `mailto:${o.to}${q.length ? '?' + q.join('&') : ''}`
}

/** Pre-filled text message. */
export function sms(o: { number: string; message?: string }): string {
  return `SMSTO:${o.number}:${o.message ?? ''}`
}

/** Phone call link. */
export function tel(number: string): string {
  return `tel:${number.replace(/[^\d+*#]/g, '')}`
}

/** Map location. */
export function geo(o: { lat: number; lng: number }): string {
  return `geo:${o.lat},${o.lng}`
}

const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

/** Calendar event in iCalendar format. */
export function event(o: { title: string; start: Date; end?: Date; location?: string; description?: string }): string {
  const lines = ['BEGIN:VEVENT', `SUMMARY:${vEscape(o.title)}`, `DTSTART:${icsDate(o.start)}`]
  if (o.end) lines.push(`DTEND:${icsDate(o.end)}`)
  if (o.location) lines.push(`LOCATION:${vEscape(o.location)}`)
  if (o.description) lines.push(`DESCRIPTION:${vEscape(o.description)}`)
  lines.push('END:VEVENT')
  return lines.join('\r\n')
}
