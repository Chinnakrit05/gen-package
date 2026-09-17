import { describe, expect, it } from 'vitest'
import { normalizeVercelRequestUrl } from './vercel'

describe('Vercel API rewrite adapter', () => {
  it('maps the explicit catch-all rewrite back to the shared API path', () => {
    expect(normalizeVercelRequestUrl('/api/backend?apiPath=health')).toBe('/api/v1/health')
    expect(normalizeVercelRequestUrl('/api/backend?apiPath=projects/123&limit=10'))
      .toBe('/api/v1/projects/123?limit=10')
  })

  it('preserves a source path when the runtime exposes it directly', () => {
    expect(normalizeVercelRequestUrl('/api/v1/health?probe=1')).toBe('/api/v1/health?probe=1')
  })
})
