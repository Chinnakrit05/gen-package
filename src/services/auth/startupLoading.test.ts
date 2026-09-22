import { describe, expect, it, vi } from 'vitest'
import { getCloudStartupVariant, supabaseAuthStorageKey } from './startupLoading'

const url = 'https://project-one.supabase.co'
const key = 'sb-project-one-auth-token'
const session = { access_token: 'test-access', refresh_token: 'test-refresh', expires_at: 2_000_000_000 }
const browser = (items: Record<string, string> = {}, search = '') => ({
  storage: { getItem: (name: string) => items[name] ?? null }, search,
})

describe('cloud startup loading hint', () => {
  it('matches the existing Supabase session namespace, including local development', () => {
    expect(supabaseAuthStorageKey(url)).toBe(key)
    expect(supabaseAuthStorageKey('http://127.0.0.1:54321')).toBe('sb-127-auth-token')
  })

  it('uses a skeleton for a visitor without a saved session', () => {
    expect(getCloudStartupVariant(url, browser())).toBe('login')
  })

  it('starts with the folding box for a saved session', () => {
    expect(getCloudStartupVariant(url, browser({ [key]: JSON.stringify(session) }))).toBe('folding')
  })

  it('keeps the box while Supabase refreshes an expired access token', () => {
    expect(getCloudStartupVariant(url, browser({ [key]: JSON.stringify({ ...session, expires_at: 1 }) }))).toBe('folding')
  })

  it.each(['null', 'true', '[]', '{invalid', '{}', '"test-token"',
    JSON.stringify({ ...session, refresh_token: '' }),
    JSON.stringify({ ...session, access_token: 123 }),
    JSON.stringify({ ...session, expires_at: 'invalid' }),
  ])('ignores malformed session data: %s', (value) => {
    expect(getCloudStartupVariant(url, browser({ [key]: value }))).toBe('login')
  })

  it('does not use another project session or the local demo gate', () => {
    expect(getCloudStartupVariant(url, browser({
      'sb-other-project-auth-token': JSON.stringify(session), 'packit-auth': '1',
    }))).toBe('login')
  })

  it('uses the box on a Google callback before the first session is saved', () => {
    expect(getCloudStartupVariant(url, browser({ [`${key}-code-verifier`]: '"test-verifier"' }, '?code=test-code'))).toBe('folding')
  })

  it('requires both the callback and this project verifier', () => {
    expect(getCloudStartupVariant(url, browser({}, '?code=test-code'))).toBe('login')
    expect(getCloudStartupVariant(url, browser({ [`${key}-code-verifier`]: '"test-verifier"' }))).toBe('login')
    expect(getCloudStartupVariant(url, browser({ 'sb-other-auth-token-code-verifier': '"test-verifier"' }, '?code=test-code'))).toBe('login')
  })

  it('does not treat a failed OAuth callback as a pending sign-in', () => {
    expect(getCloudStartupVariant(url, browser({ [`${key}-code-verifier`]: '"test-verifier"' }, '?code=test-code&error=access_denied'))).toBe('login')
  })

  it('supports a flow-specific callback without taking another flow verifier', () => {
    const items = { [`${key}-flow-flow1234-code-verifier`]: '"test-verifier"' }
    expect(getCloudStartupVariant(url, browser(items, '?code=test&sb_flow_id=flow1234'))).toBe('folding')
    expect(getCloudStartupVariant(url, browser(items, '?code=test&sb_flow_id=other123'))).toBe('login')
    expect(getCloudStartupVariant(url, browser(items, '?code=test&sb_flow_id=../invalid'))).toBe('login')
  })

  it('returns to the skeleton after the SDK removes the saved session on logout', () => {
    const items: Record<string, string> = { [key]: JSON.stringify(session) }
    expect(getCloudStartupVariant(url, browser(items))).toBe('folding')
    delete items[key]
    expect(getCloudStartupVariant(url, browser(items))).toBe('login')
  })

  it('safely handles unavailable storage, invalid URL and non-browser rendering', () => {
    const getItem = vi.fn(() => { throw new Error('Storage unavailable') })
    expect(getCloudStartupVariant(url, { storage: { getItem }, search: '' })).toBe('login')
    expect(getCloudStartupVariant('invalid', browser())).toBe('login')
    expect(getCloudStartupVariant(url)).toBe('login')
  })

  it('reads only exact auth keys and returns no tokens or session data', () => {
    const getItem = vi.fn(() => JSON.stringify(session))
    expect(getCloudStartupVariant(url, { storage: { getItem }, search: '' })).toBe('folding')
    expect(getItem).toHaveBeenCalledExactlyOnceWith(key)
  })
})
