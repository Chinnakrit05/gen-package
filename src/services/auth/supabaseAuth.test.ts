import { describe, expect, it } from 'vitest'
import { cloudDraftStorageKey } from './supabaseAuth'

describe('cloud draft isolation', () => {
  it('uses a different storage namespace for every internal app user', () => {
    expect(cloudDraftStorageKey('user-a')).not.toBe(cloudDraftStorageKey('user-b'))
    expect(cloudDraftStorageKey('user-a')).toBe('gen-package-cloud-draft-v1:user-a')
  })
})
