import { describe, expect, it } from 'vitest'
import { isLegacyAiRouteEnabled } from './legacyAiGuard'

describe('legacy AI route guard', () => {
  it('keeps the legacy endpoint only for explicit local development', () => {
    expect(isLegacyAiRouteEnabled({})).toBe(true)
    expect(isLegacyAiRouteEnabled({ APP_ENV: 'development', VITE_APP_MODE: 'local' })).toBe(true)
  })

  it('closes the legacy endpoint in cloud and production-like runtimes', () => {
    expect(isLegacyAiRouteEnabled({ APP_ENV: 'development', VITE_APP_MODE: 'cloud' })).toBe(false)
    expect(isLegacyAiRouteEnabled({ APP_ENV: 'staging', VITE_APP_MODE: 'local' })).toBe(false)
    expect(isLegacyAiRouteEnabled({ NODE_ENV: 'production' })).toBe(false)
  })
})
