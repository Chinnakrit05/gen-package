import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Entitlements, Order } from '../../shared/contracts/billing'
import { PaywallModal, formatBaht } from './PaywallModal'

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

const render = (props: Partial<Parameters<typeof PaywallModal>[0]>) => renderToStaticMarkup(createElement(PaywallModal, {
  kind: 'design',
  entitlements,
  projectName: 'กล่องชา',
  busy: false,
  onClose: vi.fn(),
  onPurchase: vi.fn(async () => order),
  onDevFulfil: vi.fn(async () => {}),
  ...props,
}))

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

  it('falls back to catalog defaults when entitlements failed to load', () => {
    const html = render({ entitlements: null })
    expect(html).toContain('149')
    expect(html).not.toContain('แถมเครดิต')
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
})
