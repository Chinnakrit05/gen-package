import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { MATERIALS, getMaterial } from './core/materials'
import { TEMPLATES, getTemplate } from './core/templates'
import type { Dieline } from './core/types'
import type { AiBoxSpec, CurrentSpec } from './core/ai'
import { dielineDXFString } from './core/dxf'
import { dielinePDFBytes } from './core/pdf'
import { specSheetPDFBytes } from './core/specSheet'
import {
  loadImageFile,
  makeImageEl,
  makeTextEl,
  recenter,
  withTextW,
  parseDecos,
  svgArtworkLayer,
  renderArtworkCanvas,
  elW,
  type Deco,
} from './core/artwork'
import { computeGuides, guidesSVGLayer, type Guides } from './core/guides'
import { generateVessel } from './core/vessel'
// โหลด viewer 3D แบบ lazy — three + R3F เป็นก้อนใหญ่สุดของ bundle และไม่จำเป็น
// ต่อการเรนเดอร์ครั้งแรก (แถบซ้าย + blueprint เป็น SVG ล้วน) แยกออกไปให้หน้าแรกเบาลง
const Viewer3D = lazy(() => import('./components/Viewer3D').then((m) => ({ default: m.Viewer3D })))
const VesselViewer3D = lazy(() =>
  import('./components/VesselViewer3D').then((m) => ({ default: m.VesselViewer3D })),
)
import { DielineSVG } from './components/DielineSVG'
import { PromptBar } from './components/PromptBar'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

interface DimFieldProps {
  label: string
  value: number
  min: number
  max: number
  disabled?: boolean
  onChange: (v: number) => void
}

function DimField({ label, value, min, max, disabled, onChange }: DimFieldProps) {
  const commit = (v: number) => onChange(clamp(Number.isFinite(v) ? v : min, min, max))
  return (
    <div className="field">
      <span className="field-head">
        {label}
        <span className="field-num">
          <input
            type="number"
            min={min}
            max={max}
            step={0.5}
            value={value}
            disabled={disabled}
            aria-label={label}
            onChange={(e) => commit(Number(e.target.value))}
          />
          มม.
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={0.5}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => commit(Number(e.target.value))}
      />
    </div>
  )
}

// จัดเป็นเลเยอร์ตั้งชื่อ cut/crease/dims เพื่อให้เปิดใน Illustrator/CorelDRAW แล้วแยกชั้นได้
// (โปรแกรมพวกนี้เอา id ของ <g> ไปเป็นชื่อเลเยอร์) ส่วน attribute inkscape:* ทำให้
// Inkscape มองเป็นเลเยอร์จริงด้วย — สำคัญตรงที่เลเยอร์ dims ต้องปิด/ลบทิ้งได้ในคลิกเดียว
// ก่อนส่งโรงงาน ไม่งั้นเสี่ยงโดนตัดตามเส้นบอกขนาด
function svgLayer(id: string, attrs: string, body: string): string {
  if (!body) return ''
  return (
    `  <g id="${id}" inkscape:groupmode="layer" inkscape:label="${id}" ${attrs}>\n` +
    `${body}\n  </g>\n`
  )
}

function dielineSVGString(
  d: Dieline,
  withDims: boolean,
  decos: Deco[] = [],
  guides: Guides | null = null,
): string {
  const pathsOf = (kind: 'cut' | 'crease') =>
    d.segments
      .filter((s) => s.kind === kind)
      .map((s) => `    <path d="${s.d}"/>`)
      .join('\n')

  const cutLayer = svgLayer('cut', 'fill="none" stroke="#e30613" stroke-width="0.35"', pathsOf('cut'))
  const creaseLayer = svgLayer(
    'crease',
    'fill="none" stroke="#009640" stroke-width="0.35" stroke-dasharray="4 2.5"',
    pathsOf('crease'),
  )

  let dimLayer = ''
  let pad = 5
  if (withDims) {
    pad = 26
    const marks = d.dims
      .map((m) => {
        const vert = Math.abs(m.a.x - m.b.x) < 0.001
        const mx = (m.a.x + m.b.x) / 2
        const my = (m.a.y + m.b.y) / 2
        const ticks = vert
          ? `<line x1="${m.a.x - 2.5}" y1="${m.a.y}" x2="${m.a.x + 2.5}" y2="${m.a.y}"/><line x1="${m.b.x - 2.5}" y1="${m.b.y}" x2="${m.b.x + 2.5}" y2="${m.b.y}"/>`
          : `<line x1="${m.a.x}" y1="${m.a.y - 2.5}" x2="${m.a.x}" y2="${m.a.y + 2.5}"/><line x1="${m.b.x}" y1="${m.b.y - 2.5}" x2="${m.b.x}" y2="${m.b.y + 2.5}"/>`
        const label = vert
          ? `<text x="${mx}" y="${my}" transform="rotate(-90 ${mx} ${my})" dy="-2" text-anchor="middle" fill="#1b6ea8" font-size="6" stroke="none">${m.label}</text>`
          : `<text x="${mx}" y="${my - 2}" text-anchor="middle" fill="#1b6ea8" font-size="6" stroke="none">${m.label}</text>`
        return `    <line x1="${m.a.x}" y1="${m.a.y}" x2="${m.b.x}" y2="${m.b.y}"/>${ticks}${label}`
      })
      .join('\n')
    dimLayer = svgLayer('dims', 'stroke="#1b6ea8" stroke-width="0.25" font-family="sans-serif"', marks)
  }

  // artwork อยู่ล่างสุด (วาดก่อน) เพื่อให้เส้น cut/crease โชว์ทับเป็นไกด์ — ตรงกับที่เห็นบนจอ
  const artLayer = svgArtworkLayer(decos)
  const guideLayer = guides ? guidesSVGLayer(guides) : ''

  const w = d.width + pad * 2
  const h = d.height + pad * 2
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"` +
    ` xmlns:xlink="http://www.w3.org/1999/xlink"` +
    ` width="${w}mm" height="${h}mm" viewBox="${-pad} ${-pad} ${w} ${h}">\n` +
    `<!-- สเกลจริง 1:1 หน่วย mm | artwork = ลายพิมพ์ | cut = เส้นตัด (แดง) | crease = เส้นพับ (เขียวประ) | guides = เผื่อตัด/ปลอดภัย | dims = เส้นบอกขนาด (ห้ามใช้ผลิต) -->\n` +
    `${artLayer}${cutLayer}${creaseLayer}${guideLayer}${dimLayer}</svg>\n`
  )
}

