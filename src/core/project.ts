import { MATERIALS } from './materials'
import { TEMPLATES } from './templates'
import { parseDecos, parseFillImage, type Deco, type FillImage } from './artwork'
import type { CurrentSpec } from './ai'

// โมเดลข้อมูลของ "งาน" หนึ่งชิ้น + ตัว parse ที่ตรวจ/ซ่อมข้อมูลจาก localStorage หรือไฟล์ที่นำเข้า
// แยกออกจาก App.tsx เพราะทั้งการโหลด store และการนำเข้าไฟล์ (.genpkg.json) ใช้ตัว validate ชุดเดียวกัน

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export const MAX_HISTORY = 30
export const QTY_MIN = 1
export const QTY_MAX = 1_000_000
export const DEFAULT_QTY = 500

export const DEFAULT_SPEC: CurrentSpec = {
  template: 'tuck-end',
  materialId: 'carton-300',
  W: 80,
  D: 50,
  H: 120,
  handle: false,
}

// สิ่งที่ AI สันนิษฐาน/ให้เหตุผลตอนสร้างเวอร์ชันนี้ — เก็บติดไว้เพื่อย้อนดูภายหลัง
// และใช้พิมพ์ลงใบสเปกที่ส่งโรงงาน (assumptions คือจุดที่ต้องให้โรงงานทักท้วง)
export interface AiInfo {
  assumptions: string[]
  layoutNote: string
  reasoning: string
}

export interface DesignVersion {
  label: string
  spec: CurrentSpec
  ai?: AiInfo
}

// qty คือจำนวนที่จะสั่งผลิต ไม่ใช่สเปกของแบบ จึงเก็บระดับงาน ไม่ใช่ใน CurrentSpec
// (ไม่ส่งให้ AI และไม่สร้างเวอร์ชันใหม่เวลาแก้ — มันไม่เปลี่ยนรูปกล่องเลย)
export interface Project {
  id: string
  name: string
  updatedAt: number
  live: CurrentSpec
  qty: number
  fillColor: string | null
  fillImage?: FillImage | null // รูปพื้นแพ็กเกจ (ถ้ามี = ใช้แทน/ทับ fillColor)
  decos: Deco[]
  history: DesignVersion[]
  histIdx: number
}

export const parseQty = (v: unknown): number => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? clamp(n, QTY_MIN, QTY_MAX) : DEFAULT_QTY
}

export function parseSpec(s: unknown): CurrentSpec | null {
  if (typeof s !== 'object' || s === null) return null
  const o = s as Record<string, unknown>
  const template = TEMPLATES.some((t) => t.id === o.template) ? (o.template as string) : null
  const materialId = MATERIALS.some((m) => m.id === o.materialId) ? (o.materialId as string) : null
  const W = Number(o.W)
  const D = Number(o.D)
  const H = Number(o.H)
  if (!template || !materialId || !Number.isFinite(W) || !Number.isFinite(D) || !Number.isFinite(H)) {
    return null
  }
  return {
    template,
    materialId,
    W: clamp(W, 30, 250),
    D: clamp(D, 20, 150),
    H: clamp(H, 30, 300),
    handle: o.handle === true,
  }
}

export function parseAiInfo(v: unknown): AiInfo | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const o = v as Record<string, unknown>
  const assumptions = Array.isArray(o.assumptions)
    ? o.assumptions.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 300))
    : []
  const layoutNote = typeof o.layoutNote === 'string' ? o.layoutNote.slice(0, 200) : ''
  const reasoning = typeof o.reasoning === 'string' ? o.reasoning.slice(0, 600) : ''
  if (!assumptions.length && !layoutNote && !reasoning) return undefined
  return { assumptions, layoutNote, reasoning }
}

export function parseHistory(v: unknown): DesignVersion[] {
  if (!Array.isArray(v)) return []
  return v
    .map((item: unknown): DesignVersion | null => {
      const o = item as Record<string, unknown> | null
      const spec = parseSpec(o?.spec)
      if (!spec) return null
      return { label: String(o?.label ?? 'เวอร์ชัน').slice(0, 120), spec, ai: parseAiInfo(o?.ai) }
    })
    .filter((item): item is DesignVersion => item !== null)
    .slice(-MAX_HISTORY)
}

export function clampIdx(raw: unknown, len: number): number {
  const n = Number(raw)
  return Math.min(Math.max(-1, Number.isInteger(n) ? n : len - 1), len - 1)
}

export function parseProject(v: unknown, idx: number): Project | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const live = parseSpec(o.live)
  if (!live) return null
  const history = parseHistory(o.history)
  return {
    id: typeof o.id === 'string' && o.id ? o.id : crypto.randomUUID(),
    name: String(o.name ?? `งาน ${idx + 1}`).slice(0, 60) || `งาน ${idx + 1}`,
    updatedAt: Number(o.updatedAt) || Date.now(),
    live,
    qty: parseQty(o.qty),
    fillColor: typeof o.fillColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.fillColor) ? o.fillColor : null,
    fillImage: parseFillImage(o.fillImage),
    decos: parseDecos(o.decos, o.artwork),
    history,
    histIdx: clampIdx(o.histIdx, history.length),
  }
}

export function freshProject(n: number): Project {
  return {
    id: crypto.randomUUID(),
    name: `งาน ${n}`,
    updatedAt: Date.now(),
    live: { ...DEFAULT_SPEC },
    qty: DEFAULT_QTY,
    fillColor: null,
    decos: [],
    history: [],
    histIdx: -1,
  }
}
