import { describe, expect, it } from 'vitest'
import {
  serializeProject,
  parseProjectFile,
  projectFileName,
  PROJECT_FILE_VERSION,
} from './projectFile'
import { freshProject, type Project } from './project'

function sampleProject(): Project {
  const p = freshProject(1)
  p.name = 'กล่องชาเขียว'
  p.live = { template: 'mailer', materialId: 'carton-300', W: 120, D: 80, H: 60, handle: false }
  p.qty = 2500
  p.fillColor = '#0f6e56'
  p.decos = [
    { id: 'a1', type: 'text', text: 'ORGANIC', color: '#ffffff', size: 12, w: 40, x: 10, y: 20, rot: 0 },
  ]
  p.history = [
    { label: 'แบบตั้งต้น', spec: { template: 'mailer', materialId: 'carton-300', W: 120, D: 80, H: 60, handle: false } },
  ]
  p.histIdx = 0
  return p
}

describe('projectFile: round-trip', () => {
  it('serialize → parse คืนค่าครบทุกฟิลด์ที่ผู้ใช้แก้', () => {
    const p = sampleProject()
    const res = parseProjectFile(serializeProject(p))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const q = res.project
    expect(q.name).toBe(p.name)
    expect(q.live).toEqual(p.live)
    expect(q.qty).toBe(p.qty)
    expect(q.fillColor).toBe(p.fillColor)
    expect(q.decos).toEqual(p.decos)
    expect(q.history).toEqual(p.history)
    expect(q.histIdx).toBe(p.histIdx)
    expect(res.warnings).toEqual([])
  })

  it('นำเข้าได้ id ใหม่เสมอ (กันชนกับงานที่เปิดอยู่)', () => {
    const p = sampleProject()
    const res = parseProjectFile(serializeProject(p))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.project.id).not.toBe(p.id)
    expect(res.project.id).toBeTruthy()
  })

  it('ไฟล์ที่เขียนออกมาอ่านง่าย (JSON มี indent) และมี envelope ครบ', () => {
    const s = serializeProject(sampleProject())
    const o = JSON.parse(s)
    expect(o.app).toBe('gen-package')
    expect(o.schemaVersion).toBe(PROJECT_FILE_VERSION)
    expect(typeof o.exportedAt).toBe('number')
    // ไม่พก id/updatedAt ออกไป — ผู้นำเข้ากำหนดใหม่
    expect(o.project.id).toBeUndefined()
    expect(o.project.updatedAt).toBeUndefined()
    expect(s.includes('\n')).toBe(true)
  })
})

describe('projectFile: ปฏิเสธไฟล์เสีย', () => {
  it('ไม่ใช่ JSON', () => {
    const res = parseProjectFile('{ not json')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('JSON')
  })

  it('JSON ที่ไม่ใช่ object', () => {
    expect(parseProjectFile('42').ok).toBe(false)
    expect(parseProjectFile('null').ok).toBe(false)
    expect(parseProjectFile('"hi"').ok).toBe(false)
  })

  it('ไม่มี app tag ของ gen-package', () => {
    const res = parseProjectFile(JSON.stringify({ schemaVersion: 1, project: {} }))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('gen-package')
  })

  it('schema ใหม่กว่าที่รองรับ → ปฏิเสธ', () => {
    const p = sampleProject()
    const file = JSON.parse(serializeProject(p))
    file.schemaVersion = PROJECT_FILE_VERSION + 1
    const res = parseProjectFile(JSON.stringify(file))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('ใหม่กว่า')
  })

  it('project อ้างถึงรูปแบบที่ระบบไม่รู้จัก → ปฏิเสธ', () => {
    const p = sampleProject()
    const file = JSON.parse(serializeProject(p))
    file.project.live.template = 'ไม่มีแบบนี้'
    const res = parseProjectFile(JSON.stringify(file))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('ไม่รู้จัก')
  })

  it('ไม่มี project เลย → ปฏิเสธ', () => {
    const res = parseProjectFile(JSON.stringify({ app: 'gen-package', schemaVersion: 1 }))
    expect(res.ok).toBe(false)
  })
})

describe('projectFile: เตือนเมื่อ parse ซ่อมค่า', () => {
  it('ขนาดเกินช่วง → clamp + เตือน', () => {
    const p = sampleProject()
    const file = JSON.parse(serializeProject(p))
    file.project.live.W = 9999 // เกิน 250
    const res = parseProjectFile(JSON.stringify(file))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.project.live.W).toBe(250)
    expect(res.warnings.some((w) => w.includes('W'))).toBe(true)
  })

  it('ไม่มีการซ่อม → ไม่มีคำเตือน', () => {
    const res = parseProjectFile(serializeProject(sampleProject()))
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.warnings).toEqual([])
  })
})

describe('projectFile: ชื่อไฟล์', () => {
  it('ตัดอักขระต้องห้ามของ Windows/POSIX ออก และลงท้าย .genpkg.json', () => {
    expect(projectFileName('กล่อง/ชา:เขียว?')).toBe('กล่อง_ชา_เขียว_.genpkg.json')
    expect(projectFileName('  ')).toBe('งาน.genpkg.json')
    expect(projectFileName('a<b>c|d')).toBe('a_b_c_d.genpkg.json')
  })
})
