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
  makeShapeEl,
  decoLabel,
  alignToFace,
  fontCss,
  FONTS,
  alignInSelection,
  distribute,
  stepRepeat,
  expandGroups,
  newGroupId,
  type AlignMode,
  recenter,
  cloneDeco,
  withTextW,
  svgArtworkLayer,
  fillSVGLayer,
  fillImageSVGLayer,
  renderArtworkCanvas,
  type Deco,
  type FillImage,
} from './core/artwork'
import { computeGuides, guidesSVGLayer, type Guides } from './core/guides'
import { generateVessel } from './core/vessel'
import {
  clamp,
  freshProject,
  parseProject,
  parseSpec,
  parseHistory,
  parseQty,
  clampIdx,
  DEFAULT_QTY,
  QTY_MIN,
  QTY_MAX,
  MAX_HISTORY,
  type DesignVersion,
  type Project,
} from './core/project'
import { serializeProject, parseProjectFile, projectFileName } from './core/projectFile'
import {
  SHEET_PRESETS,
  DEFAULT_OPT,
  computeImposition,
  sheetsNeeded,
  type Layout,
  type Sheet,
} from './core/imposition'
// โหลด viewer 3D แบบ lazy — three + R3F เป็นก้อนใหญ่สุดของ bundle และไม่จำเป็น
// ต่อการเรนเดอร์ครั้งแรก (แถบซ้าย + blueprint เป็น SVG ล้วน) แยกออกไปให้หน้าแรกเบาลง
const Viewer3D = lazy(() => import('./components/Viewer3D').then((m) => ({ default: m.Viewer3D })))
const VesselViewer3D = lazy(() =>
  import('./components/VesselViewer3D').then((m) => ({ default: m.VesselViewer3D })),
)
import { DielineSVG } from './components/DielineSVG'
import { PromptBar } from './components/PromptBar'
import { ColorField } from './components/ColorField'
import {
  IconImage,
  IconText,
  IconRect,
  IconEllipse,
  IconLine,
  IconUndo,
  IconRedo,
  IconAlignLeft,
  IconAlignCenter,
  IconAlignRight,
} from './components/icons'

// จานสี (palette) ใช้ร่วมทุกช่องสี — เก็บระดับแอปใน localStorage แยกจากงาน
const PALETTE_KEY = 'gen-package-palette-v1'
// สัดส่วนความกว้าง blueprint (ซ้าย) เทียบพื้นที่ทำงาน — ลากเส้นแบ่งปรับได้
const SPLIT_KEY = 'gen-package-split-v1'
const DEFAULT_SPLIT = 0.57
function loadSplit(): number {
  const v = Number(localStorage.getItem(SPLIT_KEY))
  return v >= 0.2 && v <= 0.8 ? v : DEFAULT_SPLIT
}
const isHex = (s: unknown): s is string => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s)
function loadPalette(): string[] {
  try {
    const a = JSON.parse(localStorage.getItem(PALETTE_KEY) || '[]')
    if (Array.isArray(a)) return a.filter(isHex).slice(0, 16)
  } catch {
    /* ค่าเริ่มต้นว่าง */
  }
  return []
}

interface DimFieldProps {
  label: string
  value: number
  min: number
  max: number
  disabled?: boolean
  unit?: string
  step?: number
  onChange: (v: number) => void
}

function DimField({ label, value, min, max, disabled, unit = 'มม.', step = 0.5, onChange }: DimFieldProps) {
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
            step={step}
            value={value}
            disabled={disabled}
            aria-label={label}
            onChange={(e) => commit(Number(e.target.value))}
          />
          {unit}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
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
  fillColor: string | null = null,
  fillImage: FillImage | null = null,
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

  // สีพื้นอยู่ล่างสุด แล้วลาย แล้วเส้น cut/crease โชว์ทับเป็นไกด์ — ตรงกับที่เห็นบนจอ
  // รูปพื้น (ถ้ามี) มาก่อนสีพื้น — ครอปตามแผงจริงเหมือนกัน
  const fillLayer = fillImage ? fillImageSVGLayer(d, fillImage) : fillSVGLayer(d, fillColor)
  const artLayer = svgArtworkLayer(decos)
  const guideLayer = guides ? guidesSVGLayer(guides) : ''

  const w = d.width + pad * 2
  const h = d.height + pad * 2
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"` +
    ` xmlns:xlink="http://www.w3.org/1999/xlink"` +
    ` width="${w}mm" height="${h}mm" viewBox="${-pad} ${-pad} ${w} ${h}">\n` +
    `<!-- สเกลจริง 1:1 หน่วย mm | fill = สีพื้น | artwork = ลายพิมพ์ | cut = เส้นตัด (แดง) | crease = เส้นพับ (เขียวประ) | guides = เผื่อตัด/ปลอดภัย | dims = เส้นบอกขนาด (ห้ามใช้ผลิต) -->\n` +
    `${fillLayer}${artLayer}${cutLayer}${creaseLayer}${guideLayer}${dimLayer}</svg>\n`
  )
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

// สแนปช็อตสถานะที่ผู้ใช้แก้ได้ สำหรับ undo/redo (ต่างจาก DesignVersion ที่เก็บเฉพาะสเปกจาก AI)
interface EditSnapshot {
  templateId: string
  materialId: string
  W: number
  D: number
  H: number
  handle: boolean
  qty: number
  fillColor: string | null
  fillImage: FillImage | null
  decos: Deco[]
}

const sameSnap = (a: EditSnapshot, b: EditSnapshot) =>
  a.templateId === b.templateId &&
  a.materialId === b.materialId &&
  a.W === b.W &&
  a.D === b.D &&
  a.H === b.H &&
  a.handle === b.handle &&
  a.qty === b.qty &&
  a.fillColor === b.fillColor &&
  a.fillImage === b.fillImage &&
  a.decos === b.decos

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

interface Store {
  projects: Project[]
  activeId: string
  showDims: boolean
}

// modal ตั้งชื่องาน — ใช้ทั้งตอนสร้างงานใหม่และเปลี่ยนชื่อ (แทน window.prompt เดิม)
function NameModal({
  title,
  initial,
  onOk,
  onCancel,
}: {
  title: string
  initial: string
  onOk: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div className="modal" role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <input
          ref={ref}
          type="text"
          value={value}
          maxLength={60}
          aria-label={title}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onOk(value.trim())
            else if (e.key === 'Escape') onCancel()
          }}
        />
        <div className="modal-actions">
          <button onClick={onCancel}>ยกเลิก</button>
          <button className="primary" onClick={() => onOk(value.trim())}>
            ตกลง
          </button>
        </div>
      </div>
    </div>
  )
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
          fillColor: null,
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

// แผนภาพย่อ: แผ่นใหญ่ + กริดของกล่องที่วางได้ (ทิศตามผลของ computeImposition)
function ImpositionDiagram({
  sheet,
  pieceW,
  pieceH,
  layout,
  margin,
  gutter,
}: {
  sheet: Sheet
  pieceW: number
  pieceH: number
  layout: Layout
  margin: number
  gutter: number
}) {
  const s = Math.min(200 / sheet.w, 260 / sheet.h)
  const W = sheet.w * s
  const H = sheet.h * s
  const pw = pieceW * s
  const ph = pieceH * s
  const m = margin * s
  const g = gutter * s
  const cells: { x: number; y: number }[] = []
  for (let r = 0; r < layout.rows; r++) {
    for (let c = 0; c < layout.cols; c++) {
      cells.push({ x: m + c * (pw + g), y: m + r * (ph + g) })
    }
  }
  return (
    <svg className="imp-diagram" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="แผนภาพการวางบนแผ่น">
      <rect x={0} y={0} width={W} height={H} fill="#f4f2ec" stroke="#c9bda2" strokeWidth={1} />
      {cells.map((c, i) => (
        <rect key={i} x={c.x} y={c.y} width={pw} height={ph} fill="#cfe6dd" stroke="#0f6e56" strokeWidth={0.7} />
      ))}
    </svg>
  )
}

const store0 = loadStore()
const active0 = store0.projects.find((p) => p.id === store0.activeId) ?? store0.projects[0]

