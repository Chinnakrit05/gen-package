import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LoadingScreen } from './LoadingScreen'
import packitMark from '../assets/packit-mark.png'

describe('LoadingScreen', () => {
  it('announces the actual loading stage once, without invented progress', () => {
    const markup = renderToStaticMarkup(createElement(LoadingScreen, {
      title: 'กำลังเปิดงาน',
      message: 'กำลังโหลดโปรเจกต์และฉบับร่างล่าสุด…',
    }))
    expect(markup).toContain('role="status" aria-live="polite" aria-atomic="true"')
    expect(markup.match(/role="status"/g)).toHaveLength(1)
    expect(markup).toContain('กำลังเปิดงาน</h1>')
    expect(markup).toContain('กำลังโหลดโปรเจกต์และฉบับร่างล่าสุด…</p>')
    expect(markup).not.toContain('progressbar')
    expect(markup).not.toContain('aria-valuenow')
  })

  it('keeps decorative folding faces out of the accessibility tree', () => {
    const markup = renderToStaticMarkup(createElement(LoadingScreen, { title: 'Loading', message: 'Please wait' }))
    expect(markup).toContain('class="packit-loading__stage" aria-hidden="true"')
    expect(markup.match(/class="packit-loading__face /g)).toHaveLength(6)
    expect(markup).not.toContain('tabindex')
  })

  it('uses the supplied logo on the lid instead of the lettermark', () => {
    const markup = renderToStaticMarkup(createElement(LoadingScreen, { title: 'Loading', message: 'Please wait' }))
    expect(markup).toContain(`class="packit-loading__lid-logo" src="${packitMark}" alt=""`)
    expect(markup).toContain('width="48" height="48" draggable="false"')
    expect(markup).not.toContain('<span>p.</span>')
  })

  it('escapes caller text and can render without a browser or animation timer', () => {
    const markup = renderToStaticMarkup(createElement(LoadingScreen, {
      title: '<script>bad()</script>',
      message: 'Project <one> & draft',
    }))
    expect(markup).not.toContain('<script>')
    expect(markup).toContain('&lt;script&gt;bad()&lt;/script&gt;')
    expect(markup).toContain('Project &lt;one&gt; &amp; draft')
  })
})
