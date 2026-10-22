import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { LangCtx } from '../i18n'
import { SwitchGuardModal } from './SwitchGuardModal'

describe('SwitchGuardModal (ถามก่อนเปลี่ยนประเภทงาน/รูปแบบ → บันทึกแล้วเริ่มชิ้นงานใหม่)', () => {
  it('เป็น alertdialog บอกว่าจะบันทึกงานนี้แล้วเริ่มชิ้นงานใหม่ การตกแต่งไม่ตามไป', () => {
    const html = renderToStaticMarkup(createElement(SwitchGuardModal, { onConfirm: vi.fn(), onCancel: vi.fn() }))
    expect(html).toContain('role="alertdialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('<h3 id="switch-guard-title">เริ่มชิ้นงานใหม่</h3>')
    expect(html).toContain('<strong>บันทึก</strong>')
    expect(html).toContain('การตกแต่งในชิ้นงานนี้ของคุณจะไม่ถูกนำไปใช้ในงานใหม่')
    expect(html).toContain('>ยกเลิก</button>')
    expect(html).toMatch(/<button type="button" class="go">เริ่มชิ้นงานใหม่<\/button>/)
    expect(html).not.toContain('ลบ') // ไม่มีการลบงานเดิมอีกแล้ว
  })

  it('แปลเป็นอังกฤษตามภาษา UI', () => {
    const html = renderToStaticMarkup(
      createElement(LangCtx.Provider, { value: 'en' }, createElement(SwitchGuardModal, { onConfirm: vi.fn(), onCancel: vi.fn() })),
    )
    expect(html).toContain('Start a new piece')
    expect(html).toContain('<strong>save</strong>')
    expect(html).toContain('will not carry over')
  })
})
