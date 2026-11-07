import { useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useQuery } from '@tanstack/react-query'
import { useCloudSession } from '../../app/cloudSession'
import { MarketplaceError } from '../suppliers/MarketplaceShell'

export type ReviewerMfaClient = Pick<SupabaseClient['auth']['mfa'], 'listFactors' | 'challengeAndVerify'>

export function ReviewerMfa({ mfa, onVerified }: { mfa: ReviewerMfaClient; onVerified(): void }) {
  const session = useCloudSession()
  const [factorId, setFactorId] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const factors = useQuery({
    queryKey: ['cloud', session.appUserId, 'marketplace', 'reviewer-totp'],
    queryFn: async () => {
      session.getAccessToken()
      const { data, error } = await mfa.listFactors()
      session.getAccessToken()
      if (error) throw error
      return data.totp.map((factor) => ({ id: factor.id, name: factor.friendly_name }))
    },
    retry: false,
    gcTime: 0,
  })
  const selected = factors.data?.find((factor) => factor.id === factorId)?.id ?? factors.data?.[0]?.id
  const verify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected || !/^\d{6}$/.test(code) || busy) return
    setBusy(true)
    setFailed(false)
    setCode('')
    try {
      session.getAccessToken()
      const { error } = await mfa.challengeAndVerify({ factorId: selected, code })
      session.getAccessToken()
      if (error) throw error
      onVerified()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="marketplace-card">
      <h2>ยืนยันตัวตนสองขั้นตอน</h2>
      <p>ใช้รหัสจากแอปยืนยันตัวตนที่ผูกกับบัญชีนี้เพื่อเปิดรายการตรวจผู้รับผลิต</p>
      {factors.isPending && <p role="status">กำลังตรวจวิธียืนยันตัวตน…</p>}
      {factors.isError && <MarketplaceError message="โหลดวิธียืนยันตัวตนไม่สำเร็จ" retry={() => void factors.refetch()} />}
      {factors.data?.length === 0 && <p>บัญชีนี้ยังไม่มีแอปยืนยันตัวตนที่พร้อมใช้งาน ติดต่อผู้ดูแล PackIt เพื่อเตรียมบัญชี</p>}
      {selected && (
        <form className="marketplace-form" onSubmit={(event) => void verify(event)}>
          {factors.data && factors.data.length > 1 && (
            <label>
              แอปยืนยันตัวตน
              <select value={selected} onChange={(event) => setFactorId(event.target.value)} disabled={busy}>
                {factors.data.map((factor, index) => <option key={factor.id} value={factor.id}>{factor.name || `แอปที่ ${index + 1}`}</option>)}
              </select>
            </label>
          )}
          <label>
            รหัสยืนยันหกหลัก
            <input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" disabled={busy} required />
          </label>
          {failed && <MarketplaceError message="ยืนยันตัวตนไม่สำเร็จ ตรวจรหัสแล้วลองอีกครั้ง" />}
          <button className="primary" type="submit" disabled={busy || !/^\d{6}$/.test(code)}>{busy ? 'กำลังยืนยัน…' : 'ยืนยันตัวตน'}</button>
        </form>
      )}
    </section>
  )
}
