import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { FileText, ArrowLeft } from 'lucide-react'
import type { Quotation, QuotationTerms } from '../../../shared/contracts/commerce'
import { useCloudSession } from '../../app/cloudSession'
import { actQuotation, getQuotation, listBuyerQuotations, listSupplierQuotations, saveQuotation } from '../../services/api/commerce'
import { getQuoteRequestPublication, getSupplierQuoteRequest } from '../../services/api/quoteRequests'
import { MarketplaceError, MarketplaceShell } from '../suppliers/MarketplaceShell'
import { SupplierIntro } from '../suppliers/SupplierStudio'
import { useMarketplaceContext } from '../suppliers/useMarketplaceContext'
import { formatQuoteDate, quoteRequestId, QuoteRequestSpec } from '../requests/QuoteRequestFacts'
import { QuotationHistory } from './CommerceHistory'
import { commerceError, ConfirmAction, CursorPager, deniedCommerce, money, parseMoney, QueryState, useCommerceQuery, useOperationId } from './commerceUi'

export const quotationStatus = { draft: 'ฉบับร่าง', sent: 'ส่งแล้ว', withdrawn: 'ถอนข้อเสนอแล้ว' }
export function QuotationTermsView({ terms }: { terms: QuotationTerms }) {
  return <><div className="commerce-money">{money(terms.totalMinor)}</div><dl className="commerce-facts"><div><dt>มัดจำ</dt><dd>{money(terms.depositMinor)}</dd></div><div><dt>ระยะเวลาผลิต</dt><dd>{terms.leadDays} วัน</dd></div><div><dt>ใช้ได้ถึง</dt><dd>{formatQuoteDate(terms.validUntil)}</dd></div><div><dt>แบบตรวจก่อนผลิต</dt><dd>{terms.requiresProof ? 'ต้องอนุมัติแบบก่อนผลิต' : 'ไม่ต้องอนุมัติแบบ'}</dd></div>{terms.notes && <div><dt>เงื่อนไขและรายละเอียด</dt><dd>{terms.notes}</dd></div>}</dl><p className="commerce-stamp">อ้างอิงฉบับสเปก {terms.requestRevisionId}</p></>
}
export function BuyerQuotationsPage() {
  const { requestId = '' } = useParams()
  return <MarketplaceShell title="เปรียบเทียบใบเสนอราคา">{quoteRequestId.test(requestId) ? <BuyerComparison key={requestId} requestId={requestId} /> : <MarketplaceError message="ลิงก์คำขอราคาไม่ถูกต้อง" />}</MarketplaceShell>
}
function BuyerComparison({ requestId }: { requestId: string }) {
  const session = useCloudSession()
  const [cursors, setCursors] = useState<string[]>([])
  const list = useCommerceQuery(['buyer-quotes', requestId, cursors.at(-1)], signal => listBuyerQuotations(session.apiBaseUrl, session.getAccessToken(), requestId, cursors.at(-1) ?? null, signal))
  const publication = useCommerceQuery(['publication', requestId], signal => getQuoteRequestPublication(session.apiBaseUrl, session.getAccessToken(), requestId, signal))
  return <><Link to={`/app/requests/${requestId}`}><ArrowLeft size={15} aria-hidden="true" /> กลับไปที่คำขอราคา</Link><SupplierIntro eyebrow="COMPARE & CHOOSE" title="เลือกข้อเสนอที่เหมาะกับงาน" description="เปรียบเทียบราคา มัดจำ ระยะเวลาผลิต และเงื่อนไขจากแต่ละกิจการ ราคาแต่ละฉบับอ้างอิงสเปกที่แน่นอน" /><QueryState query={list} /><QueryState query={publication} />{list.isSuccess && publication.isSuccess && <><div className="commerce-grid">{list.data.items.map(quote => {
    const terms = quote.current
    if (!terms) return null
    const expired = Date.parse(terms.validUntil) <= Date.now()
    const stale = terms.requestRevisionId !== publication.data.publication?.revisionId
    return <article className="commerce-card" key={quote.id}><div className="commerce-heading"><h2>{quote.supplierName}</h2><span className="commerce-status">{expired ? 'หมดอายุ' : stale ? 'อ้างอิงสเปกฉบับก่อน' : quotationStatus[quote.status]}</span></div><QuotationTermsView terms={terms} /><QuotationHistory quotationId={quote.id} /><p className="commerce-stamp">ราคาฉบับที่ {terms.revision} · ส่ง {formatQuoteDate(terms.sentAt)}</p><div className="commerce-actions"><Link to={`/chat?requestId=${requestId}&supplierId=${quote.supplierId}`}>สอบถามผู้รับผลิต</Link>{!expired && !stale && quote.status === 'sent' && <Link className="studio-button" to={`/orders/new?requestId=${requestId}&quoteRevisionId=${terms.id}`}>ตรวจสอบก่อนเลือกข้อเสนอ</Link>}</div></article>
  })}</div>{!list.data.items.length && <section className="commerce-card commerce-empty"><FileText size={30} /><h2>ยังไม่มีใบเสนอราคาที่ส่งมา</h2><p>ข้อเสนอที่ผู้รับผลิตส่งแล้วจะแสดงที่นี่</p></section>}<CursorPager cursors={cursors} next={list.data.nextCursor} setCursors={setCursors} /></>}<button onClick={() => { void list.refetch(); void publication.refetch() }} disabled={list.isFetching || publication.isFetching}>โหลดข้อมูลล่าสุด</button></>
}
export function SupplierQuotationsPage() {
  const { supplierId = '' } = useParams()
  return <MarketplaceShell title="ใบเสนอราคาของกิจการ">{quoteRequestId.test(supplierId) ? <SupplierQuoteList key={supplierId} supplierId={supplierId} /> : <MarketplaceError message="ลิงก์กิจการไม่ถูกต้อง" />}</MarketplaceShell>
}
function SupplierQuoteList({ supplierId }: { supplierId: string }) {
  const session = useCloudSession()
  const [cursors, setCursors] = useState<string[]>([])
  const list = useCommerceQuery(['supplier-quotes', supplierId, cursors.at(-1)], signal => listSupplierQuotations(session.apiBaseUrl, session.getAccessToken(), supplierId, cursors.at(-1) ?? null, signal))
  return <><SupplierIntro eyebrow="YOUR OFFERS" title="ข้อเสนอจากกิจการของคุณ" description="จัดการฉบับร่างและตรวจเงื่อนไขที่ส่งให้ผู้ซื้อ โดยราคาเดิมที่ส่งแล้วยังคงเป็นหลักฐาน" /><Link to={`/factory/${supplierId}/jobs`}>เปิดคำขอราคาที่ได้รับ</Link><QueryState query={list} />{list.isSuccess && <><div className="commerce-grid">{list.data.items.map(item => <article className="commerce-card" key={item.id}><span className="commerce-status">{quotationStatus[item.status]}</span><h2><Link to={`/factory/${supplierId}/jobs/${item.requestId}/quote`}>{item.requestTitle}</Link></h2><p className="commerce-money">{money((item.draft ?? item.current)?.totalMinor ?? 0)}</p><p className="marketplace-muted">{item.draft ? 'ฉบับร่างที่บันทึกไว้' : 'ข้อเสนอที่ส่งแล้ว'}</p></article>)}</div>{!list.data.items.length && <section className="commerce-card commerce-empty"><h2>ยังไม่มีใบเสนอราคา</h2><p>เลือกคำขอราคาที่ได้รับเพื่อเริ่มข้อเสนอ</p></section>}<CursorPager cursors={cursors} next={list.data.nextCursor} setCursors={setCursors} /></>}</>
}
export function QuotationEditorPage() {
  const { supplierId = '', requestId = '' } = useParams()
  return <MarketplaceShell title="จัดทำใบเสนอราคา">{quoteRequestId.test(supplierId) && quoteRequestId.test(requestId) ? <QuotationEditor key={`${supplierId}:${requestId}`} supplierId={supplierId} requestId={requestId} /> : <MarketplaceError message="ลิงก์ใบเสนอราคาไม่ถูกต้อง" />}</MarketplaceShell>
}
function QuotationEditor({ supplierId, requestId }: { supplierId: string; requestId: string }) {
  const session = useCloudSession()
  const context = useMarketplaceContext()
  const request = useCommerceQuery(['quote-source', supplierId, requestId], signal => getSupplierQuoteRequest(session.apiBaseUrl, session.getAccessToken(), supplierId, requestId, signal))
  const quote = useCommerceQuery(['quotation', supplierId, requestId], signal => getQuotation(session.apiBaseUrl, session.getAccessToken(), supplierId, requestId, signal))
  const access = context.isSuccess ? context.data.suppliers.find(s => s.profile.id === supplierId) : undefined
  const [revoked, setRevoked] = useState(false)
  const canEdit = Boolean(access && access.role !== 'viewer' && access.profile.status === 'approved')
  const canCommit = access?.role === 'manager' && access.profile.status === 'approved'
  if (revoked) return <MarketplaceError message="สิทธิ์ในข้อเสนอนี้เปลี่ยนไป ข้อมูลถูกปิดแล้ว กรุณากลับไปตรวจสอบสิทธิ์" />
  return <><Link to={`/factory/${supplierId}/jobs/${requestId}`}>กลับไปที่คำขอราคา</Link><QueryState query={request} /><QueryState query={quote} /><QueryState query={context} />{quote.isSuccess && request.isSuccess && context.isSuccess && <><SupplierIntro eyebrow="QUOTATION STUDIO" title={request.data.title} description={`${request.data.quantity.toLocaleString('th-TH')} ชิ้น · บันทึกฉบับร่างก่อนตรวจและส่งให้ผู้ซื้อ`} /><div className="commerce-grid"><section className="commerce-card"><QuoteForm key={quote.data.quotation?.revision ?? 0} quote={quote.data.quotation} requestRevisionId={request.data.revisionId} supplierId={supplierId} requestId={requestId} canEdit={canEdit} canCommit={canCommit} onDenied={() => setRevoked(true)} refresh={() => { void quote.refetch(); void request.refetch(); void context.refetch() }} /></section><div className="commerce-stack"><QuoteRequestSpec spec={request.data.spec} />{quote.data.quotation?.current && <section className="commerce-card"><h2>ราคาฉบับที่ส่งแล้ว</h2><span className="commerce-status">{quotationStatus[quote.data.quotation.status]}</span><QuotationTermsView terms={quote.data.quotation.current} /><QuotationHistory quotationId={quote.data.quotation.id} supplierId={supplierId} /><p className="commerce-stamp">ฉบับที่ {quote.data.quotation.current.revision} · {quote.data.quotation.current.id}</p></section>}</div></div></>}</>
}
function QuoteForm({ quote, requestRevisionId, supplierId, requestId, canEdit, canCommit, onDenied, refresh }: { quote: Quotation | null; requestRevisionId: string; supplierId: string; requestId: string; canEdit: boolean; canCommit: boolean; onDenied(): void; refresh(): void }) {
  const session = useCloudSession()
  const initial = quote?.draft ?? quote?.current
  const [total, setTotal] = useState(initial ? String(initial.totalMinor / 100) : '')
  const [deposit, setDeposit] = useState(initial ? String(initial.depositMinor / 100) : '0')
  const [days, setDays] = useState(initial ? String(initial.leadDays) : '')
  const [valid, setValid] = useState(initial ? localDateTime(initial.validUntil) : '')
  const [proof, setProof] = useState(initial?.requiresProof ?? true)
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [confirmation, setConfirmation] = useState<'send' | 'withdraw' | null>(null)
  const [validation, setValidation] = useState('')
  const operation = useOperationId()
  const mutation = useMutation({ mutationFn: async (intent: { action: 'save'; terms: QuotationTerms } | { action: 'send' | 'withdraw' }) => {
    const common = { expectedRevision: quote?.revision ?? 0 }
    const payload = { ...common, ...(intent.action === 'save' ? intent.terms : {}) }
    const input = { ...payload, operationId: operation({ action: intent.action, ...payload }) }
    return intent.action === 'save' ? saveQuotation(session.apiBaseUrl, session.getAccessToken(), supplierId, requestId, { ...intent.terms, ...input }) : actQuotation(session.apiBaseUrl, session.getAccessToken(), supplierId, requestId, intent.action, input)
  }, onSuccess: () => { setConfirmation(null); refresh() }, onError: error => { setConfirmation(null); if (deniedCommerce(error)) onDenied() } })
  const currentFields = JSON.stringify([total, deposit, days, valid, proof, notes])
  const originalFields = JSON.stringify([initial ? String(initial.totalMinor / 100) : '', initial ? String(initial.depositMinor / 100) : '0', initial ? String(initial.leadDays) : '', initial ? localDateTime(initial.validUntil) : '', initial?.requiresProof ?? true, initial?.notes ?? ''])
  const dirty = currentFields !== originalFields || initial?.requestRevisionId !== requestRevisionId
  const blocked = !canEdit || mutation.isPending || deniedCommerce(mutation.error) || (mutation.error instanceof Error && 'status' in mutation.error && mutation.error.status === 409)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const totalMinor = parseMoney(total), depositMinor = parseMoney(deposit), leadDays = Number(days), validUntil = new Date(valid)
    if (totalMinor === null || totalMinor <= 0 || depositMinor === null || depositMinor > totalMinor || !Number.isInteger(leadDays) || leadDays < 1 || leadDays > 365 || !Number.isFinite(validUntil.getTime()) || validUntil.getTime() <= Date.now()) { setValidation('ตรวจราคา มัดจำ ระยะเวลาผลิต 1–365 วัน และวันหมดอายุในอนาคต'); return }
    setValidation('')
    mutation.mutate({ action: 'save', terms: { requestRevisionId, currency: 'THB', totalMinor, depositMinor, leadDays, validUntil: validUntil.toISOString(), requiresProof: proof, notes } })
  }
  return <><h2>{canEdit ? 'ราคาและเงื่อนไข' : 'รายละเอียดข้อเสนอ · ดูอย่างเดียว'}</h2>{!canEdit && <p className="marketplace-notice">ผู้จัดการและพนักงานกิจการที่อนุมัติแล้วบันทึกร่างได้ ส่วนการส่งและถอนข้อเสนอใช้สิทธิ์ผู้จัดการ</p>}{mutation.isError && <MarketplaceError message={commerceError(mutation.error)} retry={refresh} />}{validation && <MarketplaceError message={validation} />}<form className="commerce-form" onSubmit={submit}><fieldset disabled={blocked || Boolean(confirmation)}><div className="commerce-form-grid"><label>ราคารวม (บาท)<input required inputMode="decimal" value={total} onChange={e => setTotal(e.target.value)} /></label><label>มัดจำ (บาท)<input required inputMode="decimal" value={deposit} onChange={e => setDeposit(e.target.value)} /></label><label>ระยะเวลาผลิต (วัน)<input required type="number" min="1" max="365" value={days} onChange={e => setDays(e.target.value)} /></label><label>ใช้ได้ถึง (เวลาท้องถิ่น)<input required type="datetime-local" value={valid} onChange={e => setValid(e.target.value)} /></label></div><label className="commerce-checkbox"><input type="checkbox" checked={proof} onChange={e => setProof(e.target.checked)} />ต้องอนุมัติแบบก่อนเริ่มผลิต</label><label>เงื่อนไขเพิ่มเติม<textarea rows={4} maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)} /></label>{canEdit && <button type="submit" className="commerce-primary">{mutation.isPending ? 'กำลังบันทึก…' : 'บันทึกฉบับร่าง'}</button>}</fieldset></form><p className="commerce-stamp">อ้างอิงฉบับสเปก {requestRevisionId}</p>{canCommit && !confirmation && <div className="commerce-actions"><button disabled={blocked || dirty || !quote?.draft} onClick={() => setConfirmation('send')}>ตรวจและส่งข้อเสนอ</button>{quote?.status === 'sent' && <button disabled={blocked} onClick={() => setConfirmation('withdraw')}>ถอนข้อเสนอ</button>}</div>}{dirty && <p className="marketplace-muted">บันทึกข้อมูลก่อนส่ง เพื่อให้ผู้ซื้อได้รับฉบับที่คุณตรวจแล้ว</p>}{confirmation && <ConfirmAction title={confirmation === 'send' ? 'ยืนยันส่งข้อเสนอให้ผู้ซื้อ' : 'ยืนยันถอนข้อเสนอ'} busy={mutation.isPending} onCancel={() => setConfirmation(null)} onConfirm={() => mutation.mutate({ action: confirmation })} label={confirmation === 'send' ? 'ยืนยันส่งข้อเสนอ' : 'ยืนยันถอนข้อเสนอ'}>{confirmation === 'send' && quote?.draft ? <QuotationTermsView terms={quote.draft} /> : <p>ผู้ซื้อจะไม่สามารถเลือกข้อเสนอนี้ได้ ประวัติราคาที่ส่งแล้วจะยังถูกเก็บไว้</p>}<p>เมื่อส่งแล้ว ราคาและเงื่อนไขฉบับนี้จะคงเป็นหลักฐาน การแก้ไขครั้งต่อไปต้องส่งฉบับใหม่</p></ConfirmAction>}</>
}
function localDateTime(value: string): string { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }
