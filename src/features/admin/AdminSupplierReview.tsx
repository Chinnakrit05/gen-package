import { SupplierIntro } from '../suppliers/SupplierStudio'
import { useRef, useState, type FormEvent } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { SUPPLIER_STATUSES, type SupplierProfile, type SupplierReviewAction, type SupplierStatus } from '../../../shared/contracts/marketplace'
import { useCloudSession } from '../../app/cloudSession'
import { ApiClientError } from '../../services/api/client'
import { listAdminSuppliers, marketplaceContextKey, reviewSupplier } from '../../services/api/marketplace'
import { SupplierNotifications } from '../notifications/SupplierNotifications'
import { CapabilityList, MarketplaceError, MarketplaceShell } from '../suppliers/MarketplaceShell'
import { SupplierReviewDocuments } from '../suppliers/SupplierReviewDocuments'
import { supplierError, supplierKindNames, supplierStatusNames } from '../suppliers/supplierUi'
import { useMarketplaceContext } from '../suppliers/useMarketplaceContext'
import { ReviewerMfa, type ReviewerMfaClient } from './ReviewerMfa'

const availableActions: Record<SupplierStatus, readonly SupplierReviewAction[]> = {
  draft: [],
  pending: ['approve', 'request_changes'],
  approved: ['suspend'],
  suspended: ['resume'],
}

const actionNames: Record<SupplierReviewAction, string> = {
  approve: 'อนุมัติ',
  request_changes: 'ขอให้แก้ไข',
  suspend: 'พักรับงาน',
  resume: 'เปิดรับงานอีกครั้ง',
}

export function AdminSupplierReview({ mfa }: { mfa: ReviewerMfaClient }) {
  const context = useMarketplaceContext()
  const [notice, setNotice] = useState<string | null>(null)
  const staff = context.isSuccess ? context.data.staff : undefined
  return (
    <MarketplaceShell title="ตรวจผู้รับผลิต">
      <SupplierIntro eyebrow="PACKIT OPERATIONS" title="ดูแลคุณภาพผู้รับผลิต" description="ตรวจสอบโปรไฟล์ เอกสารประกอบ และบันทึกผลการพิจารณาอย่างเป็นระบบ" />
      {(context.isPending || context.isFetching) && <p role="status">กำลังตรวจสิทธิ์เจ้าหน้าที่…</p>}
      {context.isError && <MarketplaceError message="ตรวจสิทธิ์เจ้าหน้าที่ไม่สำเร็จ" retry={() => void context.refetch()} />}
      {staff && !context.isFetching && (
        !staff.canReviewSuppliers ? <MarketplaceError message="บัญชีนี้ไม่มีสิทธิ์ตรวจผู้รับผลิต" />
          : staff.requiresMfa ? <ReviewerMfa mfa={mfa} onVerified={() => void context.refetch()} />
            : <AdminQueue notice={notice} setNotice={setNotice} checkAccess={() => void context.refetch()} />
      )}
    </MarketplaceShell>
  )
}

