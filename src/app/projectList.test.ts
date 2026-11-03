import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ProjectPage, ProjectSummary } from '../../shared/contracts/projects'
import { mergeProjectPages, PROJECT_PAGE_SIZE } from './projectList'

// fixture สังเคราะห์ของ B (docs/marketplace/fixtures/phase-1.json) — ใช้ตรวจรูปแบบเท่านั้น ไม่ใช่ผล integration
const fixtures = JSON.parse(readFileSync(new URL('../../docs/marketplace/fixtures/phase-1.json', import.meta.url), 'utf8')) as {
  cases: Record<string, { response: { data: ProjectPage } }>
}
const page1 = fixtures.cases['projects.page1'].response.data
const page2 = fixtures.cases['projects.page2'].response.data

const summary = (id: string, updatedAt: string, revision = 1): ProjectSummary => ({
  id,
  workspaceId: '00000000-0000-4000-8000-000000000001',
  name: id,
  revision,
  updatedAt,
})

describe('mergeProjectPages', () => {
  it('fixture หน้า 1 มีเท่าขนาดหน้าที่ UI ขอ และรวมสองหน้าได้ 25 ไม่ซ้ำ', () => {
    expect(page1.items).toHaveLength(PROJECT_PAGE_SIZE)
    const merged = mergeProjectPages([page1, page2])
    expect(merged).toHaveLength(25)
    expect(new Set(merged.map((item) => item.id)).size).toBe(25)
  })

  it('งานที่ถูกแก้ระหว่างโหลดแล้วโผล่ซ้ำในหน้าถัดไป เหลือตัวเดียวที่ revision ใหม่กว่า และขึ้นบนสุด', () => {
    const a = summary('a', '2026-11-01T10:00:00.000Z')
    const b = summary('b', '2026-11-01T09:00:00.000Z')
    const bMoved = summary('b', '2026-11-01T11:00:00.000Z', 2)
    const merged = mergeProjectPages([{ items: [a, b] }, { items: [bMoved] }])
    expect(merged.map((item) => [item.id, item.revision])).toEqual([['b', 2], ['a', 1]])
  })

  it('revision เก่ากว่าที่มาทีหลังไม่ทับของใหม่', () => {
    const fresh = summary('x', '2026-11-01T11:00:00.000Z', 3)
    const stale = summary('x', '2026-11-01T09:00:00.000Z', 2)
    expect(mergeProjectPages([{ items: [fresh] }, { items: [stale] }])[0].revision).toBe(3)
  })

  it('เวลาเท่ากันเรียง id มากไปน้อยแบบ server', () => {
    const t = '2026-11-01T10:00:00.000Z'
    expect(mergeProjectPages([{ items: [summary('a', t), summary('c', t), summary('b', t)] }]).map((i) => i.id))
      .toEqual(['c', 'b', 'a'])
  })
})
