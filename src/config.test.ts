import { describe, expect, it } from 'vitest'
import { ClientConfigError, loadClientConfig } from './config'

describe('loadClientConfig', () => {
  it('defaults to an isolated local demo without cloud credentials', () => {
    expect(loadClientConfig({})).toEqual({
      mode: 'local',
      apiBaseUrl: '/api/v1',
      supabase: null,
    })
  })

  it('fails closed when cloud mode is missing public Supabase configuration', () => {
    expect(() => loadClientConfig({ VITE_APP_MODE: 'cloud' })).toThrow(ClientConfigError)
    try {
      loadClientConfig({ VITE_APP_MODE: 'cloud', VITE_SUPABASE_URL: 'https://example.supabase.co' })
    } catch (error) {
      expect(error).toMatchObject({ missingKeys: ['VITE_SUPABASE_PUBLISHABLE_KEY'] })
    }
  })

  it('accepts explicit cloud configuration and normalizes base URLs', () => {
    expect(loadClientConfig({
      VITE_APP_MODE: 'cloud',
      VITE_API_BASE_URL: 'https://api.example.com/api/v1/',
      VITE_SUPABASE_URL: 'https://example.supabase.co/',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'public-key',
    })).toEqual({
      mode: 'cloud',
      apiBaseUrl: 'https://api.example.com/api/v1',
      supabase: {
        url: 'https://example.supabase.co',
        publishableKey: 'public-key',
      },
    })
  })

  it('rejects unknown modes and unsafe URL schemes', () => {
    expect(() => loadClientConfig({ VITE_APP_MODE: 'demo' })).toThrow('VITE_APP_MODE')
    expect(() => loadClientConfig({ VITE_API_BASE_URL: 'javascript:alert(1)' })).toThrow('VITE_API_BASE_URL')
  })
})
