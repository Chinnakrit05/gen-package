import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Entitlements, Order } from '../../shared/contracts/billing'
import { LangCtx } from '../i18n'
import { ApiClientError } from '../services/api/client'
import { PaywallModal, formatBaht, orderStatusLabel, purchaseErrorMessage } from './PaywallModal'

const entitlements: Entitlements = {
  workspaceId: 'space',
  plan: 'free',
  proUntil: null,
  credits: 0,
  licensedProjectIds: [],
  catalog: {
    design: { kind: 'design', amountMinor: 14900, currency: 'THB', credits: 10, periodDays: null },
    pro: { kind: 'pro', amountMinor: 39900, currency: 'THB', credits: 100, periodDays: 30 },
  },
  devFulfilAvailable: true,
  purchasesEnabled: true,
  openAccess: false,
}

const order: Order = {
  id: 'order-1',
  workspaceId: 'space',
  kind: 'design',
  projectId: 'project-1',
  amountMinor: 14900,
  currency: 'THB',
  credits: 10,
  status: 'pending',
  provider: 'none',
  providerRef: null,
  checkoutUrl: null,
  createdAt: '2026-10-13T00:00:00.000Z',
  paidAt: null,
}

const element = (props: Partial<Parameters<typeof PaywallModal>[0]>) => createElement(PaywallModal, {
  kind: 'design',
  entitlements,
  projectName: 'กล่องชา',
  busy: false,
  onClose: vi.fn(),
  onPurchase: vi.fn(async () => order),
  onDevFulfil: vi.fn(async () => {}),
  ...props,
})
const render = (props: Partial<Parameters<typeof PaywallModal>[0]>) => renderToStaticMarkup(element(props))
const renderEn = (props: Partial<Parameters<typeof PaywallModal>[0]>) =>
  renderToStaticMarkup(createElement(LangCtx.Provider, { value: 'en' }, element(props)))
const tTh = (th: string) => th
const tEn = (_th: string, en: string) => en
const off: Entitlements = { ...entitlements, purchasesEnabled: false, devFulfilAvailable: false }

describe('formatBaht', () => {
  it('formats satang amounts as whole baht in Thai locale', () => {
    expect(formatBaht(14900)).toContain('149')
    expect(formatBaht(39900)).toContain('399')
    expect(formatBaht(14900)).toContain('฿')
  })
})

