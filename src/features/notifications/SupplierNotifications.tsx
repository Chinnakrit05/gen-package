import '../suppliers/studio-suppliers.css'
import { useEffect, useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import type {
  SupplierNotificationAction,
  SupplierNotificationCursor,
  SupplierNotificationPage,
} from '../../../shared/contracts/marketplace'
import { useCloudSession } from '../../app/cloudSession'
import { ApiClientError } from '../../services/api/client'
import { listSupplierNotifications, markSupplierNotificationRead } from '../../services/api/marketplace'
import { MarketplaceError } from '../suppliers/MarketplaceShell'

const actionLabels: Record<SupplierNotificationAction, string> = {
  submitted: 'มีโปรไฟล์ผู้รับผลิตรอตรวจสอบ',
  approve: 'โปรไฟล์ได้รับอนุมัติ',
  request_changes: 'เจ้าหน้าที่ขอให้แก้ไขโปรไฟล์',
  suspend: 'โปรไฟล์ถูกพักรับงาน',
  resume: 'โปรไฟล์กลับมาเปิดรับงาน',
}
const notificationTime = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' })

function formatTime(createdAt: string): string {
  // Keep the server's full precision for paging while using millisecond ISO dates for display.
  return notificationTime.format(new Date(createdAt.replace(/(\.\d{3})\d+Z$/, '$1Z')))
}

type NotificationScope = { asReviewer?: false; openPendingQueue?: never } | {
  asReviewer: true
  openPendingQueue(): void
}

function unavailable(error: unknown): boolean {
  return error instanceof ApiClientError && [401, 403, 404].includes(error.status)
}

export function SupplierNotifications({ defaultOpen = false, ...scope }: NotificationScope & { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  useEffect(() => { if (defaultOpen) setOpen(true) }, [defaultOpen])
  const listId = useId()
  return (
    <section className="marketplace-card studio-notification-card">
      <div className="marketplace-meta studio-section-toolbar">
        <h2>การแจ้งเตือน</h2>
        <button type="button" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((previous) => !previous)}>
          {open ? 'ซ่อนการแจ้งเตือน' : 'ดูการแจ้งเตือน'}
        </button>
      </div>
      <div id={listId} hidden={!open}>
        {open && <NotificationList {...scope} />}
      </div>
    </section>
  )
}

function NotificationList(scope: NotificationScope) {
  const session = useCloudSession()
  const queryClient = useQueryClient()
  const [cursors, setCursors] = useState<SupplierNotificationCursor[]>([])
  const cursor = cursors.at(-1) ?? null
  const asReviewer = scope.asReviewer === true
  const key = ['cloud', session.appUserId, 'marketplace', 'supplier-notifications', asReviewer ? 'reviewer' : 'supplier', cursor] as const
  const list = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => listSupplierNotifications(session.apiBaseUrl, session.getAccessToken(), asReviewer, cursor, signal),
    gcTime: 0,
  })
  const read = useMutation({
    mutationFn: (id: string) => markSupplierNotificationRead(session.apiBaseUrl, session.getAccessToken(), asReviewer, id),
    onSuccess: ({ id, readAt }) => queryClient.setQueryData<SupplierNotificationPage>(key, (current) => current && ({
      ...current,
      items: current.items.map((item) => item.id === id ? { ...item, readAt } : item),
    })),
  })
  const reload = () => {
    read.reset()
    if (cursor) setCursors([])
    else void list.refetch()
  }
  const data = list.isSuccess && !list.isFetching && !unavailable(read.error) ? list.data : undefined
  const next = data?.nextCursor

  return (
    <div className="marketplace-notifications">
      <button type="button" disabled={list.isFetching || read.isPending} onClick={reload}>โหลดการแจ้งเตือนล่าสุด</button>
      {(list.isPending || list.isFetching) && <p role="status">กำลังโหลดการแจ้งเตือน…</p>}
      {list.isError && (
        <MarketplaceError
          message={unavailable(list.error) ? 'บัญชีนี้เปิดการแจ้งเตือนไม่ได้' : 'โหลดการแจ้งเตือนไม่สำเร็จ'}
          retry={unavailable(list.error) ? undefined : () => void list.refetch()}
        />
      )}
      {read.isError && (
        <MarketplaceError message={unavailable(read.error)
          ? 'เปิดการแจ้งเตือนนี้ไม่ได้ ลองโหลดรายการล่าสุด'
          : 'ทำเครื่องหมายว่าอ่านแล้วไม่สำเร็จ'} />
      )}
      {data && (data.items.length === 0 ? <p className="marketplace-muted">ยังไม่มีการแจ้งเตือนในหน้านี้</p> : (
        <ul className="marketplace-list">
          {data.items.map((item) => (
            <li className={`marketplace-notification-row ${item.readAt ? 'is-read' : 'is-unread'}`} key={item.id}>
              <div className="marketplace-description">
                <strong>{actionLabels[item.action]}</strong>
                <p>{item.supplierName}</p>
                <time className="marketplace-muted" dateTime={item.createdAt}>{formatTime(item.createdAt)}</time>
              </div>
              <div className="marketplace-meta">
                {item.readAt
                  ? <small>อ่านแล้ว</small>
                  : <span className="marketplace-badge">ยังไม่ได้อ่าน</span>}
                {scope.asReviewer
                  ? <a href="#supplier-review-queue" onClick={scope.openPendingQueue}>เปิดคิวรอตรวจ</a>
                  : <Link to={`/factory/${item.supplierId}/profile`}>เปิดโปรไฟล์</Link>}
                {!item.readAt && (
                  <button type="button" disabled={read.isPending} onClick={() => read.mutate(item.id)}>ทำเครื่องหมายว่าอ่านแล้ว</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ))}
      {data && (cursor || next) && (
        <div className="marketplace-meta" role="group" aria-label="หน้าการแจ้งเตือน">
          <button type="button" disabled={!cursor || read.isPending} onClick={() => {
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
  )
}
