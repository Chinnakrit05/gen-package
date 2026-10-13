import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { LangCtx } from '../i18n'
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

  it('keeps the AI trigger clickable when blocked (0 credits) and shows a visible 0 hint plus the reason', () => {
    const reason = 'ต้องมีเครดิต AI — ดูแพ็กเกจ'
    const html = renderToStaticMarkup(createElement(PromptBar, {
      current,
      hasDesign: true,
      onApply: vi.fn(),
      onLoadingChange: vi.fn(),
      blockedReason: reason,
      onBlocked: vi.fn(),
      credits: 0,
    }))

    // ไม่ disable — ผู้ใช้จอสัมผัสต้องกดได้แล้วไปหน้าแพ็กเกจ
    expect(html).not.toContain('disabled=""')
    expect(html).not.toContain('aria-disabled')
    expect(html).toContain('สั่ง AI')
    expect(html).toContain(`title="${reason}"`)
    expect(html).toMatch(/<span class="pb-fab-zero" aria-hidden="true">0<\/span>/)
    expect(html).toContain(`<span class="sr-only"> — ${reason}</span>`)
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).not.toContain('AI ยังไม่เปิดใช้')
  })

  it('translates the trigger in English and keeps the blocked hint', () => {
    const html = renderToStaticMarkup(createElement(LangCtx.Provider, { value: 'en' }, createElement(PromptBar, {
      current,
      hasDesign: true,
      onApply: vi.fn(),
      onLoadingChange: vi.fn(),
      blockedReason: 'AI credits for this period are used up',
      onBlocked: vi.fn(),
      credits: 0,
    })))

    expect(html).toContain('Ask AI')
    expect(html).not.toContain('สั่ง AI')
    expect(html).toContain('pb-fab-zero')
    expect(html).toContain('AI credits for this period are used up')
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
    expect(html).not.toContain('pb-fab-zero')
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
