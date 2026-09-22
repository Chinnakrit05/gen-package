import { describe, expect, it } from 'vitest'
import { loadServerConfig, ServerConfigError } from './config'

describe('loadServerConfig', () => {
  it('uses safe development defaults without credentials', () => {
    expect(loadServerConfig({})).toEqual({ appEnv: 'development', allowedOrigins: [], supabase: null })
  })

  it('requires an explicit origin allowlist outside local/test environments', () => {
    expect(() => loadServerConfig({ NODE_ENV: 'production' })).toThrow('APP_ENV')
    expect(() => loadServerConfig({ APP_ENV: 'production' })).toThrow(ServerConfigError)
    expect(() => loadServerConfig({
      APP_ENV: 'staging',
      APP_ALLOWED_ORIGINS: 'https://preview.example.com',
    })).toThrow('Supabase')

    expect(loadServerConfig({
      APP_ENV: 'staging',
      APP_ALLOWED_ORIGINS: 'https://preview.example.com',
      SUPABASE_URL: 'https://example.supabase.co/',
      SUPABASE_SECRET_KEY: 'secret',
    })).toMatchObject({
      allowedOrigins: ['https://preview.example.com'],
      supabase: {
        url: 'https://example.supabase.co',
        secretKey: 'secret',
        issuer: 'https://example.supabase.co/auth/v1',
      },
    })
  })

  it('rejects wildcard, path-bearing, and malformed origins', () => {
    for (const origin of ['*', 'https://example.com/path', 'javascript:alert(1)']) {
      expect(() => loadServerConfig({ APP_ALLOWED_ORIGINS: origin })).toThrow(ServerConfigError)
    }
  })

  it('requires both server-side Supabase values and rejects unsafe URLs', () => {
    expect(() => loadServerConfig({ SUPABASE_URL: 'https://example.supabase.co' }))
      .toThrow('พร้อมกัน')
    expect(() => loadServerConfig({
      SUPABASE_URL: 'javascript:alert(1)',
      SUPABASE_SECRET_KEY: 'secret',
    })).toThrow('SUPABASE_URL')
  })
})
