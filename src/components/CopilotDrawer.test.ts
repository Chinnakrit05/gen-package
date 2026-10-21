import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { LangCtx } from '../i18n'
import { AiTrigger, CopilotDrawer, placeholderFields } from './CopilotDrawer'
import type { Deco } from '../core/artwork'

const current = { template: 'rsc', materialId: 'kraft-350', W: 200, D: 120, H: 80, handle: false }

describe('AiTrigger (ปุ่มสั่ง AI บน header)', () => {
  it('keeps the local AI action available by default', () => {
    const html = renderToStaticMarkup(createElement(AiTrigger, { open: false, onToggle: vi.fn() }))
    expect(html).toContain('สั่ง AI')
    expect(html).not.toContain('disabled=""')
    expect(html).not.toContain('เครดิต AI')
  })

  it('keeps the trigger clickable when blocked (0 credits) and shows a visible 0 hint plus the reason', () => {
    const reason = 'ต้องมีเครดิต AI — ดูแพ็กเกจ'
    const html = renderToStaticMarkup(createElement(AiTrigger, { open: false, onToggle: vi.fn(), blockedReason: reason, onBlocked: vi.fn(), credits: 0 }))
    expect(html).not.toContain('disabled=""')
    expect(html).toContain(`title="${reason}"`)
    expect(html).toMatch(/<span class="pb-fab-zero" aria-hidden="true">0<\/span>/)
    expect(html).toContain(`<span class="sr-only"> — ${reason}</span>`)
    expect(html).toContain('aria-haspopup="dialog"')
  })

  it('translates the trigger in English and shows remaining credits from cloud', () => {
    const en = renderToStaticMarkup(createElement(LangCtx.Provider, { value: 'en' }, createElement(AiTrigger, { open: false, onToggle: vi.fn(), blockedReason: 'AI credits for this period are used up', credits: 0 })))
    expect(en).toContain('Ask AI')
    expect(en).toContain('pb-fab-zero')
    const th = renderToStaticMarkup(createElement(AiTrigger, { open: true, onToggle: vi.fn(), credits: 7 }))
    expect(th).toContain('เครดิต AI: 7')
    expect(th).toContain('aria-expanded="true"')
  })
})

describe('CopilotDrawer', () => {
  const base = {
    open: true,
    onClose: vi.fn(),
    current,
    hasDesign: false,
    onApplySpec: vi.fn(),
    lastSnapshotId: null,
    onOpenStage: vi.fn(),
    onLoadingChange: vi.fn(),
  }

  it('renders nothing when closed and the greeting + both modes when open', () => {
    expect(renderToStaticMarkup(createElement(CopilotDrawer, { ...base, open: false, artwork: null }))).toBe('')
    const html = renderToStaticMarkup(createElement(CopilotDrawer, { ...base, artwork: null }))
    expect(html).toContain('Copilot')
    expect(html).toContain('โครงกล่องจากคำสั่ง')
    expect(html).toContain('ออกแบบหน้าตาบนแบบนี้')
    // ไม่มีบริบท artwork (ยังไม่มีแบบในงาน): โหมดหน้าตาถูกปิดพร้อมบอกเหตุผล
    expect(html).toContain('ต้องมีแบบในงานก่อน')
    expect(html).toContain('สร้างกล่อง')
    expect(html).not.toContain('Anthropic API key')
  })

  it('offers the API key row only when allowApiKey (local-demo) is on, and shows the paywall banner when blocked', () => {
    const local = renderToStaticMarkup(createElement(CopilotDrawer, { ...base, artwork: null, allowApiKey: true }))
    expect(local).toContain('คีย์')
    const blocked = renderToStaticMarkup(createElement(CopilotDrawer, { ...base, artwork: null, blockedReason: 'เครดิตหมด', onBlocked: vi.fn(), credits: 0 }))
    expect(blocked).toContain('เครดิตหมด')
    expect(blocked).toContain('ดูแพ็กเกจ')
    expect(blocked).toContain('เครดิตคงเหลือ 0')
  })

  it('placeholderFields pulls [กรอก…] slots out of text decos', () => {
    const decos = [
      { id: 'a', type: 'text', text: 'ที่อยู่: [กรอกที่อยู่]\nโทร: [กรอกเบอร์]', color: '#000000', size: 3, w: 10, x: 0, y: 0, rot: 0 },
      { id: 'b', type: 'text', text: 'เลข GTIN [กรอกเบอร์]', color: '#000000', size: 3, w: 10, x: 0, y: 0, rot: 0 },
      { id: 'c', type: 'shape', shape: 'rect', w: 1, h: 1, fill: '#000000', stroke: 'none', strokeW: 0, x: 0, y: 0, rot: 0 },
    ] as Deco[]
    expect(placeholderFields(decos)).toEqual(['กรอกที่อยู่', 'กรอกเบอร์'])
  })
})
