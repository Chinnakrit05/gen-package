import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import type { SupplierAccess, SupplierProfileInput } from '../../../shared/contracts/marketplace'
import { useCloudSession } from '../../app/cloudSession'
import { ApiClientError } from '../../services/api/client'
import { getSupplier, marketplaceContextKey, submitSupplier, updateSupplier } from '../../services/api/marketplace'
import { CapabilityList, MarketplaceError, MarketplaceShell } from './MarketplaceShell'
import { SupplierForm } from './SupplierForm'
import { SUPPLIER_ID, supplierError, supplierInput, supplierKindNames, supplierRoleNames, supplierStatusNames } from './supplierUi'

export function SupplierProfilePage() {
  const { supplierId } = useParams()
  if (!supplierId || !SUPPLIER_ID.test(supplierId)) {
    return <MarketplaceShell title="เปิดโปรไฟล์ผู้รับผลิต"><MarketplaceError message="ลิงก์โปรไฟล์ไม่ถูกต้อง" /></MarketplaceShell>
  }
  return <SupplierProfileRoute key={supplierId} supplierId={supplierId} />
}

function SupplierProfileRoute({ supplierId }: { supplierId: string }) {
  const session = useCloudSession()
  const queryClient = useQueryClient()
  const queryKey = ['cloud', session.appUserId, 'marketplace', 'supplier', supplierId] as const
  const [notice, setNotice] = useState<string | null>(null)
  const supplier = useQuery({
    queryKey,
    queryFn: ({ signal }) => getSupplier(session.apiBaseUrl, session.getAccessToken(), supplierId, signal),
    gcTime: 0,
  })

  const updated = (access: SupplierAccess, message: string) => {
    queryClient.setQueryData(queryKey, access)
    void queryClient.invalidateQueries({ queryKey: marketplaceContextKey(session.appUserId) })
    setNotice(message)
  }

  const unavailable = supplier.error instanceof ApiClientError && [403, 404].includes(supplier.error.status)
  return (
    <MarketplaceShell title={supplier.data?.profile.name ?? 'โปรไฟล์ผู้รับผลิต'}>
      {supplier.isPending && <p role="status">กำลังโหลดโปรไฟล์…</p>}
      {supplier.isError && (
        <MarketplaceError
          message={unavailable ? 'ไม่พบโปรไฟล์หรือบัญชีนี้เปิดไม่ได้' : 'โหลดโปรไฟล์ไม่สำเร็จ'}
          retry={unavailable ? undefined : () => void supplier.refetch()}
        />
      )}
      {supplier.isSuccess && (
        <>
          {notice && <p className="marketplace-notice" role="status">{notice}</p>}
          <SupplierProfilePanel
            key={supplier.data.profile.revision}
            access={supplier.data}
            updated={updated}
            reload={() => void supplier.refetch()}
            refreshing={supplier.isFetching}
          />
        </>
      )}
    </MarketplaceShell>
  )
}

function SupplierProfilePanel({
  access,
  updated,
  reload,
  refreshing,
}: {
  access: SupplierAccess
  updated(access: SupplierAccess, message: string): void
  reload(): void
  refreshing: boolean
}) {
  const { profile, role } = access
  const { apiBaseUrl, getAccessToken } = useCloudSession()
  const [form, setForm] = useState(() => supplierInput(profile))
  const canEdit = role === 'manager' && (profile.status === 'draft' || profile.status === 'approved')
  const changed = JSON.stringify(supplierInput(form)) !== JSON.stringify(supplierInput(profile))
  const write = useMutation({
    mutationFn: (operation: { kind: 'save'; input: SupplierProfileInput } | { kind: 'submit' }) => (
      operation.kind === 'save'
        ? updateSupplier(apiBaseUrl, getAccessToken(), profile.id, { ...operation.input, expectedRevision: profile.revision })
        : submitSupplier(apiBaseUrl, getAccessToken(), profile.id, profile.revision)
    ),
  })
  const busy = write.isPending || refreshing
  const changedRevision = write.error instanceof ApiClientError && write.error.code === 'REVISION_CONFLICT'
  const save = (input: SupplierProfileInput) => write.mutate({ kind: 'save', input }, {
    onSuccess: (next) => updated(next, next.profile.status === 'draft' && profile.status === 'approved'
      ? 'บันทึกเป็นฉบับร่างแล้ว ส่งตรวจอีกครั้งเพื่อเผยแพร่โปรไฟล์'
      : 'บันทึกโปรไฟล์แล้ว'),
  })

  return (
    <>
      <section className="marketplace-card">
        <div className="marketplace-meta">
          <span className={`marketplace-badge is-${profile.status}`}>{supplierStatusNames[profile.status]}</span>
          <span>{supplierKindNames[profile.kind]} · {supplierRoleNames[role]}</span>
          {profile.status === 'approved' && <Link to={`/suppliers/${profile.slug}`}>ดูโปรไฟล์สาธารณะ</Link>}
        </div>
        {profile.reviewNote && (
          <div className="marketplace-notice">
            <strong>ข้อความจากผู้ตรวจ</strong>
            <p>{profile.reviewNote}</p>
          </div>
        )}
        {profile.status === 'pending' && <p>PackIt กำลังตรวจข้อมูล โปรไฟล์จะเผยแพร่เมื่อได้รับอนุมัติ</p>}
        {profile.status === 'suspended' && <p>กิจการถูกพักรับงานและโปรไฟล์สาธารณะถูกซ่อน</p>}
        {!canEdit && (
          <>
            <p className="marketplace-description">{profile.description || 'ยังไม่มีรายละเอียดกิจการ'}</p>
            <p><strong>อีเมลติดต่อ</strong> {profile.contactEmail}</p>
            <CapabilityList capabilities={profile.capabilities} />
          </>
        )}
      </section>
      {canEdit && (
        <section className="marketplace-card">
          <h2>แก้ไขข้อมูลกิจการ</h2>
          {profile.status === 'approved' && (
            <p className="marketplace-notice">หากบันทึกการแก้ไข โปรไฟล์จะกลับเป็นฉบับร่างและซ่อนจากหน้าสาธารณะจนกว่าจะอนุมัติอีกครั้ง</p>
          )}
          {write.isError && <MarketplaceError message={supplierError(write.error, 'ทำรายการไม่สำเร็จ ลองอีกครั้ง')} />}
          {changedRevision && <button type="button" onClick={reload} disabled={busy}>โหลดฉบับล่าสุด</button>}
          <SupplierForm
            value={form}
            onChange={setForm}
            busy={busy || changedRevision}
            saveLabel="บันทึกโปรไฟล์"
            onSave={save}
          />
        </section>
      )}
      {role === 'manager' && profile.status === 'draft' && (
        <section className="marketplace-card">
          <h2>ส่งโปรไฟล์ให้ PackIt ตรวจ</h2>
          <p>{changed
            ? 'บันทึกการแก้ไขก่อนส่งตรวจ'
            : profile.capabilities.length === 0
              ? 'เลือกความสามารถในการผลิตอย่างน้อยหนึ่งรายการและบันทึกก่อนส่งตรวจ'
              : 'ส่งฉบับที่บันทึกไว้ให้ PackIt ตรวจสอบ'}</p>
          <button
            type="button"
            className="primary"
            disabled={busy || changedRevision || changed || profile.capabilities.length === 0}
            onClick={() => write.mutate({ kind: 'submit' }, { onSuccess: (next) => updated(next, 'ส่งโปรไฟล์ตรวจสอบแล้ว') })}
          >
            ส่งตรวจสอบ
          </button>
        </section>
      )}
    </>
  )
}
