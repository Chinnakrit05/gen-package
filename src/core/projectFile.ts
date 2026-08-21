import { parseProject, type Project } from './project'

// นำเข้า/ส่งออก "งาน" หนึ่งชิ้นเป็นไฟล์ .genpkg.json — เพื่อสำรอง ย้ายเครื่อง หรือส่งให้ลูกค้า/โรงงานเปิดต่อ
// ไฟล์เป็นข้อมูลล้วน (parse ด้วย JSON.parse) ไม่ execute อะไร; นำเข้าแล้วสร้าง id ใหม่เสมอ กันชนกับงานที่มีอยู่

export const PROJECT_FILE_VERSION = 5
const APP_TAG = 'gen-package'

// รูปแบบไฟล์: ห่อ project ไว้ใน envelope มี app/schemaVersion เพื่อ migrate ได้ในอนาคต
interface ProjectFile {
  app: typeof APP_TAG
  schemaVersion: number
  exportedAt: number
  project: {
    name: string
    live: Project['live']
    qty: number
    fillColor: string | null
    fillImage?: Project['fillImage']
    labelStyle?: Project['labelStyle']
    pouchStyle?: Project['pouchStyle']
    zipper?: Project['zipper']
    pouchAddons?: Project['pouchAddons']
    decos: Project['decos']
    history: Project['history']
    histIdx: number
  }
}

// ชื่อไฟล์ปลอดภัยข้ามแพลตฟอร์ม — ตัดอักขระต้องห้ามของ Windows/POSIX ออก
export function projectFileName(name: string): string {
  const safe = name.trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').slice(0, 60) || 'งาน'
  return `${safe}.genpkg.json`
}

export function serializeProject(p: Project): string {
  const file: ProjectFile = {
    app: APP_TAG,
    schemaVersion: PROJECT_FILE_VERSION,
    exportedAt: Date.now(),
    // ไม่เก็บ id/updatedAt — ผู้นำเข้าจะกำหนดใหม่ (id ใหม่กันชน, เวลาแก้ = ตอนนำเข้า)
    project: {
      name: p.name,
      live: p.live,
      qty: p.qty,
      fillColor: p.fillColor,
      // เก็บเฉพาะเมื่อมีรูปพื้น — งานปกติ round-trip เหมือนเดิม
      ...(p.fillImage ? { fillImage: p.fillImage } : {}),
      ...(p.labelStyle && p.labelStyle !== 'body' ? { labelStyle: p.labelStyle } : {}),
      ...(p.pouchStyle && p.pouchStyle !== 'stand' ? { pouchStyle: p.pouchStyle } : {}),
      ...(p.zipper ? { zipper: true } : {}),
      ...(p.pouchAddons && Object.keys(p.pouchAddons).length ? { pouchAddons: p.pouchAddons } : {}),
      decos: p.decos,
      history: p.history,
      histIdx: p.histIdx,
    },
  }
  return JSON.stringify(file, null, 2)
}

export type ImportResult =
  | { ok: true; project: Project; warnings: string[] }
  | { ok: false; error: string }

export function parseProjectFile(text: string): ImportResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'ไฟล์นี้ไม่ใช่ JSON ที่ถูกต้อง' }
  }
  if (typeof data !== 'object' || data === null) {
    return { ok: false, error: 'โครงสร้างไฟล์ไม่ถูกต้อง' }
  }
  const o = data as Record<string, unknown>
  if (o.app !== APP_TAG) {
    return { ok: false, error: 'ไม่ใช่ไฟล์งานของ gen-package' }
  }
  const ver = Number(o.schemaVersion)
  if (!Number.isFinite(ver) || ver > PROJECT_FILE_VERSION) {
    return {
      ok: false,
      error: `ไฟล์นี้มาจากเวอร์ชันใหม่กว่า (schema ${o.schemaVersion}) — อัปเดตแอปก่อนนำเข้า`,
    }
  }

  const src = o.project as Record<string, unknown> | undefined
  const p = parseProject(src, 0)
  if (!p) {
    return { ok: false, error: 'ข้อมูลงานเสียหายหรืออ้างถึงรูปแบบ/วัสดุที่ระบบไม่รู้จัก' }
  }

  // parseProject ซ่อมค่าที่ผิดเงียบ ๆ (clamp ขนาดให้อยู่ในช่วง, ตัด history ที่ยาวเกิน)
  // เก็บรายการเตือนเท่าที่ตรวจได้ เพื่อบอกผู้ใช้ว่าไฟล์ต้นทางกับที่นำเข้าอาจไม่ตรงเป๊ะ
  // (รูปแบบ/วัสดุที่ไม่รู้จักจะทำให้ parseProject คืน null ไปแล้วข้างบน จึงไม่ต้องเตือนที่นี่)
  const warnings: string[] = []
  const srcSpec = (src?.live ?? {}) as Record<string, unknown>
  const clamped = (['W', 'D', 'H'] as const).filter(
    (k) => Number.isFinite(Number(srcSpec[k])) && Number(srcSpec[k]) !== p.live[k],
  )
  if (clamped.length) {
    warnings.push(`ขนาด ${clamped.join('/')} เกินช่วงที่รองรับ — ปรับให้อยู่ในช่วงแล้ว`)
  }
  const srcHist = Array.isArray(src?.history) ? src!.history.length : 0
  if (srcHist > p.history.length) {
    warnings.push(`ประวัติเวอร์ชันยาวเกิน — เก็บ ${p.history.length} เวอร์ชันล่าสุด`)
  }

  // id/updatedAt ใหม่เสมอ แม้ไฟล์จะพก id มา — กันชนกับงานที่เปิดอยู่
  p.id = crypto.randomUUID()
  p.updatedAt = Date.now()
  return { ok: true, project: p, warnings }
}