export default function App({ onLogout }: { onLogout?: () => void }) {
  const [projects, setProjects] = useState<Project[]>(store0.projects)
  const [activeId, setActiveId] = useState(active0.id)
  const [templateId, setTemplateId] = useState(active0.live.template)
  const [materialId, setMaterialId] = useState(active0.live.materialId)
  const [W, setW] = useState(active0.live.W)
  const [D, setD] = useState(active0.live.D)
  const [H, setH] = useState(active0.live.H)
  const [handle, setHandle] = useState(active0.live.handle)
  const [qty, setQty] = useState(active0.qty)
  const [fillColor, setFillColor] = useState<string | null>(active0.fillColor)
  const [fillImage, setFillImage] = useState<FillImage | null>(active0.fillImage ?? null)
  const [decos, setDecos] = useState<Deco[]>(active0.decos)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [renamingId, setRenamingId] = useState<string | null>(null) // เลเยอร์ที่กำลังแก้ชื่อ (ดับเบิลคลิก)
  const [lockAspect, setLockAspect] = useState(true) // ล็อกสัดส่วนกรอบรูป: ปรับกว้าง/สูงพร้อมกันตามสัดส่วนรูปจริง
  const [fold, setFold] = useState(1)
  const [showDims, setShowDims] = useState(store0.showDims)
  const [showGuides, setShowGuides] = useState(false)
  const [nameModal, setNameModal] = useState<{ title: string; value: string; onOk: (n: string) => void } | null>(null)
  const [sideTab, setSideTab] = useState<'design' | 'artwork' | 'export'>('design')
  const [palette, setPalette] = useState<string[]>(loadPalette)
  const [sr, setSr] = useState({ cols: 3, rows: 1, dx: 30, dy: 30, brick: false })
  const [split, setSplit] = useState<number>(loadSplit)
  const panelsRef = useRef<HTMLDivElement>(null)
  const resizing = useRef(false)
  const [sheetId, setSheetId] = useState(SHEET_PRESETS[0].id)
  const [customSheet, setCustomSheet] = useState({ w: 640, h: 900 })
  const [gutter, setGutter] = useState(DEFAULT_OPT.gutter)
  const [aiBusy, setAiBusy] = useState(false)
  const [history, setHistory] = useState<DesignVersion[]>(active0.history)
  const [histIdx, setHistIdx] = useState(active0.histIdx)
  const [undoStack, setUndoStack] = useState<EditSnapshot[]>([])
  const [redoStack, setRedoStack] = useState<EditSnapshot[]>([])
  // ข้ามการบันทึกลง undo หนึ่งครั้ง — ใช้ตอน apply undo/redo หรือสลับงาน (ไม่ใช่การแก้ของผู้ใช้)
  const skipCapture = useRef(false)
  const lastSnap = useRef<EditSnapshot | null>(null)
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

  // imposition: กล่องแผ่นคลี่วางบนแผ่นใหญ่ได้กี่ชิ้น (ประเมินต้นทุน/สั่งวัสดุ)
  const sheet: Sheet =
    sheetId === 'custom'
      ? { id: 'custom', nameTh: 'กำหนดเอง', w: customSheet.w, h: customSheet.h }
      : SHEET_PRESETS.find((s) => s.id === sheetId) ?? SHEET_PRESETS[0]
  const imposition = useMemo(
    () => (dieline ? computeImposition(dieline.width, dieline.height, sheet, { ...DEFAULT_OPT, gutter }) : null),
    [dieline, sheet.w, sheet.h, gutter],
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
                fillColor,
                fillImage,
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
  }, [history, histIdx, templateId, materialId, W, D, H, handle, qty, fillColor, fillImage, decos, activeId])

  // save ทุกงานลง localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ projects, activeId, showDims }))
    } catch {
      // storage เต็มหรือถูกปิดไว้ — ข้ามการ save เงียบๆ
    }
  }, [projects, activeId, showDims])

  // save จานสี (ใช้ร่วมทุกงาน)
  useEffect(() => {
    try {
      localStorage.setItem(PALETTE_KEY, JSON.stringify(palette))
    } catch {
      /* ข้าม */
    }
  }, [palette])

  // เพิ่มสีลงจาน (ใหม่สุดอยู่หน้า, ไม่ซ้ำ, สูงสุด 16)
  const saveSwatch = (hex: string) => {
    if (!isHex(hex)) return
    const c = hex.toLowerCase()
    setPalette((p) => [c, ...p.filter((x) => x !== c)].slice(0, 16))
  }

  // ลากเส้นแบ่ง blueprint | 3D ปรับสัดส่วน (คุมด้วย pointer capture)
  useEffect(() => {
    try {
      localStorage.setItem(SPLIT_KEY, String(split))
    } catch {
      /* ข้าม */
    }
  }, [split])

  const onDividerDown = (e: React.PointerEvent) => {
    resizing.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }
  const onDividerMove = (e: React.PointerEvent) => {
    if (!resizing.current || !panelsRef.current) return
    const r = panelsRef.current.getBoundingClientRect()
    setSplit(clamp((e.clientX - r.left) / r.width, 0.2, 0.8))
  }
  const onDividerUp = (e: React.PointerEvent) => {
    resizing.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

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

  // --- undo/redo ของสถานะที่แก้ได้ ---
  const snapshot = (): EditSnapshot => ({
    templateId,
    materialId,
    W,
    D,
    H,
    handle,
    qty,
    fillColor,
    fillImage,
    decos,
  })

  // เก็บสแนปช็อตแบบหน่วง (coalesce) — ตอนลาก slider/ลากลายจะไม่ยัด undo ทุกเฟรม
  // ดันสถานะ "ก่อนหน้า" เข้าสแตกเมื่อค่านิ่งแล้วต่างจากเดิม
  useEffect(() => {
    if (skipCapture.current) {
      skipCapture.current = false
      lastSnap.current = snapshot()
      return
    }
    const t = setTimeout(() => {
      const cur = snapshot()
      if (lastSnap.current && !sameSnap(lastSnap.current, cur)) {
        const prev = lastSnap.current
        setUndoStack((s) => [...s.slice(-49), prev])
        setRedoStack([])
      }
      lastSnap.current = cur
    }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, materialId, W, D, H, handle, qty, fillColor, fillImage, decos])

  const applySnapshot = (s: EditSnapshot) => {
    skipCapture.current = true
    setTemplateId(s.templateId)
    setMaterialId(s.materialId)
    setW(s.W)
    setD(s.D)
    setH(s.H)
    setHandle(s.handle)
    setQty(s.qty)
    setFillColor(s.fillColor)
    setFillImage(s.fillImage ?? null)
    setDecos(s.decos)
    setSelectedIds([])
  }

  const undo = () => {
    if (aiBusy || undoStack.length === 0) return
    const prev = undoStack[undoStack.length - 1]
    setRedoStack((r) => [...r, snapshot()])
    setUndoStack((u) => u.slice(0, -1))
    applySnapshot(prev)
  }

  const redo = () => {
    if (aiBusy || redoStack.length === 0) return
    const next = redoStack[redoStack.length - 1]
    setUndoStack((u) => [...u, snapshot()])
    setRedoStack((r) => r.slice(0, -1))
    applySnapshot(next)
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
        ? { ...p, live: liveSpec(), qty, fillColor, fillImage, decos, history, histIdx, updatedAt: Date.now() }
        : p,
    )

  const openProject = (p: Project) => {
    cancelAnimationFrame(raf.current)
    // สลับงาน = ไม่ใช่การแก้ที่ควร undo — ล้างสแตกและข้ามการบันทึกครั้งนี้
    skipCapture.current = true
    setUndoStack([])
    setRedoStack([])
    setActiveId(p.id)
    setSpec(p.live)
    setQty(p.qty)
    setFillColor(p.fillColor)
    setFillImage(p.fillImage ?? null)
    setDecos(p.decos)
    setSelectedIds([])
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
    setNameModal({
      title: 'ตั้งชื่องานใหม่',
      value: `งาน ${projects.length + 1}`,
      onOk: (name) => {
        const p = freshProject(projects.length + 1)
        p.name = name.slice(0, 60) || p.name
        setProjects((prev) => [...flushInto(prev), p])
        openProject(p)
      },
    })
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
    setNameModal({
      title: 'ตั้งชื่องาน',
      value: cur?.name ?? '',
      onOk: (name) => {
        const n = name.slice(0, 60)
        if (!n) return
        setProjects((prev) => prev.map((p) => (p.id === activeId ? { ...p, name: n } : p)))
      },
    })
  }

  // --- ส่งออก/นำเข้างานเป็นไฟล์ .genpkg.json (สำรอง/ย้ายเครื่อง/ส่งให้ลูกค้าเปิดต่อ) ---

  const exportProject = () => {
    if (aiBusy) return
    // flushInto ให้ได้สถานะล่าสุดที่ยังไม่ทันเขียนเข้า projects (debounce 300ms)
    const cur = flushInto(projects).find((p) => p.id === activeId)
    if (!cur) return
    // ตั้งชื่อไฟล์ตามชื่องาน (ไม่ใช้ saveFile ที่ตั้งชื่อตามสเปกกล่อง)
    const blob = new Blob([serializeProject(cur)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = projectFileName(cur.name)
    a.click()
    URL.revokeObjectURL(url)
  }

  const importProject = async (file: File | undefined) => {
    if (!file || aiBusy) return
    let res
    try {
      res = parseProjectFile(await file.text())
    } catch {
      window.alert('อ่านไฟล์ไม่สำเร็จ')
      return
    }
    if (!res.ok) {
      window.alert(`นำเข้าไม่สำเร็จ: ${res.error}`)
      return
    }
    // บันทึกงานที่เปิดอยู่ก่อน แล้วเพิ่มงานที่นำเข้าเป็นงานใหม่ (ไม่ทับของเดิม) และสลับไป
    setProjects((prev) => [...flushInto(prev), res.project])
    openProject(res.project)
    if (res.warnings.length) {
      window.alert(`นำเข้าสำเร็จ แต่มีการปรับข้อมูลบางส่วน:\n• ${res.warnings.join('\n• ')}`)
    }
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
    saveFile(dielineSVGString(dieline, showDims, decos, guides, fillColor, fillImage), 'image/svg+xml', 'svg')
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
    // รูปพื้น (ถ้ามี) baked เข้า raster เป็นชั้นล่างสุด — จึงไม่ต้องวาดสีพื้น vector ซ้ำ
    const base = fillImage ? { dieline, fillImage } : null
    const canvas = await renderArtworkCanvas(decos, dieline.width, dieline.height, 300, base)
    if (canvas) {
      const b64 = canvas.toDataURL('image/jpeg', 0.92).split(',')[1]
      const bin = atob(b64)
      const jpeg = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) jpeg[i] = bin.charCodeAt(i)
      art = { jpeg, w: canvas.width, h: canvas.height }
    }
    saveFile(dielinePDFBytes(dieline, showDims, art, guides, fillImage ? null : fillColor), 'application/pdf', 'pdf')
  }

  // เลือกได้หลายชิ้น — เมื่อเลือกชิ้นเดียวจึงโชว์แผงแก้ไขรายชิ้น; หลายชิ้นโชว์แผงหลายชิ้น
  const multi = selectedIds.length > 1
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null
  const selected = selectedId ? decos.find((d) => d.id === selectedId) ?? null : null
  const selIdx = selected ? decos.findIndex((d) => d.id === selectedId) : -1

  // เลือกชิ้น (พร้อมทั้งกลุ่มของมัน) — additive = Shift/Ctrl คลิกเพื่อสลับเข้า/ออกชุดเลือก
  const selectDeco = (id: string | null, additive = false) => {
    if (id === null) {
      setSelectedIds([])
      return
    }
    const grp = expandGroups(decos, [id])
    setSelectedIds((cur) => {
      if (!additive) return grp
      const all = grp.every((g) => cur.includes(g))
      return all ? cur.filter((x) => !grp.includes(x)) : [...new Set([...cur, ...grp])]
    })
  }
  const isSelected = (id: string) => selectedIds.includes(id)
  const currentAi = histIdx >= 0 ? history[histIdx]?.ai : undefined

  const activeName = projects.find((p) => p.id === activeId)?.name ?? 'งาน'

  // ใบสรุปสเปก 1 หน้า สำหรับส่งโรงงานขอราคา — รวมจำนวน + สิ่งที่ AI สันนิษฐาน
  const downloadSpecSheet = async () => {
    if (!dieline) return
    const bytes = await specSheetPDFBytes({
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
      setSelectedIds([el.id])
    } catch {
      window.alert('เปิดไฟล์รูปนี้ไม่ได้ ลองไฟล์ PNG, JPG หรือ SVG อีกครั้ง')
    }
  }

  const addText = () => {
    if (!dieline) return
    const el = makeTextEl(dieline, 'ข้อความ')
    setDecos((ds) => [...ds, el])
    setSelectedIds([el.id])
  }

  // รูปพื้นแพ็กเกจ: โหลด+ย่อไฟล์เดียวกับโลโก้ แล้วตั้งเป็นพื้น (fit=cover ครอปพอดี blueprint)
  const addFillImage = async (file: File | undefined) => {
    if (!file) return
    try {
      const { src, aspect } = await loadImageFile(file)
      setFillImage({ src, aspect, fit: 'cover' })
    } catch {
      window.alert('เปิดไฟล์รูปนี้ไม่ได้ ลองไฟล์ PNG หรือ JPG อีกครั้ง')
    }
  }
  const patchFillImage = (patch: Partial<FillImage>) =>
    setFillImage((fi) => (fi ? { ...fi, ...patch } : fi))

  const addShape = (shape: 'rect' | 'ellipse' | 'line') => {
    if (!dieline) return
    const el = makeShapeEl(dieline, shape)
    setDecos((ds) => [...ds, el])
    setSelectedIds([el.id])
  }

  // แก้เฉพาะชิ้นที่เลือก (ชิ้นเดียว) ผ่านฟังก์ชันแปลง (คงชนิด image/text ไว้)
  const patchSelected = (fn: (d: Deco) => Deco) => {
    if (!selectedId) return
    setDecos((ds) => ds.map((d) => (d.id === selectedId ? fn(d) : d)))
  }

  // ลากชิ้น: ถ้าอยู่ในชุดเลือกหลายชิ้น ให้ย้ายทั้งชุดตามระยะเดียวกัน (ชิ้นที่ลากตรง snap)
  const moveDeco = (id: string, x: number, y: number) =>
    setDecos((ds) => {
      const g = ds.find((d) => d.id === id)
      if (!g) return ds
      const move = multi && selectedIds.includes(id) ? new Set(selectedIds) : new Set([id])
      const dx = x - g.x
      const dy = y - g.y
      return ds.map((d) => (move.has(d.id) ? { ...d, x: d.x + dx, y: d.y + dy } : d))
    })

  const rotateDeco = (id: string, deg: number) =>
    setDecos((ds) => ds.map((d) => (d.id === id ? { ...d, rot: deg } : d)))

  const removeDeco = (id: string) =>
    setDecos((ds) => {
      setSelectedIds((cur) => cur.filter((x) => x !== id))
      return ds.filter((d) => d.id !== id)
    })

  // ลบทุกชิ้นที่เลือก (ข้ามชิ้นที่ล็อก)
  const removeSelected = () => {
    if (!selectedIds.length) return
    const kill = new Set(decos.filter((d) => selectedIds.includes(d.id) && !d.locked).map((d) => d.id))
    if (!kill.size) return
    setDecos((ds) => ds.filter((d) => !kill.has(d.id)))
    setSelectedIds((cur) => cur.filter((x) => !kill.has(x)))
  }

  const recenterSelected = () => {
    if (!selected || !dieline) return
    patchSelected((d) => recenter(dieline, d))
  }

  // จัดแนว: เลือกชิ้นเดียว = เทียบแผงหน้า; หลายชิ้น = เทียบกรอบรวมของสิ่งที่เลือก
  const alignSelected = (mode: AlignMode) => {
    if (!dieline || !selectedIds.length) return
    if (multi) setDecos((ds) => alignInSelection(ds, selectedIds, mode))
    else patchSelected((d) => alignToFace(dieline, d, mode))
  }

  const distributeSelected = (axis: 'h' | 'v') => {
    if (selectedIds.length < 3) return
    setDecos((ds) => distribute(ds, selectedIds, axis))
  }

  // จัดกลุ่ม/แยกกลุ่ม (groupId ร่วมกัน = เลือก/ย้ายพร้อมกัน)
  const groupSelected = () => {
    if (selectedIds.length < 2) return
    const gid = newGroupId()
    const sel = new Set(selectedIds)
    setDecos((ds) => ds.map((d) => (sel.has(d.id) ? { ...d, groupId: gid } : d)))
  }
  const ungroupSelected = () => {
    const sel = new Set(selectedIds)
    setDecos((ds) => ds.map((d) => (sel.has(d.id) ? { ...d, groupId: undefined } : d)))
  }

  // สลับ ซ่อน/ล็อก ให้ทุกชิ้นที่เลือก (อิงค่าของชิ้นแรกเป็นตัวตั้ง)
  const toggleHiddenSelected = () => {
    const sel = new Set(selectedIds)
    const anyShown = decos.some((d) => sel.has(d.id) && !d.hidden)
    setDecos((ds) => ds.map((d) => (sel.has(d.id) ? { ...d, hidden: anyShown } : d)))
  }
  const toggleLockedSelected = () => {
    const sel = new Set(selectedIds)
    const anyUnlocked = decos.some((d) => sel.has(d.id) && !d.locked)
    setDecos((ds) => ds.map((d) => (sel.has(d.id) ? { ...d, locked: anyUnlocked } : d)))
  }

  // ทำสำเนาทุกชิ้นที่เลือก (สำเนาของกลุ่มเดิม → กลุ่มใหม่ร่วมกัน) แล้วเลือกสำเนา
  const duplicateSelected = () => {
    if (!selectedIds.length) return
    const sel = decos.filter((d) => selectedIds.includes(d.id))
    const regroup = new Map<string, string>()
    const copies = sel.map((d) => {
      const c = cloneDeco(d)
      if (d.groupId) {
        if (!regroup.has(d.groupId)) regroup.set(d.groupId, newGroupId())
        return { ...c, groupId: regroup.get(d.groupId) }
      }
      return c
    })
    setDecos((ds) => [...ds, ...copies])
    setSelectedIds(copies.map((c) => c.id))
  }

  // ทำซ้ำเป็นแพตเทิร์นกริด: สร้างสำเนา + ดึงต้นฉบับเข้ากลุ่มเดียวกัน แล้วเลือกทั้งชุด
  const applyStepRepeat = () => {
    if (!selectedIds.length) return
    const copies = stepRepeat(decos, selectedIds, sr)
    if (!copies.length) return
    const gid = copies[0].groupId!
    const sel = new Set(selectedIds)
    setDecos((ds) => [...ds.map((d) => (sel.has(d.id) ? { ...d, groupId: gid } : d)), ...copies])
    setSelectedIds([...selectedIds, ...copies.map((c) => c.id)])
  }

  const nudgeSelected = (dx: number, dy: number) => {
    if (!selectedIds.length) return
    const move = new Set(decos.filter((d) => selectedIds.includes(d.id) && !d.locked).map((d) => d.id))
    setDecos((ds) => ds.map((d) => (move.has(d.id) ? { ...d, x: d.x + dx, y: d.y + dy } : d)))
  }

  // จัดเลเยอร์: ลำดับใน decos = ลำดับวาด (ท้าย = หน้าสุด) — เลื่อนชิ้นที่เลือกขึ้นหน้า/ลงหลัง
  // step +1 = ขึ้นหน้าหนึ่งชั้น, -1 = ลงหลังหนึ่งชั้น; toEnd = ไปสุด (หน้าสุด/หลังสุด)
  const restackSelected = (dir: 1 | -1, toEnd = false) => {
    if (!selectedId) return
    setDecos((ds) => {
      const i = ds.findIndex((d) => d.id === selectedId)
      if (i < 0) return ds
      const j = dir > 0 ? ds.length - 1 : 0
      if (i === j) return ds // อยู่สุดแล้ว
      const next = [...ds]
      const [el] = next.splice(i, 1)
      next.splice(toEnd ? j : i + dir, 0, el)
      return next
    })
  }

  const toggleHidden = (id: string) =>
    setDecos((ds) => ds.map((d) => (d.id === id ? { ...d, hidden: !d.hidden } : d)))
  const toggleLocked = (id: string) =>
    setDecos((ds) => ds.map((d) => (d.id === id ? { ...d, locked: !d.locked } : d)))
  // ตั้งชื่อชิ้นด้วยดับเบิลคลิกที่เลเยอร์ (ชื่อว่าง = ใช้ป้ายอัตโนมัติตามชนิด)
  const renameDeco = (id: string, name: string) =>
    setDecos((ds) =>
      ds.map((d) => (d.id === id ? { ...d, name: name.trim() ? name.trim().slice(0, 40) : undefined } : d)),
    )

  // คีย์ลัด: Ctrl+Z/Ctrl+Shift+Z undo/redo, Delete ลบ, Esc เลิกเลือก, ลูกศรเลื่อน, Ctrl+D สำเนา
  // ข้ามเมื่อกำลังพิมพ์ในช่อง input/textarea (ไม่แย่งคีย์)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      const mod = e.ctrlKey || e.metaKey
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        e.shiftKey ? redo() : undo()
        return
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault()
        redo()
        return
      }
      if (typing) return
      if (mod && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault()
        duplicateSelected()
      } else if (mod && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault()
        e.shiftKey ? ungroupSelected() : groupSelected()
      } else if (e.key === 'Escape') {
        setSelectedIds([])
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length) {
        e.preventDefault()
        removeSelected()
      } else if (selectedIds.length && e.key.startsWith('Arrow')) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        if (e.key === 'ArrowLeft') nudgeSelected(-step, 0)
        else if (e.key === 'ArrowRight') nudgeSelected(step, 0)
        else if (e.key === 'ArrowUp') nudgeSelected(0, -step)
        else if (e.key === 'ArrowDown') nudgeSelected(0, step)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, selected, undoStack, redoStack, aiBusy, decos, templateId, materialId, W, D, H, handle, qty, fillColor])

  // ควบคุมการพับ — แถบบนสุดของมุมมอง 3D (โชว์เฉพาะวัสดุที่พับได้)
  const foldBar = mat.foldable ? (
    <div className="fold-bar">
      <button className="fold-play" onClick={play}>
        ▶ พับให้ดู
      </button>
      <span className="fold-label">กาง</span>
      <input
        type="range"
        className="fold-range"
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
      <span className="fold-label">พับ</span>
    </div>
  ) : null

  return (
    <div className="app">
      <header>
        <h1>PackIt</h1>
        <nav className="projects" aria-label="งานที่บันทึกไว้">
          <button className="proj-new" aria-disabled={aiBusy} onClick={newProject}>
            + งานใหม่
          </button>
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
        </nav>
        {onLogout && (
          <button className="logout-btn" title="ออกจากระบบ" onClick={onLogout}>
            ออกจากระบบ
          </button>
        )}
      </header>
      <div className="body">
        <aside>
          <div className="tabbar" role="tablist">
            {(
              [
                ['design', 'ออกแบบ'],
                ['artwork', 'ตกแต่ง'],
                ['export', 'ส่งออก'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                className={`tab${sideTab === id ? ' active' : ''}`}
                aria-selected={sideTab === id}
                onClick={() => setSideTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {sideTab === 'design' && (
          <>
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
          </>
          )}

          {sideTab === 'artwork' && (
          <>
              <section>
                <h2>สีพื้นแพ็กเกจ</h2>
                <div className="fill-color-row">
                  <ColorField
                    value={fillColor ?? '#0f6e56'}
                    onChange={setFillColor}
                    palette={palette}
                    onSave={saveSwatch}
                    disabled={aiBusy}
                    label="สีพื้นแพ็กเกจ"
                  />
                  <button className="fill-none-btn" disabled={aiBusy || !fillColor} onClick={() => setFillColor(null)}>
                    ไม่มีสี
                  </button>
                </div>

                {/* รูปพื้น: คลุมทั้งแพ็กเกจแล้วครอปตามรูปทรง blueprint */}
                <div className="fill-img-row">
                  <label className="file-pick inline">
                    <input
                      type="file"
                      accept="image/*,.svg"
                      disabled={aiBusy}
                      onChange={(e) => {
                        void addFillImage(e.target.files?.[0])
                        e.target.value = ''
                      }}
                    />
                    <span className="ico-btn">
                      <IconImage /> {fillImage ? 'เปลี่ยนรูปพื้น' : 'ใส่รูปพื้น'}
                    </span>
                  </label>
                  {fillImage && (
                    <button className="fill-none-btn" disabled={aiBusy} onClick={() => setFillImage(null)}>
                      ลบรูป
                    </button>
                  )}
                </div>

                {fillImage && (
                  <div className="fill-crop">
                    <label className="crop-fit">
                      การครอป
                      <select
                        value={fillImage.fit ?? 'cover'}
                        disabled={aiBusy}
                        onChange={(e) => patchFillImage({ fit: e.target.value as FillImage['fit'] })}
                      >
                        <option value="cover">พอดี–เต็ม (ครอป)</option>
                        <option value="contain">เห็นทั้งรูป</option>
                        <option value="stretch">ยืดเต็มกรอบ</option>
                      </select>
                    </label>
                    <label className="crop-slider">
                      <span>ซูม</span>
                      <input
                        type="range"
                        min={100}
                        max={300}
                        step={1}
                        disabled={aiBusy || fillImage.fit === 'stretch'}
                        value={Math.round((fillImage.zoom ?? 1) * 100)}
                        onChange={(e) => patchFillImage({ zoom: Number(e.target.value) / 100 })}
                      />
                      <span className="crop-val">{Math.round((fillImage.zoom ?? 1) * 100)}%</span>
                    </label>
                    <label className="crop-slider">
                      <span>เลื่อน ↔</span>
                      <input
                        type="range"
                        min={-100}
                        max={100}
                        step={1}
                        disabled={aiBusy || fillImage.fit === 'stretch'}
                        value={Math.round((fillImage.ox ?? 0) * 100)}
                        onChange={(e) => patchFillImage({ ox: Number(e.target.value) / 100 })}
                      />
                    </label>
                    <label className="crop-slider">
                      <span>เลื่อน ↕</span>
                      <input
                        type="range"
                        min={-100}
                        max={100}
                        step={1}
                        disabled={aiBusy || fillImage.fit === 'stretch'}
                        value={Math.round((fillImage.oy ?? 0) * 100)}
                        onChange={(e) => patchFillImage({ oy: Number(e.target.value) / 100 })}
                      />
                    </label>
                    <button
                      className="crop-reset"
                      disabled={aiBusy}
                      onClick={() => patchFillImage({ zoom: 1, ox: 0, oy: 0 })}
                    >
                      รีเซ็ตการครอป
                    </button>
                  </div>
                )}

                <p className="hint">
                  {fillImage
                    ? 'รูปพื้นคลุมทั้งแพ็กเกจแล้วครอปตามรูปทรง blueprint — เข้าไฟล์ .svg/.pdf จริง (ไม่ใส่ .dxf); ปรับซูม/เลื่อนให้รูปเข้ากรอบพอดี'
                    : mat.foldable
                      ? 'ถมสีทั้งแผ่น (flood) เข้าไฟล์ .svg/.pdf จริง — ไม่ใส่ใน .dxf; “ไม่มีสี” = โชว์สีวัสดุ · หรือใส่รูปเป็นพื้นก็ได้'
                      : 'ถมสีพื้นฉลากทั้งแผ่น เข้าไฟล์ .svg/.pdf จริง; “ไม่มีสี” = ฉลากพื้นขาว · หรือใส่รูปเป็นพื้นก็ได้'}
                </p>
              </section>

              <section>
                <h2>โลโก้ / ข้อความ / รูปทรง</h2>
                <div className="art-actions">
                  <label className="file-pick inline">
                    <input
                      type="file"
                      accept="image/*,.svg"
                      disabled={aiBusy}
                      onChange={(e) => {
                        void addImage(e.target.files?.[0])
                        e.target.value = ''
                      }}
                    />
                    <span className="ico-btn"><IconImage /> โลโก้</span>
                  </label>
                  <button className="ico-btn" disabled={aiBusy} onClick={addText}>
                    <IconText /> ข้อความ
                  </button>
                </div>
                <div className="art-actions" style={{ marginTop: 8 }}>
                  <button className="ico-btn" disabled={aiBusy} title="สี่เหลี่ยม" onClick={() => addShape('rect')}>
                    <IconRect /> สี่เหลี่ยม
                  </button>
                  <button className="ico-btn" disabled={aiBusy} title="วงกลม/วงรี" onClick={() => addShape('ellipse')}>
                    <IconEllipse /> วงกลม
                  </button>
                  <button className="ico-btn" disabled={aiBusy} title="เส้น" onClick={() => addShape('line')}>
                    <IconLine /> เส้น
                  </button>
                </div>

                {decos.length > 0 && (
                  <ul className="deco-list">
                    {/* บนสุด = หน้าสุด (กลับลำดับ array ที่ท้าย = วาดทับ) */}
                    {[...decos].reverse().map((d) => {
                      const thumb =
                        d.type === 'image' ? (
                          <img className="deco-thumb" src={d.src} alt="" />
                        ) : d.type === 'shape' ? (
                          <span
                            className={`deco-sw${d.shape === 'ellipse' ? ' round' : ''}`}
                            style={{
                              background: d.fill && d.fill !== 'none' ? d.fill : 'transparent',
                              borderColor: d.stroke && d.stroke !== 'none' ? d.stroke : d.fill,
                            }}
                          />
                        ) : (
                          <span className="deco-tico" style={{ color: d.color }}>
                            T
                          </span>
                        )
                      return (
                      <li key={d.id} className={`deco-row${d.hidden ? ' is-hidden' : ''}`}>
                        {renamingId === d.id ? (
                          <div className="deco-item renaming">
                            {thumb}
                            <input
                              className="deco-name-edit"
                              defaultValue={d.name ?? ''}
                              maxLength={40}
                              placeholder={decoLabel(d)}
                              autoFocus
                              onFocus={(e) => e.currentTarget.select()}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  renameDeco(d.id, e.currentTarget.value)
                                  setRenamingId(null)
                                } else if (e.key === 'Escape') {
                                  setRenamingId(null)
                                }
                              }}
                              onBlur={(e) => {
                                renameDeco(d.id, e.currentTarget.value)
                                setRenamingId(null)
                              }}
                            />
                          </div>
                        ) : (
                          <button
                            className={`deco-item${isSelected(d.id) ? ' active' : ''}`}
                            onClick={(e) => selectDeco(d.id, e.shiftKey || e.ctrlKey || e.metaKey)}
                            onDoubleClick={() => setRenamingId(d.id)}
                            title={`${decoLabel(d)} — คลิกเลือก · ดับเบิลคลิกเพื่อตั้งชื่อ · Shift/Ctrl เลือกหลายชิ้น`}
                          >
                            {thumb}
                            <span className="deco-name">{decoLabel(d)}</span>
                          </button>
                        )}
                        <button
                          className="deco-toggle"
                          title={d.hidden ? 'แสดง' : 'ซ่อน'}
                          aria-label={d.hidden ? 'แสดงชิ้นนี้' : 'ซ่อนชิ้นนี้'}
                          aria-pressed={!d.hidden}
                          onClick={() => toggleHidden(d.id)}
                        >
                          {d.hidden ? '🙈' : '👁'}
                        </button>
                        <button
                          className="deco-toggle"
                          title={d.locked ? 'ปลดล็อก' : 'ล็อก'}
                          aria-label={d.locked ? 'ปลดล็อกชิ้นนี้' : 'ล็อกชิ้นนี้'}
                          aria-pressed={!!d.locked}
                          onClick={() => toggleLocked(d.id)}
                        >
                          {d.locked ? '🔒' : '🔓'}
                        </button>
                      </li>
                      )
                    })}
                  </ul>
                )}

                {multi && (
                  <div className="deco-edit">
                    <div className="multi-head">เลือก {selectedIds.length} ชิ้น</div>
                    <div className="align-box">
                      <span className="align-title">จัดแนวในกลุ่มที่เลือก</span>
                      <div className="align-grid">
                        <span className="align-axis">↔</span>
                        <button title="ชิดซ้าย" aria-label="ชิดซ้าย" onClick={() => alignSelected('left')}>⭰</button>
                        <button title="กึ่งกลางแนวนอน" aria-label="กึ่งกลางแนวนอน" onClick={() => alignSelected('hcenter')}>⭤</button>
                        <button title="ชิดขวา" aria-label="ชิดขวา" onClick={() => alignSelected('right')}>⭲</button>
                        <span className="align-axis">↕</span>
                        <button title="ชิดบน" aria-label="ชิดบน" onClick={() => alignSelected('top')}>⭱</button>
                        <button title="กึ่งกลางแนวตั้ง" aria-label="กึ่งกลางแนวตั้ง" onClick={() => alignSelected('vcenter')}>⭥</button>
                        <button title="ชิดล่าง" aria-label="ชิดล่าง" onClick={() => alignSelected('bottom')}>⭳</button>
                      </div>
                    </div>
                    {selectedIds.length >= 3 && (
                      <div className="art-actions" style={{ marginTop: 8 }}>
                        <button onClick={() => distributeSelected('h')}>กระจาย ↔</button>
                        <button onClick={() => distributeSelected('v')}>กระจาย ↕</button>
                      </div>
                    )}
                    <div className="art-actions" style={{ marginTop: 8 }}>
                      <button onClick={groupSelected}>จัดกลุ่ม</button>
                      <button onClick={ungroupSelected}>แยกกลุ่ม</button>
                    </div>
                    <div className="art-actions">
                      <button onClick={duplicateSelected}>ทำสำเนา</button>
                      <button onClick={toggleHiddenSelected}>ซ่อน/แสดง</button>
                      <button onClick={toggleLockedSelected}>ล็อก/ปลด</button>
                    </div>
                    <div className="art-actions">
                      <button onClick={removeSelected}>ลบที่เลือก</button>
                    </div>
                    <p className="hint">Shift/Ctrl คลิกเพื่อเพิ่ม-ลดชิ้น · ลากชิ้นใดชิ้นหนึ่งเพื่อย้ายทั้งชุด · Ctrl+G จัดกลุ่ม</p>
                  </div>
                )}

                {selected && (
                  <div className="deco-edit">
                    {selected.type === 'text' && (
                      <>
                        <textarea
                          className="deco-text-input"
                          rows={2}
                          value={selected.text}
                          disabled={aiBusy}
                          aria-label="ข้อความ (Enter = ขึ้นบรรทัดใหม่)"
                          onChange={(e) => patchSelected((d) => (d.type === 'text' ? withTextW({ ...d, text: e.target.value }) : d))}
                        />
                        <div className="align-seg" role="group" aria-label="จัดชิดข้อความ">
                          {(
                            [
                              ['left', 'ชิดซ้าย', <IconAlignLeft key="l" />],
                              ['center', 'กึ่งกลาง', <IconAlignCenter key="c" />],
                              ['right', 'ชิดขวา', <IconAlignRight key="r" />],
                            ] as const
                          ).map(([a, title, icon]) => (
                            <button
                              key={a}
                              aria-pressed={(selected.align ?? 'left') === a}
                              title={title}
                              aria-label={title}
                              disabled={aiBusy}
                              onClick={() =>
                                patchSelected((d) =>
                                  d.type === 'text' ? { ...d, align: a === 'left' ? undefined : a } : d,
                                )
                              }
                            >
                              {icon}
                            </button>
                          ))}
                        </div>
                        <DimField
                          label="ระยะบรรทัด"
                          value={Math.round((selected.lh ?? 1.25) * 100) / 100}
                          min={0.8}
                          max={3}
                          step={0.05}
                          unit="×"
                          disabled={aiBusy}
                          onChange={(v) =>
                            patchSelected((d) => (d.type === 'text' ? { ...d, lh: v === 1.25 ? undefined : v } : d))
                          }
                        />
                        <div className="deco-color">
                          <span>สี</span>
                          <ColorField
                            value={selected.color}
                            onChange={(hex) => patchSelected((d) => (d.type === 'text' ? { ...d, color: hex } : d))}
                            palette={palette}
                            onSave={saveSwatch}
                            disabled={aiBusy}
                            label="สีข้อความ"
                          />
                        </div>
                        <div className="font-row">
                          <select
                            value={selected.font ?? 'noto'}
                            disabled={aiBusy}
                            aria-label="ฟอนต์"
                            style={{ fontFamily: `${fontCss(selected.font)}, sans-serif` }}
                            onChange={(e) => patchSelected((d) => (d.type === 'text' ? withTextW({ ...d, font: e.target.value }) : d))}
                          >
                            {FONTS.map((f) => (
                              <option key={f.id} value={f.id} style={{ fontFamily: `${f.css}, sans-serif` }}>
                                {f.nameTh}
                              </option>
                            ))}
                          </select>
                          <button
                            className="bold-btn"
                            aria-pressed={selected.weight === 700}
                            title="ตัวหนา"
                            disabled={aiBusy}
                            onClick={() => patchSelected((d) => (d.type === 'text' ? withTextW({ ...d, weight: d.weight === 700 ? 400 : 700 }) : d))}
                          >
                            B
                          </button>
                        </div>
                      </>
                    )}

                    {selected.type === 'shape' && selected.shape === 'line' && (
                      <>
                        <div className="deco-color">
                          <span>สีเส้น</span>
                          <ColorField
                            value={selected.stroke === 'none' ? '#222222' : selected.stroke}
                            onChange={(hex) => patchSelected((d) => (d.type === 'shape' ? { ...d, stroke: hex } : d))}
                            palette={palette}
                            onSave={saveSwatch}
                            disabled={aiBusy}
                            label="สีเส้น"
                          />
                        </div>
                        <DimField
                          label="ความยาว"
                          value={Math.round(selected.w * 10) / 10}
                          min={2}
                          max={Math.round(dieline.width)}
                          disabled={aiBusy}
                          onChange={(v) => patchSelected((d) => (d.type === 'shape' ? { ...d, w: v } : d))}
                        />
                        <DimField
                          label="ความหนา"
                          value={selected.strokeW}
                          min={0.5}
                          max={30}
                          disabled={aiBusy}
                          onChange={(v) => patchSelected((d) => (d.type === 'shape' ? { ...d, strokeW: v, h: v } : d))}
                        />
                      </>
                    )}

                    {selected.type === 'shape' && selected.shape !== 'line' && (
                      <>
                        <div className="art-actions">
                          <div className="deco-color">
                            <span>พื้น</span>
                            <ColorField
                              value={selected.fill === 'none' ? '#0f6e56' : selected.fill}
                              onChange={(hex) => patchSelected((d) => (d.type === 'shape' ? { ...d, fill: hex } : d))}
                              palette={palette}
                              onSave={saveSwatch}
                              disabled={aiBusy}
                              label="สีพื้น"
                            />
                          </div>
                          <button
                            disabled={aiBusy || selected.fill === 'none'}
                            onClick={() => patchSelected((d) => (d.type === 'shape' ? { ...d, fill: 'none', strokeW: d.strokeW > 0 ? d.strokeW : 2, stroke: d.stroke === 'none' ? '#222222' : d.stroke } : d))}
                          >
                            ไม่มีพื้น
                          </button>
                        </div>
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={!!selected.grad}
                            disabled={aiBusy}
                            onChange={(e) =>
                              patchSelected((d) =>
                                d.type === 'shape'
                                  ? {
                                      ...d,
                                      grad: e.target.checked
                                        ? { from: d.fill !== 'none' ? d.fill : '#0f6e56', to: '#ffffff', angle: 90 }
                                        : undefined,
                                    }
                                  : d,
                              )
                            }
                          />
                          ไล่สี (gradient)
                        </label>
                        {selected.grad && (
                          <>
                            <div className="deco-color">
                              <span>จาก</span>
                              <ColorField
                                value={selected.grad.from}
                                onChange={(hex) => patchSelected((d) => (d.type === 'shape' && d.grad ? { ...d, grad: { ...d.grad, from: hex } } : d))}
                                palette={palette}
                                onSave={saveSwatch}
                                disabled={aiBusy}
                                label="สีเริ่มไล่"
                              />
                            </div>
                            <div className="deco-color">
                              <span>ถึง</span>
                              <ColorField
                                value={selected.grad.to}
                                onChange={(hex) => patchSelected((d) => (d.type === 'shape' && d.grad ? { ...d, grad: { ...d.grad, to: hex } } : d))}
                                palette={palette}
                                onSave={saveSwatch}
                                disabled={aiBusy}
                                label="สีปลายไล่"
                              />
                            </div>
                            <label className="check">
                              <input
                                type="checkbox"
                                checked={!!selected.grad.radial}
                                disabled={aiBusy}
                                onChange={(e) => patchSelected((d) => (d.type === 'shape' && d.grad ? { ...d, grad: { ...d.grad, radial: e.target.checked || undefined } } : d))}
                              />
                              แบบวงกลม (radial)
                            </label>
                            {!selected.grad.radial && (
                              <DimField
                                label="มุมไล่สี (องศา)"
                                value={selected.grad.angle}
                                min={0}
                                max={360}
                                disabled={aiBusy}
                                onChange={(v) => patchSelected((d) => (d.type === 'shape' && d.grad ? { ...d, grad: { ...d.grad, angle: v } } : d))}
                              />
                            )}
                          </>
                        )}
                        <div className="deco-color">
                          <span>เส้นขอบ</span>
                          <ColorField
                            value={selected.stroke === 'none' ? '#222222' : selected.stroke}
                            onChange={(hex) => patchSelected((d) => (d.type === 'shape' ? { ...d, stroke: hex, strokeW: d.strokeW > 0 ? d.strokeW : 2 } : d))}
                            palette={palette}
                            onSave={saveSwatch}
                            disabled={aiBusy}
                            label="สีเส้นขอบ"
                          />
                        </div>
                        <DimField
                          label="เส้นขอบหนา (0=ไม่มี)"
                          value={selected.strokeW}
                          min={0}
                          max={20}
                          disabled={aiBusy}
                          onChange={(v) => patchSelected((d) => (d.type === 'shape' ? { ...d, strokeW: v, stroke: v > 0 && d.stroke === 'none' ? '#222222' : d.stroke } : d))}
                        />
                        <DimField
                          label="กว้าง"
                          value={Math.round(selected.w * 10) / 10}
                          min={2}
                          max={Math.round(dieline.width)}
                          disabled={aiBusy}
                          onChange={(v) => patchSelected((d) => (d.type === 'shape' ? { ...d, w: v } : d))}
                        />
                        <DimField
                          label="สูง"
                          value={Math.round(selected.h * 10) / 10}
                          min={2}
                          max={Math.round(dieline.height)}
                          disabled={aiBusy}
                          onChange={(v) => patchSelected((d) => (d.type === 'shape' ? { ...d, h: v } : d))}
                        />
                      </>
                    )}

                    {selected.type === 'text' && (
                      <DimField
                        label="ขนาดตัวอักษร"
                        value={selected.size}
                        min={3}
                        max={120}
                        disabled={aiBusy}
                        onChange={(v) => patchSelected((d) => (d.type === 'text' ? withTextW({ ...d, size: v }) : d))}
                      />
                    )}
                    {selected.type === 'image' && (
                      <>
                        <DimField
                          label="กรอบ กว้าง"
                          value={Math.round(selected.w * 10) / 10}
                          min={5}
                          max={Math.round(dieline.width)}
                          disabled={aiBusy}
                          onChange={(v) =>
                            patchSelected((d) =>
                              d.type === 'image'
                                ? {
                                    ...d,
                                    w: v,
                                    ...(lockAspect
                                      ? { h: Math.round(clamp(v / d.aspect, 5, dieline.height) * 10) / 10 }
                                      : {}),
                                  }
                                : d,
                            )
                          }
                        />
                        <DimField
                          label="กรอบ สูง"
                          value={Math.round(selected.h * 10) / 10}
                          min={5}
                          max={Math.round(dieline.height)}
                          disabled={aiBusy}
                          onChange={(v) =>
                            patchSelected((d) =>
                              d.type === 'image'
                                ? {
                                    ...d,
                                    h: v,
                                    ...(lockAspect
                                      ? { w: Math.round(clamp(v * d.aspect, 5, dieline.width) * 10) / 10 }
                                      : {}),
                                  }
                                : d,
                            )
                          }
                        />
                        <button
                          className="lock-ratio"
                          aria-pressed={lockAspect}
                          title={lockAspect ? 'กำลังล็อกสัดส่วน — ปรับกว้าง/สูงพร้อมกัน' : 'ล็อกสัดส่วนรูป'}
                          disabled={aiBusy}
                          onClick={() => {
                            const next = !lockAspect
                            setLockAspect(next)
                            // เปิดล็อก = ปรับกรอบให้ตรงสัดส่วนรูปทันที (อิงความกว้างปัจจุบัน)
                            if (next)
                              patchSelected((d) =>
                                d.type === 'image'
                                  ? { ...d, h: Math.round(clamp(d.w / d.aspect, 5, dieline.height) * 10) / 10 }
                                  : d,
                              )
                          }}
                        >
                          {lockAspect ? '🔒' : '🔓'} ล็อกสัดส่วน
                        </button>
                        <div className="font-row">
                          <select
                            value={selected.fit ?? 'cover'}
                            disabled={aiBusy}
                            aria-label="วิธีวางรูปในกรอบ"
                            onChange={(e) => patchSelected((d) => (d.type === 'image' ? { ...d, fit: e.target.value as 'cover' | 'contain' | 'stretch' } : d))}
                          >
                            <option value="cover">เต็มกรอบ (ครอป)</option>
                            <option value="contain">พอดีทั้งรูป</option>
                            <option value="stretch">ยืดเต็มกรอบ</option>
                          </select>
                          <button
                            className="ratio-btn"
                            title="คืนสัดส่วนเดิมของรูป"
                            disabled={aiBusy}
                            onClick={() => patchSelected((d) => (d.type === 'image' ? { ...d, h: Math.round((d.w / d.aspect) * 10) / 10 } : d))}
                          >
                            สัดส่วนเดิม
                          </button>
                        </div>
                        <DimField
                          label="มุมโค้ง (มม.)"
                          value={selected.radius ?? 0}
                          min={0}
                          max={Math.round(Math.min(selected.w, selected.h) / 2)}
                          disabled={aiBusy || !!selected.circle}
                          onChange={(v) => patchSelected((d) => (d.type === 'image' ? { ...d, radius: v || undefined } : d))}
                        />
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={!!selected.circle}
                            disabled={aiBusy}
                            onChange={(e) => patchSelected((d) => (d.type === 'image' ? { ...d, circle: e.target.checked || undefined } : d))}
                          />
                          มาสก์วงรี
                        </label>
                      </>
                    )}
                    <DimField
                      label="หมุน (องศา)"
                      value={selected.rot}
                      min={-180}
                      max={180}
                      disabled={aiBusy}
                      onChange={(deg) => patchSelected((d) => ({ ...d, rot: deg }))}
                    />
                    <div className="xy-row">
                      <label>
                        X
                        <input
                          type="number"
                          step={0.5}
                          value={Math.round(selected.x * 10) / 10}
                          disabled={aiBusy}
                          aria-label="ตำแหน่ง X (มม.)"
                          onChange={(e) => patchSelected((d) => ({ ...d, x: Number(e.target.value) || 0 }))}
                        />
                        มม.
                      </label>
                      <label>
                        Y
                        <input
                          type="number"
                          step={0.5}
                          value={Math.round(selected.y * 10) / 10}
                          disabled={aiBusy}
                          aria-label="ตำแหน่ง Y (มม.)"
                          onChange={(e) => patchSelected((d) => ({ ...d, y: Number(e.target.value) || 0 }))}
                        />
                        มม.
                      </label>
                    </div>
                    <div className="art-actions">
                      <button
                        aria-pressed={!!selected.flipX}
                        title="พลิกแนวนอน"
                        onClick={() => patchSelected((d) => ({ ...d, flipX: !d.flipX }))}
                      >
                        ⇋ พลิกแนวนอน
                      </button>
                      <button
                        aria-pressed={!!selected.flipY}
                        title="พลิกแนวตั้ง"
                        onClick={() => patchSelected((d) => ({ ...d, flipY: !d.flipY }))}
                      >
                        ⥯ พลิกแนวตั้ง
                      </button>
                    </div>
                    <DimField
                      label="ความทึบ (%)"
                      value={Math.round((selected.opacity ?? 1) * 100)}
                      min={0}
                      max={100}
                      unit="%"
                      disabled={aiBusy}
                      onChange={(v) =>
                        patchSelected((d) => ({ ...d, opacity: Math.min(1, Math.max(0, v / 100)) }))
                      }
                    />
                    {decos.length > 1 && (
                      <div className="layer-row">
                        <span className="layer-label">
                          เลเยอร์ {selIdx + 1}/{decos.length}
                        </span>
                        <div className="layer-btns">
                          <button
                            title="ไปหลังสุด"
                            aria-label="ไปหลังสุด"
                            disabled={aiBusy || selIdx <= 0}
                            onClick={() => restackSelected(-1, true)}
                          >
                            ⤓
                          </button>
                          <button
                            title="ลงหลังหนึ่งชั้น"
                            aria-label="ลงหลัง"
                            disabled={aiBusy || selIdx <= 0}
                            onClick={() => restackSelected(-1)}
                          >
                            ▼
                          </button>
                          <button
                            title="ขึ้นหน้าหนึ่งชั้น"
                            aria-label="ขึ้นหน้า"
                            disabled={aiBusy || selIdx >= decos.length - 1}
                            onClick={() => restackSelected(1)}
                          >
                            ▲
                          </button>
                          <button
                            title="ไปหน้าสุด"
                            aria-label="ไปหน้าสุด"
                            disabled={aiBusy || selIdx >= decos.length - 1}
                            onClick={() => restackSelected(1, true)}
                          >
                            ⤒
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="align-box">
                      <span className="align-title">จัดแนวในแผงหน้า</span>
                      <div className="align-grid">
                        <span className="align-axis">↔</span>
                        <button title="ชิดซ้าย" aria-label="ชิดซ้าย" onClick={() => alignSelected('left')}>⭰</button>
                        <button title="กึ่งกลางแนวนอน" aria-label="กึ่งกลางแนวนอน" onClick={() => alignSelected('hcenter')}>⭤</button>
                        <button title="ชิดขวา" aria-label="ชิดขวา" onClick={() => alignSelected('right')}>⭲</button>
                        <span className="align-axis">↕</span>
                        <button title="ชิดบน" aria-label="ชิดบน" onClick={() => alignSelected('top')}>⭱</button>
                        <button title="กึ่งกลางแนวตั้ง" aria-label="กึ่งกลางแนวตั้ง" onClick={() => alignSelected('vcenter')}>⭥</button>
                        <button title="ชิดล่าง" aria-label="ชิดล่าง" onClick={() => alignSelected('bottom')}>⭳</button>
                      </div>
                    </div>
                    <div className="art-actions">
                      <button onClick={recenterSelected}>วางกลางแผงหน้า</button>
                      <button onClick={removeSelected}>ลบชิ้นนี้</button>
                    </div>
                    <p className="hint">ลาก/หมุนบน blueprint ได้ (จุดวงกลม = หมุน) · เลเยอร์สูง = อยู่หน้า</p>
                  </div>
                )}

                {selectedIds.length >= 1 && (
                  <div className="sr-box">
                    <span className="align-title">ทำซ้ำเป็นแพตเทิร์น (step &amp; repeat)</span>
                    <div className="sr-grid">
                      <label>
                        คอลัมน์
                        <input type="number" min={1} max={40} value={sr.cols} disabled={aiBusy} aria-label="จำนวนคอลัมน์"
                          onChange={(e) => setSr((s) => ({ ...s, cols: clamp(Math.round(Number(e.target.value)) || 1, 1, 40) }))} />
                      </label>
                      <label>
                        แถว
                        <input type="number" min={1} max={40} value={sr.rows} disabled={aiBusy} aria-label="จำนวนแถว"
                          onChange={(e) => setSr((s) => ({ ...s, rows: clamp(Math.round(Number(e.target.value)) || 1, 1, 40) }))} />
                      </label>
                      <label>
                        ระยะ X
                        <input type="number" min={0} value={sr.dx} disabled={aiBusy} aria-label="ระยะห่าง X (มม.)"
                          onChange={(e) => setSr((s) => ({ ...s, dx: Number(e.target.value) || 0 }))} />
                      </label>
                      <label>
                        ระยะ Y
                        <input type="number" min={0} value={sr.dy} disabled={aiBusy} aria-label="ระยะห่าง Y (มม.)"
                          onChange={(e) => setSr((s) => ({ ...s, dy: Number(e.target.value) || 0 }))} />
                      </label>
                    </div>
                    <label className="check">
                      <input type="checkbox" checked={sr.brick} disabled={aiBusy}
                        onChange={(e) => setSr((s) => ({ ...s, brick: e.target.checked }))} />
                      สลับฟันปลา (แถวคี่เยื้องครึ่งระยะ)
                    </label>
                    <button
                      className="primary"
                      disabled={aiBusy || sr.cols * sr.rows <= 1}
                      onClick={applyStepRepeat}
                    >
                      สร้าง {(sr.cols * sr.rows - 1) * selectedIds.length} สำเนา
                    </button>
                  </div>
                )}

                <p className="hint">
                  ลายจะถูกใส่ลงไฟล์ .svg (vector) และ .pdf (300 dpi) แล้ว — ไม่ใส่ใน .dxf เพราะเป็นไฟล์มีดตัด
                </p>
              </section>
          </>
          )}

          {sideTab === 'export' && (
          <>
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
                <h2>จำนวนต่อแผ่น (imposition)</h2>
                <select
                  value={sheetId}
                  disabled={aiBusy}
                  aria-label="ขนาดแผ่นใหญ่"
                  onChange={(e) => setSheetId(e.target.value)}
                >
                  {SHEET_PRESETS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nameTh}
                    </option>
                  ))}
                  <option value="custom">กำหนดขนาดเอง…</option>
                </select>

                {sheetId === 'custom' && (
                  <div className="imp-custom">
                    <label>
                      กว้าง
                      <input
                        type="number"
                        min={50}
                        max={2000}
                        value={customSheet.w}
                        aria-label="ความกว้างแผ่น (มม.)"
                        onChange={(e) =>
                          setCustomSheet((s) => ({ ...s, w: clamp(Number(e.target.value) || 0, 50, 2000) }))
                        }
                      />
                      มม.
                    </label>
                    <label>
                      ยาว
                      <input
                        type="number"
                        min={50}
                        max={2000}
                        value={customSheet.h}
                        aria-label="ความยาวแผ่น (มม.)"
                        onChange={(e) =>
                          setCustomSheet((s) => ({ ...s, h: clamp(Number(e.target.value) || 0, 50, 2000) }))
                        }
                      />
                      มม.
                    </label>
                  </div>
                )}

                <div className="field">
                  <span className="field-head">
                    ร่องระหว่างชิ้น
                    <span className="field-num">
                      <input
                        type="number"
                        min={0}
                        max={30}
                        step={0.5}
                        value={gutter}
                        disabled={aiBusy}
                        aria-label="ร่องระหว่างชิ้น (มม.)"
                        onChange={(e) => setGutter(clamp(Number(e.target.value) || 0, 0, 30))}
                      />
                      มม.
                    </span>
                  </span>
                </div>

                {imposition &&
                  (imposition.count > 0 ? (
                    <>
                      <ImpositionDiagram
                        sheet={sheet}
                        pieceW={imposition.rotated ? dieline.height : dieline.width}
                        pieceH={imposition.rotated ? dieline.width : dieline.height}
                        layout={imposition}
                        margin={DEFAULT_OPT.margin}
                        gutter={gutter}
                      />
                      <div className="imp-result">
                        <div>
                          <b>{imposition.count}</b> ชิ้น/แผ่น ({imposition.cols}×{imposition.rows}
                          {imposition.rotated ? ' · หมุน 90°' : ''})
                        </div>
                        <div>
                          ใช้พื้นที่ {Math.round(imposition.usedFrac * 100)}% · เศษเหลือ{' '}
                          {Math.round((1 - imposition.usedFrac) * 100)}%
                        </div>
                        <div className="imp-need">
                          ผลิต {qty.toLocaleString('th-TH')} ใบ → ใช้ประมาณ{' '}
                          <b>{sheetsNeeded(qty, imposition.count).toLocaleString('th-TH')}</b> แผ่น
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="hint warn">
                      กล่องแผ่นคลี่ ({Math.ceil(dieline.width)}×{Math.ceil(dieline.height)} มม.)
                      ใหญ่กว่าพื้นที่วางบนแผ่นนี้ — ลองแผ่นใหญ่ขึ้น ลดร่อง หรือลดขนาดกล่อง
                    </p>
                  ))}
                <p className="hint">
                  ขอบแผ่น {DEFAULT_OPT.margin} มม.รอบด้าน · เทียบวางตั้ง/หมุน 90° เลือกที่ได้มากสุด —
                  ประมาณการเบื้องต้น ยังไม่รวมการวางสลับทิศในแผ่นเดียว
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
                <button className="primary" onClick={() => void downloadSpecSheet()}>
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

              <section>
                <h2>สำรอง / ย้ายงาน (.genpkg.json)</h2>
                <div className="art-actions">
                  <button disabled={aiBusy} onClick={exportProject}>
                    ⬇ ส่งออกงานนี้
                  </button>
                  <label className="file-pick inline">
                    <input
                      type="file"
                      accept=".json,application/json"
                      disabled={aiBusy}
                      onChange={(e) => {
                        void importProject(e.target.files?.[0])
                        e.target.value = ''
                      }}
                    />
                    <span>⬆ นำเข้างาน</span>
                  </label>
                </div>
                <p className="hint">
                  เก็บทั้งงาน (รูปแบบ/วัสดุ/ขนาด/สี/โลโก้-ข้อความ/ประวัติเวอร์ชัน) เป็นไฟล์เดียว —
                  สำรองไว้ ย้ายไปเครื่องอื่น หรือส่งให้ลูกค้า/โรงงานเปิดต่อได้ นำเข้าแล้วเพิ่มเป็นงานใหม่
                  ไม่ทับงานเดิม
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
          <div
            className="panels"
            ref={panelsRef}
            style={{ '--split-l': `${split}fr`, '--split-r': `${1 - split}fr` } as React.CSSProperties}
          >
            <div className="blueprint card">
              <div className="bp-head">
                <span>{mat.foldable ? 'blueprint การพับ' : 'dieline ฉลาก'}</span>
                <div className="bp-head-right">
                  <div className="undo-bar">
                    <button
                      className="undo-btn"
                      title="เลิกทำ (Ctrl+Z)"
                      aria-label="เลิกทำ"
                      aria-disabled={aiBusy || undoStack.length === 0}
                      onClick={undo}
                    >
                      <IconUndo />
                    </button>
                    <button
                      className="undo-btn"
                      title="ทำซ้ำ (Ctrl+Shift+Z)"
                      aria-label="ทำซ้ำ"
                      aria-disabled={aiBusy || redoStack.length === 0}
                      onClick={redo}
                    >
                      <IconRedo />
                    </button>
                  </div>
                  <span className="legend">
                    <i className="sw-cut" /> เส้นตัด
                    <i className="sw-crease" /> {mat.foldable ? 'เส้นพับ' : 'แนวทับกาว'}
                  </span>
                </div>
              </div>
              <DielineSVG
                dieline={dieline}
                showDims={showDims}
                decos={decos}
                guides={guides}
                fillColor={fillColor}
                fillImage={fillImage}
                selectedIds={selectedIds}
                onSelect={selectDeco}
                onMove={moveDeco}
                onRotate={rotateDeco}
                onRemove={removeDeco}
              />
            </div>
            <div
              className="panels-divider"
              role="separator"
              aria-label="ลากปรับขนาดหน้าต่าง"
              aria-orientation="vertical"
              onPointerDown={onDividerDown}
              onPointerMove={onDividerMove}
              onPointerUp={onDividerUp}
              onPointerCancel={onDividerUp}
            >
              <span />
            </div>
            <div className="viewer card">
              {foldBar}
              <div className="viewer-3d">
                <Suspense fallback={<div className="viewer-loading">กำลังโหลดมุมมอง 3 มิติ…</div>}>
                  {mat.foldable ? (
                    <Viewer3D
                      dieline={dieline}
                      mat={mat}
                      fold={fold}
                      depth={template.foldDepth({ W, D, H }, mat)}
                      tilt={template.tilt}
                      decos={decos}
                      fillColor={fillColor}
                      fillImage={fillImage}
                    />
                  ) : (
                    <VesselViewer3D vessel={vessel!} mat={mat} decos={decos} fillColor={fillColor} fillImage={fillImage} />
                  )}
                </Suspense>
              </div>
            </div>
          </div>
        </main>
      </div>
      {nameModal && (
        <NameModal
          title={nameModal.title}
          initial={nameModal.value}
          onOk={(n) => {
            nameModal.onOk(n)
            setNameModal(null)
          }}
          onCancel={() => setNameModal(null)}
        />
      )}
    </div>
  )
}
