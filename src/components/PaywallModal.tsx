import { useEffect, useRef, useState } from 'react'
import type { Entitlements, Order, OrderKind, OrderStatus } from '../../shared/contracts/billing'
import { useT } from '../i18n'
import { ApiClientError } from '../services/api/client'

// paywall (cloud mode เท่านั้น) — สองโหมด: 'design' ซื้อรายแบบ (ดาวน์โหลดแบบนี้ + แถมเครดิต AI)
// และ 'pro' รายเดือน (ทุกแบบ + เครดิตต่อรอบ ไม่มีลายน้ำ) ราคา/เครดิตอ่านจาก entitlements.catalog ของ server
// ยังไม่เปิดขาย (entitlements.purchasesEnabled !== true — รวม entitlements null): แสดงราคา/สิ่งที่ได้ + ข้อความ
// "ยังไม่เปิดขาย" ปุ่มเดียวคือปิด (ไม่มีปุ่มชำระ/จำลอง ไม่บอกให้ติดต่อผู้ดูแล) — server ก็ตอบ 503 PURCHASE_UNAVAILABLE อยู่แล้ว
// เปิดขาย (ตอนนี้ = server development/test): กดชำระ = สร้าง order (pending) → ปุ่มจำลองการชำระ →
// ผู้เรียกรีเฟรชสิทธิ์แล้วทำ action ที่ค้าง (ดาวน์โหลด) ต่อ

type T = (th: string, en: string) => string

export function orderStatusLabel(status: OrderStatus, t: T): string {
  switch (status) {
    case 'pending': return t('รอชำระ', 'Awaiting payment')
    case 'paid': return t('ชำระแล้ว', 'Paid')
    case 'canceled': return t('ยกเลิกแล้ว', 'Canceled')
  }
}

// ข้อความ error ของการสั่งซื้อ/จำลองชำระ: รหัสที่รู้จักแปลตามภาษา UI, ที่เหลือใช้ข้อความจาก server
export function purchaseErrorMessage(error: unknown, fallback: string, t: T): string {
  if (error instanceof ApiClientError) {
    switch (error.code) {
      case 'PURCHASE_UNAVAILABLE':
        return t('ยังไม่เปิดขาย — ระบบชำระเงินจะเปิดเร็ว ๆ นี้', 'Not on sale yet — payments open soon')
      case 'ALREADY_LICENSED':
        return t('แบบนี้ดาวน์โหลดได้อยู่แล้ว', 'This design can already be downloaded')
      case 'NETWORK_ERROR':
        return t('เชื่อมต่อ server ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่', 'Cannot reach the server — check your connection and try again')
    }
  }
  return error instanceof Error && error.message ? error.message : fallback
}

// ราคาสำรองเมื่อโหลด entitlements ไม่ได้ (แสดงผลเท่านั้น — server เป็นผู้คิดราคาจริงตอนสั่งซื้อ)
export const FALLBACK_AMOUNT_MINOR: Record<OrderKind, number> = { design: 14900, pro: 39900 }

export function formatBaht(amountMinor: number): string {
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: amountMinor % 100 === 0 ? 0 : 2,
  }).format(amountMinor / 100)
}

export interface PaywallModalProps {
  kind: OrderKind
  entitlements: Entitlements | null
  projectName: string
  busy: boolean
  onClose(): void
  onPurchase(kind: OrderKind): Promise<Order>
  onDevFulfil(orderId: string): Promise<void>
  // แบบนี้มีสิทธิ์อยู่แล้ว (409 ALREADY_LICENSED) → ปิด modal แล้วทำ action ที่ค้างต่อ; ไม่ส่ง = แค่ปิด
  onAlreadyLicensed?(): void
  // order ที่มีอยู่แล้ว (เปิดต่อจากรอบก่อน/เทสต์) — เริ่มที่หน้าสถานะรอชำระ
  order?: Order | null
  // ลิงก์ "เปรียบเทียบแพ็กเกจทั้งหมด" → หน้าแพ็กเกจ (ไม่ส่ง = ไม่แสดง เช่นเปิดมาจากหน้าแพ็กเกจเอง)
  onShowPlans?(): void
}

