import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { BillingCatalog } from '../../shared/contracts/billing'
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

const render = (viewer: PricingViewer, cat: BillingCatalog | null = catalog) =>
  renderToStaticMarkup(createElement(PricingPage, { viewer, catalog: cat, onClose() {}, onChoose() {} }))

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
    const markup = render({ kind: 'guest' }, null)
    expect(markup).toContain('เข้าสู่ระบบเพื่อซื้อ')
    expect(markup).toContain('เข้าสู่ระบบเพื่อสมัคร Pro')
    expect(markup).toContain('กลับไปหน้าเข้าสู่ระบบ')
    expect(markup).toContain('฿149')
    expect(markup).toContain('฿399')
    expect(markup).not.toContain('แพ็กเกจปัจจุบัน')
    expect(markup).not.toMatch(/เครดิต AI \d+ เครดิต/)
    expect(markup).not.toContain('pricing-status')
  })

  it('renders an accessible full-page dialog with a comparison table and FAQ', () => {
    const markup = render(member())
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('<table class="pricing-table">')
    expect(markup).toContain('ชำระเงินอย่างไร')
  })
})
