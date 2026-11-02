import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Check path coverage against the real repository config. This does not emulate
// Vercel's filesystem precedence or certify a deployed preview.
const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as {
  rewrites: { source: string; destination: string }[]
  functions: Record<string, { maxDuration: number }>
}
const spaRewrites = config.rewrites.filter((rule) => rule.destination === '/index.html')
const servesSpa = (url: string) => spaRewrites.some((rule) => (
  new RegExp(`^${rule.source}$`).test(new URL(url, 'https://packit.example.test').pathname)
))

describe('deployment SPA routing boundaries', () => {
  it.each([
    '/', '/login', '/app/projects', '/app/projects?cursor=opaque',
    '/editor/new', '/editor/30000000-0000-4000-8000-000000000001',
    '/editor/30000000-0000-4000-8000-000000000001/',
    '/unknown-ui-page', '/apiary', '/assets-gallery',
  ])('serves the shell for a direct UI URL: %s', (url) => {
    expect(servesSpa(url)).toBe(true)
  })

  it.each([
    '/api', '/api/', '/api/v1', '/api/v1/health', '/api/v1/not-a-route',
    '/api/v1/projects?workspaceId=bad', '/api/backend', '/api/box-spec',
    '/api/unknown-function', '/assets', '/assets/', '/assets/missing',
    '/assets/app-deadbeef.js', '/assets/font.woff2', '/favicon.ico',
    '/missing.js', '/nested/missing.css', '/images/missing.png',
    '/.well-known/security.txt', '/.well-known/acme-challenge/token',
    '/_vercel', '/_vercel/insights/script.js', '/_vercel/speed-insights/vitals',
    '/tests/browser/loading-continuity.html',
  ])('never replaces an API or asset URL with the shell: %s', (url) => {
    expect(servesSpa(url)).toBe(false)
  })

  it('keeps the API rewrite first and the existing function duration', () => {
    expect(config.rewrites[0]).toEqual({
      source: '/api/v1/:path*',
      destination: '/api/backend?apiPath=:path*',
    })
    expect(spaRewrites).toHaveLength(1)
    expect(config.functions['api/backend.js'].maxDuration).toBe(300)
  })
})
