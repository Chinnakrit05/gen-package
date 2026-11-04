// บริบทของบัญชีที่ผ่าน bootstrap แล้ว ใช้ร่วมกันทุก route ฝั่ง cloud (ROUTES-PHASE-1.md §2, §7 R5)
// ไม่ import Editor/core — หน้าเบาใช้ได้
import { createContext, useContext } from 'react'
import type { MeData, WorkspaceSummary } from '../../shared/contracts/auth'

export type WorkspaceRole = WorkspaceSummary['role']

export type MeStatus = 'loading' | 'ready' | 'error'

export interface CloudSessionValue {
  apiBaseUrl: string
  appUserId: string
  personalWorkspaceId: string
  // token ของบัญชีนี้เท่านั้น: session เปลี่ยนเจ้าของ/หลุด → throw (คิว/คำขอของบัญชีเก่าจึงส่งด้วย token ใหม่ไม่ได้)
  getAccessToken(): string
  // เปลี่ยนทุกครั้งที่ token ของบัญชีเดิมถูกต่ออายุ — ใช้กระตุ้นคิวที่รอ ไม่ใช่ตัวตนใหม่
  accessToken: string
  me: MeData | null
  meStatus: MeStatus
  workspaceId: string
  role: WorkspaceRole | null
  setWorkspaceId(workspaceId: string): void
  signOut(): Promise<void>
}

export class SessionChangedError extends Error {
  constructor() {
    super('บัญชีที่เข้าสู่ระบบเปลี่ยนไปแล้ว — ไม่ส่งคำขอของบัญชีเดิม')
    this.name = 'SessionChangedError'
  }
}

export const CloudSessionContext = createContext<CloudSessionValue | null>(null)

export function useCloudSession(): CloudSessionValue {
  const value = useContext(CloudSessionContext)
  if (!value) throw new Error('ต้องอยู่ใต้ CloudSessionContext (ผ่าน RequireSession แล้ว)')
  return value
}

export const activeWorkspaceStorageKey = (appUserId: string) => `packit-active-workspace:${appUserId}`

// workspace ที่เลือกได้ต้องมาจาก /me เท่านั้น — ค่าเก็บไว้ไม่ตรงสมาชิกปัจจุบัน = personal
export function resolveActiveWorkspace(stored: string | null, me: MeData | null, personalWorkspaceId: string): string {
  if (!stored || !me) return personalWorkspaceId
  return me.workspaces.some((workspace) => workspace.id === stored) ? stored : personalWorkspaceId
}

// token ของ session ปัจจุบันเฉพาะเมื่อยังเป็นเจ้าของเดิม (Supabase subject ที่ bootstrap ยืนยันแล้ว — ไม่ใช่ appUserId)
// ต่ออายุ token ของคนเดิมใช้ต่อได้; หลุด/เปลี่ยนบัญชี = SessionChangedError (คำขอค้างของบัญชีเก่าไม่ถูกส่ง)
export function boundTokenProvider(
  sessionRef: { readonly current: { user: { id: string }; access_token: string } | null | undefined },
  identityUserId: string,
): () => string {
  return () => {
    const current = sessionRef.current
    if (!current || current.user.id !== identityUserId) throw new SessionChangedError()
    return current.access_token
  }
}
