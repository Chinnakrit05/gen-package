import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LoginSkeleton } from './LoginSkeleton'

describe('LoginSkeleton', () => {
  it('uses the login layout without a folding box or fake interactive controls', () => {
    const markup = renderToStaticMarkup(createElement(LoginSkeleton, { title: 'Loading', message: 'Please wait' }))
    expect(markup).toContain('class="login-screen login-skeleton"')
    expect(markup).toContain('class="login-card" aria-hidden="true"')
    expect(markup).toContain('login-skeleton__button')
    expect(markup).not.toContain('packit-loading__')
    expect(markup).not.toMatch(/<(button|input|a)\b|tabindex|progressbar|aria-valuenow/)
  })

  it('announces the current stage once and escapes caller text', () => {
    const markup = renderToStaticMarkup(createElement(LoginSkeleton, {
      title: 'กำลังเตรียมหน้าเข้าสู่ระบบ',
      message: 'Session <one> & account',
    }))
    expect(markup.match(/role="status"/g)).toHaveLength(1)
    expect(markup).toContain('aria-live="polite" aria-atomic="true"')
    expect(markup).toContain('กำลังเตรียมหน้าเข้าสู่ระบบ — Session &lt;one&gt; &amp; account')
  })
})
