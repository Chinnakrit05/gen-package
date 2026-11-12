import { Layers3 } from 'lucide-react'
import type { ReactNode } from 'react'
import type { QuoteRequestDraft } from '../../../shared/contracts/quoteRequests'
import { ApiClientError } from '../../services/api/client'

export const quoteRequestId = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i
export const quoteQuantity = new Intl.NumberFormat('th-TH')
const quoteDate = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' })

export function quoteAccessUnavailable(error: unknown): boolean {
  return error instanceof ApiClientError && [401, 403, 404].includes(error.status)
}

export function formatQuoteDate(value: string): string {
  return quoteDate.format(new Date(value.replace(/(\.\d{3})\d+Z$/, '$1Z')))
}

export function QuoteRequestSpec({ spec, children }: { spec: QuoteRequestDraft['spec']; children?: ReactNode }) {
  return (
    <section className="marketplace-card quote-request-spec-card">
      <div className="quote-request-section-heading"><span className="quote-request-icon"><Layers3 size={21} aria-hidden="true" /></span><h2>สเปกเบื้องต้น</h2></div>
      {children}
      <dl className="quote-request-spec">
        <div><dt>รหัสแบบ</dt><dd>{spec.template}</dd></div>
        <div><dt>รหัสวัสดุ</dt><dd>{spec.materialId}</dd></div>
        <div><dt>กว้าง × ลึก × สูง</dt><dd>{spec.W} × {spec.D} × {spec.H} มม.</dd></div>
        <div><dt>หูหิ้ว</dt><dd>{spec.handle ? 'มี' : 'ไม่มี'}</dd></div>
      </dl>
    </section>
  )
}
