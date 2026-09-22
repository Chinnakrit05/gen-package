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
  })

  it('disables the legacy AI action when cloud mode supplies a reason', () => {
    const reason = 'AI บน Cloud จะเปิดหลังระบบโควตาและความปลอดภัยพร้อม'
    const html = renderToStaticMarkup(createElement(PromptBar, {
      current,
      hasDesign: true,
      onApply: vi.fn(),
      onLoadingChange: vi.fn(),
      disabledReason: reason,
    }))

    expect(html).toContain('disabled=""')
    expect(html).toContain('AI ยังไม่เปิดใช้')
    expect(html).toContain(reason)
  })
})