const QTY_MIN = 1
const QTY_MAX = 1_000_000
const DEFAULT_QTY = 500

const parseQty = (v: unknown): number => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? clamp(n, QTY_MIN, QTY_MAX) : DEFAULT_QTY
}

// ช่องจำนวนเก็บข้อความที่กำลังพิมพ์ไว้ต่างหาก ไม่ผูกกับตัวเลขโดยตรง
// ถ้า clamp ทุกครั้งที่พิมพ์ พอผู้ใช้ลบจนว่างช่องจะเด้งเป็นค่าต่ำสุดทันที
// แล้วพิมพ์ต่อจะได้เลขปนกัน — จำนวนเป็นค่าที่แก้บ่อย ต้องพิมพ์ได้ลื่น
// จึงยอมให้ค่าระหว่างพิมพ์ยังไม่ถูกต้องได้ แล้วค่อยจัดให้เข้าที่ตอนออกจากช่อง
function QtyField({
  value,
  disabled,
  onChange,
}: {
  value: number
  disabled?: boolean
  onChange: (v: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])

  const type = (raw: string) => {
    setDraft(raw)
    const n = Math.round(Number(raw))
    if (raw.trim() !== '' && Number.isFinite(n) && n >= QTY_MIN && n <= QTY_MAX) onChange(n)
  }

  const settle = () => {
    if (draft.trim() === '' || !Number.isFinite(Number(draft))) {
      setDraft(String(value)) // ปล่อยว่างแล้วออก = ไม่เปลี่ยนอะไร
      return
    }
    const v = parseQty(draft)
    onChange(v)
    setDraft(String(v))
  }

  return (
    <input
      type="number"
      min={QTY_MIN}
      max={QTY_MAX}
      step={50}
      value={draft}
      disabled={disabled}
      aria-label="จำนวนที่จะสั่ง"
      onChange={(e) => type(e.target.value)}
      onBlur={settle}
    />
  )
}

// สิ่งที่ AI สันนิษฐาน/ให้เหตุผลตอนสร้างเวอร์ชันนี้ — เก็บติดไว้เพื่อย้อนดูภายหลัง
// และใช้พิมพ์ลงใบสเปกที่ส่งโรงงาน (assumptions คือจุดที่ต้องให้โรงงานทักท้วง)
interface AiInfo {
  assumptions: string[]
  layoutNote: string
  reasoning: string
}

interface DesignVersion {
  label: string
  spec: CurrentSpec
  ai?: AiInfo
}

const sameSpec = (a: CurrentSpec, b: CurrentSpec) =>
  a.template === b.template &&
  a.materialId === b.materialId &&
  a.W === b.W &&
  a.D === b.D &&
  a.H === b.H &&
  a.handle === b.handle

// --- บันทึกหลายงาน (project) + ประวัติเวอร์ชันของแต่ละงานลง localStorage ---

const STORAGE_KEY = 'gen-package-projects-v1'
const LEGACY_KEY = 'gen-package-design-v1'
const MAX_HISTORY = 30

// qty คือจำนวนที่จะสั่งผลิต ไม่ใช่สเปกของแบบ จึงเก็บระดับงาน ไม่ใช่ใน CurrentSpec
// (ไม่ส่งให้ AI และไม่สร้างเวอร์ชันใหม่เวลาแก้ — มันไม่เปลี่ยนรูปกล่องเลย)
interface Project {
  id: string
  name: string
  updatedAt: number
  live: CurrentSpec
  qty: number
  decos: Deco[]
  history: DesignVersion[]
  histIdx: number
}

