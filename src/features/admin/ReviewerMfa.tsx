import '../suppliers/studio-suppliers.css'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useQuery } from '@tanstack/react-query'
import { SessionChangedError, useCloudSession } from '../../app/cloudSession'
import { MarketplaceError } from '../suppliers/MarketplaceShell'

export type ReviewerMfaClient = Pick<SupabaseClient['auth']['mfa'],
  'listFactors' | 'challengeAndVerify' | 'enroll' | 'unenroll' | 'getAuthenticatorAssuranceLevel'>

type Setup = { id: string; qrUrl: string | null; secret: string }
type Action = 'enroll' | 'verify' | 'cancel'

const SVG_PREFIX = 'data:image/svg+xml;utf-8,'

function qrImageUrl(value: string): string | null {
  // The Supabase SDK prefixes raw SVG. Encode the payload for use as an image, never as document markup.
  if (!value.startsWith(SVG_PREFIX)) return null
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(value.slice(SVG_PREFIX.length))}`
}

export function ReviewerMfa({ mfa, onVerified }: { mfa: ReviewerMfaClient; onVerified(): void }) {
  const session = useCloudSession()
  const mounted = useRef(true)
  const activeAction = useRef<Action | null>(null)
  const [factorId, setFactorId] = useState('')
  const [code, setCode] = useState('')
  const [action, setAction] = useState<Action | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [setup, setSetup] = useState<Setup | null>(null)
  const [resume, setResume] = useState(false)
  const [showManual, setShowManual] = useState(false)
  const busy = action !== null

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const assertCurrent = () => {
    if (!mounted.current) throw new SessionChangedError()
    return session.getAccessToken()
  }
  const readFactors = async () => {
    assertCurrent()
    const { data, error } = await mfa.listFactors()
    assertCurrent()
    if (error) throw error
    return data
  }
  const factors = useQuery({
    queryKey: ['cloud', session.appUserId, 'marketplace', 'reviewer-totp'],
    queryFn: async () => {
      const data = await readFactors()
      return {
        verified: data.totp.map((factor) => ({ id: factor.id, name: factor.friendly_name })),
        incomplete: data.all
          .filter((factor) => factor.factor_type === 'totp' && factor.status === 'unverified')
          .map((factor) => ({ id: factor.id, name: factor.friendly_name })),
      }
    },
    retry: false,
    gcTime: 0,
  })

  const verified = factors.data?.verified ?? []
  const available = verified.length > 0 ? verified : resume ? factors.data?.incomplete ?? [] : []
  const selected = setup?.id ?? available.find((factor) => factor.id === factorId)?.id ?? available[0]?.id

  const runAction = async (kind: Action, failure: string, run: () => Promise<void>) => {
    if (activeAction.current) return
    activeAction.current = kind
    setAction(kind)
    setMessage(null)
    try {
      assertCurrent()
      await run()
    } catch (error) {
      if (mounted.current && !(error instanceof SessionChangedError)) setMessage(failure)
    } finally {
      activeAction.current = null
      if (mounted.current) setAction(null)
    }
  }

  const beginSetup = () => void runAction('enroll', 'เริ่มตั้งค่าไม่สำเร็จ ลองอีกครั้งหรือติดต่อผู้ดูแล PackIt', async () => {
    const { data, error } = await mfa.enroll({ factorType: 'totp', issuer: 'PackIt' })
    assertCurrent()
    if (error) throw error
    setSetup({ id: data.id, qrUrl: qrImageUrl(data.totp.qr_code), secret: data.totp.secret })
    setCode('')
    setResume(false)
  })

  const cancelSetup = () => {
    if (!setup) return
    void runAction('cancel', 'ยกเลิกการตั้งค่าไม่สำเร็จ ลองอีกครั้ง', async () => {
      const token = assertCurrent()
      const current = (await readFactors()).all.find((factor) => factor.id === setup.id)
      // Only the factor created on this screen may be removed. Recheck its live state and session first.
      if (current?.factor_type === 'totp' && current.status === 'unverified') {
        const assurance = await mfa.getAuthenticatorAssuranceLevel()
        if (assurance.error) throw assurance.error
        // Supabase will reject removal of a verified factor from an AAL1 session.
        if (assertCurrent() !== token || assurance.data.currentLevel !== 'aal1') throw new Error('Session changed during cancellation')
        const { error } = await mfa.unenroll({ factorId: setup.id })
        assertCurrent()
        if (error) throw error
      }
      setSetup(null)
      setCode('')
      setShowManual(false)
      void factors.refetch()
    })
  }

  const verify = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected || !/^\d{6}$/.test(code)) return
    void runAction('verify', 'ยืนยันตัวตนไม่สำเร็จ ตรวจรหัสแล้วลองอีกครั้ง', async () => {
      setCode('')
      const { error } = await mfa.challengeAndVerify({ factorId: selected, code })
      assertCurrent()
      if (error) throw error
      setSetup(null)
      setShowManual(false)
      onVerified()
    })
  }

  return (
    <section className="marketplace-card studio-mfa-card">
      <div className="studio-security-mark" aria-hidden="true">✓</div>
      <p className="studio-eyebrow">SECURE STAFF ACCESS</p>
      <h2>ยืนยันตัวตนสองขั้นตอน</h2>
      <p>ใช้รหัสจากแอปยืนยันตัวตนที่ผูกกับบัญชีนี้เพื่อเปิดรายการตรวจผู้รับผลิต</p>
      {factors.isPending && <p role="status">กำลังตรวจวิธียืนยันตัวตน…</p>}
      {factors.isError && <MarketplaceError message="โหลดวิธียืนยันตัวตนไม่สำเร็จ" retry={() => void factors.refetch()} />}
      {factors.isSuccess && verified.length === 0 && (
        <p>เมื่อยืนยันการตั้งค่าครั้งแรกสำเร็จ บัญชีนี้จะออกจากระบบในเซสชันอื่น</p>
      )}
      {factors.isSuccess && verified.length === 0 && !setup && (
        <>
          <button type="button" className="primary" onClick={beginSetup} disabled={busy || factors.isFetching}>
            {action === 'enroll' ? 'กำลังเริ่มตั้งค่า…' : 'ตั้งค่าแอปยืนยันตัวตน'}
          </button>
          {!resume && factors.data.incomplete.length > 0 && (
            <button type="button" onClick={() => { setResume(true); setCode(''); setMessage(null) }} disabled={busy}>
              ใช้แอปที่เคยสแกนไว้
            </button>
          )}
          {resume && <p>กรอกรหัสจากแอปที่เคยสแกนไว้ หากยังไม่ได้สแกนให้เริ่มตั้งค่าใหม่</p>}
        </>
      )}
      {setup && (
        <div className="marketplace-notice studio-mfa-setup">
          <p>{setup.qrUrl
            ? 'สแกน QR ด้วยแอปยืนยันตัวตน แล้วกรอกรหัสหกหลักจากแอปด้านล่าง'
            : 'ใช้รหัสตั้งค่าด้วยตนเองในแอปยืนยันตัวตน แล้วกรอกรหัสหกหลักจากแอปด้านล่าง'}</p>
          {setup.qrUrl && <img src={setup.qrUrl} width={180} height={180} alt="QR สำหรับตั้งค่าแอปยืนยันตัวตน" />}
          <button type="button" aria-expanded={showManual} onClick={() => setShowManual(!showManual)} disabled={busy}>
            {showManual ? 'ซ่อนรหัสตั้งค่าด้วยตนเอง' : 'แสดงรหัสตั้งค่าด้วยตนเอง'}
          </button>
          {showManual && <code aria-label="รหัสตั้งค่าด้วยตนเอง">{setup.secret}</code>}
          <button type="button" onClick={cancelSetup} disabled={busy}>
            {action === 'cancel' ? 'กำลังยกเลิก…' : 'ยกเลิกการตั้งค่า'}
          </button>
        </div>
      )}
      {message && <MarketplaceError message={message} />}
      {selected && (
        <form className="marketplace-form" onSubmit={verify}>
          {!setup && available.length > 1 && (
            <label>
              แอปยืนยันตัวตน
              <select value={selected} onChange={(event) => { setFactorId(event.target.value); setCode('') }} disabled={busy}>
                {available.map((factor, index) => <option key={factor.id} value={factor.id}>{factor.name || `แอปที่ ${index + 1}`}</option>)}
              </select>
            </label>
          )}
          <label>
            รหัสยืนยันหกหลัก
            <input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" disabled={busy} required />
          </label>
          <button className="primary" type="submit" disabled={busy || !/^\d{6}$/.test(code)}>{action === 'verify' ? 'กำลังยืนยัน…' : 'ยืนยันตัวตน'}</button>
        </form>
      )}
    </section>
  )
}
