import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Login } from './Login'

describe('Login mode labels', () => {
  it('makes local startup explicit without implying Google authentication', () => {
    const markup = renderToStaticMarkup(createElement(Login, { mode: 'local', onLogin() {} }))
    expect(markup).toContain('เริ่มใช้งานบนเครื่องนี้')
    expect(markup).toContain('ไม่ต้องเข้าสู่ระบบ')
    expect(markup).toContain('งานบันทึกในเบราว์เซอร์นี้เท่านั้น')
    expect(markup).not.toContain('เข้าสู่ระบบด้วย Google')
    expect(markup).not.toContain('viewBox="0 0 48 48"')
  })

  it('preserves Google authentication and caller messages for cloud mode', () => {
    const markup = renderToStaticMarkup(createElement(Login, { onLogin() {}, finePrint: 'Cloud account' }))
    expect(markup).toContain('เข้าสู่ระบบด้วย Google')
    expect(markup).toContain('viewBox="0 0 48 48"')
    expect(markup).toContain('Cloud account')
    expect(markup).not.toContain('เริ่มใช้งานบนเครื่องนี้')
  })
})
