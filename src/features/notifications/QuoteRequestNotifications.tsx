import '../suppliers/studio-suppliers.css'
import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import type {
  QuoteRequestNotification,
  QuoteRequestNotificationCursor,
  QuoteRequestNotificationPage,
} from '../../../shared/contracts/quoteRequests'
import { useCloudSession } from '../../app/cloudSession'
import { listQuoteRequestNotifications, markQuoteRequestNotificationRead } from '../../services/api/quoteRequests'
import { formatQuoteDate, quoteAccessUnavailable } from '../requests/QuoteRequestFacts'
import { MarketplaceError } from '../suppliers/MarketplaceShell'

const REFRESH_INTERVAL = 45_000

export function QuoteRequestNotifications() {
  const session = useCloudSession()
  const queryClient = useQueryClient()
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [cursors, setCursors] = useState<QuoteRequestNotificationCursor[]>([])
  const after = cursors.at(-1) ?? null
  const key = ['cloud', session.appUserId, 'marketplace', 'quote-request-notifications'] as const
  const list = useQuery({
    queryKey: [...key, after],
    queryFn: ({ signal }) => listQuoteRequestNotifications(session.apiBaseUrl, session.getAccessToken(), after, signal),
    gcTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => quoteAccessUnavailable(query.state.error) ? false : REFRESH_INTERVAL,
    refetchIntervalInBackground: false,
  })
  const read = useMutation({
    gcTime: 0,
    mutationFn: ({ supplierId, requestId }: Pick<QuoteRequestNotification, 'supplierId' | 'requestId'>) =>
      markQuoteRequestNotificationRead(session.apiBaseUrl, session.getAccessToken(), supplierId, requestId),
    onSuccess: async ({ supplierId, requestId, readAt }) => {
      await queryClient.cancelQueries({ queryKey: key })
      queryClient.setQueriesData<QuoteRequestNotificationPage>({ queryKey: key }, (data) => data && ({
        ...data,
        items: data.items.map((item) => item.supplierId === supplierId && item.requestId === requestId ? { ...item, readAt } : item),
      }))
      // A different page or shop may still have an unread alert.
      await queryClient.invalidateQueries({ queryKey: key })
    },
  })
  const denied = quoteAccessUnavailable(list.error) || quoteAccessUnavailable(read.error)
  const data = !denied && list.isSuccess ? list.data : undefined
  const next = data?.nextCursor
  const unread = !read.isPending && data?.hasUnread
  const refresh = () => {
    read.reset()
    if (after) setCursors([])
    else void list.refetch()
  }
  const toggle = () => {
    if (open) setCursors([])
    setOpen(!open)
  }

  return (
    <section className="marketplace-card studio-notification-card">
      <div className="marketplace-meta studio-section-toolbar">
        <h2>แจ้งเตือนคำขอราคา</h2>
        {unread && <span className="marketplace-badge" role="status">มีรายการยังไม่ได้อ่าน</span>}
        <button type="button" aria-expanded={open} aria-controls={listId} disabled={read.isPending} onClick={toggle}>
          {open ? 'ซ่อนแจ้งเตือนคำขอราคา' : 'ดูแจ้งเตือนคำขอราคา'}
        </button>
      </div>
      <div id={listId} hidden={!open}>
        {open && (
          <div className="marketplace-notifications">
            <button type="button" disabled={list.isFetching || read.isPending} onClick={refresh}>
              โหลดแจ้งเตือนคำขอราคาล่าสุด
            </button>
            {list.isPending && <p role="status">กำลังโหลดแจ้งเตือนคำขอราคา…</p>}
            {denied && <MarketplaceError message="บัญชีนี้เปิดรายการแจ้งเตือนคำขอราคาไม่ได้ ลองโหลดรายการล่าสุด" />}
            {!denied && list.isError && <MarketplaceError message="โหลดแจ้งเตือนคำขอราคาไม่สำเร็จ" retry={() => void list.refetch()} />}
            {!denied && read.isError && <MarketplaceError message="ทำเครื่องหมายว่าอ่านแล้วไม่สำเร็จ" />}
            {data && (data.items.length === 0 ? <p className="marketplace-muted">ยังไม่มีแจ้งเตือนคำขอราคาในหน้านี้</p> : (
              <ul className="marketplace-list">
                {data.items.map((item) => (
                  <li className={`marketplace-notification-row ${item.readAt ? 'is-read' : 'is-unread'}`} key={`${item.supplierId}:${item.requestId}`}>
                    <div className="marketplace-description">
                      <strong>{item.requestTitle}</strong>
                      <p>{item.supplierName}</p>
                      <time className="marketplace-muted" dateTime={item.createdAt}>{formatQuoteDate(item.createdAt)}</time>
                    </div>
                    <div className="marketplace-meta">
                      {item.readAt ? <small>อ่านแล้ว</small> : <span className="marketplace-badge">ยังไม่ได้อ่าน</span>}
                      <Link to={`/factory/${item.supplierId}/jobs/${item.requestId}`}>เปิดคำขอราคา</Link>
                      {!item.readAt && (
                        <button type="button" disabled={read.isPending} onClick={() => read.mutate({ supplierId: item.supplierId, requestId: item.requestId })}>ทำเครื่องหมายว่าอ่านแล้ว</button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ))}
            {data && (after || next) && (
              <div className="marketplace-meta" role="group" aria-label="หน้าแจ้งเตือนคำขอราคา">
                <button type="button" disabled={!after || read.isPending} onClick={() => {
                  read.reset()
                  setCursors((previous) => previous.slice(0, -1))
                }}>ใหม่กว่า</button>
                <button type="button" disabled={!next || read.isPending} onClick={() => {
                  if (!next) return
                  read.reset()
                  setCursors((previous) => [...previous, next])
                }}>เก่ากว่า</button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
