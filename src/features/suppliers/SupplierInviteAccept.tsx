import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { SessionChangedError, useCloudSession } from '../../app/cloudSession'
import { peekSupplierInvite, storeSupplierInvite } from '../../app/supplierInviteRoute'
import { ApiClientError } from '../../services/api/client'
import { acceptSupplierInvite, marketplaceContextKey } from '../../services/api/marketplace'
import { MarketplaceError, MarketplaceShell } from './MarketplaceShell'

const UNAVAILABLE = 'ใช้คำเชิญนี้ไม่ได้ ลิงก์อาจหมดอายุ ถูกยกเลิก หรือส่งให้บัญชีอื่น'

export function SupplierInviteAccept() {
  const session = useCloudSession()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [invitationToken] = useState(peekSupplierInvite)
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const active = useRef(false)
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])

  const accept = async () => {
    if (busy || !invitationToken) return
    setBusy(true)
    setError(null)
    try {
      const access = await acceptSupplierInvite(session.apiBaseUrl, session.getAccessToken(), invitationToken)
      if (!active.current) return
      // A completed request must not change the route or cache for a different session.
      session.getAccessToken()
      storeSupplierInvite(null)
      void queryClient.invalidateQueries({ queryKey: marketplaceContextKey(session.appUserId) })
      void navigate(`/factory/${access.profile.id}/profile`, { replace: true })
    } catch (failure) {
      if (!active.current || failure instanceof SessionChangedError) return
      if (failure instanceof ApiClientError && [404, 422].includes(failure.status)) setUnavailable(true)
      else setError('ตอบรับคำเชิญไม่สำเร็จ กรุณาลองอีกครั้ง')
    } finally {
      if (active.current) setBusy(false)
    }
  }

  return (
    <MarketplaceShell title="คำเชิญเข้าทีมผู้รับผลิต">
      <section className="marketplace-card">
        {invitationToken && !unavailable ? (
          <>
            <p>ตอบรับเพื่อเข้าร่วมทีมใน Marketplace ของ PackIt</p>
            <p>ใช้บัญชี Google ที่ตรงกับอีเมลที่ได้รับเชิญ</p>
            {error && <MarketplaceError message={error} />}
            <button type="button" className="primary" disabled={busy} onClick={() => void accept()}>
              {busy ? 'กำลังตอบรับ…' : 'ตอบรับคำเชิญ'}
            </button>
          </>
        ) : (
          <>
            <MarketplaceError message={invitationToken ? UNAVAILABLE : 'ลิงก์เชิญไม่สมบูรณ์ กรุณาเปิดลิงก์ที่ได้รับอีกครั้ง'} />
            {unavailable && (
              <>
                <p>หากใช้บัญชีคนละอีเมล ให้ออกจากระบบแล้วเปิดลิงก์เดิมด้วยบัญชีที่ได้รับเชิญ</p>
                <button type="button" onClick={() => void session.signOut()}>ออกจากระบบ</button>
              </>
            )}
          </>
        )}
      </section>
    </MarketplaceShell>
  )
}
