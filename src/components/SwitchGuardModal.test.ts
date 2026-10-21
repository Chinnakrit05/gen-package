import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { LangCtx } from '../i18n'
import { SwitchGuardModal } from './SwitchGuardModal'

const summary = { text: 2, image: 1, shape: 0, nutrition: 0, fillImage: false, fillColor: true, total: 4 }

describe('SwitchGuardModal (เตือนก่อนสลับประเภทงาน/รูปแบบ)', () => {
  it('เป็น alertdialog ที่บอกชัดว่างานเดิมจะถูกลบ พร้อมรายการที่จะหายและปุ่มยืนยันสีอันตราย', () => {
    const html = renderToStaticMarkup(
      createElement(SwitchGuardModal, { what: 'รูปแบบบรรจุภัณฑ์', fromName: 'กล่องฝาเสียบ (tuck end)', toName: 'ปลอกสวม (sleeve)', summary, onConfirm: vi.fn(), onCancel: vi.fn() }),
    )
    expect(html).toContain('role="alertdialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('เปลี่ยนรูปแบบบรรจุภัณฑ์แล้ว งานของรูปแบบเดิมจะถูกลบไปเลย')
    expect(html).toContain('«กล่องฝาเสียบ (tuck end)» (4 รายการ)')
    expect(html).toContain('«ปลอกสวม (sleeve)»')
    expect(html).toContain('ข้อความ 2 · รูปภาพ 1 · สีพื้น')
    expect(html).toContain('ต้องการจะเปลี่ยนใช่ไหม')
    expect(html).toContain('Ctrl+Z')
    expect(html).toContain('ยกเลิก เก็บงานเดิมไว้')
    expect(html).toMatch(/<button type="button" class="danger">ลบงานเดิมแล้วเปลี่ยน<\/button>/)
  })

  it('แปลเป็นอังกฤษตามภาษา UI', () => {
    const html = renderToStaticMarkup(
      createElement(LangCtx.Provider, { value: 'en' }, createElement(SwitchGuardModal, { what: 'job type', fromName: 'Folding box', toName: 'Film pouch', summary, onConfirm: vi.fn(), onCancel: vi.fn() })),
    )
    expect(html).toContain('Changing the job type deletes the work on the current one')
    expect(html).toContain('Delete it and switch')
    expect(html).toContain('Text 2 · Images 1 · Background colour')
  })
})
