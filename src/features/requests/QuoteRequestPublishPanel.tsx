import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { QUOTE_REQUEST_MAX_SUPPLIERS, type QuoteRequestPublication } from '../../../shared/contracts/quoteRequests'
import { useCloudSession } from '../../app/cloudSession'
import { ApiClientError } from '../../services/api/client'
import { listQuoteRequestEligibleSuppliers, publishQuoteRequest } from '../../services/api/quoteRequests'
import { CapabilityList, MarketplaceError } from '../suppliers/MarketplaceShell'
import { supplierKindNames } from '../suppliers/supplierUi'
import { formatQuoteDate, quoteAccessUnavailable } from './QuoteRequestFacts'

export function QuoteRequestPublicationReceipt({ receipt }: { receipt: QuoteRequestPublication }) {
  return (
    <section className="marketplace-card">
      <h2>ส่งคำขอราคาแล้ว</h2>
      <time className="marketplace-muted" dateTime={receipt.publishedAt}>{formatQuoteDate(receipt.publishedAt)}</time>
      <p>ผู้รับผลิตที่ได้รับคำขอ {receipt.suppliers.length} ราย</p>
      <ul className="marketplace-list">
        {receipt.suppliers.map((supplier) => <li key={supplier.id}>{supplier.name}</li>)}
      </ul>
    </section>
  )
}

