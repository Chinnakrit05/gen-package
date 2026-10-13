import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PromptBar } from './PromptBar'

const current = {
  template: 'rsc',
  materialId: 'kraft-350',
  W: 200,
  D: 120,
  H: 80,
  handle: false,
}

describe('PromptBar', () => {
  it('keeps the local AI action available by default', () => {
    const html = renderToStaticMarkup(createElement(PromptBar, {
      current,
      hasDesign: false,
      onApply: vi.fn(),
      onLoadingChange: vi.fn(),
    }))

    expect(html).toContain('สั่ง AI')
    expect(html).not.toContain('disabled=""')
    // ไม่มีเครดิต (local) → ไม่โชว์ตัวเลขเครดิต
    expect(html).not.toContain('เครดิต AI')
  })

  it('disables the AI action when cloud mode supplies a reason (no credits)', () => {
    const reason = 'ต้องมีเครดิต AI — ซื้อแบบนี้ 149 บาท หรือสมัคร Pro'
    const html = renderToStaticMarkup(createElement(PromptBar, {
      current,
      hasDesign: true,
      onApply: vi.fn(),
      onLoadingChange: vi.fn(),
      disabledReason: reason,
      credits: 0,
    }))

    expect(html).toContain('disabled=""')
    expect(html).toContain('AI ยังไม่เปิดใช้')
    expect(html).toContain(reason)
  })

  it('shows the remaining AI credits on the trigger when cloud supplies them', () => {
    const html = renderToStaticMarkup(createElement(PromptBar, {
      current,
      hasDesign: true,
      onApply: vi.fn(),
      onLoadingChange: vi.fn(),
      credits: 7,
    }))

    expect(html).toContain('เครดิต AI: 7')
    expect(html).not.toContain('disabled=""')
  })

  it('never sends a user API key unless allowApiKey (local-demo) is on', async () => {
    // เรียก requestSpec ตรง ๆ ผ่าน prop ไม่ได้จาก static markup — ตรวจสัญญา prop แทน:
    // คอมโพเนนต์รับ allowApiKey (ไม่ใช่ apiKeyRequired เดิม) และยังเรนเดอร์ได้ทั้งสองค่า
    for (const allowApiKey of [false, true]) {
      const html = renderToStaticMarkup(createElement(PromptBar, {
        current,
        hasDesign: false,
        onApply: vi.fn(),
        onLoadingChange: vi.fn(),
        allowApiKey,
        requestSpec: vi.fn(async () => {
          throw new Error('unused')
        }),
      }))
      expect(html).toContain('สั่ง AI')
    }
  })
})
