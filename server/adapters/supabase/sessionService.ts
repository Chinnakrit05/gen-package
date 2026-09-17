import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import type { SessionBootstrapData } from '../../../shared/contracts/auth'
import type { ServerConfig } from '../../config'
import { HttpError } from '../../http/errors'
import type { SessionService } from '../../modules/identity/sessionService'

interface BootstrapRow {
  app_user_id: string
  personal_workspace_id: string
  profile_display_name: string
  profile_email: string | null
  user_status: string
}

function normalizedDisplayName(user: User): string {
  const metadataName = user.user_metadata.full_name ?? user.user_metadata.name
  const candidate = typeof metadataName === 'string' && metadataName.trim()
    ? metadataName.trim()
    : user.email?.split('@')[0]?.trim() || 'ผู้ใช้ PackIt'
  return Array.from(candidate).slice(0, 100).join('')
}

function normalizedEmail(user: User): string | null {
  const email = user.email?.trim()
  return email && email.length <= 320 ? email : null
}

export class SupabaseSessionService implements SessionService {
  constructor(
    private readonly client: SupabaseClient,
    private readonly issuer: string,
  ) {}

  async bootstrap(accessToken: string, _requestId: string): Promise<SessionBootstrapData> {
    const { data: { user }, error: authError } = await this.client.auth.getUser(accessToken)
    if (authError && authError.status !== 401 && authError.status !== 403) {
      throw new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'บริการยืนยันตัวตนไม่พร้อมใช้งาน')
    }
    if (authError || !user) {
      throw new HttpError(401, 'SESSION_INVALID', 'Session หมดอายุหรือไม่ถูกต้อง')
    }

    const { data, error } = await this.client.rpc('bootstrap_personal_workspace', {
      p_identity_issuer: this.issuer,
      p_identity_subject: user.id,
      p_display_name: normalizedDisplayName(user),
      p_email: normalizedEmail(user),
    })
    if (error) {
      if (error.message.includes('APP_USER_NOT_ACTIVE')) {
        throw new HttpError(403, 'USER_NOT_ACTIVE', 'บัญชีนี้ไม่พร้อมใช้งาน')
      }
      throw new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'เริ่ม session กับฐานข้อมูลไม่สำเร็จ')
    }

    const row = (data as BootstrapRow[] | null)?.[0]
    if (!row || row.user_status !== 'active') {
      throw new HttpError(503, 'DEPENDENCY_UNAVAILABLE', 'ฐานข้อมูลไม่คืน session ที่สมบูรณ์')
    }

    return {
      user: {
        id: row.app_user_id,
        displayName: row.profile_display_name,
        email: row.profile_email,
      },
      personalWorkspace: {
        id: row.personal_workspace_id,
        kind: 'personal',
        name: 'พื้นที่ส่วนตัว',
        role: 'owner',
      },
    }
  }
}

export function createSupabaseSessionService(
  config: NonNullable<ServerConfig['supabase']>,
): SessionService {
  const client = createClient(config.url, config.secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })
  return new SupabaseSessionService(client, config.issuer)
}
