import type { IncomingMessage, ServerResponse } from 'node:http'
import { loadServerConfig } from '../config'
import { createApiRouter } from '../http/router'

const router = createApiRouter(loadServerConfig())

export function normalizeVercelRequestUrl(rawUrl: string | undefined): string {
  const url = new URL(rawUrl ?? '/', 'http://packit.local')
  // Vercel can retain the source pathname while adding destination query params.
  // apiPath is routing metadata, not a caller filter; keep strict API validation.
  if (url.pathname.startsWith('/api/v1/')) {
    url.searchParams.delete('apiPath')
    return `${url.pathname}${url.search}`
  }
  if (url.pathname !== '/api/backend') return `${url.pathname}${url.search}`

  const apiPath = url.searchParams.get('apiPath')
  if (!apiPath) return `${url.pathname}${url.search}`
  url.searchParams.delete('apiPath')
  const query = url.searchParams.toString()
  return `/api/v1/${apiPath.replace(/^\/+/, '')}${query ? `?${query}` : ''}`
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await router({
    method: req.method,
    url: normalizeVercelRequestUrl(req.url),
    headers: req.headers,
    body: (req as IncomingMessage & { body?: unknown }).body,
    raw: req,
  }, res)
}
