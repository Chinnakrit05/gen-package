import { ArrowLeft, ArrowUpRight, Inbox, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import type { QuoteRequestCursor } from '../../../shared/contracts/quoteRequests'
import { useCloudSession } from '../../app/cloudSession'
import { getSupplierQuoteRequest, listSupplierQuoteRequests } from '../../services/api/quoteRequests'
import { MarketplaceError, MarketplaceShell } from '../suppliers/MarketplaceShell'
import { QuoteRequestSpec, formatQuoteDate, quoteAccessUnavailable, quoteQuantity, quoteRequestId } from './QuoteRequestFacts'
import { RequestPreview } from '../commerce/RequestPreview'
import './quoteRequests.css'

export function SupplierQuoteRequestsPage() {
  const { supplierId } = useParams()
  return (
    <MarketplaceShell title="คำขอราคาที่ได้รับ">
      {supplierId && quoteRequestId.test(supplierId) ? <SupplierQuoteList key={supplierId} supplierId={supplierId} /> : (
        <MarketplaceError message="ลิงก์พื้นที่ผู้รับผลิตไม่ถูกต้อง" />
      )}
    </MarketplaceShell>
  )
}

function SupplierQuoteList({ supplierId }: { supplierId: string }) {
  const session = useCloudSession()
  const [cursors, setCursors] = useState<QuoteRequestCursor[]>([])
  const after = cursors.at(-1) ?? null
  const list = useQuery({
    queryKey: ['cloud', session.appUserId, 'supplier-quote-requests', supplierId, after],
    queryFn: ({ signal }) => listSupplierQuoteRequests(session.apiBaseUrl, session.getAccessToken(), supplierId, after, signal),
    gcTime: 0,
    refetchOnWindowFocus: true,
  })
  const data = list.isSuccess && !list.isFetching ? list.data : undefined
  const next = data?.nextCursor
  const denied = quoteAccessUnavailable(list.error)
  return (
    <>
      <div><Link className="quote-request-back" to={`/factory/${supplierId}/profile`}><ArrowLeft size={16} aria-hidden="true" />กลับไปที่โปรไฟล์ผู้รับผลิต</Link></div>
      <section className="marketplace-card quote-request-list-card">
        <div className="quote-request-section-heading"><span className="quote-request-icon"><Inbox size={22} aria-hidden="true" /></span><div><h2>งานที่ส่งถึงกิจการของคุณ</h2><p className="marketplace-muted">ตรวจรายละเอียดและสเปกจากผู้ซื้อได้ที่นี่</p></div></div>
        {!denied && <button type="button" disabled={list.isFetching} onClick={() => {
          if (after) setCursors([])
          else void list.refetch()
        }}><RefreshCw size={15} aria-hidden="true" />โหลดรายการล่าสุด</button>}
        {(list.isPending || list.isFetching) && <p role="status">กำลังโหลดคำขอราคา…</p>}
        {list.isError && <MarketplaceError
          message={denied ? 'บัญชีนี้เปิดรายการคำขอราคาของกิจการไม่ได้' : 'โหลดคำขอราคาไม่สำเร็จ'}
          retry={denied ? undefined : () => void list.refetch()}
        />}
        {data && (data.items.length === 0 ? <div className="quote-request-empty"><Inbox size={30} aria-hidden="true" /><h3>ยังไม่มีคำขอราคาในหน้านี้</h3><p>คำขอที่ผู้ซื้อส่งถึงกิจการจะปรากฏในรายการนี้</p></div> : (
          <ul className="marketplace-list">
            {data.items.map((item) => (
              <li className="quote-request-row" key={item.id}>
                <div className="marketplace-description">
                  <Link className="quote-request-title-link" to={`/factory/${supplierId}/jobs/${item.id}`}>{item.title}<ArrowUpRight size={17} aria-hidden="true" /></Link>
                  <p>{quoteQuantity.format(item.quantity)} ชิ้น</p>
                </div>
                <time className="marketplace-muted" dateTime={item.publishedAt}>{formatQuoteDate(item.publishedAt)}</time>
              </li>
            ))}
          </ul>
        ))}
        {data && (after || next) && (
          <div className="marketplace-meta" role="group" aria-label="หน้าคำขอราคาที่ได้รับ">
            <button type="button" disabled={!after} onClick={() => setCursors((previous) => previous.slice(0, -1))}>ใหม่กว่า</button>
            <button type="button" disabled={!next} onClick={() => {
              if (next) setCursors((previous) => [...previous, next])
            }}>เก่ากว่า</button>
          </div>
        )}
      </section>
    </>
  )
}

export function SupplierQuoteRequestDetailPage() {
  const { supplierId, requestId } = useParams()
  return (
    <MarketplaceShell title="คำขอราคาที่ได้รับ">
      {supplierId && requestId && quoteRequestId.test(supplierId) && quoteRequestId.test(requestId)
        ? <SupplierQuoteDetail key={`${supplierId}:${requestId}`} supplierId={supplierId} requestId={requestId} />
        : <MarketplaceError message="ลิงก์คำขอราคาไม่ถูกต้อง" />}
    </MarketplaceShell>
  )
}

function SupplierQuoteDetail({ supplierId, requestId }: { supplierId: string; requestId: string }) {
  const session = useCloudSession()
  const detail = useQuery({
    queryKey: ['cloud', session.appUserId, 'supplier-quote-request', supplierId, requestId],
    queryFn: ({ signal }) => getSupplierQuoteRequest(session.apiBaseUrl, session.getAccessToken(), supplierId, requestId, signal),
    gcTime: 0,
    refetchOnWindowFocus: true,
  })
  const item = detail.isSuccess && !detail.isFetching ? detail.data : undefined
  const denied = quoteAccessUnavailable(detail.error)
  return (
    <>
      <div><Link className="quote-request-back" to={`/factory/${supplierId}/jobs`}><ArrowLeft size={16} aria-hidden="true" />กลับไปที่คำขอราคาที่ได้รับ</Link></div>
      {(detail.isPending || detail.isFetching) && <p role="status">กำลังโหลดคำขอราคา…</p>}
      {detail.isError && <MarketplaceError
        message={denied ? 'ไม่พบคำขอราคาหรือบัญชีนี้เปิดไม่ได้' : 'โหลดคำขอราคาไม่สำเร็จ'}
        retry={denied ? undefined : () => void detail.refetch()}
      />}
      {item && (
        <div className="quote-request-detail-grid">
          <section className="marketplace-card quote-request-summary">
            <span className="quote-request-eyebrow">รายละเอียดจากผู้ซื้อ</span>
            <h2>{item.title}</h2><Link to={`/factory/${supplierId}/jobs/${requestId}/revisions`}>ดูประวัติฉบับสเปก</Link><Link className="quote-request-primary-link" to={`/factory/${supplierId}/jobs/${requestId}/quote`}>จัดทำหรือดูใบเสนอราคา</Link><Link to={`/chat?requestId=${requestId}&supplierId=${supplierId}`}>สนทนากับผู้ซื้อ</Link>
            <div className="quote-request-quantity"><span>จำนวนที่ต้องการผลิต</span><strong>{quoteQuantity.format(item.quantity)} <small>ชิ้น</small></strong></div>
            {item.notes && <p className="marketplace-description">{item.notes}</p>}
            <time className="marketplace-muted" dateTime={item.publishedAt}>ส่งเมื่อ {formatQuoteDate(item.publishedAt)}</time>
          </section>
          <QuoteRequestSpec spec={item.spec} /><RequestPreview target={{ requestId, revisionId: item.revisionId, supplierId }} />
        </div>
      )}
    </>
  )
}
