import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import type { QuoteRequestCursor } from '../../../shared/contracts/quoteRequests'
import { useCloudSession } from '../../app/cloudSession'
import { getSupplierQuoteRequest, listSupplierQuoteRequests } from '../../services/api/quoteRequests'
import { MarketplaceError, MarketplaceShell } from '../suppliers/MarketplaceShell'
import { QuoteRequestSpec, formatQuoteDate, quoteAccessUnavailable, quoteQuantity, quoteRequestId } from './QuoteRequestFacts'
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
      <div><Link to={`/factory/${supplierId}/profile`}>กลับไปที่โปรไฟล์ผู้รับผลิต</Link></div>
      <section className="marketplace-card">
        {!denied && <button type="button" disabled={list.isFetching} onClick={() => {
          if (after) setCursors([])
          else void list.refetch()
        }}>โหลดรายการล่าสุด</button>}
        {(list.isPending || list.isFetching) && <p role="status">กำลังโหลดคำขอราคา…</p>}
        {list.isError && <MarketplaceError
          message={denied ? 'บัญชีนี้เปิดรายการคำขอราคาของกิจการไม่ได้' : 'โหลดคำขอราคาไม่สำเร็จ'}
          retry={denied ? undefined : () => void list.refetch()}
        />}
        {data && (data.items.length === 0 ? <p className="marketplace-muted">ยังไม่มีคำขอราคาในหน้านี้</p> : (
          <ul className="marketplace-list">
            {data.items.map((item) => (
              <li className="quote-request-row" key={item.id}>
                <div className="marketplace-description">
                  <Link to={`/factory/${supplierId}/jobs/${item.id}`}>{item.title}</Link>
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
      <div><Link to={`/factory/${supplierId}/jobs`}>กลับไปที่คำขอราคาที่ได้รับ</Link></div>
      {(detail.isPending || detail.isFetching) && <p role="status">กำลังโหลดคำขอราคา…</p>}
      {detail.isError && <MarketplaceError
        message={denied ? 'ไม่พบคำขอราคาหรือบัญชีนี้เปิดไม่ได้' : 'โหลดคำขอราคาไม่สำเร็จ'}
        retry={denied ? undefined : () => void detail.refetch()}
      />}
      {item && (
        <>
          <section className="marketplace-card">
            <h2>{item.title}</h2>
            <p>จำนวนที่ต้องการผลิต {quoteQuantity.format(item.quantity)} ชิ้น</p>
            {item.notes && <p className="marketplace-description">{item.notes}</p>}
            <time className="marketplace-muted" dateTime={item.publishedAt}>ส่งเมื่อ {formatQuoteDate(item.publishedAt)}</time>
          </section>
          <QuoteRequestSpec spec={item.spec} />
        </>
      )}
    </>
  )
}
