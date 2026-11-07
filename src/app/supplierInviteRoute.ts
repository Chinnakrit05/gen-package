export const SUPPLIER_INVITE_PATH = '/factory/invitations/accept'
const STORAGE_KEY = 'packit-pending-supplier-invite'
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function isSupplierInvitePath(path: string): boolean {
  return /^\/factory\/invitations\/accept\/?$/i.test(path)
}

export function readSupplierInviteFragment(hash: string): string | null {
  const token = hash.startsWith('#token=') ? hash.slice(7) : ''
  return TOKEN_PATTERN.test(token) ? token : null
}

export function supplierInviteLink(origin: string, token: string): string {
  return new URL(`${SUPPLIER_INVITE_PATH}#token=${encodeURIComponent(token)}`, origin).href
}

export function storeSupplierInvite(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(STORAGE_KEY, token)
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // If tab storage is unavailable, the user can reopen the original link.
  }
}

export function peekSupplierInvite(): string | null {
  try {
    const token = sessionStorage.getItem(STORAGE_KEY)
    return token && TOKEN_PATTERN.test(token) ? token : null
  } catch {
    return null
  }
}