export function QuoteRequestPublishPanel({
  requestId,
  workspaceId,
  blocked,
  onPublished,
  reloadPublication,
}: {
  requestId: string
  workspaceId: string
  blocked: boolean
  onPublished(receipt: QuoteRequestPublication): Promise<void>
  reloadPublication(): Promise<boolean>
}) {
  const session = useCloudSession()
  const [cursors, setCursors] = useState<string[]>([])
  const [selected, setSelected] = useState<{ id: string; name: string }[]>([])
  const [confirming, setConfirming] = useState(false)
  const after = cursors.at(-1) ?? null
  const eligible = useQuery({
    queryKey: ['cloud', session.appUserId, workspaceId, 'quote-request-eligible-suppliers', requestId, after],
    queryFn: ({ signal }) => listQuoteRequestEligibleSuppliers(session.apiBaseUrl, session.getAccessToken(), requestId, after, signal),
    gcTime: 0,
  })
  const publish = useMutation({
    mutationFn: (supplierIds: string[]) => publishQuoteRequest(session.apiBaseUrl, session.getAccessToken(), requestId, { supplierIds }),
    onSuccess: onPublished,
  })
  const denied = quoteAccessUnavailable(eligible.error) || quoteAccessUnavailable(publish.error)
  useEffect(() => {
    if (denied) void reloadPublication()
  }, [denied, reloadPublication])
  const conflict = publish.error instanceof ApiClientError && publish.error.status === 409
  const data = eligible.isSuccess && !eligible.isFetching ? eligible.data : undefined
  const next = data?.nextCursor
  const busy = blocked || eligible.isFetching || publish.isPending
  const toggle = (supplier: { id: string; name: string }) => {
    setSelected((current) => {
      if (current.some((item) => item.id === supplier.id)) return current.filter((item) => item.id !== supplier.id)
      return current.length < QUOTE_REQUEST_MAX_SUPPLIERS ? [...current, { id: supplier.id, name: supplier.name }] : current
    })
  }
  const refreshStatus = async () => {
    const stillUnpublished = await reloadPublication()
    if (!stillUnpublished) return
    publish.reset()
    if (conflict) {
      setConfirming(false)
      setSelected([])
      if (after) setCursors([])
      else void eligible.refetch()
    }
  }

  if (denied) return <MarketplaceError message="บัญชีนี้เปิดการส่งคำขอราคาไม่ได้" />

  return (
    <section className="marketplace-card">
      <h2>ส่งคำขอราคาให้ผู้รับผลิต</h2>
      <p>เลือกผู้รับผลิตที่ผ่านการอนุมัติ 1–{QUOTE_REQUEST_MAX_SUPPLIERS} ราย</p>
      <p>ผู้รับผลิตที่เลือกจะเห็นชื่อคำขอ จำนวนที่ต้องการผลิต รายละเอียดเพิ่มเติม และสเปกเบื้องต้น</p>
      {publish.isError && (
        <MarketplaceError message={conflict
          ? 'สถานะคำขอหรือรายชื่อผู้รับผลิตเปลี่ยนไป ตรวจสถานะล่าสุดก่อนส่งอีกครั้ง'
          : 'ยังยืนยันผลการส่งไม่ได้ ลองส่งรายชื่อเดิมอีกครั้งหรือตรวจสถานะล่าสุด'} />
      )}
      {publish.isError && <button type="button" disabled={busy} onClick={() => void refreshStatus()}>ตรวจสถานะล่าสุด</button>}
      {selected.length > 0 && (
        <div className="quote-request-selection">
          <strong>เลือกแล้ว {selected.length} จาก {QUOTE_REQUEST_MAX_SUPPLIERS} ราย</strong>
          <ul className="marketplace-list">
            {selected.map((supplier) => (
              <li className="marketplace-meta" key={supplier.id}>
                <span>{supplier.name}</span>
                {!confirming && <button type="button" disabled={busy || conflict} onClick={() => toggle(supplier)}
                  aria-label={`นำ ${supplier.name} ออกจากรายชื่อ`}>นำออก</button>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {confirming ? (
        <div className="quote-request-selection">
          <h3>ยืนยันรายชื่อผู้รับผลิต</h3>
          <p>คำขอจะส่งถึงผู้รับผลิต {selected.length} รายที่แสดงด้านบน</p>
          <div className="marketplace-meta">
            <button type="button" disabled={busy || conflict} onClick={() => { setConfirming(false); publish.reset() }}>กลับไปแก้รายชื่อ</button>
            <button type="button" className="primary" disabled={busy || conflict || !selected.length}
              onClick={() => publish.mutate(selected.map((supplier) => supplier.id))}>
              {publish.isPending ? 'กำลังส่งคำขอ…' : 'ยืนยันส่งคำขอ'}
            </button>
          </div>
        </div>
      ) : (
        <>
          {(eligible.isPending || eligible.isFetching) && <p role="status">กำลังโหลดผู้รับผลิต…</p>}
          {eligible.isError && <MarketplaceError message="โหลดรายชื่อผู้รับผลิตไม่สำเร็จ" retry={() => void eligible.refetch()} />}
          {data && (data.items.length === 0 ? <p className="marketplace-muted">ยังไม่มีผู้รับผลิตที่เลือกได้ในหน้านี้</p> : (
            <ul className="marketplace-list">
              {data.items.map((supplier) => {
                const checked = selected.some((item) => item.id === supplier.id)
                return (
                  <li className="quote-request-eligible" key={supplier.id}>
                    <label className="quote-request-supplier-option">
                      <input type="checkbox" checked={checked} onChange={() => toggle(supplier)}
                        disabled={busy || conflict || (!checked && selected.length >= QUOTE_REQUEST_MAX_SUPPLIERS)} />
                      <span><strong>{supplier.name}</strong> · {supplierKindNames[supplier.kind]}</span>
                    </label>
                    <CapabilityList capabilities={supplier.capabilities} />
                  </li>
                )
              })}
            </ul>
          ))}
          {data && (after || next) && (
            <div className="marketplace-meta" role="group" aria-label="หน้ารายชื่อผู้รับผลิต">
              <button type="button" disabled={!after || busy || conflict} onClick={() => setCursors((previous) => previous.slice(0, -1))}>ก่อนหน้า</button>
              <button type="button" disabled={!next || busy || conflict} onClick={() => {
                if (next) setCursors((previous) => [...previous, next])
              }}>ถัดไป</button>
            </div>
          )}
          <button type="button" className="primary" disabled={!selected.length || !data || busy || conflict} onClick={() => setConfirming(true)}>
            ตรวจรายชื่อก่อนส่ง
          </button>
        </>
      )}
    </section>
  )
}
