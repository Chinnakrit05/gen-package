// รวมหลายหน้าของ GET /projects (R1 ใน ROUTES-PHASE-1.md §7) — pure
// cursor เป็น keyset ไม่ใช่ snapshot: งานที่ถูกแก้ระหว่างโหลดอาจซ้ำข้ามหน้าหรือหายจากหน้าถัดไป
// จึงตัดซ้ำด้วย id (เก็บ revision สูงกว่า) แล้วเรียงใหม่ ไม่ชดเชยด้วยการโหลดทุกหน้า
import type { ProjectSummary } from '../../shared/contracts/projects'

export const PROJECT_PAGE_SIZE = 24

export function mergeProjectPages(pages: readonly { items: readonly ProjectSummary[] }[]): ProjectSummary[] {
  const byId = new Map<string, ProjectSummary>()
  for (const page of pages) {
    for (const item of page.items) {
      const seen = byId.get(item.id)
      if (!seen || newer(item, seen)) byId.set(item.id, item)
    }
  }
  return [...byId.values()].sort(compareSummaries)
}

function newer(a: ProjectSummary, b: ProjectSummary): boolean {
  if (a.revision !== b.revision) return a.revision > b.revision
  return Date.parse(a.updatedAt) > Date.parse(b.updatedAt)
}

// ลำดับเดียวกับ server: updatedAt DESC แล้ว id DESC
export function compareSummaries(a: ProjectSummary, b: ProjectSummary): number {
  const time = Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  if (time !== 0) return time
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}
