import { useEffect, useRef, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCloudSession } from '../../app/cloudSession'
import { ApiClientError } from '../../services/api/client'
import { MarketplaceError } from '../suppliers/MarketplaceShell'
import './commerce.css'

export const money = (minor: number) => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(minor / 100)
export function parseMoney(value: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return null
  const [whole, fraction = ''] = value.trim().split('.')
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(minor) ? minor : null
}
export const deniedCommerce = (error: unknown) => error instanceof ApiClientError && [401, 403, 404].includes(error.status)
export function commerceError(error: unknown): string {
  if (deniedCommerce(error)) return 'ไม่พบรายการหรือสิทธิ์ของคุณเปลี่ยนไป กรุณาตรวจสอบบัญชีและพื้นที่งาน'
  if (error instanceof ApiClientError && error.status === 409) return 'ข้อมูลมีการเปลี่ยนแปลงแล้ว โหลดฉบับล่าสุดก่อนตรวจสอบและยืนยันอีกครั้ง'
  return error instanceof Error ? error.message : 'ดำเนินการไม่สำเร็จ กรุณาลองใหม่'
}
export function createOperationTracker() {
  let attempt: { key: string; id: string } | null = null
  const get = (input: unknown) => {
    const key = JSON.stringify(input)
    if (attempt?.key !== key) attempt = { key, id: crypto.randomUUID() }
    return attempt.id
  }
  return Object.assign(get, { reset: () => { attempt = null } })
}
export function useOperationId() {
  const tracker = useRef<ReturnType<typeof createOperationTracker> | null>(null)
  if (!tracker.current) tracker.current = createOperationTracker()
  return tracker.current
}
export function useCommerceQuery<T>(scope: readonly unknown[], read: (signal: AbortSignal) => Promise<T>, enabled = true) {
  const session = useCloudSession()
  const client = useQueryClient()
  const key = ['cloud', session.appUserId, session.workspaceId, 'commerce', ...scope]
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => read(signal), enabled, retry: false, gcTime: 0, refetchOnWindowFocus: true })
  useEffect(() => {
    if (deniedCommerce(query.error)) {
      client.removeQueries({ queryKey: ['cloud', session.appUserId, session.workspaceId, 'commerce'], type: 'inactive' })
    }
  }, [query.error, client, session.appUserId, session.workspaceId])
  return query
}
export function QueryState({ query }: { query: { isPending: boolean; isFetching: boolean; isError: boolean; error: unknown; refetch(): unknown } }) {
  return <>{(query.isPending || query.isFetching) && <p role="status">กำลังโหลดข้อมูลล่าสุด…</p>}{query.isError && <MarketplaceError message={commerceError(query.error)} retry={deniedCommerce(query.error) ? undefined : () => void query.refetch()} />}</>
}
export function ConfirmAction({ title, children, busy, onCancel, onConfirm, label = 'ยืนยัน' }: { title: string; children: ReactNode; busy: boolean; onCancel(): void; onConfirm(): void; label?: string }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])
  return <section className="commerce-confirm" role="region" aria-label={title}><h3 ref={heading} tabIndex={-1}>{title}</h3>{children}<div className="commerce-actions"><button type="button" disabled={busy} onClick={onCancel}>กลับไปตรวจสอบ</button><button type="button" className="commerce-primary" disabled={busy} onClick={onConfirm}>{busy ? 'กำลังดำเนินการ…' : label}</button></div></section>
}
export function CursorPager({ cursors, next, setCursors }: { cursors: string[]; next: string | null; setCursors(value: string[]): void }) {
  if (!cursors.length && !next) return null
  return <nav className="commerce-actions" aria-label="หน้ารายการ"><button disabled={!cursors.length} onClick={() => setCursors(cursors.slice(0, -1))}>ก่อนหน้า</button><button disabled={!next} onClick={() => { if (next) setCursors([...cursors, next]) }}>ถัดไป</button></nav>
}
