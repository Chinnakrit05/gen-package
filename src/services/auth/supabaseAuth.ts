import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { ClientConfig } from '../../config'

export function createBrowserSupabaseClient(
  config: NonNullable<ClientConfig['supabase']>,
): SupabaseClient {
  return createClient(config.url, config.publishableKey, {
    auth: {
      detectSessionInUrl: true,
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
    },
  })
}

export function cloudDraftStorageKey(appUserId: string): string {
  return `gen-package-cloud-draft-v1:${appUserId}`
}
