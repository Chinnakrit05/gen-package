import { describe, expect, it } from 'vitest'
import { normalizeVercelRequestUrl } from './vercel'

describe('Vercel API rewrite adapter', () => {
  it('maps the explicit catch-all rewrite back to the shared API path', () => {
    expect(normalizeVercelRequestUrl('/api/backend?apiPath=health')).toBe('/api/v1/health')
    expect(normalizeVercelRequestUrl('/api/backend?apiPath=projects/123&limit=10'))
      .toBe('/api/v1/projects/123?limit=10')
    expect(normalizeVercelRequestUrl('/api/backend?workspaceId=workspace-1&limit=100&apiPath=projects&path=projects'))
      .toBe('/api/v1/projects?workspaceId=workspace-1&limit=100')
  })

  it('preserves a source path when the runtime exposes it directly', () => {
    expect(normalizeVercelRequestUrl('/api/v1/health?probe=1')).toBe('/api/v1/health?probe=1')
  })

  it('strips the internal rewrite parameter when Vercel preserves the source path', () => {
    expect(normalizeVercelRequestUrl('/api/v1/projects?workspaceId=workspace-1&apiPath=projects&path=projects&limit=10'))
      .toBe('/api/v1/projects?workspaceId=workspace-1&limit=10')
  })

  it('does not let rewrite metadata replace an already resolved API path', () => {
    expect(normalizeVercelRequestUrl('/api/v1/projects?apiPath=health&workspaceId=workspace-1'))
      .toBe('/api/v1/projects?workspaceId=workspace-1')
  })

  it('preserves cursor values and unknown or duplicate caller parameters for router validation', () => {
    expect(normalizeVercelRequestUrl('/api/v1/projects?apiPath=projects&path=projects&cursor=a%2Bb%2Fc%3D&limit=10&limit=20&unexpected=1'))
      .toBe('/api/v1/projects?cursor=a%2Bb%2Fc%3D&limit=10&limit=20&unexpected=1')
  })

  it('does not consume rewrite metadata outside API routes', () => {
    expect(normalizeVercelRequestUrl('/elsewhere?apiPath=projects')).toBe('/elsewhere?apiPath=projects')
    expect(normalizeVercelRequestUrl('/api/backend')).toBe('/api/backend')
  })
})
