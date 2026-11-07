import { describe, expect, it } from 'vitest'
import { DEFAULT_RETURN_TO, returnToOrDefault, sanitizeReturnTo } from './returnTo'
import { readSupplierInviteFragment, supplierInviteLink } from './supplierInviteRoute'

const ORIGIN = 'https://packit.example'

describe('sanitizeReturnTo', () => {
  it('รับ path ภายใน /app/ และ /editor/ พร้อม query/hash', () => {
    expect(sanitizeReturnTo('/app/projects', ORIGIN)).toBe('/app/projects')
    expect(sanitizeReturnTo('/editor/0b2f2c8e-1111-4222-8333-444455556666', ORIGIN))
      .toBe('/editor/0b2f2c8e-1111-4222-8333-444455556666')
    expect(sanitizeReturnTo('/app/projects?x=1#top', ORIGIN)).toBe('/app/projects?x=1#top')
  })

  it('ปฏิเสธ URL ภายนอก protocol-relative และ backslash', () => {
    for (const value of [
      'https://evil.example/app/projects',
      '//evil.example/app/projects',
      '/\\evil.example/app/projects',
      '/app\\..\\evil',
      'javascript:alert(1)',
      'app/projects',
      '',
    ]) expect(sanitizeReturnTo(value, ORIGIN)).toBeNull()
  })

  it('ปฏิเสธอักขระควบคุม ความยาวเกิน และค่าที่ไม่ใช่ string', () => {
    expect(sanitizeReturnTo('/app/\nprojects', ORIGIN)).toBeNull()
    expect(sanitizeReturnTo(`/app/${'a'.repeat(600)}`, ORIGIN)).toBeNull()
    expect(sanitizeReturnTo(null, ORIGIN)).toBeNull()
    expect(sanitizeReturnTo({ path: '/app/projects' }, ORIGIN)).toBeNull()
  })

  it('ไม่รับปลายทางที่วนกลับ login/root หรือ path ที่ resolve ออกนอก prefix', () => {
    expect(sanitizeReturnTo('/login', ORIGIN)).toBeNull()
    expect(sanitizeReturnTo('/', ORIGIN)).toBeNull()
    expect(sanitizeReturnTo('/app/../login', ORIGIN)).toBeNull()
    expect(sanitizeReturnTo('/api/v1/me', ORIGIN)).toBeNull()
  })

  it('ค่าที่ไม่ผ่านใช้หน้ารายการแทน', () => {
    expect(returnToOrDefault('//evil.example', ORIGIN)).toBe(DEFAULT_RETURN_TO)
    expect(returnToOrDefault('/editor/new', ORIGIN)).toBe('/editor/new')
  })

  it('allows the protected Marketplace routes while keeping other destinations outside the allowlist', () => {
    expect(sanitizeReturnTo('/factory/onboarding', ORIGIN)).toBe('/factory/onboarding')
    expect(sanitizeReturnTo('/factory/0b2f2c8e-1111-4222-8333-444455556666/profile', ORIGIN))
      .toBe('/factory/0b2f2c8e-1111-4222-8333-444455556666/profile')
    expect(sanitizeReturnTo('/factory/0b2f2c8e-1111-4222-8333-444455556666/team', ORIGIN))
      .toBe('/factory/0b2f2c8e-1111-4222-8333-444455556666/team')
    expect(sanitizeReturnTo('/admin/suppliers?status=pending', ORIGIN)).toBe('/admin/suppliers?status=pending')
    for (const path of ['/factory/invalid/profile', '/factory/%2Fexample/profile', '/factory/../login', '/admin/other', '/suppliers/first-shop']) {
      expect(sanitizeReturnTo(path, ORIGIN)).toBeNull()
    }
  })

  it('allows only a token-free invitation return path', () => {
    const path = '/factory/invitations/accept'
    const token = 'A-_'.repeat(14) + 'X'
    const link = new URL(supplierInviteLink(ORIGIN, token))
    expect(link.pathname).toBe(path)
    expect(link.search).toBe('')
    expect(readSupplierInviteFragment(link.hash)).toBe(token)
    expect(sanitizeReturnTo(path + '/', ORIGIN)).toBe(path)
    expect(sanitizeReturnTo(path + link.hash, ORIGIN)).toBeNull()
    expect(sanitizeReturnTo(path + '?token=' + token, ORIGIN)).toBeNull()
    for (const hash of ['', '#token=short', '#token=' + token + '&token=' + token, '#token=' + token.slice(1) + '+']) {
      expect(readSupplierInviteFragment(hash)).toBeNull()
    }
  })
})