interface Store {
  projects: Project[]
  activeId: string
  showDims: boolean
}

const DEFAULT_SPEC: CurrentSpec = {
  template: 'tuck-end',
  materialId: 'carton-300',
  W: 80,
  D: 50,
  H: 120,
  handle: false,
}

function freshProject(n: number): Project {
  return {
    id: crypto.randomUUID(),
    name: `งาน ${n}`,
    updatedAt: Date.now(),
    live: { ...DEFAULT_SPEC },
    qty: DEFAULT_QTY,
    decos: [],
    history: [],
    histIdx: -1,
  }
}

function parseSpec(s: unknown): CurrentSpec | null {
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

function parseAiInfo(v: unknown): AiInfo | undefined {
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

function parseHistory(v: unknown): DesignVersion[] {
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

function clampIdx(raw: unknown, len: number): number {
  const n = Number(raw)
  return Math.min(Math.max(-1, Number.isInteger(n) ? n : len - 1), len - 1)
}

function parseProject(v: unknown, idx: number): Project | null {
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
    decos: parseDecos(o.decos, o.artwork),
    history,
    histIdx: clampIdx(o.histIdx, history.length),
  }
}

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const d = JSON.parse(raw) as Record<string, unknown>
      const projects = Array.isArray(d.projects)
        ? d.projects
            .map((p: unknown, i: number) => parseProject(p, i))
            .filter((p): p is Project => p !== null)
        : []
      if (projects.length > 0) {
        const activeId = projects.some((p) => p.id === d.activeId)
          ? (d.activeId as string)
          : projects[0].id
        return { projects, activeId, showDims: d.showDims !== false }
      }
    }
  } catch {
    // ตกไปเช็คข้อมูลรุ่นเก่า
  }

  // ย้ายข้อมูลรุ่นเก่า (งานเดียว) เข้าระบบหลายงาน
  try {
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy) {
      const d = JSON.parse(legacy) as Record<string, unknown>
      const live = parseSpec(d.live)
      if (live) {
        const history = parseHistory(d.history)
        const p: Project = {
          id: crypto.randomUUID(),
          name: 'งาน 1',
          updatedAt: Date.now(),
          live,
          qty: DEFAULT_QTY,
          decos: [],
          history,
          histIdx: clampIdx(d.histIdx, history.length),
        }
        localStorage.removeItem(LEGACY_KEY)
        return { projects: [p], activeId: p.id, showDims: d.showDims !== false }
      }
    }
  } catch {
    // ใช้ค่าเริ่มต้น
  }

  const p = freshProject(1)
  return { projects: [p], activeId: p.id, showDims: true }
}

const store0 = loadStore()
const active0 = store0.projects.find((p) => p.id === store0.activeId) ?? store0.projects[0]

