import { SupplierIntro } from './SupplierStudio'
import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import type { SupplierProfileInput } from '../../../shared/contracts/marketplace'
import { useCloudSession } from '../../app/cloudSession'
import { createSupplier, marketplaceContextKey } from '../../services/api/marketplace'
import { QuoteRequestNotifications } from '../notifications/QuoteRequestNotifications'
import { SupplierNotifications } from '../notifications/SupplierNotifications'
import { MarketplaceError, MarketplaceShell } from './MarketplaceShell'
import { SupplierForm } from './SupplierForm'
import { supplierError, supplierRoleNames, supplierStatusNames } from './supplierUi'
import { useMarketplaceContext } from './useMarketplaceContext'

export function SupplierOnboarding() {
  const session = useCloudSession()
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const location = useLocation()
  const queryClient = useQueryClient()
  const context = useMarketplaceContext()
  const [form, setForm] = useState<SupplierProfileInput>({
    kind: 'factory', name: '', slug: '', description: '', contactEmail: '', capabilities: [],
  })
  const attempt = useRef<{ inputKey: string; operationId: string } | null>(null)
  const create = useMutation({
    mutationFn: (input: SupplierProfileInput) => {
      const inputKey = JSON.stringify(input)
      if (attempt.current?.inputKey !== inputKey) {
        attempt.current = { inputKey, operationId: crypto.randomUUID() }
      }
      return createSupplier(session.apiBaseUrl, session.getAccessToken(), { ...input, operationId: attempt.current.operationId })
    },
  })
  return (
    <MarketplaceShell title="พื้นที่ผู้รับผลิต">
      <SupplierIntro eyebrow="SUPPLIER WORKSPACE" title="สร้างโอกาสใหม่ให้กิจการของคุณ" description="จัดการข้อมูลกิจการ ทีมงาน และคำขอราคาในพื้นที่เดียว พร้อมเตรียมโปรไฟล์ให้ผู้ซื้อรู้จักความสามารถของคุณ" />
      {context.isPending && <p role="status">กำลังโหลดกิจการของคุณ…</p>}
      {context.isError && <MarketplaceError message="โหลดกิจการของคุณไม่สำเร็จ" retry={() => void context.refetch()} />}
      {context.isSuccess && (
        <>
          {context.data.staff.canReviewSuppliers && (
            <section className="marketplace-card studio-staff-shortcut">
              <h2>สำหรับเจ้าหน้าที่ PackIt</h2>
              <Link to="/admin/suppliers">ตรวจผู้รับผลิต</Link>
            </section>
          )}
          {context.data.suppliers.length > 0 && (
            <>
              <div id="supplier-notifications" className="studio-notification-stack">
              <SupplierNotifications defaultOpen={search.get('notifications') === 'open' || location.hash === '#supplier-notifications'} />
              {context.data.suppliers.some(({ profile }) => profile.status === 'approved') && <QuoteRequestNotifications />}
              </div>
              <section className="marketplace-card">
                <h2>กิจการของคุณ</h2>
                <ul className="marketplace-list studio-business-list">
                  {context.data.suppliers.map(({ profile, role }) => (
                    <li key={profile.id}>
                      <Link to={`/factory/${profile.id}/profile`}>{profile.name}</Link>
                      <span className="marketplace-muted">{supplierRoleNames[role]}</span>
                      <span className={`marketplace-badge is-${profile.status}`}>{supplierStatusNames[profile.status]}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
          <section className="marketplace-card">
            <div className="studio-section-heading"><span className="studio-step">01</span><div><h2>สมัครเป็นผู้รับผลิต</h2><p className="marketplace-muted">เริ่มต้นด้วยข้อมูลกิจการของคุณ</p></div></div>
            <p>เริ่มจากสร้างฉบับร่างของโรงงานหรือร้านปริ้น แล้วส่งให้ PackIt ตรวจเมื่อกรอกข้อมูลพร้อม</p>
            {create.isError && <MarketplaceError message={supplierError(create.error, 'สร้างโปรไฟล์ไม่สำเร็จ ลองบันทึกอีกครั้ง')} />}
            <SupplierForm
              value={form}
              onChange={setForm}
              busy={create.isPending}
              saveLabel="สร้างฉบับร่าง"
              onSave={(input) => create.mutate(input, {
                onSuccess: ({ profile }) => {
                  void queryClient.invalidateQueries({ queryKey: marketplaceContextKey(session.appUserId) })
                  void navigate(`/factory/${profile.id}/profile`, { replace: true })
                },
              })}
            />
          </section>
        </>
      )}
    </MarketplaceShell>
  )
}
