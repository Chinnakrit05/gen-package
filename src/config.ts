import { APP_MODES, type AppMode } from '../shared/contracts/system'

interface ClientEnvironment {
  VITE_APP_MODE?: unknown
  VITE_API_BASE_URL?: unknown
  VITE_SUPABASE_URL?: unknown
  VITE_SUPABASE_PUBLISHABLE_KEY?: unknown
}

export interface ClientConfig {
  mode: AppMode
  apiBaseUrl: string
  supabase: null | {
    url: string
    publishableKey: string
  }
}

export class ClientConfigError extends Error {
  readonly missingKeys: readonly string[]

  constructor(message: string, missingKeys: readonly string[] = []) {
    super(message)
    this.name = 'ClientConfigError'
    this.missingKeys = missingKeys
  }
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

function parseMode(value: unknown): AppMode {
  const mode = optionalString(value) ?? 'local'
  if ((APP_MODES as readonly string[]).includes(mode)) return mode as AppMode
  throw new ClientConfigError(`VITE_APP_MODE ต้องเป็น ${APP_MODES.join(' หรือ ')}`)
}

function parseApiBaseUrl(value: unknown): string {
  const base = optionalString(value) ?? '/api/v1'
  if (base.startsWith('/')) return base.replace(/\/+$/, '') || '/'
  try {
    const url = new URL(base)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('invalid protocol')
    return url.toString().replace(/\/+$/, '')
  } catch {
    throw new ClientConfigError('VITE_API_BASE_URL ต้องเป็น path ที่ขึ้นต้นด้วย / หรือ URL แบบ http(s)')
  }
}

function parseHttpUrl(value: string, key: string): string {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('invalid protocol')
    return url.toString().replace(/\/+$/, '')
  } catch {
    throw new ClientConfigError(`${key} ต้องเป็น URL แบบ http(s)`)
  }
}

export function loadClientConfig(env: ClientEnvironment = import.meta.env): ClientConfig {
  const mode = parseMode(env.VITE_APP_MODE)
  const apiBaseUrl = parseApiBaseUrl(env.VITE_API_BASE_URL)

  if (mode === 'local') return { mode, apiBaseUrl, supabase: null }

  const supabaseUrl = optionalString(env.VITE_SUPABASE_URL)
  const publishableKey = optionalString(env.VITE_SUPABASE_PUBLISHABLE_KEY)
  const missingKeys = [
    ...(!supabaseUrl ? ['VITE_SUPABASE_URL'] : []),
    ...(!publishableKey ? ['VITE_SUPABASE_PUBLISHABLE_KEY'] : []),
  ]
  if (missingKeys.length > 0) {
    throw new ClientConfigError(`Cloud mode ยังตั้งค่าไม่ครบ: ${missingKeys.join(', ')}`, missingKeys)
  }

  return {
    mode,
    apiBaseUrl,
    supabase: {
      url: parseHttpUrl(supabaseUrl!, 'VITE_SUPABASE_URL'),
      publishableKey: publishableKey!,
    },
  }
}
