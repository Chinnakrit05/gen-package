import { Suspense, createContext, lazy, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// true เมื่อ DimField อยู่ในแถบปรับแต่งด้านบน (Canva-style) → เปลี่ยนสไลเดอร์เป็นปุ่ม+dropdown อัตโนมัติ
const TopBarCtx = createContext(false)
import { MATERIALS, getMaterial, packKind } from './core/materials'
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
  makeNutritionEl,
  type Deco,
  type FillImage,
  type ShapeKind,
  type NutriRow,
} from './core/artwork'
import { computeGuides, guidesSVGLayer, type Guides } from './core/guides'
import { generateVessel, LABEL_STYLES, type LabelStyle } from './core/vessel'
import { generatePouch, POUCH_STYLES, type PouchStyle, type PouchAddons } from './core/pouch'
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
import { PRESETS, PRESET_CATS, presetById, presetDataUrl, type Preset } from './core/presets'
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
const PouchViewer3D = lazy(() =>
  import('./components/PouchViewer3D').then((m) => ({ default: m.PouchViewer3D })),
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
  IconTriangle,
  IconPolygon,
  IconStar,
  IconAlignLeft,
  IconAlignCenter,
  IconAlignRight,
  IconBox,
  IconBottle,
  IconPouch,
  IconCard,
  IconTrash,
  IconFontSize,
  IconStroke,
  IconNutrition,
  IconPosition,
  IconEffects,
} from './components/icons'

// จานสี (palette) ใช้ร่วมทุกช่องสี — เก็บระดับแอปใน localStorage แยกจากงาน
const PALETTE_KEY = 'gen-package-palette-v1'
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
  // pop = แสดงเป็นปุ่มเล็ก คลิกแล้ว dropdown สไลเดอร์ลงมา (แบบ Canva) — ใช้ในแถบบน
  pop?: boolean
  icon?: React.ReactNode // ถ้ามี → ปุ่ม pop โชว์ไอคอนแทนป้ายข้อความ (label ยังอยู่ใน dropdown + tooltip)
}

function DimField({ label, value, min, max, disabled, unit = 'มม.', step = 0.5, onChange, pop: popProp, icon }: DimFieldProps) {
  const commit = (v: number) => onChange(clamp(Number.isFinite(v) ? v : min, min, max))
  const inTopBar = useContext(TopBarCtx) // เรียก hook แบบไม่มีเงื่อนไข
  const pop = popProp || inTopBar // ในแถบบน = โหมด dropdown อัตโนมัติ
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null)
  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setMenuPos({ left: r.left, top: r.bottom + 6 }) // dropdown ใต้ปุ่ม (portal ไป body กันโดน overflow ตัด)
    setOpen((v) => !v)
  }
  // clamp dropdown เข้าจอหลังเรนเดอร์ (ปุ่มชิดขวาแถบ → เมนูล้นขอบ)
  useLayoutEffect(() => {
    if (!pop || !open) return
    const menu = menuRef.current
    const btn = btnRef.current
    if (!menu || !btn) return
    const m = 8
    const w = menu.offsetWidth
    const h = menu.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    const br = btn.getBoundingClientRect()
    let left = br.left
    if (left + w > vw - m) left = br.right - w
    left = Math.max(m, Math.min(left, vw - m - w))
    let top = br.bottom + 6
    if (top + h > vh - m) top = br.top - 6 - h
    top = Math.max(m, Math.min(top, vh - m - h))
    setMenuPos({ left, top })
  }, [pop, open])
  useEffect(() => {
    if (!pop || !open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [pop, open])

  const num = (
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
  )
  const slider = (
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
  )

  if (pop) {
    return (
      <div className="field-pop">
        <button
          ref={btnRef}
          type="button"
          className="field-pop-btn"
          aria-expanded={open}
          aria-haspopup="true"
          disabled={disabled}
          title={label}
          onClick={openMenu}
        >
          {icon ? (
            <span className="field-pop-ic" aria-hidden="true">
              {icon}
            </span>
          ) : (
            <span className="field-pop-label">{label}</span>
          )}
          <b>
            {value}
            {unit === '×' ? '×' : ''}
          </b>
        </button>
        {open &&
          menuPos &&
          createPortal(
            <div
              ref={menuRef}
              className="field-pop-menu card"
              style={{ position: 'fixed', left: menuPos.left, top: menuPos.top }}
            >
              <span className="field-head">
                {label}
                <span className="field-num">
                  {num}
                  {unit}
                </span>
              </span>
              {slider}
            </div>,
            document.body,
          )}
      </div>
    )
  }

  return (
    <div className="field">
      <span className="field-head">
        {label}
        <span className="field-num">
          {num}
          {unit}
        </span>
      </span>
      {slider}
    </div>
  )
}

// ปุ่มไอคอนในแถบเครื่องมือ ที่คลิกแล้วกาง popover (portal ไป body กัน overflow ตัด) — จัดกลุ่มเครื่องมือ
function ToolPopover({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const toggle = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos({ left: r.left, top: r.bottom + 6 })
    setOpen((v) => !v)
  }
  // clamp เข้าจอหลังเมนูเรนเดอร์ (ปุ่มอยู่ชิดขวา เมนูกว้างจะล้นขอบ → ดันซ้าย/ชิดขวาปุ่ม)
  useLayoutEffect(() => {
    if (!open) return
    const menu = menuRef.current
    const btn = btnRef.current
    if (!menu || !btn) return
    const m = 8
    const w = menu.offsetWidth
    const h = menu.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    const br = btn.getBoundingClientRect()
    let left = br.left
    if (left + w > vw - m) left = br.right - w // ชิดขวาปุ่มก่อน
    left = Math.max(m, Math.min(left, vw - m - w)) // แล้ว hard-clamp เข้าจอเสมอ (กันปุ่มที่เลื่อนพ้นขอบ)
    let top = br.bottom + 6
    if (top + h > vh - m) top = br.top - 6 - h // เด้งขึ้นบนถ้าล้นล่าง
    top = Math.max(m, Math.min(top, vh - m - h))
    setPos({ left, top })
  }, [open])
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div className="tool-pop">
      <button
        ref={btnRef}
        type="button"
        className="tb-ic"
        aria-haspopup="true"
        aria-expanded={open}
        title={title}
        aria-label={title}
        onClick={toggle}
      >
        {icon}
      </button>
      {open &&
        pos &&
        createPortal(
          <div ref={menuRef} className="tool-pop-menu card" style={{ position: 'fixed', left: pos.left, top: pos.top }}>
            {children}
          </div>,
          document.body,
        )}
    </div>
  )
}

