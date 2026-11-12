import './studio-suppliers.css'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import type { SupplierPublicProfile } from '../../../shared/contracts/marketplace'
import { ApiClientError } from '../../services/api/client'
import { getPublicSupplier } from '../../services/api/marketplace'
import { CapabilityList, MarketplaceError, MarketplaceShell } from './MarketplaceShell'
import { SUPPLIER_SLUG, supplierKindNames } from './supplierUi'

type PublicState = { status: 'loading' | 'missing' | 'error' } | { status: 'ready'; profile: SupplierPublicProfile }

export function PublicSupplierPage({ apiBaseUrl }: { apiBaseUrl: string }) {
  const { slug } = useParams()
  if (!slug || slug.length < 3 || slug.length > 64 || !SUPPLIER_SLUG.test(slug)) {
    return <MarketplaceShell title="ไม่พบโปรไฟล์ผู้รับผลิต" publicPage><p>ตรวจลิงก์แล้วลองอีกครั้ง</p></MarketplaceShell>
  }
  return <PublicSupplier key={slug} apiBaseUrl={apiBaseUrl} slug={slug} />
}

function PublicSupplier({ apiBaseUrl, slug }: { apiBaseUrl: string; slug: string }) {
  const [state, setState] = useState<PublicState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    void getPublicSupplier(apiBaseUrl, slug, signal).then(
      (profile) => { if (!signal.aborted) setState({ status: 'ready', profile }) },
      (error: unknown) => {
        if (!signal.aborted) setState({ status: error instanceof ApiClientError && error.status === 404 ? 'missing' : 'error' })
      },
    )
    return () => controller.abort()
  }, [apiBaseUrl, attempt, slug])

  return (
    <MarketplaceShell title={state.status === 'ready' ? state.profile.name : state.status === 'missing' ? 'ไม่พบโปรไฟล์ผู้รับผลิต' : 'โปรไฟล์ผู้รับผลิต'} publicPage>
      {state.status === 'loading' && <p role="status">กำลังโหลดโปรไฟล์…</p>}
      {state.status === 'missing' && <p>โปรไฟล์นี้อาจยังไม่ได้เผยแพร่หรือใช้ลิงก์ใหม่แล้ว</p>}
      {state.status === 'error' && <MarketplaceError message="โหลดโปรไฟล์ไม่สำเร็จ" retry={() => { setState({ status: 'loading' }); setAttempt((value) => value + 1) }} />}
      {state.status === 'ready' && (
        <article className="marketplace-card studio-public-profile">
          <div className="studio-public-banner"><span className="studio-company-avatar" aria-hidden="true">{state.profile.name.slice(0, 1)}</span><div><p className="studio-eyebrow">SUPPLIER PROFILE</p><h2>{state.profile.name}</h2></div></div>
          <p className="marketplace-meta"><span className="marketplace-badge">{supplierKindNames[state.profile.kind]}</span></p>
          {state.profile.description && <p className="marketplace-description">{state.profile.description}</p>}
          <div className="studio-form-section-label"><h2>ความสามารถในการผลิต</h2><p>ประเภทงานที่ผู้รับผลิตรายนี้รองรับ</p></div>
          <CapabilityList capabilities={state.profile.capabilities} />
        </article>
      )}
    </MarketplaceShell>
  )
}
