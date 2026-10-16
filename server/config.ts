export const APP_ENVIRONMENTS = ['development', 'test', 'staging', 'production'] as const

export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number]

export interface ServerConfig {
  appEnv: AppEnvironment
  allowedOrigins: readonly string[]
  supabase: null | {
    url: string
    secretKey: string
    issuer: string
  }
  // คีย์ AI ของระบบสำหรับ /api/v1/ai/box-spec (cloud ไม่รับคีย์จากผู้ใช้แล้ว) — ไม่บังคับ: ไม่มี → route ตอบ 503
  ai: null | {
    anthropicApiKey: string
    model: string
  }
}

// Opus 5.5 (ตัดสินใจ 16 ต.ค. 2026) — ถูกกว่า Opus 4.8 ต่อโทเคน ($4/$20 vs $5/$25) และคำขอรองรับแล้ว
// (structured outputs + effort low + server-side fallback ดู boxSpecModelOptions ใน server/boxSpec.ts)
export const DEFAULT_AI_MODEL = 'claude-opus-5-5'

export class ServerConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ServerConfigError'
  }
}

function optionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}

function parseAppEnvironment(value: string | undefined): AppEnvironment {
  const appEnv = optionalString(value) ?? 'development'
  if ((APP_ENVIRONMENTS as readonly string[]).includes(appEnv)) return appEnv as AppEnvironment
  throw new ServerConfigError(`APP_ENV ต้องเป็น ${APP_ENVIRONMENTS.join(', ')}`)
}

function parseOrigins(value: string | undefined): readonly string[] {
  if (!optionalString(value)) return []

  return value!.split(',').map((entry) => {
    const origin = entry.trim()
    try {
      const url = new URL(origin)
      if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin !== origin) {
        throw new Error('not an origin')
      }
      return origin
    } catch {
      throw new ServerConfigError(`APP_ALLOWED_ORIGINS มี origin ไม่ถูกต้อง: ${origin || '(empty)'}`)
    }
  })
}

function parseHttpUrl(value: string, key: string): string {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('invalid protocol')
    return url.toString().replace(/\/+$/, '')
  } catch {
    throw new ServerConfigError(`${key} ต้องเป็น URL แบบ http(s)`)
  }
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  if (!optionalString(env.APP_ENV) && env.NODE_ENV === 'production') {
    throw new ServerConfigError('APP_ENV จำเป็นเมื่อ NODE_ENV=production')
  }
  const appEnv = parseAppEnvironment(env.APP_ENV)
  const allowedOrigins = parseOrigins(env.APP_ALLOWED_ORIGINS)

  if ((appEnv === 'staging' || appEnv === 'production') && allowedOrigins.length === 0) {
    throw new ServerConfigError(`APP_ALLOWED_ORIGINS จำเป็นเมื่อ APP_ENV=${appEnv}`)
  }

  const supabaseUrl = optionalString(env.SUPABASE_URL)
  const supabaseSecretKey = optionalString(env.SUPABASE_SECRET_KEY)
  if (Boolean(supabaseUrl) !== Boolean(supabaseSecretKey)) {
    throw new ServerConfigError('ต้องตั้ง SUPABASE_URL และ SUPABASE_SECRET_KEY พร้อมกัน')
  }
  if ((appEnv === 'staging' || appEnv === 'production') && !supabaseUrl) {
    throw new ServerConfigError(`Supabase server credentials จำเป็นเมื่อ APP_ENV=${appEnv}`)
  }

  const supabase = supabaseUrl && supabaseSecretKey
    ? {
        url: parseHttpUrl(supabaseUrl, 'SUPABASE_URL'),
        secretKey: supabaseSecretKey,
        issuer: `${parseHttpUrl(supabaseUrl, 'SUPABASE_URL')}/auth/v1`,
      }
    : null

  const anthropicApiKey = optionalString(env.ANTHROPIC_API_KEY)
  const ai = anthropicApiKey
    ? { anthropicApiKey, model: optionalString(env.BOX_SPEC_MODEL) ?? DEFAULT_AI_MODEL }
    : null

  return { appEnv, allowedOrigins, supabase, ai }
}
