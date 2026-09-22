export type CloudStartupVariant = 'login' | 'folding'

interface StartupBrowser {
  storage: Pick<Storage, 'getItem'>
  search: string
}

/** Keep the SDK's existing default namespace so saved sessions remain compatible. */
export function supabaseAuthStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
}

function readStoredValue(storage: StartupBrowser['storage'], key: string): unknown {
  try {
    return JSON.parse(storage.getItem(key) ?? 'null')
  } catch {
    return null
  }
}

/**
 * Presentation hint only, captured before the lazy auth module starts. Never use
 * this to authenticate, fetch a workspace or skip Supabase/server validation.
 * Keep refreshable sessions on the folding loader even if the access token expired.
 */
export function getCloudStartupVariant(supabaseUrl: string, browser?: StartupBrowser): CloudStartupVariant {
  try {
    const { storage, search } = browser ?? { storage: window.localStorage, search: window.location.search }
    const key = supabaseAuthStorageKey(supabaseUrl)
    const saved = readStoredValue(storage, key)
    if (saved && typeof saved === 'object'
      && 'access_token' in saved && typeof saved.access_token === 'string' && saved.access_token.length > 0
      && 'refresh_token' in saved && typeof saved.refresh_token === 'string' && saved.refresh_token.length > 0
      && 'expires_at' in saved && typeof saved.expires_at === 'number' && Number.isFinite(saved.expires_at)) {
      return 'folding'
    }

    // On a first Google login the session is not stored until PKCE exchange ends.
    // Require a pending verifier for this project, not just an arbitrary ?code=.
    const params = new URLSearchParams(search)
    if (params.get('code') && !params.has('error') && !params.has('error_description')) {
      const flowId = params.get('sb_flow_id')
      if (flowId !== null && !/^[a-zA-Z0-9_-]{8,64}$/.test(flowId)) return 'login'
      const verifierKey = flowId ? `${key}-flow-${flowId}-code-verifier` : `${key}-code-verifier`
      const verifier = readStoredValue(storage, verifierKey)
      if (typeof verifier === 'string' && verifier.length > 0) return 'folding'
    }
  } catch {
    // Storage can be unavailable (privacy settings/SSR); auth still owns recovery.
  }
  return 'login'
}
