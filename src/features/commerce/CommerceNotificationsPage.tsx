import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link } from 'react-router'
import type { CommerceNotification } from '../../../shared/contracts/commerce'
import { useCloudSession } from '../../app/cloudSession'
import { listCommerceNotifications, readCommerceNotification } from '../../services/api/commerce'
import { MarketplaceError, MarketplaceShell } from '../suppliers/MarketplaceShell'
import { useMarketplaceContext } from '../suppliers/useMarketplaceContext'
import { formatQuoteDate } from '../requests/QuoteRequestFacts'
import { commerceError, CursorPager, deniedCommerce, QueryState, useCommerceQuery } from './commerceUi'
const eventNames: Record<string, string> = { quotation_send: 'ได้รับใบเสนอราคาฉบับใหม่', quotation_withdraw: 'ถอนใบเสนอราคา', request_revised: 'เผยแพร่สเปกฉบับใหม่', request_awarded: 'คำขอนี้ยืนยันกับผู้รับผลิตแล้ว', order_selected: 'เลือกข้อเสนอแล้ว รอผู้รับผลิตยืนยัน', order_confirm: 'ผู้รับผลิตยืนยันรับงาน', order_decline: 'ผู้รับผลิตปฏิเสธงาน', order_cancel: 'ยกเลิกรายการรอยืนยัน', order_expired: 'หมดเวลายืนยัน', order_proof: 'ส่งแบบตรวจฉบับใหม่', 'order_approve-proof': 'อนุมัติแบบตรวจแล้ว', order_payment: 'ผู้ซื้อแจ้งโอนเงิน', 'order_confirm-payment': 'ผู้รับผลิตรับรองเงินแล้ว', 'order_start-production': 'เริ่มผลิตแล้ว', order_ship: 'จัดส่งแล้ว', order_complete: 'งานเสร็จสมบูรณ์' }
export function commerceNotificationTarget(item: CommerceNotification, supplierIds: string[]): string {
  // A losing supplier's request_awarded notice is never a link to another shop's order.
  if (item.kind.startsWith('order_')) return `/orders/${item.entityId}`
  return supplierIds.includes(item.supplierId) ? `/factory/${item.supplierId}/jobs/${item.requestId}` : `/app/requests/${item.requestId}`
}
export function CommerceNotificationsPage() {
  const session = useCloudSession()
  return <MarketplaceShell title="การแจ้งเตือน Marketplace"><Notifications key={`${session.appUserId}:${session.workspaceId}`} /></MarketplaceShell>
}
function Notifications() {
  const session = useCloudSession(), context = useMarketplaceContext(), [cursors, setCursors] = useState<string[]>([]), [revoked, setRevoked] = useState(false)
  const query = useCommerceQuery(['commerce-notifications', cursors.at(-1)], signal => listCommerceNotifications(session.apiBaseUrl, session.getAccessToken(), cursors.at(-1) ?? null, signal), !revoked)
  const read = useMutation({ mutationFn: (id: string) => readCommerceNotification(session.apiBaseUrl, session.getAccessToken(), id), onSuccess: () => void query.refetch(), onError: e => { if (deniedCommerce(e)) setRevoked(true) } })
  if (revoked) return <MarketplaceError message="สิทธิ์ของรายการแจ้งเตือนเปลี่ยนไป กรุณาเปิดรายการล่าสุดอีกครั้ง" />
  return <><p className="marketplace-muted">การแจ้งเตือนไม่ได้ให้สิทธิ์เปิดงาน ระบบจะตรวจสิทธิ์อีกครั้งเมื่อเปิดแต่ละรายการ</p><QueryState query={query} /><QueryState query={context} />{read.isError && <MarketplaceError message={commerceError(read.error)} />}{query.isSuccess && context.isSuccess && <><div className="commerce-stack">{query.data.items.map(item => <article key={item.id} className="commerce-card"><span className="commerce-status">{item.readAt ? 'อ่านแล้ว' : 'ยังไม่อ่าน'}</span><h2>{eventNames[item.kind] ?? 'มีการอัปเดตงาน'}</h2><p>{item.requestTitle} · {item.supplierName}</p><time>{formatQuoteDate(item.createdAt)}</time><div className="commerce-actions"><Link to={commerceNotificationTarget(item, context.data.suppliers.map(s => s.profile.id))}>เปิดรายการ</Link>{!item.readAt && <button disabled={read.isPending} onClick={() => read.mutate(item.id)}>ทำเครื่องหมายว่าอ่านแล้ว</button>}</div></article>)}</div>{!query.data.items.length && <section className="commerce-card commerce-empty"><h2>ไม่มีการแจ้งเตือนในหน้านี้</h2></section>}<CursorPager cursors={cursors} next={query.data.nextCursor} setCursors={setCursors} /></>}<button disabled={query.isFetching} onClick={() => void query.refetch()}>โหลดแจ้งเตือนล่าสุด</button></>
}