// กลุ่มเครื่องมือแบบพับเก็บได้ (accordion) — หัวคลิกเพื่อเปิด/ปิด, มีป้ายจำนวน (badge) ได้
function Group({
  title,
  open,
  onToggle,
  badge,
  children,
}: {
  title: string
  open: boolean
  onToggle: () => void
  badge?: number
  children: React.ReactNode
}) {
  return (
    <section className={`tgroup${open ? ' open' : ''}`}>
      <button className="tgroup-head" aria-expanded={open} onClick={onToggle}>
        <span className="tgroup-chev" aria-hidden>
          ▸
        </span>
        <span className="tgroup-title">{title}</span>
        {badge ? <span className="tgroup-badge">{badge}</span> : null}
      </button>
      {open && <div className="tgroup-body">{children}</div>}
    </section>
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
  labelStyle: LabelStyle
  pouchStyle: PouchStyle
  zipper: boolean
  pouchAddons: PouchAddons
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
  a.labelStyle === b.labelStyle &&
  a.pouchStyle === b.pouchStyle &&
  a.zipper === b.zipper &&
  a.pouchAddons === b.pouchAddons &&
  a.decos === b.decos

const sameSpec = (a: CurrentSpec, b: CurrentSpec) =>
  a.template === b.template &&
  a.materialId === b.materialId &&
  a.W === b.W &&
  a.D === b.D &&
  a.H === b.H &&
  a.handle === b.handle

// --- บันทึกหลายงาน (project) + ประวัติเวอร์ชันของแต่ละงานลง localStorage ---

// export ให้ตอน "ออกจากระบบ" ล้างงานทิ้งได้ (ยังไม่มีระบบ user — งานผูกกับเบราว์เซอร์)
export const STORAGE_KEY = 'gen-package-projects-v1'
export const LEGACY_KEY = 'gen-package-design-v1'

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
        <rect key={i} x={c.x} y={c.y} width={pw} height={ph} fill="#e3e0fb" stroke="#7b74e8" strokeWidth={0.7} />
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
  const [labelStyle, setLabelStyle] = useState<LabelStyle>(active0.labelStyle ?? 'body')
  const [pouchStyle, setPouchStyle] = useState<PouchStyle>(active0.pouchStyle ?? 'stand')
  const [zipper, setZipper] = useState<boolean>(active0.zipper ?? false)
  const [pouchAddons, setPouchAddons] = useState<PouchAddons>(active0.pouchAddons ?? {})
  // ธีมสว่าง/มืด — เก็บใน localStorage, ตั้ง data-theme บน <html> (canvas/3D คงขาวเสมอ)
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark')
  useEffect(() => {
    if (dark) document.documentElement.dataset.theme = 'dark'
    else delete document.documentElement.dataset.theme
    localStorage.setItem('packit-theme', dark ? 'dark' : 'light')
  }, [dark])
  const [decos, setDecos] = useState<Deco[]>(active0.decos)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [renamingId, setRenamingId] = useState<string | null>(null) // เลเยอร์ที่กำลังแก้ชื่อ (ดับเบิลคลิก)
  const [lockAspect, setLockAspect] = useState(true) // ล็อกสัดส่วนกรอบรูป: ปรับกว้าง/สูงพร้อมกันตามสัดส่วนรูปจริง
  const [presetColor, setPresetColor] = useState('#7b74e8') // สีเริ่มต้นของลายจากไลบรารี
  // กลุ่มเครื่องมือหน้าตกแต่งที่เปิดอยู่ (accordion) — เก็บค่าเริ่มต้นตามการใช้งานบ่อย
  const [groups, setGroups] = useState({
    // หน้าออกแบบ
    mode: true,
    tpl: true,
    mat: true,
    label: true,
    size: true,
    // หน้าตกแต่ง
    bg: false,
    add: true,
    lib: false,
    layers: true,
    props: true,
    // หน้าส่งออก
    exp: true,
    qty: true,
    backup: false,
  })
  const toggleGroup = (k: keyof typeof groups) => setGroups((g) => ({ ...g, [k]: !g[k] }))
  // แถบปรับแต่งชิ้นที่เลือก ย้ายไปอยู่ "ด้านบน blueprint" แบบ Canva ผ่าน portal (host อยู่ใน main)
  const [decoBar, setDecoBar] = useState<HTMLDivElement | null>(null)
  const [decoMore, setDecoMore] = useState(false) // กาง/ยุบเครื่องมือขั้นสูงในแถบบน (สร้างสำเนาตาราง ฯลฯ)

  // tooltip กล่องข้อความตอนชี้ปุ่มในแถบเครื่องมือบน — อ่านจาก title ของปุ่ม (ครอบทุกปุ่มอัตโนมัติ)
  // แล้วแสดงเป็นกล่องสไตล์ Canva (พร้อมถอด title ออกชั่วคราวกัน tooltip เนทีฟซ้อน)
  useEffect(() => {
    let tip: HTMLDivElement | null = null
    let cur: HTMLElement | null = null
    const hide = () => {
      if (cur && cur.dataset.tipHold != null) {
        cur.setAttribute('title', cur.dataset.tipHold)
        delete cur.dataset.tipHold
      }
      cur = null
      tip?.classList.remove('on')
    }
    const show = (el: HTMLElement) => {
      const txt = el.getAttribute('title')
      if (!txt) return
      el.dataset.tipHold = txt
      el.removeAttribute('title')
      if (!tip) {
        tip = document.createElement('div')
        tip.className = 'hover-tip'
        document.body.appendChild(tip)
      }
      tip.textContent = txt
      const r = el.getBoundingClientRect()
      tip.style.left = `${r.left + r.width / 2}px`
      tip.style.top = `${r.bottom + 8}px`
      cur = el
      void tip.offsetHeight // บังคับ reflow ให้ transition ทำงาน (ไม่พึ่ง requestAnimationFrame)
      tip.classList.add('on')
    }
    const over = (e: Event) => {
      const el = (e.target as Element).closest?.('.deco-topbar [title]') as HTMLElement | null
      if (el && el !== cur) {
        hide()
        show(el)
      }
    }
    const out = (e: MouseEvent) => {
      if (cur && !cur.contains(e.relatedTarget as Node)) hide()
    }
    document.addEventListener('mouseover', over)
    document.addEventListener('mouseout', out)
    return () => {
      document.removeEventListener('mouseover', over)
      document.removeEventListener('mouseout', out)
      tip?.remove()
    }
  }, [])
  // เลือกชิ้น → เปิดกลุ่ม "ปรับแต่งที่เลือก" ให้อัตโนมัติ (ไม่ปิดกลุ่มอื่น)
  useEffect(() => {
    if (selectedIds.length) setGroups((g) => (g.props ? g : { ...g, props: true }))
  }, [selectedIds.length])
  const [fold, setFold] = useState(1)
  const [showDims, setShowDims] = useState(store0.showDims)
  const [showGuides, setShowGuides] = useState(false)
  const [nameModal, setNameModal] = useState<{ title: string; value: string; onOk: (n: string) => void } | null>(null)
  const [sideTab, setSideTab] = useState<'design' | 'artwork' | 'export'>('design')
  const asideRef = useRef<HTMLElement>(null)
  // สลับขั้นตอน + เลื่อน sidebar ขึ้นบนสุด (จะได้ไม่ต้องเลื่อนหาแท็บเอง)
  const goStep = (tab: 'design' | 'artwork' | 'export') => {
    setSideTab(tab)
    requestAnimationFrame(() => {
      const el = asideRef.current
      if (!el) return
      el.scrollTop = 0 // เดสก์ท็อป: aside เลื่อนภายในตัวเอง
      el.scrollIntoView({ block: 'start' }) // มือถือ: ดึงหัว sidebar กลับเข้าจอ
    })
  }
  const [palette, setPalette] = useState<string[]>(loadPalette)
  const [sr, setSr] = useState({ cols: 3, rows: 1, dx: 30, dy: 30, brick: false })
  const [expand3d, setExpand3d] = useState(false) // ขยาย 3D viewer เป็น popup ใหญ่
  const [pip3dMin, setPip3dMin] = useState(false) // ซ่อนจอเล็ก 3D เหลือปุ่มกลม
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
  const kind = packKind(mat) // 'box' | 'vessel' | 'pouch' — เลือก path dieline/3D
  // นามบัตรใช้กลไก box (การ์ดแบน) แต่นำเสนอเป็น "ประเภทงาน" แยกใน UI
  const isCard = kind === 'box' && templateId === 'card'
  // วัสดุพับไม่ได้แยกเป็น 2 เส้นทาง: ภาชนะ (revolve + ฉลากพันรอบ) กับ ถุงฟิล์ม (doypack)
  // ทั้งคู่ผลิต Dieline ธรรมดา ระบบเดิม (artwork/export/guides/ใบสเปก/CMYK) จึงใช้ต่อได้เลย
  const vessel = useMemo(
    () => (kind === 'vessel' ? generateVessel({ W, D, H, handle }, mat, labelStyle) : null),
    [W, D, H, handle, mat, labelStyle, kind],
  )
  const pouch = useMemo(
    () =>
      kind === 'pouch'
        ? generatePouch({ W, D, H, handle }, mat, { style: pouchStyle, zipper, addons: pouchAddons })
        : null,
    [W, D, H, handle, mat, kind, pouchStyle, zipper, pouchAddons],
  )
  const dieline = useMemo(
    () =>
      kind === 'box'
        ? template.generate({ W, D, H, handle }, mat)
        : kind === 'vessel'
          ? vessel!.label
          : pouch!.label,
    [W, D, H, handle, mat, template, vessel, pouch, kind],
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
                labelStyle,
                pouchStyle,
                zipper,
                pouchAddons,
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
  }, [history, histIdx, templateId, materialId, W, D, H, handle, qty, fillColor, fillImage, labelStyle, pouchStyle, zipper, pouchAddons, decos, activeId])

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

  // ปิด popup 3D ด้วย Esc
  useEffect(() => {
    if (!expand3d) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpand3d(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expand3d])

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
    labelStyle,
    pouchStyle,
    zipper,
    pouchAddons,
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
  }, [templateId, materialId, W, D, H, handle, qty, fillColor, fillImage, labelStyle, pouchStyle, zipper, pouchAddons, decos])

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
    setLabelStyle(s.labelStyle ?? 'body')
    setPouchStyle(s.pouchStyle ?? 'stand')
    setZipper(s.zipper ?? false)
    setPouchAddons(s.pouchAddons ?? {})
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
        ? { ...p, live: liveSpec(), qty, fillColor, fillImage, labelStyle, pouchStyle, zipper, pouchAddons, decos, history, histIdx, updatedAt: Date.now() }
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
    setLabelStyle(p.labelStyle ?? 'body')
    setPouchStyle(p.pouchStyle ?? 'stand')
    setZipper(p.zipper ?? false)
    setPouchAddons(p.pouchAddons ?? {})
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
    setGroups((g) => (g.props ? g : { ...g, props: true })) // คลิกเลือก = เปิดกลุ่มปรับแต่งให้เห็นเครื่องมือ
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
      templateNameTh:
        kind === 'box'
          ? template.nameTh
          : kind === 'pouch'
            ? `ถุงตั้งได้ (doypack) — ${mat.nameTh}`
            : `ภาชนะ ${mat.nameTh} + ฉลากพันรอบ`,
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
      decos,
      fillColor,
      fillImage,
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

  // วางลายจากไลบรารี — เก็บ preset id + สีไว้บนชิ้น เพื่อเปลี่ยนสีทีหลังได้
  const addPreset = (p: Preset) => {
    if (!dieline) return
    const el = { ...makeImageEl(dieline, presetDataUrl(p.svg(presetColor)), p.aspect), preset: p.id, presetColor }
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

  const addShape = (shape: ShapeKind) => {
    if (!dieline) return
    const el = makeShapeEl(dieline, shape)
    setDecos((ds) => [...ds, el])
    setSelectedIds([el.id])
  }

  const addNutrition = () => {
    if (!dieline) return
    const el = makeNutritionEl(dieline)
    setDecos((ds) => [...ds, el])
    setSelectedIds([el.id])
  }

  // แก้เฉพาะชิ้นที่เลือก (ชิ้นเดียว) ผ่านฟังก์ชันแปลง (คงชนิด image/text ไว้)
  const patchSelected = (fn: (d: Deco) => Deco) => {
    if (!selectedId) return
    setDecos((ds) => ds.map((d) => (d.id === selectedId ? fn(d) : d)))
  }

  // แก้แถวตารางโภชนาการทีละแถว (rows = สารอาหาร, vitamins = วิตามิน/แร่ธาตุ)
  const patchNutriRow = (key: 'rows' | 'vitamins', i: number, patch: Partial<NutriRow>) =>
    patchSelected((d) => (d.type === 'nutrition' ? { ...d, [key]: d[key].map((r, j) => (j === i ? { ...r, ...patch } : r)) } : d))
  const removeNutriRow = (key: 'rows' | 'vitamins', i: number) =>
    patchSelected((d) => (d.type === 'nutrition' ? { ...d, [key]: d[key].filter((_, j) => j !== i) } : d))
  const moveNutriRow = (key: 'rows' | 'vitamins', i: number, dir: -1 | 1) =>
    patchSelected((d) => {
      if (d.type !== 'nutrition') return d
      const j = i + dir
      if (j < 0 || j >= d[key].length) return d
      const arr = [...d[key]]
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
      return { ...d, [key]: arr }
    })
  const addNutriRow = (key: 'rows' | 'vitamins') =>
    patchSelected((d) =>
      d.type === 'nutrition'
        ? { ...d, [key]: [...d[key], key === 'rows' ? { label: 'สารอาหาร', value: '0 ก.' } : { label: 'วิตามิน', value: '', rdi: '0' }] }
        : d,
    )

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
        <PromptBar
          current={{ template: templateId, materialId, W, D, H, handle }}
          hasDesign={history.length > 0}
          onApply={applySpec}
          onLoadingChange={setAiBusy}
        />
        <button
          className="theme-btn"
          title={dark ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดมืด'}
          aria-label="สลับธีมสว่าง/มืด"
          aria-pressed={dark}
          onClick={() => setDark((d) => !d)}
        >
          {dark ? '☀' : '☾'}
        </button>
        {onLogout && (
          <button className="logout-btn" title="ออกจากระบบ" onClick={onLogout}>
            ออกจากระบบ
          </button>
        )}
      </header>
      <div className="body">
        <aside ref={asideRef}>
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
          <Group title="ประเภทงาน" open={groups.mode} onToggle={() => toggleGroup('mode')}>
            <div className="pick-list">
              <button
                className={`pick-item mode${kind === 'box' && !isCard ? ' active' : ''}`}
                disabled={aiBusy}
                aria-pressed={kind === 'box' && !isCard}
                onClick={() => {
                  if (kind !== 'box') changeMaterial('carton-300')
                  else if (isCard) changeTemplate('tuck-end')
                }}
              >
                <span className="mode-ic">
                  <IconBox size={20} />
                </span>
                <span className="pick-body">
                  <span className="pick-name">กล่องพับ</span>
                  <span className="pick-detail">กล่องกระดาษพับขึ้นรูป — เลือกทรง + วัสดุ</span>
                </span>
              </button>
              <button
                className={`pick-item mode${kind === 'vessel' ? ' active' : ''}`}
                disabled={aiBusy}
                aria-pressed={kind === 'vessel'}
                onClick={() => {
                  if (kind !== 'vessel') changeMaterial('pet-bottle')
                }}
              >
                <span className="mode-ic">
                  <IconBottle size={20} />
                </span>
                <span className="pick-body">
                  <span className="pick-name">ภาชนะ + ฉลาก</span>
                  <span className="pick-detail">ผลิตตัวขวด/โหล/กระป๋อง + ฉลากพันรอบ</span>
                </span>
              </button>
              <button
                className={`pick-item mode${kind === 'pouch' ? ' active' : ''}`}
                disabled={aiBusy}
                aria-pressed={kind === 'pouch'}
                onClick={() => {
                  if (kind !== 'pouch') changeMaterial('pouch-foil')
                }}
              >
                <span className="mode-ic">
                  <IconPouch size={20} />
                </span>
                <span className="pick-body">
                  <span className="pick-name">ถุงฟิล์ม (ตั้งได้)</span>
                  <span className="pick-detail">ถุง doypack ก้นตั้ง — พิมพ์ฟิล์มซีลขอบ</span>
                </span>
              </button>
              <button
                className={`pick-item mode${isCard ? ' active' : ''}`}
                disabled={aiBusy}
                aria-pressed={isCard}
                onClick={() => {
                  if (kind !== 'box') changeMaterial('carton-300')
                  changeTemplate('card')
                }}
              >
                <span className="mode-ic">
                  <IconCard size={20} />
                </span>
                <span className="pick-body">
                  <span className="pick-name">นามบัตร</span>
                  <span className="pick-detail">การ์ดแบนพิมพ์ ขนาดมาตรฐาน 90×54 มม.</span>
                </span>
              </button>
            </div>
          </Group>

          {mat.foldable && !isCard && (
            <Group title="รูปแบบบรรจุภัณฑ์" open={groups.tpl} onToggle={() => toggleGroup('tpl')}>
              <div className="pick-list">
                {TEMPLATES.filter((tp) => tp.id !== 'card').map((tp) => (
                  <button
                    key={tp.id}
                    className={`pick-item${templateId === tp.id ? ' active' : ''}`}
                    disabled={aiBusy}
                    aria-pressed={templateId === tp.id}
                    onClick={() => changeTemplate(tp.id)}
                  >
                    <span className="pick-name">{tp.nameTh}</span>
                    <span className="pick-detail">{tp.detail}</span>
                  </button>
                ))}
              </div>
            </Group>
          )}

          {kind === 'pouch' && (
            <Group title="รูปแบบถุง" open={groups.label} onToggle={() => toggleGroup('label')}>
              <div className="pick-list">
                {POUCH_STYLES.map((s) => (
                  <button
                    key={s.id}
                    className={`pick-item${pouchStyle === s.id ? ' active' : ''}`}
                    disabled={aiBusy}
                    aria-pressed={pouchStyle === s.id}
                    onClick={() => setPouchStyle(s.id)}
                  >
                    <span className="pick-name">{s.nameTh}</span>
                    <span className="pick-detail">{s.detail}</span>
                  </button>
                ))}
              </div>
              <p className="hint">
                {pouchStyle === 'flat'
                  ? 'ซองแบน 3 ด้าน — ไม่มีก้น ไม่ใช้ค่า D'
                  : pouchStyle === 'pillow'
                    ? 'ซองหลังกลาง — พองนุ่ม ซีลหลังกลาง ไม่ใช้ค่า D'
                    : pouchStyle === 'gusset'
                      ? 'ซองข้างจีบ — ค่า “จีบข้าง” = ความลึกทรงแท่ง (ถุงกาแฟ)'
                      : pouchStyle === 'box'
                        ? 'ถุงก้นแบนตั้งเหลี่ยม — ค่า “จีบข้าง” = ความลึกทรงกล่อง (ตั้งได้)'
                        : pouchStyle === 'spout'
                          ? 'ถุงมีจุก — ก้นตั้งได้ + จุก/ฝาที่ปากบน ค่า “ลึกก้น” = ความจุ'
                          : 'ถุงตั้งได้ — ค่า “ลึกก้น” ยิ่งมากยิ่งตั้งมั่น/จุมาก'}
              </p>
            </Group>
          )}

          <Group
            title={isCard ? 'กระดาษนามบัตร' : kind === 'box' ? 'วัสดุกล่อง' : kind === 'pouch' ? 'ชนิดถุง' : 'ชนิดภาชนะ'}
            open={groups.mat}
            onToggle={() => toggleGroup('mat')}
          >
            <div className="pick-list">
              {MATERIALS.filter(
                (m) =>
                  packKind(m) === kind &&
                  // นามบัตรใช้กระดาษการ์ดเท่านั้น (ไม่ใช่ลูกฟูก/พลาสติกใส)
                  (!isCard || m.id === 'carton-300' || m.id === 'carton-400' || m.id === 'kraft-350'),
              ).map((m) => (
                <button
                  key={m.id}
                  className={`pick-item mat${materialId === m.id ? ' active' : ''}`}
                  disabled={aiBusy}
                  aria-pressed={materialId === m.id}
                  onClick={() => changeMaterial(m.id)}
                >
                  <span className="mat-sw" style={{ background: m.color }} />
                  <span className="pick-body">
                    <span className="pick-name">{m.nameTh}</span>
                    <span className="pick-detail">
                      {m.foldable ? `หนา ${m.thickness} มม. · พับได้` : m.process}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <div className="mat-info">
              <div>{mat.detail}</div>
              {mat.foldable ? (
                <div className="ok">พับได้ — dieline เผื่อระยะตามความหนาให้อัตโนมัติ</div>
              ) : (
                <div className="warn">{mat.note}</div>
              )}
            </div>
          </Group>

          {kind === 'vessel' && (
            <Group title="รูปแบบฉลาก" open={groups.label} onToggle={() => toggleGroup('label')}>
              <div className="pick-list">
                {LABEL_STYLES.map((s) => (
                  <button
                    key={s.id}
                    className={`pick-item${labelStyle === s.id ? ' active' : ''}`}
                    disabled={aiBusy}
                    aria-pressed={labelStyle === s.id}
                    onClick={() => setLabelStyle(s.id)}
                  >
                    <span className="pick-name">{s.nameTh}</span>
                    <span className="pick-detail">{s.detail}</span>
                  </button>
                ))}
              </div>
              <p className="hint">
                ฉลากพันรอบตัว — เลือกว่าคลุมช่วงความสูงแค่ไหน ความสูงฉลากในไฟล์ปรับตามนี้
              </p>
            </Group>
          )}

          <Group
            title={
              kind === 'box'
                ? templateId === 'card'
                  ? 'ขนาดนามบัตร'
                  : 'ขนาดกล่อง (ด้านใน)'
                : kind === 'pouch'
                  ? 'ขนาดถุง'
                  : 'ขนาดภาชนะ'
            }
            open={groups.size}
            onToggle={() => toggleGroup('size')}
          >
            <DimField
              label={
                kind === 'box'
                  ? 'กว้าง W'
                  : kind === 'pouch'
                    ? pouchStyle === 'flat'
                      ? 'กว้างซอง W'
                      : pouchStyle === 'gusset' || pouchStyle === 'box'
                        ? 'กว้างหน้า W'
                        : pouchStyle === 'pillow'
                          ? 'กว้าง W'
                          : 'กว้างถุง W'
                    : '⌀ ตัว W'
              }
              value={W}
              min={30}
              max={250}
              disabled={aiBusy}
              onChange={setW}
            />
            {/* ซองแบน/หลังกลางไม่มีก้น-จีบ, นามบัตรเป็นการ์ดแบน → ซ่อนช่อง D */}
            {!(kind === 'pouch' && (pouchStyle === 'flat' || pouchStyle === 'pillow')) &&
              !(kind === 'box' && templateId === 'card') && (
              <DimField
                label={
                  kind === 'box'
                    ? 'ลึก D'
                    : kind === 'pouch'
                      ? pouchStyle === 'gusset' || pouchStyle === 'box'
                        ? 'จีบข้าง D'
                        : 'ลึกก้น D'
                      : '⌀ ปาก/คอ D'
                }
                value={D}
                min={20}
                max={150}
                disabled={aiBusy}
                onChange={setD}
              />
            )}
            <DimField
              label={kind === 'pouch' ? 'สูงลำตัว H' : 'สูง H'}
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
            {kind === 'pouch' && (
              <>
                <label className="check" style={{ marginTop: 12 }}>
                  <input
                    type="checkbox"
                    checked={zipper}
                    disabled={aiBusy}
                    onChange={(e) => setZipper(e.target.checked)}
                  />
                  ซิปล็อก + รอยฉีก (เปิด-ปิดซ้ำได้)
                </label>
                <label className="check" style={{ marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={pouchAddons.hangHole ?? false}
                    disabled={aiBusy}
                    onChange={(e) => setPouchAddons((a) => ({ ...a, hangHole: e.target.checked }))}
                  />
                  รูแขวน (euro-hole)
                </label>
                <label className="check" style={{ marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={pouchAddons.valve ?? false}
                    disabled={aiBusy}
                    onChange={(e) => setPouchAddons((a) => ({ ...a, valve: e.target.checked }))}
                  />
                  วาล์วกาแฟ (degassing valve)
                </label>
                <label className="check" style={{ marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={pouchAddons.tinTie ?? false}
                    disabled={aiBusy}
                    onChange={(e) => setPouchAddons((a) => ({ ...a, tinTie: e.target.checked }))}
                  />
                  ที่รัดปาก (tin-tie)
                </label>
                <p className="hint">
                  แนะนำการจับคู่: วาล์ว/ที่รัดปาก → ถุงกาแฟ (ข้างจีบ · ก้นแบน) · ซิปล็อก → ถุงตั้ง/ก้นแบน ·
                  รูแขวน → ได้ทุกแบบ (ผู้ใช้เลือกเองได้ตามต้องการ)
                </p>
              </>
            )}
          </Group>

          <div className="step-nav">
            <span className="step-saved">✓ บันทึกงานอัตโนมัติ</span>
            <div className="step-btns">
              <button className="step-next" onClick={() => goStep('artwork')}>
                ไปต่อ: ตกแต่ง →
              </button>
            </div>
          </div>
          </>
          )}

          {sideTab === 'artwork' && (
          <>
              <Group title="พื้นหลังแพ็กเกจ" open={groups.bg} onToggle={() => toggleGroup('bg')}>
                <div className="fill-color-row">
                  <ColorField
                    value={fillColor ?? '#7b74e8'}
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
                    <label className="crop-slider">
                      <span>หมุน</span>
                      <input
                        type="range"
                        min={-180}
                        max={180}
                        step={1}
                        disabled={aiBusy}
                        value={Math.round(fillImage.rot ?? 0)}
                        onChange={(e) => patchFillImage({ rot: Number(e.target.value) })}
                      />
                      <span className="crop-val">{Math.round(fillImage.rot ?? 0)}°</span>
                    </label>
                    <label className="crop-slider">
                      <span>ความทึบ</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        disabled={aiBusy}
                        value={Math.round((fillImage.opacity ?? 1) * 100)}
                        onChange={(e) => patchFillImage({ opacity: Number(e.target.value) / 100 })}
                      />
                      <span className="crop-val">{Math.round((fillImage.opacity ?? 1) * 100)}%</span>
                    </label>
                    <button
                      className="crop-reset"
                      disabled={aiBusy}
                      onClick={() => patchFillImage({ zoom: 1, ox: 0, oy: 0, rot: 0 })}
                    >
                      รีเซ็ตการครอป
                    </button>
                  </div>
                )}

                <p className="hint">
                  {fillImage
                    ? 'รูปพื้นคลุมทั้งแพ็กเกจแล้วครอปตามรูปทรง blueprint — เข้าไฟล์ .svg/.pdf จริง (ไม่ใส่ .dxf); ปรับซูม/เลื่อนให้รูปเข้ากรอบพอดี'
                    : kind === 'box'
                      ? 'ถมสีทั้งแผ่น (flood) เข้าไฟล์ .svg/.pdf จริง — ไม่ใส่ใน .dxf; “ไม่มีสี” = โชว์สีวัสดุ · หรือใส่รูปเป็นพื้นก็ได้'
                      : kind === 'pouch'
                        ? 'ถมสีพื้นถุงทั้งแผ่น เข้าไฟล์ .svg/.pdf จริง; “ไม่มีสี” = ฟิล์มพื้นขาว · หรือใส่รูปเป็นพื้นก็ได้'
                        : 'ถมสีพื้นฉลากทั้งแผ่น เข้าไฟล์ .svg/.pdf จริง; “ไม่มีสี” = ฉลากพื้นขาว · หรือใส่รูปเป็นพื้นก็ได้'}
                </p>
              </Group>

              <Group title="เพิ่มองค์ประกอบ" open={groups.add} onToggle={() => toggleGroup('add')}>
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
                  <button className="ico-btn" disabled={aiBusy} title="สามเหลี่ยม" onClick={() => addShape('triangle')}>
                    <IconTriangle /> สามเหลี่ยม
                  </button>
                  <button className="ico-btn" disabled={aiBusy} title="หลายเหลี่ยม" onClick={() => addShape('polygon')}>
                    <IconPolygon /> หลายเหลี่ยม
                  </button>
                  <button className="ico-btn" disabled={aiBusy} title="ดาว" onClick={() => addShape('star')}>
                    <IconStar /> ดาว
                  </button>
                </div>
                <div className="art-actions" style={{ marginTop: 8 }}>
                  <button className="ico-btn" disabled={aiBusy} title="ตารางข้อมูลโภชนาการ (อย.)" onClick={addNutrition}>
                    <IconNutrition /> ตารางโภชนาการ (อย.)
                  </button>
                </div>
              </Group>

              <Group title="ไลบรารีลาย" open={groups.lib} onToggle={() => toggleGroup('lib')}>
                <div className="preset-lib">
                  <div className="preset-head">
                    <span className="preset-title">สีลาย</span>
                    <ColorField
                      value={presetColor}
                      onChange={setPresetColor}
                      palette={palette}
                      onSave={saveSwatch}
                      disabled={aiBusy}
                      label="สีลาย"
                    />
                  </div>
                  {PRESET_CATS.map((cat) => (
                    <div key={cat.id} className="preset-cat">
                      <span className="preset-cat-name">{cat.nameTh}</span>
                      <div className="preset-grid">
                        {PRESETS.filter((p) => p.cat === cat.id).map((p) => (
                          <button
                            key={p.id}
                            className="preset-item"
                            title={p.nameTh}
                            aria-label={`เพิ่ม ${p.nameTh}`}
                            disabled={aiBusy}
                            onClick={() => addPreset(p)}
                          >
                            <img src={presetDataUrl(p.svg(presetColor))} alt={p.nameTh} />
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Group>

              <Group title="เลเยอร์" open={groups.layers} onToggle={() => toggleGroup('layers')} badge={decos.length}>
                {decos.length === 0 && <p className="hint">ยังไม่มีองค์ประกอบ — เพิ่มได้จากกลุ่มด้านบน</p>}
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
                        ) : d.type === 'nutrition' ? (
                          <span className="deco-tico" style={{ color: '#111' }}>
                            ▤
                          </span>
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
                        <button
                          className="deco-toggle deco-del"
                          title="ลบชิ้นนี้"
                          aria-label="ลบชิ้นนี้"
                          onClick={() => removeDeco(d.id)}
                        >
                          <IconTrash size={15} />
                        </button>
                      </li>
                      )
                    })}
                  </ul>
                )}
                {selected && (
                  <div className="layer-quick">
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
                  </div>
                )}
              </Group>

              {!selected && !multi && (
                <Group title="ปรับแต่งที่เลือก" open={groups.props} onToggle={() => toggleGroup('props')}>
                  <p className="hint">เลือกชิ้นบนเลเยอร์หรือ blueprint เพื่อปรับแต่ง (แถบปรับแต่งจะโผล่ด้านบน)</p>
                </Group>
              )}
              {(selected || multi) &&
                decoBar &&
                createPortal(
                  <TopBarCtx.Provider value={true}>
                  <div className={`deco-topbar card${decoMore ? ' more' : ''}`}>
                    <button
                      type="button"
                      className="deco-more-btn"
                      aria-pressed={decoMore}
                      title="เครื่องมือเพิ่มเติม (สร้างสำเนาเป็นตาราง ฯลฯ)"
                      aria-label="เครื่องมือเพิ่มเติม"
                      onClick={() => setDecoMore((v) => !v)}
                    >
                      ⋯
                    </button>
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
                        <button className="tb-ic" title="กระจายแนวนอนเท่า ๆ กัน" aria-label="กระจายแนวนอน" onClick={() => distributeSelected('h')}>↔</button>
                        <button className="tb-ic" title="กระจายแนวตั้งเท่า ๆ กัน" aria-label="กระจายแนวตั้ง" onClick={() => distributeSelected('v')}>↕</button>
                      </div>
                    )}
                    <span className="tb-sep" />
                    <div className="art-actions" style={{ marginTop: 8 }}>
                      <button className="tb-ic" title="จัดกลุ่ม (Ctrl+G)" aria-label="จัดกลุ่ม" onClick={groupSelected}>⊞</button>
                      <button className="tb-ic" title="แยกกลุ่ม" aria-label="แยกกลุ่ม" onClick={ungroupSelected}>⊟</button>
                    </div>
                    <span className="tb-sep" />
                    <div className="art-actions">
                      <button className="tb-ic" title="ทำสำเนา" aria-label="ทำสำเนา" onClick={duplicateSelected}>⧉</button>
                      <button className="tb-ic" title="ซ่อน/แสดง" aria-label="ซ่อน/แสดง" onClick={toggleHiddenSelected}>👁</button>
                      <button className="tb-ic" title="ล็อก/ปลดล็อก" aria-label="ล็อก/ปลดล็อก" onClick={toggleLockedSelected}>🔒</button>
                      <button className="tb-ic" title="ลบที่เลือก" aria-label="ลบที่เลือก" onClick={removeSelected}>🗑</button>
                    </div>
                    <p className="hint">Shift/Ctrl คลิกเพื่อเพิ่ม-ลดชิ้น · ลากชิ้นใดชิ้นหนึ่งเพื่อย้ายทั้งชุด · Ctrl+G จัดกลุ่ม</p>
                  </div>
                )}

                {selected && (
                  <div className="deco-edit">
                    {selected.type === 'text' && (
                      <>
                        {/* แก้ข้อความด้วยการคลิกที่ข้อความบน blueprint แล้วพิมพ์ได้เลย (เลิกใช้กล่องในแถบ) */}
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
                              value={selected.fill === 'none' ? '#7b74e8' : selected.fill}
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
                                        ? { from: d.fill !== 'none' ? d.fill : '#7b74e8', to: '#ffffff', angle: 90 }
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
                          icon={<IconStroke />}
                          value={selected.strokeW}
                          min={0}
                          max={20}
                          disabled={aiBusy}
                          onChange={(v) => patchSelected((d) => (d.type === 'shape' ? { ...d, strokeW: v, stroke: v > 0 && d.stroke === 'none' ? '#222222' : d.stroke } : d))}
                        />
                        {selected.strokeW > 0 && (
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={!!selected.dash}
                              disabled={aiBusy}
                              onChange={(e) => patchSelected((d) => (d.type === 'shape' ? { ...d, dash: e.target.checked || undefined } : d))}
                            />
                            เส้นขอบประ (dashed)
                          </label>
                        )}
                        {(selected.shape === 'polygon' || selected.shape === 'star') && (
                          <DimField
                            label={selected.shape === 'star' ? 'จำนวนแฉก' : 'จำนวนด้าน'}
                            value={selected.sides ?? (selected.shape === 'star' ? 5 : 6)}
                            min={3}
                            max={12}
                            disabled={aiBusy}
                            onChange={(v) => patchSelected((d) => (d.type === 'shape' ? { ...d, sides: Math.round(v) } : d))}
                          />
                        )}
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
                      <>
                        <DimField
                          label="ขนาดตัวอักษร"
                          icon={<IconFontSize />}
                          value={selected.size}
                          min={3}
                          max={120}
                          disabled={aiBusy}
                          onChange={(v) => patchSelected((d) => (d.type === 'text' ? withTextW({ ...d, size: v }) : d))}
                        />
                        <ToolPopover icon={<IconEffects />} title="เอฟเฟกต์/ระยะข้อความ (ระยะบรรทัด/เส้นขอบ/เงา/โค้ง)">
                          {/* ในป็อปโอเวอร์มีที่ → ปิดโหมด pop ให้ DimField เป็นสไลเดอร์เต็ม */}
                          <TopBarCtx.Provider value={false}>
                            <div className="pop-title">ระยะบรรทัด</div>
                            <DimField
                              label="ระยะบรรทัด"
                              value={Math.round((selected.lh ?? 1.25) * 100) / 100}
                              min={0.8}
                              max={3}
                              step={0.05}
                              unit="×"
                              disabled={aiBusy}
                              onChange={(v) => patchSelected((d) => (d.type === 'text' ? { ...d, lh: v === 1.25 ? undefined : v } : d))}
                            />
                            <div className="pop-title">เส้นขอบตัวอักษร</div>
                            <div className="deco-color">
                              <span>สี</span>
                              <ColorField
                                value={selected.strokeColor ?? '#ffffff'}
                                onChange={(hex) => patchSelected((d) => (d.type === 'text' ? { ...d, strokeColor: hex, strokeW: d.strokeW && d.strokeW > 0 ? d.strokeW : 0.8 } : d))}
                                palette={palette}
                                onSave={saveSwatch}
                                disabled={aiBusy}
                                label="สีเส้นขอบตัวอักษร"
                              />
                            </div>
                            <DimField
                              label="ความหนา (0=ไม่มี)"
                              value={selected.strokeW ?? 0}
                              min={0}
                              max={5}
                              disabled={aiBusy}
                              onChange={(v) => patchSelected((d) => (d.type === 'text' ? { ...d, strokeW: v || undefined, strokeColor: v > 0 ? d.strokeColor ?? '#ffffff' : d.strokeColor } : d))}
                            />
                            <div className="pop-title">เงา</div>
                            <label className="check">
                              <input
                                type="checkbox"
                                checked={!!selected.shadow}
                                disabled={aiBusy}
                                onChange={(e) => patchSelected((d) => (d.type === 'text' ? { ...d, shadow: e.target.checked || undefined } : d))}
                              />
                              เงาใต้ตัวอักษร
                            </label>
                            <div className="pop-title">ดัดโค้ง</div>
                            <DimField
                              label="โค้ง (0=ตรง, +ขึ้น −ลง)"
                              value={selected.curve ?? 0}
                              min={-300}
                              max={300}
                              unit="°"
                              disabled={aiBusy}
                              onChange={(v) => patchSelected((d) => (d.type === 'text' ? { ...d, curve: Math.abs(v) >= 1 ? v : undefined } : d))}
                            />
                          </TopBarCtx.Provider>
                        </ToolPopover>
                      </>
                    )}
                    {selected.type === 'nutrition' && (
                      <>
                        <DimField
                          label="กว้างตาราง"
                          value={Math.round(selected.w * 10) / 10}
                          min={30}
                          max={Math.round(dieline.width)}
                          disabled={aiBusy}
                          onChange={(v) => patchSelected((d) => (d.type === 'nutrition' ? { ...d, w: v } : d))}
                        />
                        <DimField
                          label="ขนาดตัวอักษร"
                          icon={<IconFontSize />}
                          value={selected.scale ?? 1}
                          min={0.6}
                          max={2}
                          step={0.05}
                          unit="×"
                          disabled={aiBusy}
                          onChange={(v) => patchSelected((d) => (d.type === 'nutrition' ? { ...d, scale: v !== 1 ? v : undefined } : d))}
                        />
                        <div className="deco-color">
                          <span>สีตัวอักษร</span>
                          <ColorField
                            value={selected.ink ?? '#111111'}
                            onChange={(hex) => patchSelected((d) => (d.type === 'nutrition' ? { ...d, ink: hex } : d))}
                            palette={palette}
                            onSave={saveSwatch}
                            disabled={aiBusy}
                            label="สีตัวอักษรตาราง"
                          />
                        </div>
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={selected.paper !== false}
                            disabled={aiBusy}
                            onChange={(e) => patchSelected((d) => (d.type === 'nutrition' ? { ...d, paper: e.target.checked ? undefined : false } : d))}
                          />
                          พื้นขาว
                        </label>
                        <label className="fld">
                          <span>หนึ่งหน่วยบริโภค</span>
                          <input
                            className="txt-in"
                            value={selected.serving}
                            disabled={aiBusy}
                            onChange={(e) => patchSelected((d) => (d.type === 'nutrition' ? { ...d, serving: e.target.value } : d))}
                          />
                        </label>
                        <label className="fld">
                          <span>จำนวนหน่วยบริโภคต่อภาชนะ</span>
                          <input
                            className="txt-in"
                            value={selected.servings}
                            disabled={aiBusy}
                            onChange={(e) => patchSelected((d) => (d.type === 'nutrition' ? { ...d, servings: e.target.value } : d))}
                          />
                        </label>
                        <div className="art-actions">
                          <label className="fld" style={{ flex: 1 }}>
                            <span>พลังงาน (kcal)</span>
                            <input
                              className="txt-in"
                              value={selected.energy}
                              disabled={aiBusy}
                              onChange={(e) => patchSelected((d) => (d.type === 'nutrition' ? { ...d, energy: e.target.value } : d))}
                            />
                          </label>
                          <label className="fld" style={{ flex: 1 }}>
                            <span>จากไขมัน</span>
                            <input
                              className="txt-in"
                              value={selected.energyFat ?? ''}
                              disabled={aiBusy}
                              onChange={(e) => patchSelected((d) => (d.type === 'nutrition' ? { ...d, energyFat: e.target.value || undefined } : d))}
                            />
                          </label>
                        </div>
                        <div className="nutri-head">
                          <span>สารอาหาร</span>
                          <span className="nutri-cols">ปริมาณ · %</span>
                        </div>
                        {selected.rows.map((r, i) => (
                          <div className="nrow" key={`r${i}`}>
                            <button
                              className={`nmini${r.indent ? ' on' : ''}`}
                              title="ย่อหน้า (สารอาหารย่อย)"
                              disabled={aiBusy}
                              onClick={() => patchNutriRow('rows', i, { indent: !r.indent || undefined })}
                            >
                              ↳
                            </button>
                            <input
                              className="txt-in lbl"
                              value={r.label}
                              placeholder="ชื่อสารอาหาร"
                              disabled={aiBusy}
                              onChange={(e) => patchNutriRow('rows', i, { label: e.target.value })}
                            />
                            <input
                              className="txt-in val"
                              value={r.value}
                              placeholder="3 ก."
                              disabled={aiBusy}
                              onChange={(e) => patchNutriRow('rows', i, { value: e.target.value })}
                            />
                            <input
                              className="txt-in rdi"
                              value={r.rdi ?? ''}
                              placeholder="%"
                              disabled={aiBusy}
                              onChange={(e) => patchNutriRow('rows', i, { rdi: e.target.value || undefined })}
                            />
                            <button className={`nmini${r.bold ? ' on' : ''}`} title="ตัวหนา" disabled={aiBusy} onClick={() => patchNutriRow('rows', i, { bold: !r.bold || undefined })}>
                              <b>B</b>
                            </button>
                            <button className="nmini" title="เลื่อนขึ้น" disabled={aiBusy || i === 0} onClick={() => moveNutriRow('rows', i, -1)}>
                              ▲
                            </button>
                            <button className="nmini" title="เลื่อนลง" disabled={aiBusy || i === selected.rows.length - 1} onClick={() => moveNutriRow('rows', i, 1)}>
                              ▼
                            </button>
                            <button className="nmini del" title="ลบแถว" disabled={aiBusy} onClick={() => removeNutriRow('rows', i)}>
                              ✕
                            </button>
                          </div>
                        ))}
                        <button className="add-row" disabled={aiBusy} onClick={() => addNutriRow('rows')}>
                          ＋ เพิ่มแถวสารอาหาร
                        </button>

                        <div className="nutri-head">
                          <span>วิตามิน / แร่ธาตุ</span>
                          <span className="nutri-cols">%</span>
                        </div>
                        {selected.vitamins.map((v, i) => (
                          <div className="nrow" key={`v${i}`}>
                            <input
                              className="txt-in lbl"
                              value={v.label}
                              placeholder="ชื่อวิตามิน"
                              disabled={aiBusy}
                              onChange={(e) => patchNutriRow('vitamins', i, { label: e.target.value })}
                            />
                            <input
                              className="txt-in rdi"
                              value={v.rdi ?? ''}
                              placeholder="%"
                              disabled={aiBusy}
                              onChange={(e) => patchNutriRow('vitamins', i, { rdi: e.target.value || undefined })}
                            />
                            <button className="nmini" title="เลื่อนขึ้น" disabled={aiBusy || i === 0} onClick={() => moveNutriRow('vitamins', i, -1)}>
                              ▲
                            </button>
                            <button className="nmini" title="เลื่อนลง" disabled={aiBusy || i === selected.vitamins.length - 1} onClick={() => moveNutriRow('vitamins', i, 1)}>
                              ▼
                            </button>
                            <button className="nmini del" title="ลบแถว" disabled={aiBusy} onClick={() => removeNutriRow('vitamins', i)}>
                              ✕
                            </button>
                          </div>
                        ))}
                        <button className="add-row" disabled={aiBusy} onClick={() => addNutriRow('vitamins')}>
                          ＋ เพิ่มวิตามิน/แร่ธาตุ
                        </button>

                        <label className="fld" style={{ marginTop: 8 }}>
                          <span>หมายเหตุท้ายตาราง</span>
                          <textarea
                            className="txt-in"
                            rows={2}
                            key={`fn-${selected.id}`}
                            defaultValue={selected.footnote}
                            disabled={aiBusy}
                            onBlur={(e) => patchSelected((d) => (d.type === 'nutrition' ? { ...d, footnote: e.target.value } : d))}
                          />
                        </label>
                      </>
                    )}
                    {selected.type === 'image' && selected.preset && (
                      <div className="deco-color">
                        <span>สีลาย</span>
                        <ColorField
                          value={selected.presetColor ?? '#7b74e8'}
                          onChange={(hex) =>
                            patchSelected((d) => {
                              if (d.type !== 'image' || !d.preset) return d
                              const p = presetById(d.preset)
                              return p ? { ...d, presetColor: hex, src: presetDataUrl(p.svg(hex)) } : { ...d, presetColor: hex }
                            })
                          }
                          palette={palette}
                          onSave={saveSwatch}
                          disabled={aiBusy}
                          label="สีลาย"
                        />
                      </div>
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
                          disabled={aiBusy || !!selected.circle || !!selected.maskShape}
                          onChange={(v) => patchSelected((d) => (d.type === 'image' ? { ...d, radius: v || undefined, maskShape: undefined } : d))}
                        />
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={!!selected.circle}
                            disabled={aiBusy}
                            onChange={(e) => patchSelected((d) => (d.type === 'image' ? { ...d, circle: e.target.checked || undefined, maskShape: undefined, maskSides: undefined } : d))}
                          />
                          มาสก์วงรี
                        </label>
                        <div className="art-actions" style={{ marginTop: 6 }}>
                          <span className="hint" style={{ alignSelf: 'center' }}>มาสก์ทรง:</span>
                          {(['triangle', 'polygon', 'star'] as const).map((sh) => (
                            <button
                              key={sh}
                              className="ico-btn"
                              disabled={aiBusy}
                              aria-pressed={selected.maskShape === sh}
                              style={selected.maskShape === sh ? { borderColor: '#7b74e8', color: '#7b74e8' } : undefined}
                              onClick={() =>
                                patchSelected((d) =>
                                  d.type === 'image'
                                    ? { ...d, maskShape: d.maskShape === sh ? undefined : sh, circle: undefined, radius: undefined }
                                    : d,
                                )
                              }
                            >
                              {sh === 'triangle' ? <IconTriangle /> : sh === 'polygon' ? <IconPolygon /> : <IconStar />}
                              {sh === 'triangle' ? 'สามเหลี่ยม' : sh === 'polygon' ? 'หลายเหลี่ยม' : 'ดาว'}
                            </button>
                          ))}
                        </div>
                        {(selected.maskShape === 'polygon' || selected.maskShape === 'star') && (
                          <DimField
                            label={selected.maskShape === 'star' ? 'จำนวนแฉก' : 'จำนวนด้าน'}
                            value={selected.maskSides ?? (selected.maskShape === 'star' ? 5 : 6)}
                            min={3}
                            max={12}
                            disabled={aiBusy}
                            onChange={(v) => patchSelected((d) => (d.type === 'image' ? { ...d, maskSides: Math.round(v) } : d))}
                          />
                        )}
                      </>
                    )}
                    <DimField
                      label="หมุน (องศา)"
                      icon={
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M20 11a8 8 0 1 0-2.3 5.7" />
                          <path d="M20 4v5h-5" />
                        </svg>
                      }
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
                    <span className="tb-sep" />
                    <ToolPopover icon={<IconPosition />} title="จัดตำแหน่ง / พลิก">
                      <div className="pop-title">จัดแนวในแผงหน้า</div>
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
                      <div className="pop-title">พลิก / จัดกลาง</div>
                      <div className="pop-row">
                        <button
                          className="tb-ic"
                          aria-pressed={!!selected.flipX}
                          title="พลิกแนวนอน"
                          aria-label="พลิกแนวนอน"
                          onClick={() => patchSelected((d) => ({ ...d, flipX: !d.flipX }))}
                        >
                          ⇋
                        </button>
                        <button
                          className="tb-ic"
                          aria-pressed={!!selected.flipY}
                          title="พลิกแนวตั้ง"
                          aria-label="พลิกแนวตั้ง"
                          onClick={() => patchSelected((d) => ({ ...d, flipY: !d.flipY }))}
                        >
                          ⥯
                        </button>
                        <button className="tb-ic" title="วางกลางแผงหน้า" aria-label="วางกลางแผงหน้า" onClick={recenterSelected}>
                          ⊕
                        </button>
                      </div>
                    </ToolPopover>
                    <button className="tb-ic" title="ลบชิ้นนี้" aria-label="ลบชิ้นนี้" onClick={removeSelected}>
                      🗑
                    </button>
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
                  </div>
                  </TopBarCtx.Provider>,
                  decoBar,
                )}

              <p className="hint">
                ลายจะถูกใส่ลงไฟล์ .svg (vector) และ .pdf (300 dpi) แล้ว — ไม่ใส่ใน .dxf เพราะเป็นไฟล์มีดตัด
              </p>

              <div className="step-nav">
                <span className="step-saved">✓ บันทึกงานอัตโนมัติ</span>
                <div className="step-btns">
                  <button className="step-back" onClick={() => goStep('design')}>
                    ← ออกแบบ
                  </button>
                  <button className="step-next" onClick={() => goStep('export')}>
                    ไปต่อ: ส่งออก →
                  </button>
                </div>
              </div>
          </>
          )}

          {sideTab === 'export' && (
          <>
              <Group title="ดาวน์โหลดไฟล์" open={groups.exp} onToggle={() => toggleGroup('exp')}>
                <div className="export-opts">
                  <span className="grp-sub">ใส่ในแบบ</span>
                  <label className="check">
                    <input type="checkbox" checked={showDims} onChange={(e) => setShowDims(e.target.checked)} />
                    เส้นบอกขนาด (มม.)
                  </label>
                  <label className="check">
                    <input type="checkbox" checked={showGuides} onChange={(e) => setShowGuides(e.target.checked)} />
                    เส้นเผื่อตัด / ปลอดภัย
                  </label>
                </div>
                <div className="export-list">
                  <button className="export-item primary" onClick={() => void downloadSpecSheet()}>
                    <span className="export-badge">PDF</span>
                    <span className="export-body">
                      <span className="export-name">ใบสเปกขอราคา</span>
                      <span className="export-desc">สรุปขนาด/วัสดุ/จำนวน/ข้อสันนิษฐาน + แบบย่อ — ส่งโรงงานขอราคาได้เลย</span>
                    </span>
                  </button>
                  <button className="export-item" onClick={downloadDXF}>
                    <span className="export-badge">DXF</span>
                    <span className="export-body">
                      <span className="export-name">ไฟล์ผลิต · ส่งโรงไดคัท</span>
                      <span className="export-desc">เลเยอร์ CUT/CREASE แยก · หน่วย มม. · ไม่มีเส้นบอกขนาด</span>
                    </span>
                  </button>
                  <button className="export-item" onClick={() => void downloadPDF()}>
                    <span className="export-badge">PDF</span>
                    <span className="export-body">
                      <span className="export-name">แบบพิมพ์ 1:1</span>
                      <span className="export-desc">ลายพิมพ์ฝัง 300 dpi · เลเยอร์ artwork/cut/crease/dims ปิด-เปิดได้ใน Acrobat</span>
                    </span>
                  </button>
                  <button className="export-item" onClick={downloadSVG}>
                    <span className="export-badge">SVG</span>
                    <span className="export-body">
                      <span className="export-name">dieline เวกเตอร์</span>
                      <span className="export-desc">เปิด/แก้ต่อใน Illustrator, CorelDRAW, Inkscape</span>
                    </span>
                  </button>
                </div>
                <p className="hint">
                  ขนาดแผ่น {Math.ceil(dieline.width)} × {Math.ceil(dieline.height)} มม. · สเกลจริง 1:1 ·
                  ตัวเลขบนแบบรวมเผื่อความหนา {mat.thickness} มม.แล้ว จึงใหญ่กว่าขนาดด้านในเล็กน้อย
                </p>
              </Group>

              <Group title="จำนวน & จำนวนต่อแผ่น" open={groups.qty} onToggle={() => toggleGroup('qty')}>
                <div className="field">
                  <span className="field-head">
                    จำนวนที่จะสั่ง
                    <span className="field-num">
                      <QtyField value={qty} disabled={aiBusy} onChange={setQty} />
                      ใบ
                    </span>
                  </span>
                </div>
                <p className="hint">ใช้ตอนขอราคาจากโรงงาน — ไม่มีผลกับรูปกล่องหรือไฟล์ไดคัท</p>
                <div className="grp-sub">จำนวนต่อแผ่น (imposition)</div>
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
              </Group>

              <Group title="สำรอง / ย้ายงาน" open={groups.backup} onToggle={() => toggleGroup('backup')}>
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
              </Group>

              <div className="step-nav">
                <span className="step-saved">✓ บันทึกงานอัตโนมัติ · ครบทุกขั้นตอนแล้ว</span>
                <div className="step-btns">
                  <button className="step-back" onClick={() => goStep('artwork')}>
                    ← ตกแต่ง
                  </button>
                </div>
              </div>
            </>
          )}
        </aside>

        <main>
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
            {/* host แถบเครื่องมือ (Canva) — ลอยทับบน dieline (portal มาลงที่นี่เมื่อเลือกชิ้น) */}
            <div className="deco-topbar-host" ref={setDecoBar} />
            <div className="blueprint card">
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
                onText={(id, text) =>
                  setDecos((ds) =>
                    ds.map((d) => (d.id === id && d.type === 'text' ? withTextW({ ...d, text }) : d)),
                  )
                }
                onUndo={undo}
                onRedo={redo}
                canUndo={!aiBusy && undoStack.length > 0}
                canRedo={!aiBusy && redoStack.length > 0}
              />
              <span className="bp-legend">
                <i className="sw-cut" /> เส้นตัด
                <i className="sw-crease" />{' '}
                {kind === 'box' ? 'เส้นพับ' : kind === 'pouch' ? 'รอยพับ/ซีล' : 'แนวทับกาว'}
              </span>
            </div>
            {expand3d && <div className="viewer-backdrop" onClick={() => setExpand3d(false)} />}
            {/* ย่อเหลือปุ่มกลม — กดเพื่อโชว์จอเล็กกลับมา */}
            {pip3dMin && !expand3d && (
              <button className="pip-restore card" title="แสดงมุมมอง 3D" aria-label="แสดงมุมมอง 3D" onClick={() => setPip3dMin(false)}>
                3D
              </button>
            )}
            {/* มุมมอง 3D = จอเล็กซ้อนมุม blueprint (PiP) จางไว้ ชี้เมาส์ค่อยชัด กดขยายเป็น popup ใหญ่ */}
            {!(pip3dMin && !expand3d) && (
            <div className={`viewer-pip card${expand3d ? ' expanded' : ''}`}>
              <div className="pip-bar">
                <span className="pip-title">มุมมอง 3D</span>
                <span className="pip-actions">
                  {!expand3d && (
                    <button className="pip-expand" title="ซ่อนมุมมอง" aria-label="ซ่อนมุมมอง 3D" onClick={() => setPip3dMin(true)}>
                      –
                    </button>
                  )}
                  <button
                    className="pip-expand"
                    title={expand3d ? 'ย่อมุมมอง' : 'ขยายมุมมอง'}
                    aria-label={expand3d ? 'ย่อมุมมอง 3D' : 'ขยายมุมมอง 3D'}
                    onClick={() => setExpand3d((v) => !v)}
                  >
                    {expand3d ? '✕' : '⤢'}
                  </button>
                </span>
              </div>
              {expand3d && foldBar}
              <div className="viewer-3d">
                <Suspense fallback={<div className="viewer-loading">กำลังโหลดมุมมอง 3 มิติ…</div>}>
                  {kind === 'box' ? (
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
                  ) : kind === 'vessel' ? (
                    <VesselViewer3D vessel={vessel!} mat={mat} decos={decos} fillColor={fillColor} fillImage={fillImage} />
                  ) : (
                    <PouchViewer3D pouch={pouch!} mat={mat} decos={decos} fillColor={fillColor} fillImage={fillImage} />
                  )}
                </Suspense>
              </div>
            </div>
            )}
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