describe('PaywallModal', () => {
  it('shows the per-design price, project name and bonus credits from the catalog', () => {
    const html = render({})
    expect(html).toContain('กล่องชา')
    expect(html).toContain('149')
    expect(html).toContain('แถมเครดิต AI 10')
    expect(html).toContain('ชำระ')
    expect(html).not.toContain('จำลองการชำระ')
  })

  it('shows the monthly Pro price and credits per period', () => {
    const html = render({ kind: 'pro' })
    expect(html).toContain('399')
    expect(html).toContain('100')
    expect(html).toContain('30 วัน')
    expect(html).toContain('สมัคร Pro')
  })

  it('falls back to catalog defaults when entitlements failed to load, without a pay button', () => {
    const html = render({ entitlements: null })
    expect(html).toContain('149')
    expect(html).not.toContain('แถมเครดิต')
    // โหลดสิทธิ์ไม่ได้ = ไม่รู้ว่าเปิดขายไหม → ไม่โชว์ปุ่มที่ server อาจปฏิเสธ
    expect(html).not.toContain('ชำระ ฿')
    expect(html).toContain('ยังไม่เปิดขาย')
  })

  it('hides purchasing when the server has not opened sales: price and benefits stay, the only action is Close', () => {
    const html = render({ entitlements: off, onShowPlans: vi.fn() })
    expect(html).toContain('฿149')
    expect(html).toContain('แถมเครดิต AI 10')
    expect(html).toContain('ยังไม่เปิดขาย — ระบบชำระเงินจะเปิดเร็ว ๆ นี้')
    expect(html).toContain('ตอนนี้ออกแบบและดูพรีวิวได้ฟรี')
    expect(html).toContain('เปรียบเทียบแพ็กเกจทั้งหมด')
    expect(html).not.toContain('ชำระ ฿')
    expect(html).not.toContain('จำลองการชำระ')
    expect(html).not.toContain('ติดต่อผู้ดูแล')
    expect(html).not.toContain('หรือสมัคร Pro')
    expect(html).not.toContain('ยกเลิก')
    expect(html).toContain('>ปิด</button>')
    expect(html.match(/<button type="button"[^>]*>ปิด<\/button>/g)).toHaveLength(1)
  })

  it('never shows a pending order or the contact-admin note while sales are closed', () => {
    const html = render({ entitlements: off, order })
    expect(html).not.toContain('order-1')
    expect(html).not.toContain('ติดต่อผู้ดูแล')
    expect(html).not.toContain('จำลองการชำระ')
    expect(html).toContain('ยังไม่เปิดขาย')
  })

  it('shows the closed-sales note in English', () => {
    const html = renderEn({ entitlements: off, kind: 'pro' })
    expect(html).toContain('Not on sale yet — payments open soon.')
    expect(html).toContain('You can keep designing and previewing for free.')
    expect(html).toContain('Pro monthly plan')
    expect(html).toContain('See per design')
    expect(html).not.toContain('Buy per design')
    expect(html).not.toContain('Pay ฿')
    expect(html).toContain('>Close</button>')
  })

  it('never offers a per-design purchase to a Pro member renewing Pro', () => {
    const pro: Entitlements = { ...entitlements, plan: 'pro', proUntil: '2026-11-12T00:00:00.000Z' }
    const html = render({ kind: 'pro', entitlements: pro, onShowPlans: vi.fn() })
    expect(html).toContain('ชำระ ฿399')
    expect(html).not.toContain('หรือซื้อเฉพาะแบบนี้')
    expect(html).not.toContain('ซื้อรายแบบ')
    expect(html).not.toContain('฿149')
    expect(html).toContain('เปรียบเทียบแพ็กเกจทั้งหมด')
    expect(html).not.toContain(' · ')

    const closed = renderEn({ kind: 'pro', entitlements: { ...pro, purchasesEnabled: false } })
    expect(closed).not.toContain('See per design')
    expect(closed).not.toContain('paywall-switch')

    // ผู้ใช้ที่ยังไม่ใช่ Pro ยังเลือกรายแบบจากหน้าต่าง Pro ได้
    expect(render({ kind: 'pro' })).toContain('หรือซื้อเฉพาะแบบนี้')
  })

  it('offers the dev simulated payment only when the server allows it', () => {
    const withDev = render({ order })
    expect(withDev).toContain('ระบบชำระเงินยังไม่เปิดให้บริการ')
    expect(withDev).toContain('จำลองการชำระ (dev)')
    expect(withDev).toContain('order-1')

    const withoutDev = render({ order, entitlements: { ...entitlements, devFulfilAvailable: false } })
    expect(withoutDev).toContain('ระบบชำระเงินยังไม่เปิดให้บริการ')
    expect(withoutDev).not.toContain('จำลองการชำระ')
  })

  it('translates the order status instead of printing the raw enum', () => {
    expect(render({ order })).toContain('รอชำระ')
    expect(render({ order })).not.toContain('· pending')
    expect(renderEn({ order })).toContain('Awaiting payment')
    expect(orderStatusLabel('paid', tTh)).toBe('ชำระแล้ว')
    expect(orderStatusLabel('canceled', tEn)).toBe('Canceled')
  })
})

describe('purchaseErrorMessage', () => {
  it('maps known codes to UI-language text and falls back to the server message', () => {
    const fallback = 'สั่งซื้อไม่สำเร็จ'
    expect(purchaseErrorMessage(new ApiClientError(503, 'PURCHASE_UNAVAILABLE', 'server text'), fallback, tTh)).toContain('ยังไม่เปิดขาย')
    expect(purchaseErrorMessage(new ApiClientError(503, 'PURCHASE_UNAVAILABLE', 'server text'), fallback, tEn)).toContain('Not on sale yet')
    expect(purchaseErrorMessage(new ApiClientError(409, 'ALREADY_LICENSED', 'server text'), fallback, tEn)).toBe('This design can already be downloaded')
    expect(purchaseErrorMessage(new ApiClientError(0, 'NETWORK_ERROR', 'เชื่อมต่อ server ไม่ได้'), fallback, tEn)).toContain('Cannot reach the server')
    expect(purchaseErrorMessage(new ApiClientError(409, 'ORDER_NOT_PAYABLE', 'คำสั่งซื้อถูกยกเลิกแล้ว'), fallback, tEn)).toBe('คำสั่งซื้อถูกยกเลิกแล้ว')
    expect(purchaseErrorMessage('boom', fallback, tTh)).toBe(fallback)
  })
})
