import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { BillingCatalog } from '../../shared/contracts/billing'
import { LangCtx } from '../i18n'
import { PricingPage, type PricingViewer } from './PricingPage'

const catalog: BillingCatalog = {
  design: { kind: 'design', amountMinor: 14900, currency: 'THB', credits: 10, periodDays: null },
  pro: { kind: 'pro', amountMinor: 39900, currency: 'THB', credits: 100, periodDays: 30 },
}

const member = (overrides: Partial<Extract<PricingViewer, { kind: 'member' }>> = {}): PricingViewer => ({
  kind: 'member',
  plan: 'free',
  proUntilLabel: '',
  credits: 0,
  projectName: 'กล่องชา',
  activeLicensed: false,
  ...overrides,
})

const element = (viewer: PricingViewer, cat: BillingCatalog | null, purchasesEnabled: boolean) =>
  createElement(PricingPage, { viewer, catalog: cat, purchasesEnabled, onClose() {}, onChoose() {} })
const render = (viewer: PricingViewer, cat: BillingCatalog | null = catalog, purchasesEnabled = true) =>
  renderToStaticMarkup(element(viewer, cat, purchasesEnabled))
const renderEn = (viewer: PricingViewer, cat: BillingCatalog | null = catalog, purchasesEnabled = true) =>
  renderToStaticMarkup(createElement(LangCtx.Provider, { value: 'en' }, element(viewer, cat, purchasesEnabled)))
