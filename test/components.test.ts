import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { QRCode as ReactQR } from '../src/react'
import { QRCode as VueQR } from '../src/vue'

describe('framework components', () => {
  it('React renders an inline SVG', () => {
    const html = renderToStaticMarkup(createElement(ReactQR, { value: 'https://example.com', size: 200, title: 'Example', dots: 'rounded' }))
    expect(html).toMatch(/^<svg[^>]*viewBox="0 0 33 33"[^>]*width="200"/)
    expect(html).toContain('<path')
    expect(html).toContain('aria-label="Example"')
  })
  it('Vue renders an inline SVG', async () => {
    const app = createSSRApp({ render: () => h(VueQR, { value: 'https://example.com', size: 200, options: { dots: 'dots' } }) })
    const html = await renderToString(app)
    expect(html).toMatch(/^<svg[^>]*viewBox="0 0 33 33"/)
    expect(html).toContain('<path')
  })
})