export default function App() {
  const [projects, setProjects] = useState<Project[]>(store0.projects)
  const [activeId, setActiveId] = useState(active0.id)
  const [templateId, setTemplateId] = useState(active0.live.template)
  const [materialId, setMaterialId] = useState(active0.live.materialId)
  const [W, setW] = useState(active0.live.W)
  const [D, setD] = useState(active0.live.D)
  const [H, setH] = useState(active0.live.H)
  const [handle, setHandle] = useState(active0.live.handle)
  const [qty, setQty] = useState(active0.qty)
  const [decos, setDecos] = useState<Deco[]>(active0.decos)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [fold, setFold] = useState(1)
  const [showDims, setShowDims] = useState(store0.showDims)
  const [showGuides, setShowGuides] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [history, setHistory] = useState<DesignVersion[]>(active0.history)
  const [histIdx, setHistIdx] = useState(active0.histIdx)
  const raf = useRef(0)

  const template = getTemplate(templateId)
  const mat = getMaterial(materialId)
  // วัสดุกลุ่มพับไม่ได้ → เส้นทางภาชนะ: ทรง revolve + dieline ของ "ฉลาก"
  // ฉลากเป็น Dieline ธรรมดา ระบบเดิมทั้งหมด (artwork/export/guides/ใบสเปก) จึงใช้ต่อได้เลย
  const vessel = useMemo(
    () => (mat.foldable ? null : generateVessel({ W, D, H, handle }, mat)),
    [W, D, H, handle, mat],
  )
  const dieline = useMemo(
    () => (mat.foldable ? template.generate({ W, D, H, handle }, mat) : vessel!.label),
    [W, D, H, handle, mat, template, vessel],
  )
  const guides = useMemo(
    () => (showGuides && dieline ? computeGuides(dieline.panels) : null),
    [showGuides, dieline],
  )

  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  // sync สถานะปัจจุบันเข้างานที่เปิดอยู่ (หน่วงสั้นๆ กันเขียนถี่ตอนลาก slider)
  useEffect(() => {
    const t = setTimeout(() => {
      setProjects((prev) =>
        prev.map((p) =>
          p.id === activeId
            ? {
                ...p,
                live: { template: templateId, materialId, W, D, H, handle },
                qty,
                decos,
                history,
                histIdx,
                updatedAt: Date.now(),
              }
            : p,
        ),
      )
    }, 300)
    return () => clearTimeout(t)
  }, [history, histIdx, templateId, materialId, W, D, H, handle, qty, decos, activeId])

  // save ทุกงานลง localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ projects, activeId, showDims }))
    } catch {
      // storage เต็มหรือถูกปิดไว้ — ข้ามการ save เงียบๆ
    }
  }, [projects, activeId, showDims])

  const play = () => {
    cancelAnimationFrame(raf.current)
    const t0 = performance.now()
    const dur = 3000
    const step = (now: number) => {
      const u = clamp((now - t0) / dur, 0, 1)
      setFold(u)
      if (u < 1) raf.current = requestAnimationFrame(step)
    }
    setFold(0)
    raf.current = requestAnimationFrame(step)
  }

  const liveSpec = (): CurrentSpec => ({ template: templateId, materialId, W, D, H, handle })

  const setSpec = (spec: CurrentSpec) => {
    setTemplateId(spec.template)
    setMaterialId(spec.materialId)
    setW(clamp(spec.W, 30, 250))
    setD(clamp(spec.D, 20, 150))
    setH(clamp(spec.H, 30, 300))
    setHandle(spec.handle && getTemplate(spec.template).supportsHandle)
  }

  const applySpec = (spec: AiBoxSpec, label: string) => {
    const applied: CurrentSpec = {
      template: spec.template,
      materialId: spec.materialId,
      W: clamp(spec.W, 30, 250),
      D: clamp(spec.D, 20, 150),
      H: clamp(spec.H, 30, 300),
      handle: spec.handle && getTemplate(spec.template).supportsHandle,
    }
    // เก็บเวอร์ชัน: ตัด redo tail, เก็บสถานะก่อนหน้า (ตั้งต้น/ปรับเอง) ถ้ายังไม่ถูกเก็บ
    const live = liveSpec()
    const h = history.slice(0, histIdx + 1)
    if (h.length === 0) h.push({ label: 'แบบตั้งต้น', spec: live })
    else if (!sameSpec(h[h.length - 1].spec, live)) h.push({ label: 'ปรับเองด้วยมือ', spec: live })
    h.push({
      label,
      spec: applied,
      ai: {
        assumptions: spec.assumptions,
        layoutNote: spec.layoutNote,
        reasoning: spec.reasoning,
      },
    })
    if (h.length > MAX_HISTORY) h.splice(0, h.length - MAX_HISTORY)
    setHistory(h)
    setHistIdx(h.length - 1)

    // งานที่ยังใช้ชื่ออัตโนมัติ ("งาน N") ตั้งชื่อตาม prompt แรกให้เลย
    setProjects((prev) =>
      prev.map((p) =>
        p.id === activeId && /^งาน \d+$/.test(p.name) && label
          ? { ...p, name: label.slice(0, 40) }
          : p,
      ),
    )

    setSpec(applied)
    if (getMaterial(applied.materialId).foldable) play()
    else setFold(1)
  }

  const restoreVersion = (i: number) => {
    const v = history[i]
    if (!v || aiBusy) return
    cancelAnimationFrame(raf.current)
    setHistIdx(i)
    setSpec(v.spec)
    setFold(1)
  }

  const clearHistory = () => {
    if (aiBusy) return
    if (!window.confirm('ลบประวัติเวอร์ชันทั้งหมด? (แบบปัจจุบันยังอยู่)')) return
    setHistory([])
    setHistIdx(-1)
  }

  // --- จัดการหลายงาน (navbar) ---

  const flushInto = (list: Project[]): Project[] =>
    list.map((p) =>
      p.id === activeId
        ? { ...p, live: liveSpec(), qty, decos, history, histIdx, updatedAt: Date.now() }
        : p,
    )

  const openProject = (p: Project) => {
    cancelAnimationFrame(raf.current)
    setActiveId(p.id)
    setSpec(p.live)
    setQty(p.qty)
    setDecos(p.decos)
    setSelectedId(null)
    setHistory(p.history)
    setHistIdx(p.histIdx)
    setFold(1)
  }

  const switchProject = (id: string) => {
    if (id === activeId || aiBusy) return
    const target = projects.find((p) => p.id === id)
    if (!target) return
    setProjects((prev) => flushInto(prev))
    openProject(target)
  }

  const newProject = () => {
    if (aiBusy) return
    const p = freshProject(projects.length + 1)
    setProjects((prev) => [...flushInto(prev), p])
    openProject(p)
  }

  const deleteProject = (id: string) => {
    if (aiBusy) return
    const victim = projects.find((p) => p.id === id)
    if (!victim) return
    if (!window.confirm(`ลบงาน "${victim.name}" ทั้งงานรวมประวัติ?`)) return
    let rest = projects.filter((p) => p.id !== id)
    if (rest.length === 0) rest = [freshProject(1)]
    setProjects(rest)
    if (id === activeId) openProject(rest[rest.length - 1])
  }

  const renameProject = () => {
    if (aiBusy) return
    const cur = projects.find((p) => p.id === activeId)
    const name = window.prompt('ตั้งชื่องาน', cur?.name ?? '')?.trim()
    if (!name) return
    setProjects((prev) =>
      prev.map((p) => (p.id === activeId ? { ...p, name: name.slice(0, 60) } : p)),
    )
  }

  const changeTemplate = (id: string) => {
    cancelAnimationFrame(raf.current)
    setTemplateId(id)
    const tp = getTemplate(id)
    setW(tp.defaults.W)
    setD(tp.defaults.D)
    setH(tp.defaults.H)
    if (!tp.supportsHandle) setHandle(false)
    if (mat.foldable) play()
  }

  const changeMaterial = (id: string) => {
    cancelAnimationFrame(raf.current)
    setMaterialId(id)
    if (!getMaterial(id).foldable) setFold(1)
  }

  const saveFile = (data: BlobPart, mime: string, ext: string) => {
    const blob = new Blob([data], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${templateId}_${W}x${D}x${H}_${mat.id}.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  const downloadSVG = () => {
    if (!dieline) return
    saveFile(dielineSVGString(dieline, showDims, decos, guides), 'image/svg+xml', 'svg')
  }

  // DXF คือไฟล์ที่โรงทำมีดไดคัทใช้จริง — มีแต่เลเยอร์ CUT/CREASE ไม่มีเส้นบอกขนาด
  const downloadDXF = () => {
    if (!dieline) return
    saveFile(dielineDXFString(dieline), 'application/dxf', 'dxf')
  }

  // PDF สเกล 1:1 สำหรับพิมพ์ตรวจ/ส่งโรงงาน — เลเยอร์ปิด-เปิดได้ใน Acrobat
  // ลายฝังเป็นภาพ 300 dpi (ไทยได้ ไม่ต้องฝังฟอนต์) ใต้เส้น cut/crease
  const downloadPDF = async () => {
    if (!dieline) return
    let art
    const canvas = await renderArtworkCanvas(decos, dieline.width, dieline.height, 300)
    if (canvas) {
      const b64 = canvas.toDataURL('image/jpeg', 0.92).split(',')[1]
      const bin = atob(b64)
      const jpeg = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) jpeg[i] = bin.charCodeAt(i)
      art = { jpeg, w: canvas.width, h: canvas.height }
    }
    saveFile(dielinePDFBytes(dieline, showDims, art, guides), 'application/pdf', 'pdf')
  }

  const selected = decos.find((d) => d.id === selectedId) ?? null
  const currentAi = histIdx >= 0 ? history[histIdx]?.ai : undefined

  const activeName = projects.find((p) => p.id === activeId)?.name ?? 'งาน'

  // ใบสรุปสเปก 1 หน้า สำหรับส่งโรงงานขอราคา — รวมจำนวน + สิ่งที่ AI สันนิษฐาน
  const downloadSpecSheet = () => {
    if (!dieline) return
    const bytes = specSheetPDFBytes({
      projectName: activeName,
      templateNameTh: mat.foldable ? template.nameTh : `ภาชนะ ${mat.nameTh} + ฉลากพันรอบ`,
      materialNameTh: mat.nameTh,
      materialThickness: mat.thickness,
      W,
      D,
      H,
      qty,
      handle,
      assumptions: currentAi?.assumptions ?? [],
      layoutNote: currentAi?.layoutNote ?? '',
      reasoning: currentAi?.reasoning ?? '',
      dieline,
    })
    saveFile(bytes, 'application/pdf', 'spec.pdf')
  }

  const addImage = async (file: File | undefined) => {
    if (!file || !dieline) return
    try {
      const { src, aspect } = await loadImageFile(file)
      const el = makeImageEl(dieline, src, aspect)
      setDecos((ds) => [...ds, el])
      setSelectedId(el.id)
    } catch {
      window.alert('เปิดไฟล์รูปนี้ไม่ได้ ลองไฟล์ PNG หรือ JPG อีกครั้ง')
    }
  }

  const addText = () => {
    if (!dieline) return
    const el = makeTextEl(dieline, 'ข้อความ')
    setDecos((ds) => [...ds, el])
    setSelectedId(el.id)
  }

  // แก้เฉพาะชิ้นที่เลือก ผ่านฟังก์ชันแปลง (คงชนิด image/text ไว้)
  const patchSelected = (fn: (d: Deco) => Deco) => {
    if (!selectedId) return
    setDecos((ds) => ds.map((d) => (d.id === selectedId ? fn(d) : d)))
  }

  const moveDeco = (id: string, x: number, y: number) =>
    setDecos((ds) => ds.map((d) => (d.id === id ? { ...d, x, y } : d)))

  const rotateDeco = (id: string, deg: number) =>
    setDecos((ds) => ds.map((d) => (d.id === id ? { ...d, rot: deg } : d)))

  const removeSelected = () => {
    if (!selectedId) return
    setDecos((ds) => ds.filter((d) => d.id !== selectedId))
    setSelectedId(null)
  }

  const recenterSelected = () => {
    if (!selected || !dieline) return
    patchSelected((d) => recenter(dieline, d))
  }

  return (
    <div className="app">
      <header>
        <h1>gen-package</h1>
        <nav className="projects" aria-label="งานที่บันทึกไว้">
          {projects.map((p) => (
            <div key={p.id} className={`proj-tab${p.id === activeId ? ' active' : ''}`}>
              <button
                className="proj-name"
                title={`${p.name} · แก้ล่าสุด ${new Date(p.updatedAt).toLocaleString('th-TH')}`}
                aria-current={p.id === activeId ? 'true' : undefined}
                aria-disabled={aiBusy}
                onClick={() => switchProject(p.id)}
              >
                {p.name}
              </button>
              {p.id === activeId && (
                <button
                  className="proj-act"
                  aria-label="ตั้งชื่องานนี้"
                  title="ตั้งชื่องาน"
                  onClick={renameProject}
                >
                  ✎
                </button>
              )}
              <button
                className="proj-act"
                aria-label={`ลบงาน ${p.name}`}
                title="ลบงานนี้"
                onClick={() => deleteProject(p.id)}
              >
                ✕
              </button>
            </div>
          ))}
          <button className="proj-new" aria-disabled={aiBusy} onClick={newProject}>
            + งานใหม่
          </button>
        </nav>
      </header>
      <div className="body">
        <aside>
          <section>
            <h2>รูปแบบบรรจุภัณฑ์</h2>
            <select
              value={templateId}
              disabled={aiBusy || !mat.foldable}
              aria-label="รูปแบบบรรจุภัณฑ์"
              onChange={(e) => changeTemplate(e.target.value)}
            >
              {TEMPLATES.map((tp) => (
                <option key={tp.id} value={tp.id}>
                  {tp.nameTh}
                </option>
              ))}
            </select>
            <p className="hint">
              {mat.foldable
                ? template.detail
                : 'วัสดุภาชนะไม่ใช้รูปแบบกล่อง — ระบบขึ้นทรง revolve และ blueprint คือ dieline ฉลากพันรอบตัว'}
            </p>
            {mat.foldable && (
              <p className="hint">
                อยากทำตัวขวด/โหล/กระป๋องเอง? เลือกที่ช่อง “วัสดุ” กลุ่มภาชนะขึ้นรูป
              </p>
            )}
          </section>

          <section>
            <h2>วัสดุ</h2>
            <select
              value={materialId}
              disabled={aiBusy}
              aria-label="เลือกวัสดุ"
              onChange={(e) => changeMaterial(e.target.value)}
            >
              <optgroup label="กล่อง (เลือกรูปแบบด้านบน)">
                {MATERIALS.filter((m) => m.foldable).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nameTh}
                  </option>
                ))}
              </optgroup>
              <optgroup label="ภาชนะขึ้นรูป + ฉลาก (ขวด/โหล/กระป๋อง)">
                {MATERIALS.filter((m) => !m.foldable).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nameTh}
                  </option>
                ))}
              </optgroup>
            </select>
            <div className="mat-info">
              <div>{mat.detail}</div>
              <div>
                ความหนา {mat.thickness} มม. · {mat.process}
              </div>
              {mat.foldable ? (
                <div className="ok">พับได้ — dieline เผื่อระยะตามความหนาให้อัตโนมัติ</div>
              ) : (
                <div className="warn">{mat.note}</div>
              )}
            </div>
          </section>

          {dieline && (
            <>
              <section>
                <h2>{mat.foldable ? 'ขนาดกล่อง (ด้านใน)' : 'ขนาดภาชนะ'}</h2>
                <DimField
                  label={mat.foldable ? 'กว้าง W' : '⌀ ตัว W'}
                  value={W}
                  min={30}
                  max={250}
                  disabled={aiBusy}
                  onChange={setW}
                />
                <DimField
                  label={mat.foldable ? 'ลึก D' : '⌀ ปาก/คอ D'}
                  value={D}
                  min={20}
                  max={150}
                  disabled={aiBusy}
                  onChange={setD}
                />
                <DimField
                  label={mat.foldable ? 'สูง H' : 'สูง H'}
                  value={H}
                  min={30}
                  max={300}
                  disabled={aiBusy}
                  onChange={setH}
                />
                {mat.foldable && template.supportsHandle && (
                  <label className="check" style={{ marginTop: 12 }}>
                    <input
                      type="checkbox"
                      checked={handle}
                      disabled={aiBusy}
                      onChange={(e) => setHandle(e.target.checked)}
                    />
                    เจาะรูหิ้ว (die-cut handle)
                  </label>
                )}
              </section>

              <section hidden={!mat.foldable}>
                <h2>การพับ</h2>
                <button className="primary" onClick={play}>
                  ▶ พับให้ดู
                </button>
                <label className="field">
                  <span>กาง ↔ พับ</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={fold}
                    aria-label="กาง-พับ"
                    aria-valuetext={`${Math.round(fold * 100)}%`}
                    onChange={(e) => {
                      cancelAnimationFrame(raf.current)
                      setFold(Number(e.target.value))
                    }}
                  />
                </label>
              </section>

              <section>
                <h2>โลโก้ / ข้อความ</h2>
                <div className="art-actions">
                  <label className="file-pick inline">
                    <input
                      type="file"
                      accept="image/*"
                      disabled={aiBusy}
                      onChange={(e) => {
                        void addImage(e.target.files?.[0])
                        e.target.value = ''
                      }}
                    />
                    <span>+ โลโก้</span>
                  </label>
                  <button disabled={aiBusy} onClick={addText}>
                    + ข้อความ
                  </button>
                </div>

                {decos.length > 0 && (
                  <ul className="deco-list">
                    {decos.map((d) => (
                      <li key={d.id}>
                        <button
                          className={`deco-item${d.id === selectedId ? ' active' : ''}`}
                          onClick={() => setSelectedId(d.id)}
                        >
                          {d.type === 'image' ? '🖼 รูป' : `T ${d.text || 'ข้อความ'}`}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {selected && (
                  <div className="deco-edit">
                    {selected.type === 'text' && (
                      <>
                        <input
                          type="text"
                          className="deco-text-input"
                          value={selected.text}
                          disabled={aiBusy}
                          aria-label="ข้อความ"
                          onChange={(e) => patchSelected((d) => (d.type === 'text' ? withTextW({ ...d, text: e.target.value }) : d))}
                        />
                        <label className="deco-color">
                          สี
                          <input
                            type="color"
                            value={selected.color}
                            disabled={aiBusy}
                            aria-label="สีข้อความ"
                            onChange={(e) => patchSelected((d) => (d.type === 'text' ? { ...d, color: e.target.value } : d))}
                          />
                        </label>
                      </>
                    )}
                    <DimField
                      label={selected.type === 'text' ? 'ขนาดตัวอักษร' : 'ขนาดรูป'}
                      value={selected.type === 'text' ? selected.size : Math.round(elW(selected) * 10) / 10}
                      min={selected.type === 'text' ? 3 : 5}
                      max={selected.type === 'text' ? 120 : Math.round(dieline.width)}
                      disabled={aiBusy}
                      onChange={(v) =>
                        patchSelected((d) =>
                          d.type === 'text' ? withTextW({ ...d, size: v }) : { ...d, w: v },
                        )
                      }
                    />
                    <DimField
                      label="หมุน (องศา)"
                      value={selected.rot}
                      min={-180}
                      max={180}
                      disabled={aiBusy}
                      onChange={(deg) => patchSelected((d) => ({ ...d, rot: deg }))}
                    />
                    <div className="art-actions">
                      <button onClick={recenterSelected}>วางกลางแผงหน้า</button>
                      <button onClick={removeSelected}>ลบชิ้นนี้</button>
                    </div>
                    <p className="hint">ลาก/หมุนบน blueprint ได้ (จุดวงกลม = หมุน) ดูผลบนกล่อง 3D ทันที</p>
                  </div>
                )}
                <p className="hint">
                  ลายจะถูกใส่ลงไฟล์ .svg (vector) และ .pdf (300 dpi) แล้ว — ไม่ใส่ใน .dxf เพราะเป็นไฟล์มีดตัด
                </p>
              </section>

              <section>
                <h2>จำนวนที่จะสั่ง</h2>
                <div className="field">
                  <span className="field-head">
                    จำนวน
                    <span className="field-num">
                      <QtyField value={qty} disabled={aiBusy} onChange={setQty} />
                      ใบ
                    </span>
                  </span>
                </div>
                <p className="hint">
                  ใช้ตอนขอราคาจากโรงงาน — ไม่มีผลกับรูปกล่องหรือไฟล์ไดคัท
                </p>
              </section>

              <section>
                <h2>Blueprint</h2>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={showDims}
                    onChange={(e) => setShowDims(e.target.checked)}
                  />
                  แสดงขนาดกำกับเส้น (มม.)
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={showGuides}
                    onChange={(e) => setShowGuides(e.target.checked)}
                  />
                  แสดงเส้นเผื่อตัด (bleed) / ระยะปลอดภัย
                </label>
                <button onClick={downloadSVG}>ดาวน์โหลด dieline (.svg)</button>
                <button onClick={downloadDXF}>ดาวน์โหลดไฟล์ผลิต (.dxf)</button>
                <button onClick={() => void downloadPDF()}>ดาวน์โหลดแบบพิมพ์ (.pdf)</button>
                <button className="primary" onClick={downloadSpecSheet}>
                  ดาวน์โหลดใบสเปกขอราคา (.pdf)
                </button>
                <p className="hint">
                  .dxf สำหรับส่งโรงทำมีดไดคัท — เลเยอร์ CUT/CREASE แยกกัน หน่วย มม. ไม่มีเส้นบอกขนาด
                  <br />
                  .pdf สเกล 1:1 + ลายพิมพ์ฝัง 300 dpi — เลเยอร์ artwork/cut/crease/dims ปิด-เปิดได้ใน Acrobat
                  <br />
                  ใบสเปก = สรุปขนาด/วัสดุ/จำนวน/ข้อสันนิษฐาน + แบบย่อ ส่งโรงงานขอราคาได้เลย
                </p>
                <p className="hint">
                  ขนาดแผ่น {Math.ceil(dieline.width)} × {Math.ceil(dieline.height)} มม. · สเกลจริง 1:1
                </p>
                <p className="hint">
                  ตัวเลขบนแบบคือระยะจริงบนแผ่น (บวกเผื่อความหนา {mat.thickness} มม. แล้ว)
                  จึงใหญ่กว่าขนาดด้านในที่ตั้งไว้เล็กน้อย
                </p>
              </section>
            </>
          )}
        </aside>

        <main>
          <PromptBar
            current={{ template: templateId, materialId, W, D, H, handle }}
            hasDesign={history.length > 0}
            onApply={applySpec}
            onLoadingChange={setAiBusy}
          />
          {history.length > 0 && (
            <div className="versions card" aria-label="ประวัติเวอร์ชัน">
              <button
                className="ver-nav"
                aria-label="ย้อนเวอร์ชัน"
                aria-disabled={histIdx <= 0 || aiBusy}
                onClick={() => restoreVersion(histIdx - 1)}
              >
                ↶ ย้อน
              </button>
              <button
                className="ver-nav"
                aria-label="ไปเวอร์ชันถัดไป"
                aria-disabled={histIdx >= history.length - 1 || aiBusy}
                onClick={() => restoreVersion(histIdx + 1)}
              >
                ไปหน้า ↷
              </button>
              <div className="ver-list">
                {history.map((v, i) => (
                  <button
                    key={i}
                    className={`ver-chip${i === histIdx ? ' active' : ''}`}
                    aria-disabled={aiBusy}
                    aria-current={i === histIdx ? 'true' : undefined}
                    title={v.label}
                    onClick={() => restoreVersion(i)}
                  >
                    v{i + 1} · {v.label}
                  </button>
                ))}
              </div>
              <span className="ver-saved hint">บันทึกอัตโนมัติ</span>
              <button className="ver-nav" aria-disabled={aiBusy} onClick={clearHistory}>
                ล้างประวัติ
              </button>
            </div>
          )}
          {currentAi && (
            <div className="assume card" aria-label="สิ่งที่ AI สันนิษฐาน">
              <span className="hint">สิ่งที่ AI สันนิษฐานในเวอร์ชันนี้ (ตรวจ/แก้ก่อนส่งโรงงาน):</span>
              <ul>
                {currentAi.assumptions.map((a, i) => (
                  <li
                    key={i}
                    className={
                      a.startsWith('ข้อจำกัด') ? 'limit' : a.startsWith('จากรูป') ? 'fromimg' : undefined
                    }
                  >
                    {a}
                  </li>
                ))}
                {currentAi.layoutNote && currentAi.layoutNote !== '-' && (
                  <li className="layout">การจัดวาง: {currentAi.layoutNote}</li>
                )}
              </ul>
              {currentAi.reasoning && <p className="assume-reason">{currentAi.reasoning}</p>}
            </div>
          )}
          <div className="panels">
            <div className="viewer card">
              <Suspense fallback={<div className="viewer-loading">กำลังโหลดมุมมอง 3 มิติ…</div>}>
                {mat.foldable ? (
                  <Viewer3D
                    dieline={dieline}
                    mat={mat}
                    fold={fold}
                    depth={template.foldDepth({ W, D, H }, mat)}
                    tilt={template.tilt}
                    decos={decos}
                  />
                ) : (
                  <VesselViewer3D vessel={vessel!} mat={mat} decos={decos} />
                )}
              </Suspense>
            </div>
            <div className="blueprint card">
              <div className="bp-head">
                <span>{mat.foldable ? 'blueprint การพับ' : 'dieline ฉลาก'}</span>
                <span className="legend">
                  <i className="sw-cut" /> เส้นตัด
                  <i className="sw-crease" /> {mat.foldable ? 'เส้นพับ' : 'แนวทับกาว'}
                </span>
              </div>
              <DielineSVG
                dieline={dieline}
                showDims={showDims}
                decos={decos}
                guides={guides}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onMove={moveDeco}
                onRotate={rotateDeco}
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