const ctaLabels = (markup: string) =>
  [...markup.matchAll(/<button type="button" class="plan-cta[^"]*"( disabled="")?>([^<]*)<\/button>/g)]
    .map((m) => ({ label: m[2], disabled: Boolean(m[1]) }))

// นับปุ่มที่ disabled ใน markup (ปุ่มซื้อของแพ็กเกจที่ใช้ไม่ได้/ใช้อยู่แล้ว)
const disabledCtas = (markup: string) => (markup.match(/class="plan-cta[^"]*" disabled=""/g) ?? []).length

describe('PricingPage', () => {
  it('shows server catalog prices, credits and the Pro break-even for a Freemium member', () => {
    const markup = render(member())
    expect(markup).toContain('฿149')
    expect(markup).toContain('฿399')
    expect(markup).toContain('แถมเครดิต AI 10 เครดิต')
    expect(markup).toContain('เครดิต AI 100 เครดิต ทุก 30 วัน')
    // 2 แบบ = 298 < 399 < 447 = 3 แบบ
    expect(markup).toContain('ตั้งแต่ 3 แบบต่อเดือน')
    expect(markup).toContain('แพ็กเกจปัจจุบัน')
    expect(markup).toContain('ซื้อแบบ “กล่องชา”')
    expect(markup).toContain('สมัคร Pro')
    expect(disabledCtas(markup)).toBe(0)
  })

  it('marks the active design as bought and keeps Pro available', () => {
    const markup = render(member({ activeLicensed: true }))
    expect(markup).toContain('ซื้อแบบ “กล่องชา” แล้ว')
    expect(disabledCtas(markup)).toBe(1)
  })

  it('shows Pro as the current plan with its end date and offers renewal', () => {
    const markup = render(member({ plan: 'pro', proUntilLabel: '12 พ.ย. 2569', credits: 100 }))
    expect(markup).toContain('ใช้อยู่ · ถึง 12 พ.ย. 2569')
    expect(markup).toContain('ต่ออายุ Pro')
    expect(markup).toContain('เครดิต AI 100')
    // Freemium และรายแบบใช้ไม่ได้เมื่อเป็น Pro
    expect(disabledCtas(markup)).toBe(2)
  })

  it('sends guests to sign in and never guesses credit numbers without a catalog', () => {
    const markup = render({ kind: 'guest' }, null, true)
    expect(markup).toContain('เข้าสู่ระบบเพื่อซื้อ')
    expect(markup).toContain('เข้าสู่ระบบเพื่อสมัคร Pro')
    expect(markup).toContain('กลับไปหน้าเข้าสู่ระบบ')
    expect(markup).toContain('฿149')
    expect(markup).toContain('฿399')
    expect(markup).not.toContain('แพ็กเกจปัจจุบัน')
    expect(markup).not.toMatch(/เครดิต AI \d+ เครดิต/)
    expect(markup).not.toContain('pricing-status')
  })

  it('shows closed sales to a Freemium member: paid plans are disabled "coming soon", with a notice and no contact-admin', () => {
    const markup = render(member(), catalog, false)
    expect(ctaLabels(markup)).toEqual([
      { label: 'กลับไปออกแบบต่อ', disabled: false },
      { label: 'เปิดขายเร็ว ๆ นี้', disabled: true },
      { label: 'เปิดขายเร็ว ๆ นี้', disabled: true },
    ])
    expect(markup).toContain('pricing-soon')
    expect(markup).toContain('ระบบชำระเงินจะเปิดเร็ว ๆ นี้ ตอนนี้ออกแบบและดูพรีวิวได้ฟรี')
    expect(markup).toContain('เราจะประกาศให้ทราบเมื่อเปิดขาย')
    expect(markup).not.toContain('ติดต่อผู้ดูแล')
    // ราคา/สิ่งที่ได้ยังแสดงครบ
    expect(markup).toContain('฿149')
    expect(markup).toContain('฿399')
    expect(markup).toContain('แถมเครดิต AI 10 เครดิต')
  })

  it('keeps factual states (already bought) while sales are closed', () => {
    const markup = render(member({ activeLicensed: true }), catalog, false)
    expect(ctaLabels(markup).map((c) => c.label)).toEqual(['กลับไปออกแบบต่อ', 'ซื้อแบบ “กล่องชา” แล้ว', 'เปิดขายเร็ว ๆ นี้'])
    expect(disabledCtas(markup)).toBe(2)
  })

  it('offers no Pro renewal while sales are closed', () => {
    const markup = render(member({ plan: 'pro', proUntilLabel: '12 พ.ย. 2569', credits: 3 }), catalog, false)
    expect(markup).not.toContain('ต่ออายุ Pro')
    expect(markup).toContain('ใช้อยู่ · ถึง 12 พ.ย. 2569')
    expect(ctaLabels(markup)).toEqual([
      { label: 'รวมอยู่ใน Pro แล้ว', disabled: true },
      { label: 'Pro ดาวน์โหลดได้ทุกแบบอยู่แล้ว', disabled: true },
      { label: 'ต่ออายุได้เมื่อเปิดขาย', disabled: true },
    ])
    expect(markup).not.toContain('ติดต่อผู้ดูแล')
  })

  it('tells open-access members that Pro is free for now, with the allowance and what happens after', () => {
    const markup = render(member({ plan: 'pro', proUntilLabel: '14 พ.ย. 2569', credits: 100, openAccess: true }), catalog, false)
    expect(markup).toContain('ตอนนี้ใช้ Pro ได้ฟรี')
    expect(markup).toContain('ได้เครดิต AI 100 เครดิตทุก 30 วัน')
    expect(markup).toContain('แบบที่ยังไม่ได้ซื้อจะกลับไปใช้กติกาปกติ')
    expect(markup).toContain('ใช้ฟรีอยู่')
    expect(markup).toContain('ใช้ฟรีช่วงนี้')
    // รอบฟรีต่อเอง ไม่ใช่วันหมดอายุ/การต่ออายุแบบจ่ายเงิน และไม่มีป้าย "ยังไม่เปิดขาย" ซ้อน
    expect(markup).not.toContain('ถึง 14 พ.ย. 2569')
    expect(markup).not.toContain('ต่ออายุได้เมื่อเปิดขาย')
    expect(markup).not.toContain('ระบบชำระเงินจะเปิดเร็ว ๆ นี้ ตอนนี้ออกแบบและดูพรีวิวได้ฟรี')
    expect(markup).toContain('ระหว่างนี้ทุกบัญชีใช้ Pro ได้ฟรี')
    expect(ctaLabels(markup)).toEqual([
      { label: 'รวมอยู่ใน Pro แล้ว', disabled: true },
      { label: 'Pro ดาวน์โหลดได้ทุกแบบอยู่แล้ว', disabled: true },
      { label: 'ต่อรอบให้อัตโนมัติ', disabled: true },
    ])
  })

  it('renders the open-access notice in English', () => {
    const markup = renderEn(member({ plan: 'pro', credits: 100, openAccess: true }), catalog, false)
    expect(markup).toContain('Pro is free for now')
    expect(markup).toContain('100 AI credits every 30 days')
    expect(markup).toContain('Renews automatically')
  })

  it('lets guests start for free but not buy while sales are closed (login page view)', () => {
    const markup = render({ kind: 'guest' }, null, false)
    expect(ctaLabels(markup)).toEqual([
      { label: 'เริ่มใช้ฟรี', disabled: false },
      { label: 'เปิดขายเร็ว ๆ นี้', disabled: true },
      { label: 'เปิดขายเร็ว ๆ นี้', disabled: true },
    ])
    expect(markup).not.toContain('เข้าสู่ระบบเพื่อซื้อ')
    expect(markup).not.toContain('เข้าสู่ระบบเพื่อสมัคร Pro')
    expect(markup).toContain('ยังไม่เปิดขาย')
    expect(markup).not.toContain('ติดต่อผู้ดูแล')
  })

  it('renders the closed-sales copy in English', () => {
    const markup = renderEn({ kind: 'guest' }, null, false)
    expect(ctaLabels(markup).map((c) => c.label)).toEqual(['Start for free', 'Coming soon', 'Coming soon'])
    expect(markup).toContain('Not on sale yet')
    expect(markup).toContain('we will announce when sales open')
    expect(markup).not.toContain('administrator')
  })

  it('renders an accessible full-page dialog with a comparison table and FAQ', () => {
    const markup = render(member())
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('<table class="pricing-table">')
    expect(markup).toContain('ชำระเงินอย่างไร')
  })
})