function AdminQueue({
  notice,
  setNotice,
  checkAccess,
}: {
  notice: string | null
  setNotice(message: string | null): void
  checkAccess(): void
}) {
  const session = useCloudSession()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<SupplierStatus>('pending')
  const statusFilter = useRef<HTMLSelectElement>(null)
  const key = ['cloud', session.appUserId, 'marketplace', 'admin-suppliers'] as const
  const page = useInfiniteQuery({
    queryKey: [...key, status],
    queryFn: ({ pageParam, signal }) => listAdminSuppliers(session.apiBaseUrl, session.getAccessToken(), status, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    gcTime: 0,
  })
  const items = [...new Map(page.data?.pages.flatMap((part) => part.items.map((profile) => [profile.id, profile] as const))).values()]
  const refresh = () => void queryClient.resetQueries({ queryKey: key })
  const openPendingQueue = () => {
    setStatus('pending')
    setNotice(null)
    void queryClient.resetQueries({ queryKey: [...key, 'pending'] })
    statusFilter.current?.focus()
  }
  const denied = page.error instanceof ApiClientError && page.error.status === 403
  return (
    <>
      {!denied && <SupplierNotifications asReviewer openPendingQueue={openPendingQueue} />}
      <section className="marketplace-card studio-review-filter" id="supplier-review-queue">
        <div><h2>รายการตรวจสอบ</h2><p className="marketplace-muted">เลือกสถานะเพื่อจัดการโปรไฟล์ผู้รับผลิต</p></div>
        <label>
          สถานะโปรไฟล์
          <select ref={statusFilter} value={status} onChange={(event) => { setStatus(event.target.value as SupplierStatus); setNotice(null) }}>
            {SUPPLIER_STATUSES.map((item) => <option key={item} value={item}>{supplierStatusNames[item]}</option>)}
          </select>
        </label>
        {notice && <p className="marketplace-notice" role="status">{notice}</p>}
      </section>
      {page.isPending && <p role="status">กำลังโหลดรายการตรวจสอบ…</p>}
      {page.isError && (
        <MarketplaceError message={supplierError(page.error, 'โหลดรายการตรวจสอบไม่สำเร็จ')} retry={denied ? checkAccess : refresh} />
      )}
      {page.isSuccess && items.length === 0 && <div className="marketplace-card studio-empty-state"><h2>ไม่มีโปรไฟล์ในสถานะนี้</h2><p className="marketplace-muted">เลือกสถานะอื่นเพื่อตรวจสอบรายการเพิ่มเติม</p></div>}
      {!denied && items.map((profile) => (
        <ReviewCard key={`${profile.id}:${profile.revision}`} profile={profile} reload={refresh} reviewed={(next) => {
          setNotice(`${next.name} · ${supplierStatusNames[next.status]}`)
          refresh()
          void queryClient.invalidateQueries({ queryKey: marketplaceContextKey(session.appUserId), refetchType: 'none' })
        }} />
      ))}
      {page.hasNextPage && !denied && <button type="button" onClick={() => void page.fetchNextPage()} disabled={page.isFetchingNextPage}>
        {page.isFetchingNextPage ? 'กำลังโหลด…' : 'โหลดเพิ่ม'}
      </button>}
    </>
  )
}

function ReviewCard({ profile, reviewed, reload }: {
  profile: SupplierProfile
  reviewed(profile: SupplierProfile): void
  reload(): void
}) {
  const session = useCloudSession()
  const actions = availableActions[profile.status]
  const [action, setAction] = useState<SupplierReviewAction | undefined>(actions[0])
  const [reason, setReason] = useState('')
  const [documentsOpen, setDocumentsOpen] = useState(false)
  const review = useMutation({
    mutationFn: (input: { action: SupplierReviewAction; reason: string }) => reviewSupplier(
      session.apiBaseUrl,
      session.getAccessToken(),
      profile.id,
      { ...input, expectedRevision: profile.revision },
    ),
  })
  const changedRevision = review.error instanceof ApiClientError && review.error.code === 'REVISION_CONFLICT'
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (action && reason.trim() && !review.isPending && !changedRevision) {
      review.mutate({ action, reason: reason.trim() }, { onSuccess: reviewed })
    }
  }

  return (
    <article className="marketplace-card studio-review-card">
      <h2>{profile.name}</h2>
      <div className="marketplace-meta">
        <span className={`marketplace-badge is-${profile.status}`}>{supplierStatusNames[profile.status]}</span>
        <span>{supplierKindNames[profile.kind]}</span>
        {profile.status === 'approved' && <Link to={`/suppliers/${profile.slug}`}>ดูโปรไฟล์สาธารณะ</Link>}
      </div>
      <p className="marketplace-description">{profile.description || 'ยังไม่มีรายละเอียดกิจการ'}</p>
      <p><strong>อีเมลติดต่อ</strong> {profile.contactEmail}</p>
      <p className="marketplace-muted"><strong>ชื่อในลิงก์</strong> {profile.slug}</p>
      <CapabilityList capabilities={profile.capabilities} />
      {profile.reviewNote && <p className="marketplace-notice"><strong>ข้อความจากผู้ตรวจ</strong> {profile.reviewNote}</p>}
      {profile.status === 'pending' && (
        <div className="marketplace-documents">
          <button type="button" aria-expanded={documentsOpen} onClick={() => setDocumentsOpen((open) => !open)}>
            {documentsOpen ? 'ซ่อนเอกสารประกอบ' : 'ดูเอกสารประกอบ'}
          </button>
          {documentsOpen && <SupplierReviewDocuments supplierId={profile.id} asReviewer blocked={review.isPending} />}
        </div>
      )}
      {action && (
        <form className="marketplace-form studio-review-decision" onSubmit={submit}>
          <h3>บันทึกผลการตรวจสอบ</h3>
          <fieldset className="marketplace-form-fields" disabled={review.isPending || changedRevision}>
            <label>
              การตัดสินใจ
              <select value={action} onChange={(event) => setAction(event.target.value as SupplierReviewAction)}>
                {actions.map((item) => <option key={item} value={item}>{actionNames[item]}</option>)}
              </select>
            </label>
            <label>
              เหตุผล
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} rows={2} required />
            </label>
          </fieldset>
          {review.isError && <MarketplaceError message={supplierError(review.error, 'บันทึกผลตรวจไม่สำเร็จ ลองอีกครั้ง')} />}
          {changedRevision
            ? <button type="button" onClick={reload}>โหลดฉบับล่าสุด</button>
            : <button type="submit" className="primary" disabled={review.isPending || !reason.trim()}>
              {review.isPending ? 'กำลังบันทึก…' : 'บันทึกผลตรวจ'}
            </button>}
        </form>
      )}
    </article>
  )
}
