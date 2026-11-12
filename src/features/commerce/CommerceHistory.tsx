import type { RequestSpecRevision } from '../../../shared/contracts/commerce'
import { RequestPreview } from './RequestPreview'
import { useState } from 'react'
import { useCloudSession } from '../../app/cloudSession'
import { getQuotationHistory, getRequestHistory } from '../../services/api/commerce'
import { formatQuoteDate, QuoteRequestSpec } from '../requests/QuoteRequestFacts'
import { QueryState, useCommerceQuery } from './commerceUi'
import { QuotationTermsView } from './QuotationPages'

export function QuotationHistory({ quotationId, supplierId }: { quotationId: string; supplierId?: string }) {
  const [open, setOpen] = useState(false)
  return <section className="commerce-stack"><button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'ปิดประวัติราคา' : 'ดูราคาทุกฉบับที่ส่งแล้ว'}</button>{open && <QuoteHistoryContent quotationId={quotationId} supplierId={supplierId} />}</section>
}
function QuoteHistoryContent({ quotationId, supplierId }: { quotationId: string; supplierId?: string }) {
  const session = useCloudSession(), [cursors, setCursors] = useState<number[]>([])
  const query = useCommerceQuery(['quote-history', quotationId, supplierId, cursors.at(-1)], signal => getQuotationHistory(session.apiBaseUrl, session.getAccessToken(), quotationId, supplierId, cursors.at(-1) ?? null, signal))
  return <><QueryState query={query} />{query.isSuccess && <>{query.data.items.map(revision => <details key={revision.id}><summary>ราคาฉบับที่ {revision.revision} · {formatQuoteDate(revision.sentAt)}</summary><QuotationTermsView terms={revision} /><p className="commerce-stamp">รหัสฉบับราคา {revision.id}</p></details>)}<NumberPager cursors={cursors} next={query.data.nextCursor} setCursors={setCursors} /></>}</>
}
export function RequestRevisionHistory({ requestId, supplierId }: { requestId: string; supplierId?: string }) {
  const session = useCloudSession(), [cursors, setCursors] = useState<number[]>([])
  const query = useCommerceQuery(['request-history', requestId, supplierId, cursors.at(-1)], signal => getRequestHistory(session.apiBaseUrl, session.getAccessToken(), requestId, supplierId, cursors.at(-1) ?? null, signal))
  return <><QueryState query={query} />{query.isSuccess && <>{query.data.items.map(revision => <SpecHistoryEntry key={revision.id} revision={revision} requestId={requestId} supplierId={supplierId} />)}<NumberPager cursors={cursors} next={query.data.nextCursor} setCursors={setCursors} /></>}</>
}
function NumberPager({ cursors, next, setCursors }: { cursors: number[]; next: number | null; setCursors(cursors: number[]): void }) {
  if (!cursors.length && !next) return null
  return <nav className="commerce-actions" aria-label="หน้าประวัติ"><button disabled={!cursors.length} onClick={() => setCursors(cursors.slice(0, -1))}>ใหม่กว่า</button><button disabled={!next} onClick={() => { if (next) setCursors([...cursors, next]) }}>เก่ากว่า</button></nav>
}

function SpecHistoryEntry({ revision, requestId, supplierId }: { revision: RequestSpecRevision; requestId: string; supplierId?: string }) {
  const [open, setOpen] = useState(false)
  return <details onToggle={event => setOpen(event.currentTarget.open)}><summary>ฉบับที่ {revision.revision} · {revision.title} · {formatQuoteDate(revision.createdAt)}</summary><p>{revision.quantity.toLocaleString('th-TH')} ชิ้น · {revision.notes}</p><QuoteRequestSpec spec={revision.spec} />{open && <RequestPreview target={{ requestId, revisionId: revision.id, supplierId }} />}<p className="commerce-stamp">{revision.id}</p></details>
}
