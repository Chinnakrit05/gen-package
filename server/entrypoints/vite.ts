import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect } from 'vite'
import { loadServerConfig } from '../config'
import { createApiRouter } from '../http/router'

export function createViteApiMiddleware(env: Record<string, string | undefined>): Connect.NextHandleFunction {
  const router = createApiRouter(loadServerConfig(env))
  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const path = new URL(req.url ?? '/', 'http://packit.local').pathname
    if (path === '/api/v1' || path.startsWith('/api/v1/')) {
      void router(req, res)
      return
    }
    next()
  }
}