export function PaywallModal({
  kind: initialKind,
  entitlements,
  projectName,
  busy,
  onClose,
  onPurchase,
  onDevFulfil,
  onAlreadyLicensed,
  order: initialOrder = null,
  onShowPlans,
}: PaywallModalProps) {
  const t = useT()
  const [kind, setKind] = useState<OrderKind>(initialKind)
  const [order, setOrder] = useState<Order | null>(initialOrder)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const locked = busy || working
  const dialogRef = useRef<HTMLDivElement>(null)
  // ค่าล่าสุดสำหรับตัวฟัง keydown ที่ผูกครั้งเดียว
  const closeRef = useRef({ locked, onClose })
  closeRef.current = { locked, onClose }

  // โฟกัสตัว dialog ตอนเปิด (ไม่ใช่ปุ่มชำระ — กด Enter/Space ซ้ำจะได้ไม่สร้างคำสั่งซื้อโดยไม่ตั้งใจ
  // และไม่ไปกดปุ่มดาวน์โหลดข้างหลังซ้ำ), Esc ปิดเมื่อไม่ได้ทำงานค้าง, ปิดแล้วคืนโฟกัสให้ปุ่มที่เปิด
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || closeRef.current.locked) return
      e.stopPropagation()
      closeRef.current.onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  const item = entitlements?.catalog[kind] ?? null
  const price = formatBaht(item?.amountMinor ?? FALLBACK_AMOUNT_MINOR[kind])
  const otherKind: OrderKind = kind === 'design' ? 'pro' : 'design'
  const otherPrice = formatBaht(entitlements?.catalog[otherKind].amountMinor ?? FALLBACK_AMOUNT_MINOR[otherKind])
  const credits = item?.credits ?? null
  const periodDays = item?.periodDays ?? 30
  // null (โหลดสิทธิ์ไม่ได้) = ไม่เปิดขาย — ไม่โชว์ปุ่มที่ server จะปฏิเสธ
  const purchasesEnabled = entitlements?.purchasesEnabled === true
  // ปิดการขายระหว่างเปิด modal (เช่นได้ 503 แล้วผู้เรียกรีเฟรชสิทธิ์) — ข้อความ "ยังไม่เปิดขาย" แทน error เดิม
  useEffect(() => {
    if (!purchasesEnabled) setError(null)
  }, [purchasesEnabled])

  const purchase = async () => {
    if (locked || !purchasesEnabled) return
    setWorking(true)
    setError(null)
    try {
      setOrder(await onPurchase(kind))
    } catch (e) {
      if (e instanceof ApiClientError && e.code === 'ALREADY_LICENSED') {
        ;(onAlreadyLicensed ?? onClose)()
        return
      }
      setError(purchaseErrorMessage(e, t('สั่งซื้อไม่สำเร็จ', 'Could not create the order'), t))
    } finally {
      setWorking(false)
    }
  }

  const fulfil = async () => {
    if (locked || !order || !purchasesEnabled) return
    setWorking(true)
    setError(null)
    try {
      await onDevFulfil(order.id)
      onClose()
    } catch (e) {
      setError(purchaseErrorMessage(e, t('จำลองการชำระไม่สำเร็จ', 'Simulated payment failed'), t))
    } finally {
      setWorking(false)
    }
  }

  const title = kind === 'design'
    ? t(`ดาวน์โหลดแบบ "${projectName}"`, `Download "${projectName}"`)
    : purchasesEnabled
      ? t('สมัคร Pro รายเดือน', 'Go Pro (monthly)')
      : t('แพ็กเกจ Pro รายเดือน', 'Pro monthly plan')
  // ยังไม่เปิดขาย: order ค้างจากรอบก่อน (ถ้ามี) ไม่แสดง — สถานะนี้ไม่มีทางชำระต่อ
  const shownOrder = purchasesEnabled ? order : null
  // สมาชิก Pro (เช่นกดต่ออายุ) ไม่ถูกชวนไปรายแบบ — Pro ครอบคลุมทุกแบบอยู่แล้ว (กติกาเดียวกับการ์ดรายแบบในหน้าแพ็กเกจ)
  const offerSwitch = kind === 'design' || entitlements?.plan !== 'pro'

  return (
    <div className="modal-overlay" onMouseDown={() => { if (!locked) onClose() }}>
      <div
        ref={dialogRef}
        className="modal paywall-modal"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label={title}
        aria-busy={locked || undefined}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3>{title}</h3>
        <div className="paywall-price">
          <b>{price}</b>
          <small>{kind === 'pro' ? t('/ เดือน', '/ month') : t('ครั้งเดียว · ต่อแบบ', 'one-time · per design')}</small>
        </div>
        <ul className="paywall-list">
          {kind === 'design' ? (
            <>
              <li>{t('ดาวน์โหลด SVG / DXF / PDF 1:1 / ใบสเปกขอราคา ของแบบนี้ได้ตลอด (แก้ต่อแล้วโหลดซ้ำได้)', 'Download SVG / DXF / 1:1 PDF / quote sheet for this design, forever (edit and re-download anytime)')}</li>
              <li>{t('ไม่มีลายน้ำบนพรีวิวของแบบนี้', 'No watermark on this design’s previews')}</li>
              {credits !== null && (
                <li>{t(`แถมเครดิต AI ${credits} เครดิต (1 เครดิต = สั่ง AI 1 ครั้ง)`, `Includes ${credits} AI credits (1 credit = 1 AI request)`)}</li>
              )}
            </>
          ) : (
            <>
              <li>{t('ดาวน์โหลดไฟล์ผลิตได้ทุกแบบในพื้นที่งาน', 'Download production files for every design in the workspace')}</li>
              <li>{t('ไม่มีลายน้ำบนพรีวิว', 'No watermark on previews')}</li>
              {credits !== null && (
                <li>{t(`เครดิต AI ${credits} เครดิต ทุกรอบ ${periodDays} วัน (เครดิตไม่หมดอายุ)`, `${credits} AI credits every ${periodDays} days (credits never expire)`)}</li>
              )}
            </>
          )}
        </ul>
        {!shownOrder && (offerSwitch || onShowPlans) && (
          <p className="paywall-switch">
            {offerSwitch && (
              <>
                {purchasesEnabled
                  ? kind === 'design'
                    ? t(`หรือสมัคร Pro ${otherPrice}/เดือน ได้ทุกแบบ`, `Or go Pro at ${otherPrice}/month for every design`)
                    : t(`หรือซื้อเฉพาะแบบนี้ ${otherPrice}`, `Or buy just this design for ${otherPrice}`)
                  : kind === 'design'
                    ? t(`Pro ${otherPrice}/เดือน ดาวน์โหลดได้ทุกแบบ`, `Pro at ${otherPrice}/month covers every design`)
                    : t(`รายแบบ ${otherPrice} ต่อแบบ`, `Per design: ${otherPrice} each`)}{' '}
                <button type="button" className="link-btn" disabled={locked} onClick={() => setKind(otherKind)}>
                  {kind === 'design'
                    ? t('ดู Pro', 'See Pro')
                    : purchasesEnabled ? t('ซื้อรายแบบ', 'Buy per design') : t('ดูรายแบบ', 'See per design')}
                </button>
              </>
            )}
            {onShowPlans && (
              <>
                {offerSwitch && ' · '}
                <button type="button" className="link-btn" disabled={locked} onClick={onShowPlans}>
                  {t('เปรียบเทียบแพ็กเกจทั้งหมด', 'Compare all plans')}
                </button>
              </>
            )}
          </p>
        )}
        {!purchasesEnabled && (
          <div className="paywall-soon" role="status">
            <b>{t('ยังไม่เปิดขาย — ระบบชำระเงินจะเปิดเร็ว ๆ นี้', 'Not on sale yet — payments open soon.')}</b>
            <span>{t('ตอนนี้ออกแบบและดูพรีวิวได้ฟรี', 'You can keep designing and previewing for free.')}</span>
          </div>
        )}
        {shownOrder && (
          <div className="paywall-note" role="status">
            <b>{t('ระบบชำระเงินยังไม่เปิดให้บริการ — ติดต่อผู้ดูแลเพื่อเปิดสิทธิ์', 'Payments are not open yet — contact the administrator to activate')}</b>
            <small>{t('เลขที่คำสั่งซื้อ', 'Order')} {shownOrder.id} · {formatBaht(shownOrder.amountMinor)} · {orderStatusLabel(shownOrder.status, t)}</small>
          </div>
        )}
        {error && <div className="paywall-error" role="alert">{error}</div>}
        <div className="modal-actions">
          <button type="button" className={purchasesEnabled ? undefined : 'primary'} disabled={locked} onClick={onClose}>
            {shownOrder || !purchasesEnabled ? t('ปิด', 'Close') : t('ยกเลิก', 'Cancel')}
          </button>
          {purchasesEnabled && !shownOrder && (
            <button type="button" className="primary" disabled={locked} onClick={() => void purchase()}>
              {working ? t('กำลังสร้างคำสั่งซื้อ…', 'Creating order…') : t(`ชำระ ${price}`, `Pay ${price}`)}
            </button>
          )}
          {shownOrder && entitlements?.devFulfilAvailable && (
            <button type="button" className="primary paywall-dev" disabled={locked} onClick={() => void fulfil()}>
              {working ? t('กำลังจำลอง…', 'Simulating…') : t('จำลองการชำระ (dev)', 'Simulate payment (dev)')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
