import { describe, expect, it } from 'vitest'
import type { MeData } from '../../shared/contracts/auth'
import { SessionChangedError, boundTokenProvider, resolveActiveWorkspace } from './cloudSession'

const PERSONAL = '20000000-0000-4000-8000-000000000001'
const TEAM = '20000000-0000-4000-8000-000000000003'
const me: MeData = {
  user: { id: '10000000-0000-4000-8000-000000000001', displayName: 'Owner', email: null },
  workspaces: [
    { id: PERSONAL, kind: 'personal', name: 'ส่วนตัว', role: 'owner' },
    { id: TEAM, kind: 'team', name: 'ทีม', role: 'viewer' },
  ],
}

describe('boundTokenProvider', () => {
  it('ต่ออายุ token ของคนเดิมได้ token ใหม่', () => {
    const ref = { current: { user: { id: 'subject-a' }, access_token: 't1' } as { user: { id: string }; access_token: string } | null }
    const token = boundTokenProvider(ref, 'subject-a')
    expect(token()).toBe('t1')
    ref.current = { user: { id: 'subject-a' }, access_token: 't2' }
    expect(token()).toBe('t2')
  })

  it('เปลี่ยนบัญชีหรือ logout แล้วคำขอของบัญชีเก่าไม่ได้ token', () => {
    const ref = { current: { user: { id: 'subject-a' }, access_token: 't1' } as { user: { id: string }; access_token: string } | null }
    const token = boundTokenProvider(ref, 'subject-a')
    ref.current = { user: { id: 'subject-b' }, access_token: 'tb' }
    expect(() => token()).toThrow(SessionChangedError)
    ref.current = null
    expect(() => token()).toThrow(SessionChangedError)
  })
})

describe('resolveActiveWorkspace', () => {
  it('ใช้ workspace ที่เก็บไว้เมื่อยังเป็นสมาชิกตาม /me', () => {
    expect(resolveActiveWorkspace(TEAM, me, PERSONAL)).toBe(TEAM)
  })

  it('ค่าที่ไม่อยู่ใน /me หรือยังไม่มี /me ใช้ personal', () => {
    expect(resolveActiveWorkspace('20000000-0000-4000-8000-000000000999', me, PERSONAL)).toBe(PERSONAL)
    expect(resolveActiveWorkspace(TEAM, null, PERSONAL)).toBe(PERSONAL)
    expect(resolveActiveWorkspace(null, me, PERSONAL)).toBe(PERSONAL)
  })
})
