import { Suspense, createContext, lazy, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LogOut } from 'lucide-react'

// true เมื่อ DimField อยู่ในแถบปรับแต่งด้านบน (Canva-style) → เปลี่ยนสไลเดอร์เป็นปุ่ม+dropdown อัตโนมัติ
const TopBarCtx = createContext(false)
import { LangCtx, loadLang, LANG_KEY, useT, type Lang } from './i18n'
import { MATERIALS, getMaterial, packKind } from './core/materials'
import { TEMPLATES, getTemplate } from './core/templates'
import type { Dieline, Vec2 } from './core/types'
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
  loadTextFont,
  alignInSelection,
  distribute,
  stepRepeat,
  expandGroups,
  newGroupId,
  type AlignMode,
  recenter,
  cloneDeco,
  withTextW,
  makePathEl,
  type RawAnchor,
  type PathAnchor,
  elW,
  elH,
  svgArtworkLayer,
  fillSVGLayer,
  fillImageSVGLayer,
  renderArtworkCanvas,
  renderArtworkAlpha,
  scaleDecos,
  makeNutritionEl,
  FRAMES,
  framePath,
  type Deco,
  type TextEl,
  type FillImage,
  type ShapeKind,
  type NutriRow,
} from './core/artwork'
import { computeGuides, guidesSVGLayer, type Guides } from './core/guides'
import {
  DEFAULT_STICKER_CUT,
  NO_BORDER_INSET,
  STICKER_OFFSET_MAX,
  STICKER_OFFSET_MIN,
  STICKER_RULES,
  sameStickerCut,
  storedStickerCut,
  type AlphaMask,
  type StickerCut,
} from './core/stickerContour'
import { preflightSticker, type PreflightIssue } from './core/stickerPreflight'
import { WHITE_SPOT, traceWhiteInk, whiteInkPath } from './core/whiteInk'
import { generateStickerContour } from './core/templates/sticker'
import {
  SHEET_GAP,
  SHEET_MARGIN,
  STICKER_SHEETS,
  PER_SHEET_MAX,
  STICKER_MIN_SIZE,
  artClipBox,
  cutBox,
  fitScaleForCount,
  layoutStickerSheet,
  placePoint,
  placementSVG,
  sheetDieline,
  sheetsNeeded as stickerSheetsNeeded,
  CUSTOM_SHEET_MAX,
  CUSTOM_SHEET_MIN,
  DEFAULT_CUSTOM_SHEET,
  SHEET_MARGIN_MAX,
  resolveStickerSheet,
  type SheetLayout,
} from './core/stickerSheet'
import { generateVessel, LABEL_STYLES, type LabelStyle } from './core/vessel'
import {
  generatePouch,
  POUCH_STYLES,
  TEAR_GAP,
  ZIP_AT_MAX,
  type PouchStyle,
  type PouchAddons,
} from './core/pouch'
import { pouchZipIssues } from './core/pouchPreflight'
import { boxVolumeMl, pouchVolumeMl, vesselVolumeMl, tubeVolumeMl, formatCapacity } from './core/capacity'
import {
  applyVents,
  DEFAULT_VENTS,
  VENT_DIA_MIN,
  VENT_DIA_MAX,
  VENT_ROWS_MAX,
  VENT_COLS_MAX,
  type VentConfig,
  type VentWalls,
} from './core/vents'
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
import type { ProjectSummary } from '../shared/contracts/projects'
import type { ProjectSaveState } from './services/projects/durableSaveQueue'
import { rasterizeTrustedPreset } from './services/projects/trustedPresetRasterizer'
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
import type { Dim3D } from './components/DimBadge3D'
import type { LightMode } from './components/SceneLighting'
import { useSoftProof } from './components/useSoftProof'
import { useImageDpi } from './components/useImageDpi'
import { useStickerContour } from './components/useStickerContour'
import { GOOD_DPI, LOW_DPI, imageDrawMm, pixelsNeeded } from './core/imageDpi'
import { CMYK_PROOF_PROFILE } from './core/cmykProofLut'
import { PromptBar } from './components/PromptBar'
import { ColorField } from './components/ColorField'
import { ProjectGallery } from './components/ProjectGallery'
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
  IconTube,
  IconSticker,
  IconTrash,
  IconFontSize,
  IconStroke,
  IconNutrition,
  IconPosition,
  IconEffects,
  IconFill,
  IconNoFill,
  IconGradient,
  IconWidth,
  IconHeight,
  IconGradStart,
  IconGradEnd,
  IconRadial,
  IconAngle,
  IconCorner,
  IconDash,
  IconLock,
  IconUnlock,
  IconPen,
} from './components/icons'

// จานสี (palette) ใช้ร่วมทุกช่องสี — เก็บระดับแอปใน localStorage แยกจากงาน
// ซ่อนเครื่องมือปากกา (Pen) ไว้ก่อน — โค้ด path/pen ยังอยู่ครบ เปิดกลับได้ที่นี่
const SHOW_PEN_TOOL = false
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
  imperial?: boolean // true = แสดง/ป้อนเป็นนิ้ว (ค่าจริงเก็บเป็น มม. เสมอ)
}

const MM_PER_IN = 25.4

const fmtMm = (v: number) => String(Math.round(v * 10) / 10)
const hexLuminance = (hex: string) => {
  const v = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255
  return hex.length >= 7 ? 0.299 * v(1) + 0.587 * v(3) + 0.114 * v(5) : 0
}

// ช่องจำนวนต่อแผ่น — พิมพ์อิสระ แล้วใช้ค่าเมื่อ Enter/ออกจากช่อง (กันจัดขนาดใหม่ทุกตัวอักษรที่พิมพ์)
function PerSheetField({
  value,
  disabled,
  onCommit,
  label,
  unit,
}: {
  value: number
  disabled?: boolean
  onCommit: (n: number) => void
  label: string
  unit: string
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const commit = () => {
    const n = Math.round(Number(text))
    if (!Number.isFinite(n) || n < 1) {
      setText(String(value))
      return
    }
    const v = Math.min(PER_SHEET_MAX, n)
    setText(String(v))
    if (v !== value) onCommit(v)
  }
  return (
    <label className="per-sheet">
      <span>{label}</span>
      <input
        type="number"
        min={1}
        max={PER_SHEET_MAX}
        step={1}
        inputMode="numeric"
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
      />
      <span>{unit}</span>
    </label>
  )
}

// พรีวิวแผ่นสติกเกอร์: กรอบแผ่น + ลายแต่ละดวง (ภาพย่อ คลิปกรอบเส้นตัด+เผื่อสี) + เส้นตัดทุกดวง
function StickerSheetPreview({
  layout,
  sheetDieline: sd,
  piece,
  thumb,
  fillColor,
}: {
  layout: SheetLayout
  sheetDieline: Dieline
  piece: Dieline
  thumb: string | null
  fillColor: string | null
}) {
  const c = artClipBox(cutBox(piece))
  const { w, h } = layout.sheet
  return (
    <svg className="sheet-preview" viewBox={`-2 -2 ${w + 4} ${h + 4}`} role="img" aria-label={`${layout.sheet.nameTh} ${layout.count}`}>
      <defs>
        <clipPath id="sheet-pv-clip">
          <rect x={c.x0} y={c.y0} width={c.x1 - c.x0} height={c.y1 - c.y0} />
        </clipPath>
      </defs>
      <rect x={0} y={0} width={w} height={h} fill="#fff" stroke="#9aa5ad" strokeWidth={0.6} />
      {fillColor &&
        sd.panels.map((p) => (
          <polygon key={p.id} points={p.outline.map((q) => `${q.x},${q.y}`).join(' ')} fill={fillColor} />
        ))}
      {thumb &&
        layout.placements.map((pl, i) => (
          <g key={i} transform={placementSVG(pl)}>
            <image href={thumb} x={0} y={0} width={piece.width} height={piece.height} clipPath="url(#sheet-pv-clip)" />
          </g>
        ))}
      {sd.segments.map((sg, i) => (
        <path key={i} d={sg.d} fill="none" stroke="#e30613" strokeWidth={0.45} />
      ))}
    </svg>
  )
}

// ผลตรวจไฟล์สติกเกอร์ — error (ต้องแก้ก่อนส่งผลิต) / warn (ควรแก้) + สรุปกติกาเมื่อผ่านหมด
type IssueItem = Pick<PreflightIssue, 'level' | 'th' | 'en'> & { code: string }

function StickerIssues({ issues, okText }: { issues: IssueItem[]; okText?: [string, string] }) {
  const t = useT()
  if (!issues.length && okText) {
    return (
      <div className="sticker-ok" role="status">
        ✓ {t(okText[0], okText[1])}
      </div>
    )
  }
  if (!issues.length) {
    return (
      <div className="sticker-ok" role="status">
        ✓ {t('ไฟล์ผ่านข้อกำหนดไดคัท', 'Meets die-cut rules')}
        <span>
          {t(
            `เส้นตัดห่างลาย ≥${STICKER_RULES.minBorder} มม. หรือเผื่อสี ≥${STICKER_RULES.minBleed} มม. · ระยะระหว่างเส้นตัด ≥${STICKER_RULES.minGap} มม. · ช่องเจาะ ≥${STICKER_RULES.minHole} มม. · ไม่มีมุมหักศอก`,
            `Cut ≥${STICKER_RULES.minBorder} mm from art or bleed ≥${STICKER_RULES.minBleed} mm · cuts ≥${STICKER_RULES.minGap} mm apart · holes ≥${STICKER_RULES.minHole} mm · no sharp corners`,
          )}
        </span>
      </div>
    )
  }
  const errs = issues.filter((i) => i.level === 'error').length
  return (
    <div className={`sticker-issues${errs ? ' has-err' : ''}`} role="alert">
      <b>
        {errs
          ? t(`⛔ ต้องแก้ก่อนส่งผลิต ${errs} ข้อ`, `⛔ ${errs} issue(s) to fix before production`)
          : t('⚠ ควรตรวจก่อนส่งผลิต', '⚠ Check before production')}
      </b>
      <ul>
        {issues.map((i) => (
          <li key={i.code} className={i.level}>
            {t(i.th, i.en)}
          </li>
        ))}
      </ul>
    </div>
  )
}

function DimField({ label, value, min, max, disabled, unit = 'มม.', step = 0.5, onChange, pop: popProp, icon, imperial = false }: DimFieldProps) {
  // ค่า state จริงเป็น มม. เสมอ (เรขาคณิตใช้ มม.) — โหมดนิ้วแค่แปลงตอนแสดง/ป้อน
  const toDisp = (v: number) => (imperial ? Math.round((v / MM_PER_IN) * 1000) / 1000 : v)
  const toMm = (n: number) => (imperial ? n * MM_PER_IN : n)
  const unitLabel = imperial ? 'นิ้ว' : unit
  const dMin = toDisp(min)
  const dMax = toDisp(max)
  const dStep = imperial ? 0.05 : step
  const commit = (vmm: number) => onChange(clamp(Number.isFinite(vmm) ? vmm : min, min, max))
  const inTopBar = useContext(TopBarCtx) // เรียก hook แบบไม่มีเงื่อนไข
  const pop = popProp || inTopBar // ในแถบบน = โหมด dropdown อัตโนมัติ
  const [open, setOpen] = useState(false)
  // ข้อความในช่องพิมพ์ระหว่างแก้ (ไม่ clamp ทันที กันพิมพ์เลขมั่ว เช่น 100→250) — clamp ตอน blur
  const [text, setText] = useState(String(value))
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!editing) setText(String(toDisp(value)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editing, imperial])
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
      min={dMin}
      max={dMax}
      step={dStep}
      value={text}
      disabled={disabled}
      aria-label={label}
      onFocus={() => setEditing(true)}
      onChange={(e) => {
        setText(e.target.value)
        const n = Number(e.target.value)
        // อัปเดตสด (สไลเดอร์/3D ตาม) เฉพาะเมื่อเป็นตัวเลขในช่วง — ไม่ clamp ระหว่างพิมพ์
        if (e.target.value !== '' && Number.isFinite(n) && n >= dMin && n <= dMax) onChange(toMm(n))
      }}
      onBlur={() => {
        setEditing(false)
        commit(toMm(Number(text))) // clamp ตอนออกจากช่อง (เป็น มม.)
      }}
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
            {toDisp(value)}
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
                  {unitLabel}
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
          {unitLabel}
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

// โมดูลลอยที่ลากย้ายได้ (จับที่แถบหัวข้อ) + จางลงเมื่อไม่ได้ชี้/โฟกัส
// host คือ div เปล่า — เนื้อหา (Group) ถูก portal เข้ามาจาก App ผ่าน hostRef
function FloatModule({ kind, hostRef }: { kind: 'size' | 'bg'; hostRef: (el: HTMLDivElement | null) => void }) {
  const elRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const setRef = (el: HTMLDivElement | null) => {
    elRef.current = el
    hostRef(el)
  }
  // ใช้ native listener บน host — เนื้อหา (Group) ถูก portal เข้ามา event จึง bubble ทาง DOM ไม่ใช่ React tree
  useEffect(() => {
    const el = elRef.current
    if (!el) return
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.tgroup-head')) return // ลากเฉพาะแถบหัวข้อ
      const start = { sx: e.clientX, sy: e.clientY, l: el.offsetLeft, t: el.offsetTop, moved: false }
      const parent = el.offsetParent as HTMLElement | null
      const onMove = (ev: PointerEvent) => {
        if (!start.moved && Math.hypot(ev.clientX - start.sx, ev.clientY - start.sy) > 3) start.moved = true
        if (!start.moved) return
        let left = start.l + (ev.clientX - start.sx)
        let top = start.t + (ev.clientY - start.sy)
        if (parent) {
          left = Math.max(4, Math.min(left, parent.clientWidth - el.offsetWidth - 4))
          top = Math.max(4, Math.min(top, parent.clientHeight - 44))
        }
        setPos({ left, top })
      }
      const onUp = () => {
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
        if (start.moved) {
          // กันคลิกที่ตามมา (ไม่ให้ยุบ/กางกลุ่มหลังลาก)
          const eat = (ce: Event) => ce.stopPropagation()
          document.addEventListener('click', eat, { capture: true, once: true })
          setTimeout(() => document.removeEventListener('click', eat, { capture: true }), 120)
        }
      }
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
    }
    el.addEventListener('pointerdown', onDown)
    return () => el.removeEventListener('pointerdown', onDown)
  }, [])
  const style = pos ? { left: pos.left, top: pos.top, right: 'auto' as const } : undefined
  return <div ref={setRef} className={`${kind}-float card float-module`} style={style} />
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
  sheet: { piece: Dieline; layout: SheetLayout } | null = null,
  white: Vec2[][] | null = null,
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
  let fillLayer = fillImage ? fillImageSVGLayer(d, fillImage) : fillSVGLayer(d, fillColor)
  let artLayer = svgArtworkLayer(decos)
  if (sheet) {
    // แผ่นหลายดวง: สีพื้น+ลายของดวงเดียวเก็บใน defs แล้ววางซ้ำตามตำแหน่ง (คลิปกรอบเส้นตัด + เผื่อสี)
    const piece = sheet.piece
    const one =
      (fillImage ? fillImageSVGLayer(piece, fillImage) : fillSVGLayer(piece, fillColor)) + svgArtworkLayer(decos)
    const c = artClipBox(cutBox(piece))
    const uses = sheet.layout.placements
      .map((pl) => `    <g transform="${placementSVG(pl)}"><use href="#sticker-one" xlink:href="#sticker-one" clip-path="url(#sticker-clip)"/></g>`)
      .join('\n')
    fillLayer = ''
    artLayer = one
      ? `  <defs>\n    <clipPath id="sticker-clip"><rect x="${c.x0}" y="${c.y0}" width="${c.x1 - c.x0}" height="${c.y1 - c.y0}"/></clipPath>\n` +
        `    <g id="sticker-one">\n${one}    </g>\n  </defs>\n` +
        svgLayer('artwork', '', uses)
      : ''
  }
  const guideLayer = guides ? guidesSVGLayer(guides) : ''
  // หมึกขาวรอง (ฟิล์มใส): เลเยอร์ White ล่างสุด เติม even-odd (รูในตัวอักษรเว้นใส) — สีฟ้าอ่อนแค่ให้มองเห็นบนจอ
  const whiteLayer = white?.length
    ? svgLayer(WHITE_SPOT, 'fill="#8fd3f4" fill-rule="evenodd"', `    <path d="${whiteInkPath(white)}"/>`)
    : ''

  const w = d.width + pad * 2
  const h = d.height + pad * 2
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"` +
    ` xmlns:xlink="http://www.w3.org/1999/xlink"` +
    ` width="${w}mm" height="${h}mm" viewBox="${-pad} ${-pad} ${w} ${h}">\n` +
    `<!-- สเกลจริง 1:1 หน่วย mm | White = หมึกขาวรอง (ฟิล์มใส) | fill = สีพื้น | artwork = ลายพิมพ์ | cut = เส้นตัด (แดง) | crease = เส้นพับ (เขียวประ) | guides = เผื่อตัด/ปลอดภัย | dims = เส้นบอกขนาด (ห้ามใช้ผลิต) -->\n` +
    `${whiteLayer}${fillLayer}${artLayer}${cutLayer}${creaseLayer}${guideLayer}${dimLayer}</svg>\n`
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
  vents: VentConfig
  stickerCut: StickerCut
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
  a.vents === b.vents &&
  sameStickerCut(a.stickerCut, b.stickerCut) &&
  a.decos === b.decos

const sameSpec = (a: CurrentSpec, b: CurrentSpec) =>
  a.template === b.template &&
  a.materialId === b.materialId &&
  a.W === b.W &&
  a.D === b.D &&
  a.H === b.H &&
  a.handle === b.handle

const samePouchAddons = (a: PouchAddons | undefined, b: PouchAddons | undefined) =>
  Boolean(a?.hangHole) === Boolean(b?.hangHole)
  && Boolean(a?.valve) === Boolean(b?.valve)
  && Boolean(a?.tinTie) === Boolean(b?.tinTie)
  && a?.zipAt === b?.zipAt
  && a?.tearAt === b?.tearAt

// เทียบรูระบายอากาศ — ไม่เปิดทั้งคู่ = เท่ากัน (undefined = ปิด); เปิดทั้งคู่ค่อยเทียบค่า
const sameVents = (a: VentConfig | undefined, b: VentConfig | undefined) => {
  const ao = Boolean(a?.on)
  const bo = Boolean(b?.on)
  if (!ao && !bo) return true
  return (
    ao === bo &&
    a!.walls === b!.walls &&
    a!.dia === b!.dia &&
    a!.rows === b!.rows &&
    a!.cols === b!.cols
  )
}

// --- บันทึกหลายงาน (project) + ประวัติเวอร์ชันของแต่ละงานลง localStorage ---

// local demo ใช้ key เดิมเพื่อรักษาความเข้ากันได้; cloud draft ส่ง storageKey ที่ผูกกับ app user
export const STORAGE_KEY = 'gen-package-projects-v1'
export const LEGACY_KEY = 'gen-package-design-v1'

export interface ProjectStoreSnapshot {
  projects: Project[]
  activeId: string
  showDims: boolean
}

export interface CloudProjectBridge {
  items: ProjectSummary[]
  online: boolean
  saveState: ProjectSaveState
  onProjectChange(project: Project): Promise<void>
  switchProject(current: Project, targetId: string): Promise<Project>
  createProject(current: Project, name: string): Promise<Project>
  deleteProject(current: Project, targetId: string): Promise<Project>
  importProject(current: Project, imported: Project): Promise<Project>
  beforeLogout(current: Project): Promise<void>
  resolveConflict(current: Project, action: 'reload' | 'copy'): Promise<Project>
  retrySave(): Promise<void>
  subscribeRemoteProject(listener: (project: Project) => void): () => void
  requestAiSpec: (
    prompt: string,
    current?: CurrentSpec,
    imageBase64?: string,
    apiKey?: string,
  ) => Promise<AiBoxSpec>
}

function cloudSaveLabel(state: ProjectSaveState): string {
  switch (state) {
    case 'loading': return 'กำลังโหลด…'
    case 'clean': return 'บันทึกแล้ว'
    case 'dirty': return 'มีการแก้ไข'
    case 'saving': return 'กำลังบันทึก…'
    case 'offline': return 'ออฟไลน์ · เก็บ draft แล้ว'
    case 'conflict': return 'มีการแก้ไขจากอีกแท็บ'
    case 'error': return 'บันทึกไม่สำเร็จ'
  }
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

function loadStore(storageKey: string, migrateLegacy: boolean): ProjectStoreSnapshot {
  try {
    const raw = localStorage.getItem(storageKey)
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

  if (migrateLegacy) {
    // ย้ายข้อมูลรุ่นเก่า (งานเดียว) เข้าระบบหลายงานเฉพาะ local demo
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
          return { projects: [p], activeId: p.id, showDims: d.showDims !== false }
        }
      }
    } catch {
      // ใช้ค่าเริ่มต้น
    }
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
        <rect key={i} x={c.x} y={c.y} width={pw} height={ph} fill="#dbeef1" stroke="#2f8a99" strokeWidth={0.7} />
      ))}
    </svg>
  )
}

interface AppProps {
  onLogout?: () => void | Promise<void>
  storageKey?: string
  migrateLegacy?: boolean
  initialStore?: ProjectStoreSnapshot
  cloud?: CloudProjectBridge
}

export default function App({
  onLogout,
  storageKey = STORAGE_KEY,
  migrateLegacy = true,
  initialStore: suppliedStore,
  cloud,
}: AppProps) {
  const initialStore = useMemo(
    () => suppliedStore ?? loadStore(storageKey, migrateLegacy),
    [suppliedStore, storageKey, migrateLegacy],
  )
  const initialActive = initialStore.projects.find((p) => p.id === initialStore.activeId)
    ?? initialStore.projects[0]
  const [projects, setProjects] = useState<Project[]>(initialStore.projects)
  const [activeId, setActiveId] = useState(initialActive.id)
  const [projectOperation, setProjectOperation] = useState<'create' | 'delete' | 'switch' | 'import' | 'reload' | 'copy' | 'logout' | null>(null)
  const projectBusy = projectOperation !== null
  const [visibleProjectOperation, setVisibleProjectOperation] = useState<typeof projectOperation>(null)
  const startProjectOperation = (operation: NonNullable<typeof projectOperation>) => {
    setVisibleProjectOperation(null)
    setProjectOperation(operation)
  }

  useEffect(() => {
    if (!projectOperation) {
      setVisibleProjectOperation(null)
      return
    }
    const timer = window.setTimeout(() => setVisibleProjectOperation(projectOperation), 320)
    return () => window.clearTimeout(timer)
  }, [projectOperation])

  const projectOperationLabel = projectOperation && projectOperation === visibleProjectOperation ? {
    create: 'กำลังสร้างงานใหม่…',
    delete: 'กำลังลบงาน…',
    switch: 'กำลังเปิดงาน…',
    import: 'กำลังนำเข้างาน…',
    reload: 'กำลังโหลดงานล่าสุด…',
    copy: 'กำลังเก็บสำเนา…',
    logout: 'กำลังออกจากระบบ…',
  }[projectOperation] : null
  const [templateId, setTemplateId] = useState(initialActive.live.template)
  const [materialId, setMaterialId] = useState(initialActive.live.materialId)
  const [W, setW] = useState(initialActive.live.W)
  const [D, setD] = useState(initialActive.live.D)
  const [H, setH] = useState(initialActive.live.H)
  const [handle, setHandle] = useState(initialActive.live.handle)
  const [qty, setQty] = useState(initialActive.qty)
  const [fillColor, setFillColor] = useState<string | null>(initialActive.fillColor)
  const [fillImage, setFillImage] = useState<FillImage | null>(initialActive.fillImage ?? null)
  // พรีวิวสีงานพิมพ์ CMYK บน blueprint (soft-proof) — ตั้งใจไม่จำค่าข้ามรอบ กันลืมเปิดค้างแล้วนึกว่าสีลายเพี้ยน
  const [softProof, setSoftProof] = useState(false)
  const [labelStyle, setLabelStyle] = useState<LabelStyle>(initialActive.labelStyle ?? 'body')
  const [pouchStyle, setPouchStyle] = useState<PouchStyle>(initialActive.pouchStyle ?? 'stand')
  const [zipper, setZipper] = useState<boolean>(initialActive.zipper ?? false)
  const [pouchAddons, setPouchAddons] = useState<PouchAddons>(initialActive.pouchAddons ?? {})
  const [vents, setVents] = useState<VentConfig>(initialActive.vents ?? DEFAULT_VENTS)
  // สติกเกอร์: รูปทรงไดคัท (สี่เหลี่ยมมุมมน / ตามรูป) + ขอบขาว
  const [stickerCut, setStickerCut] = useState<StickerCut>(initialActive.stickerCut ?? DEFAULT_STICKER_CUT)
  // ธีมสว่าง/มืด — เก็บใน localStorage, ตั้ง data-theme บน <html> (canvas/3D คงขาวเสมอ)
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark')
  useEffect(() => {
    if (dark) document.documentElement.dataset.theme = 'dark'
    else delete document.documentElement.dataset.theme
    localStorage.setItem('packit-theme', dark ? 'dark' : 'light')
  }, [dark])
  // ภาษา (ไทย/อังกฤษ) — เก็บใน localStorage; t(ไทย, อังกฤษ) เลือกตามภาษาปัจจุบัน
  const [lang, setLang] = useState<Lang>(loadLang)
  useEffect(() => {
    try {
      localStorage.setItem(LANG_KEY, lang)
    } catch {
      /* ปิด storage — ข้าม */
    }
  }, [lang])
  const t = (th: string, en: string) => (lang === 'en' ? en : th)
  // หน่วยวัดช่องขนาด (มม./นิ้ว) — ค่าจริงเก็บเป็น มม. เสมอ สลับแค่การแสดงผล
  const [unit, setUnit] = useState<'mm' | 'in'>(() => {
    try {
      return localStorage.getItem('packit-unit') === 'in' ? 'in' : 'mm'
    } catch {
      return 'mm'
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('packit-unit', unit)
    } catch {
      /* ปิด storage — ข้าม */
    }
  }, [unit])
  const imperial = unit === 'in'
  // แสดง/ซ่อนเส้นบอกขนาดบนมุมมอง 3D (จำค่าไว้)
  const [showDims3d, setShowDims3d] = useState<boolean>(() => {
    try {
      return localStorage.getItem('packit-dims3d') !== '0'
    } catch {
      return true
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('packit-dims3d', showDims3d ? '1' : '0')
    } catch {
      /* ปิด storage — ข้าม */
    }
  }, [showDims3d])
  // แสงสด: เพิ่มไฟ + ปิด tone mapping ฟิล์มให้สีสด/สว่างขึ้นในมุมมอง 3D (จำค่าไว้; เปิดเป็นค่าเริ่มต้น)
  const [vivid3d, setVivid3d] = useState<boolean>(() => {
    try {
      return localStorage.getItem('packit-vivid3d') !== '0'
    } catch {
      return true
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('packit-vivid3d', vivid3d ? '1' : '0')
    } catch {
      /* ปิด storage — ข้าม */
    }
  }, [vivid3d])
  // รูปแบบแสงเมื่อเปิดแสงสด: 'studio' = ฟุ้งรอบด้าน (เช็กลาย) / 'threePoint' = key+fill+rim (มีมิติแบบภาพโฆษณา)
  const [lightRig3d, setLightRig3d] = useState<'studio' | 'threePoint'>(() => {
    try {
      return localStorage.getItem('packit-lightrig3d') === 'threePoint' ? 'threePoint' : 'studio'
    } catch {
      return 'studio'
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('packit-lightrig3d', lightRig3d)
    } catch {
      /* ปิด storage — ข้าม */
    }
  }, [lightRig3d])
  const lightMode3d: LightMode = vivid3d ? lightRig3d : 'soft'
  const [decos, setDecos] = useState<Deco[]>(initialActive.decos)
  const textFontKey = decos
    .filter((d): d is TextEl => d.type === 'text' && !d.hidden)
    .map((d) => `${d.id}:${d.font ?? 'noto'}:${d.weight ?? 400}:${d.size}:${d.text}`)
    .sort()
    .join('\u0000')
  useEffect(() => {
    const textDecos = decos.filter((d): d is TextEl => d.type === 'text' && !d.hidden)
    if (!textDecos.length) return
    let cancelled = false
    void Promise.all(textDecos.map((d) => loadTextFont(d.font, d.weight ?? 400, d.text))).then(() => {
      if (cancelled) return
      setDecos((current) => {
        let changed = false
        const measured = current.map((d) => {
          if (d.type !== 'text') return d
          const width = withTextW(d).w
          if (Math.abs(width - d.w) < 0.01) return d
          changed = true
          return { ...d, w: width }
        })
        return changed ? measured : current
      })
    })
    return () => { cancelled = true }
    // The key tracks text, face, weight, and size without rerunning after width-only corrections.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textFontKey])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [renamingId, setRenamingId] = useState<string | null>(null) // เลเยอร์ที่กำลังแก้ชื่อ (ดับเบิลคลิก)
  const [lockAspect, setLockAspect] = useState(true) // ล็อกสัดส่วนกรอบรูป: ปรับกว้าง/สูงพร้อมกันตามสัดส่วนรูปจริง
  const [presetColor, setPresetColor] = useState('#2f8a99') // สีเริ่มต้นของลายจากไลบรารี
  // กลุ่มเครื่องมือหน้าตกแต่งที่เปิดอยู่ (accordion) — เก็บค่าเริ่มต้นตามการใช้งานบ่อย
  const [groups, setGroups] = useState({
    // หน้าออกแบบ
    mode: true,
    tpl: true,
    mat: true,
    label: true,
    size: true,
    // หน้าตกแต่ง (bg เปิดไว้ — เป็นโมดูลลอยแล้ว)
    bg: true,
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
  // โมดูล "ขนาด" ลอยด้านขวา work area (portal จากแถบข้างไปที่ host ใน main)
  const [sizeFloatEl, setSizeFloatEl] = useState<HTMLDivElement | null>(null)
  // โมดูล "พื้นหลังแพ็กเกจ" ลอยด้านขวา work area (แท็บตกแต่ง)
  const [bgFloatEl, setBgFloatEl] = useState<HTMLDivElement | null>(null)

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

    // จอสัมผัส (ไม่มี hover): แตะค้าง ~0.45 วิ = โชว์ tooltip เดียวกัน แล้วกันไม่ให้ปุ่มถูกกดจริง
    let pressTimer = 0
    let pressEl: HTMLElement | null = null
    let pressXY = { x: 0, y: 0 }
    let lpShown = false
    let autoHide = 0
    const clearPress = () => {
      if (pressTimer) window.clearTimeout(pressTimer)
      pressTimer = 0
    }
    const eatClick = (ev: Event) => {
      ev.preventDefault()
      ev.stopPropagation()
    }
    const pDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      const el = (e.target as Element).closest?.('.deco-topbar [title]') as HTMLElement | null
      if (!el) return
      pressEl = el
      pressXY = { x: e.clientX, y: e.clientY }
      lpShown = false
      clearPress()
      pressTimer = window.setTimeout(() => {
        if (!pressEl) return
        hide()
        show(pressEl)
        lpShown = true
      }, 450)
    }
    const pMove = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !pressEl) return
      // ขยับเกินระยะ = ตั้งใจลาก/เลื่อน ไม่ใช่แตะค้าง
      if (Math.hypot(e.clientX - pressXY.x, e.clientY - pressXY.y) > 10) {
        clearPress()
        if (lpShown) hide()
        pressEl = null
        lpShown = false
      }
    }
    const pUp = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      clearPress()
      if (lpShown) {
        // กันคลิกที่จะตามมาหลังปล่อยนิ้ว (แตะค้าง = ดูข้อมูล ไม่สั่งทำงาน)
        document.addEventListener('click', eatClick, { capture: true, once: true })
        window.setTimeout(() => document.removeEventListener('click', eatClick, { capture: true }), 500)
        if (autoHide) window.clearTimeout(autoHide)
        autoHide = window.setTimeout(hide, 1600) // ปล่อยแล้วค้างไว้ให้อ่านครู่หนึ่ง
      }
      pressEl = null
      lpShown = false
    }
    document.addEventListener('pointerdown', pDown, true)
    document.addEventListener('pointermove', pMove, true)
    document.addEventListener('pointerup', pUp, true)
    document.addEventListener('pointercancel', pUp, true)

    return () => {
      document.removeEventListener('mouseover', over)
      document.removeEventListener('mouseout', out)
      document.removeEventListener('pointerdown', pDown, true)
      document.removeEventListener('pointermove', pMove, true)
      document.removeEventListener('pointerup', pUp, true)
      document.removeEventListener('pointercancel', pUp, true)
      document.removeEventListener('click', eatClick, { capture: true })
      clearPress()
      if (autoHide) window.clearTimeout(autoHide)
      tip?.remove()
    }
  }, [])
  // เลือกชิ้น → เปิดกลุ่ม "ปรับแต่งที่เลือก" ให้อัตโนมัติ (ไม่ปิดกลุ่มอื่น)
  useEffect(() => {
    if (selectedIds.length) setGroups((g) => (g.props ? g : { ...g, props: true }))
  }, [selectedIds.length])
  const [fold, setFold] = useState(1)
  const [showDims, setShowDims] = useState(initialStore.showDims)
  const [showGuides, setShowGuides] = useState(false)
  const [nameModal, setNameModal] = useState<{ title: string; value: string; onOk: (n: string) => void } | null>(null)
  const [sideTab, setSideTab] = useState<'design' | 'artwork' | 'export'>('design')
  const asideRef = useRef<HTMLElement>(null)
  const headerRef = useRef<HTMLElement>(null)
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
  const [history, setHistory] = useState<DesignVersion[]>(initialActive.history)
  const [histIdx, setHistIdx] = useState(initialActive.histIdx)
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
  // สติกเกอร์ไดคัท = box (แผ่นแบนชิ้นเดียว) นำเสนอเป็นประเภทงานแยก
  const isSticker = kind === 'box' && templateId === 'sticker'
  // หลอดครีม = vessel (revolve) วัสดุ tube นำเสนอเป็นประเภทงานแยก
  const isTube = kind === 'vessel' && mat.form === 'tube'
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
  const zipIssues = useMemo(() => (pouch ? pouchZipIssues(pouch) : []), [pouch])
  // สติกเกอร์: alpha ของลาย (ไม่รวมสีพื้น) — ใช้ทั้งไดคัทตามรูปและตรวจไฟล์ตามข้อจำกัดผลิต
  // หน่วงหลังแก้ลาย/ขนาด (raster + distance transform หนัก ไม่ควรทำทุกครั้งที่ state ขยับ)
  const [stickerArt, setStickerArt] = useState<AlphaMask | null>(null)
  useEffect(() => {
    if (!isSticker) {
      setStickerArt(null)
      return
    }
    let alive = true
    const pad = 3 // มม. รอบแผ่น — เห็นสีที่เลยเส้นตัดออกไป (เช็คระยะเผื่อสี)
    const tm = setTimeout(async () => {
      // ความละเอียดปรับตามขนาดแผ่น (คุมจำนวนพิกเซล ~1.5 ล้าน) — 3–8 px/มม.
      const s = Math.max(3, Math.min(8, Math.sqrt(1.5e6 / ((W + 2 * pad) * (H + 2 * pad)))))
      const m = await renderArtworkAlpha(decos, W, H, s, pad)
      if (alive) setStickerArt(m)
    }, 250)
    return () => {
      alive = false
      clearTimeout(tm)
    }
  }, [isSticker, decos, W, H])
  // ไดคัทตามรูป: คำนวณใน Web Worker (หนักเกินจะทำบน main thread)
  const { loops: stickerLoops, status: contourStatus } = useStickerContour(isSticker, stickerCut, stickerArt, W, H)
  const dieline = useMemo(
    () =>
      kind === 'box'
        ? isSticker && stickerLoops
          ? generateStickerContour(stickerLoops, W, H)
          : applyVents(
              template.generate({ W, D, H, handle }, mat),
              template.supportsVents ? vents : undefined,
            )
        : kind === 'vessel'
          ? vessel!.label
          : pouch!.label,
    [W, D, H, handle, mat, template, vessel, pouch, kind, vents, isSticker, stickerLoops],
  )
  // ไดคัทตามรูปไม่ใช้เส้นเผื่อตัด 3 มม. แบบกล่อง — สติกเกอร์ใช้กติกาเผื่อสี/ระยะห่างของตัวเอง (ตรวจด้านล่าง)
  const guides = useMemo(
    () => (showGuides && dieline && !(isSticker && stickerLoops) ? computeGuides(dieline.panels) : null),
    [showGuides, dieline, isSticker, stickerLoops],
  )
  // ตรวจไฟล์สติกเกอร์ตามข้อจำกัดการผลิตไดคัท (ระยะจากเส้นตัด/เผื่อสี/ระยะห่าง/ช่องเจาะ/มุมแหลม)
  const stickerIssues = useMemo<PreflightIssue[]>(
    () =>
      isSticker && dieline
        ? preflightSticker({
            loops: dieline.panels.map((p) => p.outline),
            art: stickerArt,
            sheet: { w: dieline.width, h: dieline.height },
            contour: !!stickerLoops,
            clearNoWhite:
              mat.clear && !mat.underbase ? { lightFill: !!fillColor && hexLuminance(fillColor) > 0.8 } : undefined,
          })
        : [],
    [isSticker, dieline, stickerArt, stickerLoops, mat.clear, mat.underbase, fillColor],
  )
  // แผ่นสติกเกอร์หลายดวง: ออกแบบดวงเดียว ระบบเรียงซ้ำเต็มแผ่น (ไฟล์ส่งออกเป็นทั้งแผ่น)
  // memo: แผ่นกำหนดเองสร้าง object ใหม่ทุกครั้ง — ถ้าไม่ memo พรีวิว/ภาพย่อจะคำนวณซ้ำไม่จบ
  const stickerSheet = useMemo(
    () =>
      isSticker
        ? resolveStickerSheet({ sheet: stickerCut.sheet, sheetW: stickerCut.sheetW, sheetH: stickerCut.sheetH })
        : undefined,
    [isSticker, stickerCut.sheet, stickerCut.sheetW, stickerCut.sheetH],
  )
  const sheetMargin = stickerCut.sheetMargin ?? SHEET_MARGIN
  const sheetLayout = useMemo(
    () =>
      stickerSheet && dieline
        ? layoutStickerSheet(cutBox(dieline), stickerSheet, sheetMargin, SHEET_GAP, stickerCut.perSheet)
        : null,
    [stickerSheet, dieline, sheetMargin, stickerCut.perSheet],
  )
  const sheetOut = useMemo(
    () => (sheetLayout && sheetLayout.count > 0 && dieline ? { piece: dieline, layout: sheetLayout } : null),
    [sheetLayout, dieline],
  )
  // dieline ที่ใช้ส่งออก (ทั้งแผ่นเมื่อเลือกแผ่นหลายดวง)
  const exportDieline = useMemo(
    () => (sheetOut ? sheetDieline(sheetOut.piece, sheetOut.layout) : dieline),
    [sheetOut, dieline],
  )
  // หมึกขาวรองสำหรับไฟล์ส่งออก (สติกเกอร์ฟิล์มใสรองขาว): สีพื้น/รูปพื้นพิมพ์เต็มดวง → ขาวเต็มรูปทรงดวง,
  // ไม่มีพื้น → ตามรูปทรงลาย (เว้นรูในตัวอักษร) — แผ่นหลายดวงวางซ้ำตามตำแหน่งแต่ละดวง
  const whiteInkForExport = async (): Promise<Vec2[][] | null> => {
    if (!isSticker || !mat.underbase || !dieline) return null
    let loops: Vec2[][]
    if (fillColor || fillImage) loops = dieline.panels.map((p) => p.outline)
    else {
      const s = Math.max(4, Math.min(10, Math.sqrt(4e6 / (dieline.width * dieline.height))))
      const m = await renderArtworkAlpha(decos, dieline.width, dieline.height, s, 0)
      if (!m) return null
      loops = traceWhiteInk(m)
    }
    if (sheetOut) loops = sheetOut.layout.placements.flatMap((pl) => loops.map((l) => l.map((q) => placePoint(pl, q))))
    return loops.length ? loops : null
  }

  // กำหนดจำนวนต่อแผ่น: ขนาดดวงถูกล็อกตามจำนวน (ช่อง W/H แก้เองไม่ได้)
  const perSheetLocked = isSticker && !!stickerCut.sheet && !!stickerCut.perSheet
  // ย่อ/ขยายดวง (แผ่นออกแบบ + ลายทั้งชุด) ให้ได้ n ดวงต่อแผ่นที่ขนาดใหญ่สุด — คืน false ถ้าใส่ไม่ครบ
  const fitStickerToCount = (n: number, cut: StickerCut = stickerCut): boolean => {
    const sh = resolveStickerSheet(cut)
    if (!sh || !dieline || n < 1) return false
    const box = cutBox(dieline)
    // ไดคัทตามรูป: ขอบขาวกว้างคงที่ไม่ย่อตามลาย (ไม่มีขอบขาว = ตัดเข้าเนื้อ → ติดลบ); สี่เหลี่ยม = 0
    const edge = stickerLoops ? (stickerCut.border === 'white' ? stickerCut.offset : -NO_BORDER_INSET) : 0
    const art = { w: box.x1 - box.x0 - 2 * edge, h: box.y1 - box.y0 - 2 * edge }
    // ไดคัทตามรูป: เส้นตัดถูก trace ใหม่หลังย่อลาย (raster/เกลี่ยเส้น คลาด ~0.2 มม.) → เผื่อ 0.6 มม. ต่อดวง
    const k0 = fitScaleForCount(n, art, edge, sh, cut.sheetMargin ?? SHEET_MARGIN, SHEET_GAP, stickerLoops ? 0.6 : 0)
    if (!k0) return false
    const k = Math.min(k0, 250 / W, 300 / H)
    const nW = Math.floor(W * k * 10) / 10 // ปัดลง 0.1 มม. — ไม่เกินช่องที่คำนวณไว้
    const nH = Math.floor(H * k * 10) / 10
    if (nW < STICKER_MIN_SIZE || nH < STICKER_MIN_SIZE) return false
    setW(nW)
    setH(nH)
    setDecos(scaleDecos(decos, Math.min(nW / W, nH / H)))
    return true
  }
  const [perSheetErr, setPerSheetErr] = useState(false)
  // เปลี่ยนค่าตั้งแผ่น — ถ้าอยู่โหมดกำหนดจำนวน จัดขนาดดวงใหม่ตามแผ่น/ขอบ/จำนวนล่าสุดทันที
  const updateSheet = (patch: Partial<StickerCut>) => {
    const next = { ...stickerCut, ...patch }
    setStickerCut(next)
    setPerSheetErr(next.sheet && next.perSheet ? !fitStickerToCount(next.perSheet, next) : false)
  }

  // ภาพย่อลายดวงเดียว (ความละเอียดต่ำ) สำหรับพรีวิวแผ่น
  const [stickerThumb, setStickerThumb] = useState<string | null>(null)
  useEffect(() => {
    if (!sheetOut) {
      setStickerThumb(null)
      return
    }
    let alive = true
    const tm = setTimeout(async () => {
      const base = fillImage ? { dieline: sheetOut.piece, fillImage } : null
      const c = await renderArtworkCanvas(decos, sheetOut.piece.width, sheetOut.piece.height, 96, base)
      if (alive) setStickerThumb(c ? c.toDataURL('image/png') : null)
    }, 300)
    return () => {
      alive = false
      clearTimeout(tm)
    }
  }, [sheetOut, decos, fillImage])

  // ความจุโดยประมาณ (มล.) ตามชนิดบรรจุภัณฑ์ — การ์ด/สติกเกอร์เป็นแผ่นแบน ไม่มีความจุ
  const capacityMl = useMemo(() => {
    if (isCard || isSticker) return null
    if (kind === 'pouch' && pouch) return pouchVolumeMl(W, H, pouch.depth3D, pouchStyle)
    if (kind === 'vessel' && vessel)
      return isTube && vessel.tube
        ? tubeVolumeMl(W, H, vessel.tube.rcap, vessel.tube.capTop)
        : vesselVolumeMl(vessel.profile)
    if (kind === 'box') return boxVolumeMl(W, D, H)
    return null
  }, [kind, W, D, H, pouch, vessel, pouchStyle, isTube, isCard, isSticker])

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
            ? sameSpec(p.live, { template: templateId, materialId, W, D, H, handle })
              && p.qty === qty
              && p.fillColor === fillColor
              && p.fillImage === fillImage
              && (p.labelStyle ?? 'body') === labelStyle
              && (p.pouchStyle ?? 'stand') === pouchStyle
              && Boolean(p.zipper) === zipper
              && samePouchAddons(p.pouchAddons, pouchAddons)
              && sameVents(p.vents, vents)
              && sameStickerCut(p.stickerCut, stickerCut)
              && p.decos === decos
              && p.history === history
              && p.histIdx === histIdx
                ? p
                : {
                    ...p,
                    live: { template: templateId, materialId, W, D, H, handle },
                    qty,
                    fillColor,
                    fillImage,
                    labelStyle,
                    pouchStyle,
                    zipper,
                    pouchAddons,
                    vents,
                    stickerCut: storedStickerCut(stickerCut),
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
  }, [history, histIdx, templateId, materialId, W, D, H, handle, qty, fillColor, fillImage, labelStyle, pouchStyle, zipper, pouchAddons, vents, stickerCut, decos, activeId])

  // local demo เขียน localStorage; cloud ส่ง active project เข้า durable IndexedDB/save queue
  useEffect(() => {
    if (cloud) {
      const active = projects.find((project) => project.id === activeId)
      if (active) void cloud.onProjectChange(active).catch(() => {
        // Cloud bridge exposes the durable-save error in its status indicator.
      })
      return
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify({ projects, activeId, showDims }))
    } catch {
      // storage เต็มหรือถูกปิดไว้ — ข้ามการ save เงียบๆ
    }
  }, [projects, activeId, showDims, storageKey])

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
    const minWH = spec.template === 'sticker' ? STICKER_MIN_SIZE : 30
    setW(clamp(spec.W, minWH, 250))
    setD(clamp(spec.D, 20, 150))
    setH(clamp(spec.H, minWH, 300))
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
    vents,
    stickerCut,
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
  }, [templateId, materialId, W, D, H, handle, qty, fillColor, fillImage, labelStyle, pouchStyle, zipper, pouchAddons, vents, stickerCut, decos])

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
    setVents(s.vents ?? DEFAULT_VENTS)
    setStickerCut(s.stickerCut ?? DEFAULT_STICKER_CUT)
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
      W: clamp(spec.W, spec.template === 'sticker' ? STICKER_MIN_SIZE : 30, 250),
      D: clamp(spec.D, 20, 150),
      H: clamp(spec.H, spec.template === 'sticker' ? STICKER_MIN_SIZE : 30, 300),
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
        ? sameSpec(p.live, liveSpec())
          && p.qty === qty
          && p.fillColor === fillColor
          && p.fillImage === fillImage
          && (p.labelStyle ?? 'body') === labelStyle
          && (p.pouchStyle ?? 'stand') === pouchStyle
          && Boolean(p.zipper) === zipper
          && samePouchAddons(p.pouchAddons, pouchAddons)
          && sameVents(p.vents, vents)
          && sameStickerCut(p.stickerCut, stickerCut)
          && p.decos === decos
          && p.history === history
          && p.histIdx === histIdx
            ? p
            : { ...p, live: liveSpec(), qty, fillColor, fillImage, labelStyle, pouchStyle, zipper, pouchAddons, vents, stickerCut: storedStickerCut(stickerCut), decos, history, histIdx, updatedAt: Date.now() }
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
    setVents(p.vents ?? DEFAULT_VENTS)
    setStickerCut(p.stickerCut ?? DEFAULT_STICKER_CUT)
    setDecos(p.decos)
    setSelectedIds([])
    setHistory(p.history)
    setHistIdx(p.histIdx)
    setFold(1)
  }

  useEffect(() => {
    if (!cloud) return
    return cloud.subscribeRemoteProject((project) => {
      setProjects([project])
      openProject(project)
    })
    // subscribeRemoteProject is stable for the lifetime of a cloud workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud?.subscribeRemoteProject])

  const switchProject = async (id: string) => {
    if (id === activeId || aiBusy || projectBusy) return
    if (cloud) {
      const current = flushInto(projects).find((project) => project.id === activeId)
      if (!current) return
      startProjectOperation('switch')
      try {
        const target = await cloud.switchProject(current, id)
        setProjects([target])
        openProject(target)
      } catch (error) {
        window.alert(error instanceof Error ? error.message : 'เปิดงานไม่สำเร็จ')
      } finally {
        setProjectOperation(null)
      }
      return
    }
    const target = projects.find((p) => p.id === id)
    if (!target) return
    setProjects((prev) => flushInto(prev))
    openProject(target)
  }

  const newProject = () => {
    if (aiBusy || projectBusy || (cloud && !cloud.online)) return
    setNameModal({
      title: 'ตั้งชื่องานใหม่',
      value: `งาน ${(cloud?.items.length ?? projects.length) + 1}`,
      onOk: (name) => {
        if (cloud) {
          const current = flushInto(projects).find((project) => project.id === activeId)
          if (!current) return
          startProjectOperation('create')
          void cloud.createProject(current, name).then((created) => {
            setProjects([created])
            openProject(created)
          }).catch((error: unknown) => {
            window.alert(error instanceof Error ? error.message : 'สร้างงานไม่สำเร็จ')
          }).finally(() => setProjectOperation(null))
          return
        }
        const p = freshProject(projects.length + 1)
        p.name = name.slice(0, 60) || p.name
        setProjects((prev) => [...flushInto(prev), p])
        openProject(p)
      },
    })
  }

  const deleteProject = (id: string) => {
    if (aiBusy || projectBusy || (cloud && !cloud.online)) return
    const victim = cloud?.items.find((project) => project.id === id) ?? projects.find((p) => p.id === id)
    if (!victim) return
    if (!window.confirm(`ลบงาน "${victim.name}" ทั้งงานรวมประวัติ?`)) return
    if (cloud) {
      const current = flushInto(projects).find((project) => project.id === activeId)
      if (!current) return
      startProjectOperation('delete')
      void cloud.deleteProject(current, id).then((next) => {
        setProjects([next])
        if (next.id !== activeId) openProject(next)
      }).catch((error: unknown) => {
        window.alert(error instanceof Error ? error.message : 'ลบงานไม่สำเร็จ')
      }).finally(() => setProjectOperation(null))
      return
    }
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
    if (!file || aiBusy || projectBusy || (cloud && !cloud.online)) return
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
    if (cloud) {
      const current = flushInto(projects).find((project) => project.id === activeId)
      if (!current) return
      startProjectOperation('import')
      try {
        const imported = await cloud.importProject(current, res.project)
        setProjects([imported])
        openProject(imported)
      } catch (error) {
        window.alert(error instanceof Error ? error.message : 'นำเข้างานขึ้น cloud ไม่สำเร็จ')
        return
      } finally {
        setProjectOperation(null)
      }
      if (res.warnings.length) {
        window.alert(`นำเข้าสำเร็จ แต่มีการปรับข้อมูลบางส่วน:\n• ${res.warnings.join('\n• ')}`)
      }
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

  const downloadSVG = async () => {
    if (!dieline) return
    const white = await whiteInkForExport()
    // แผ่นหลายดวง: ไม่ใส่เส้นเผื่อตัด 3 มม. ของดวงเดียว (ดวงเรียงชิดกันตามกติกาเว้น 2 มม. อยู่แล้ว)
    saveFile(
      dielineSVGString(exportDieline, showDims, decos, sheetOut ? null : guides, fillColor, fillImage, sheetOut, white),
      'image/svg+xml',
      'svg',
    )
  }

  // DXF คือไฟล์ที่โรงทำมีดไดคัทใช้จริง — มีแต่เลเยอร์ CUT/CREASE ไม่มีเส้นบอกขนาด
  const downloadDXF = () => {
    if (!dieline) return
    saveFile(dielineDXFString(exportDieline), 'application/dxf', 'dxf')
  }

  // PDF สเกล 1:1 สำหรับพิมพ์ตรวจ/ส่งโรงงาน — เลเยอร์ปิด-เปิดได้ใน Acrobat
  // ลายฝังเป็นภาพ 300 dpi (ไทยได้ ไม่ต้องฝังฟอนต์) ใต้เส้น cut/crease
  const downloadPDF = async () => {
    if (!dieline) return
    let art
    // รูปพื้น (ถ้ามี) baked เข้า raster เป็นชั้นล่างสุด — จึงไม่ต้องวาดสีพื้น vector ซ้ำ
    const base = fillImage ? { dieline, fillImage } : null
    let canvas = await renderArtworkCanvas(decos, dieline.width, dieline.height, 300, base)
    if (canvas && sheetOut) {
      // แผ่นหลายดวง: วางภาพลายดวงเดียวซ้ำตามตำแหน่ง (หมุนตามแผน) คลิปกรอบเส้นตัด + เผื่อสี
      const sc = 300 / 25.4
      const { layout, piece } = sheetOut
      const sheetC = document.createElement('canvas')
      sheetC.width = Math.round(layout.sheet.w * sc)
      sheetC.height = Math.round(layout.sheet.h * sc)
      const ctx = sheetC.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, sheetC.width, sheetC.height)
        const c = artClipBox(cutBox(piece))
        for (const pl of layout.placements) {
          ctx.save()
          ctx.scale(sc, sc)
          ctx.translate(pl.tx, pl.ty)
          if (pl.rot) ctx.rotate(Math.PI / 2)
          ctx.beginPath()
          ctx.rect(c.x0, c.y0, c.x1 - c.x0, c.y1 - c.y0)
          ctx.clip()
          ctx.drawImage(canvas, 0, 0, piece.width, piece.height)
          ctx.restore()
        }
        canvas = sheetC
      }
    }
    if (canvas) {
      const b64 = canvas.toDataURL('image/jpeg', 0.92).split(',')[1]
      const bin = atob(b64)
      const jpeg = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) jpeg[i] = bin.charCodeAt(i)
      art = { jpeg, w: canvas.width, h: canvas.height }
    }
    saveFile(
      dielinePDFBytes(
        exportDieline,
        showDims,
        art,
        sheetOut ? null : guides,
        fillImage ? null : fillColor,
        await whiteInkForExport(),
      ),
      'application/pdf',
      'pdf',
    )
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
      vents: kind === 'box' && template.supportsVents ? vents : undefined,
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
    if (cloud && !cloud.online) {
      window.alert('ต้องออนไลน์ก่อนเพิ่มรูปใหม่ งานแก้ไขอื่นยังเก็บเป็น draft ได้')
      return
    }
    if (cloud && file.type === 'image/svg+xml') {
      window.alert('Cloud ยังไม่รองรับ SVG ที่นำเข้า กรุณาแปลงเป็น PNG หรือ JPG ก่อน')
      return
    }
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
  const addPreset = async (p: Preset) => {
    if (!dieline) return
    if (cloud && !cloud.online) {
      window.alert('ต้องออนไลน์ก่อนเพิ่มลาย preset ใหม่')
      return
    }
    try {
      const src = cloud
        ? await rasterizeTrustedPreset(p.id, presetColor, p.aspect)
        : presetDataUrl(p.svg(presetColor))
      const el = { ...makeImageEl(dieline, src, p.aspect), preset: p.id, presetColor }
      setDecos((ds) => [...ds, el])
      setSelectedIds([el.id])
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'แปลงลาย preset ไม่สำเร็จ')
    }
  }

  const changePresetColor = async (targetId: string, presetId: string, hex: string) => {
    const preset = presetById(presetId)
    if (!preset) return
    if (cloud && !cloud.online) {
      window.alert('ต้องออนไลน์ก่อนเปลี่ยนสีลาย preset')
      return
    }
    try {
      const src = cloud
        ? await rasterizeTrustedPreset(preset.id, hex, preset.aspect)
        : presetDataUrl(preset.svg(hex))
      setDecos((current) => current.map((deco) => (
        deco.id === targetId && deco.type === 'image'
          ? { ...deco, presetColor: hex, src, aspect: preset.aspect }
          : deco
      )))
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'เปลี่ยนสีลาย preset ไม่สำเร็จ')
    }
  }

  // รูปพื้นแพ็กเกจ: โหลด+ย่อไฟล์เดียวกับโลโก้ แล้วตั้งเป็นพื้น (fit=cover ครอปพอดี blueprint)
  const addFillImage = async (file: File | undefined) => {
    if (!file) return
    if (cloud && !cloud.online) {
      window.alert('ต้องออนไลน์ก่อนเพิ่มรูปพื้นใหม่ งานแก้ไขอื่นยังเก็บเป็น draft ได้')
      return
    }
    if (cloud && file.type === 'image/svg+xml') {
      window.alert('Cloud ยังไม่รองรับ SVG ที่นำเข้า กรุณาแปลงเป็น PNG หรือ JPG ก่อน')
      return
    }
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

  // Pen tool: โหมดวาดเวกเตอร์ — กดปุ่มเข้าโหมด, วาดบน blueprint, เสร็จแล้วได้ path deco
  const [penMode, setPenMode] = useState(false)
  const startPen = () => {
    setSelectedIds([])
    setPenMode(true)
  }
  const addPath = (raw: RawAnchor[], closed: boolean) => {
    const el = makePathEl(raw, closed)
    if (!el) return
    setDecos((ds) => [...ds, el])
    setSelectedIds([el.id])
  }
  // แก้จุด path ทีละจุด (ลาก anchor/แขนโค้ง, เพิ่ม-ลบจุด)
  const editPath = (id: string, anchors: PathAnchor[]) =>
    setDecos((ds) => ds.map((d) => (d.id === id && d.type === 'path' ? { ...d, anchors } : d)))

  // เลื่อน/ซูมรูปในกรอบครอป (double-click แล้วลาก/สกอลล์) — เก็บ cropX/cropY (−1..1) + cropZoom (≥1)
  const cropDeco = (id: string, cropX: number, cropY: number, cropZoom: number) =>
    setDecos((ds) =>
      ds.map((d) =>
        d.id === id && d.type === 'image'
          ? { ...d, cropX, cropY, cropZoom: cropZoom > 1 ? cropZoom : undefined }
          : d,
      ),
    )

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

  // ย่อ-ขยายจากมือจับมุม — DielineSVG ส่งกรอบใหม่ (x,y,w,h) มาให้ แล้วปรับตามชนิดชิ้น
  const r1 = (v: number) => Math.round(v * 10) / 10
  const resizeDeco = (id: string, x: number, y: number, w: number, h: number) =>
    setDecos((ds) =>
      ds.map((d) => {
        if (d.id !== id) return d
        if (d.type === 'shape' || d.type === 'path') return { ...d, x, y, w: Math.max(2, r1(w)), h: Math.max(2, r1(h)) }
        if (d.type === 'nutrition') return { ...d, x, y, w: Math.max(20, r1(w)) }
        if (d.type === 'image') {
          if (lockAspect) {
            const nw = Math.max(5, r1(w))
            return { ...d, x, y, w: nw, h: r1(nw / d.aspect) }
          }
          return { ...d, x, y, w: Math.max(5, r1(w)), h: Math.max(5, r1(h)) }
        }
        if (d.type === 'text') {
          const cur = elH(d) || 1
          const size = clamp(Math.round((d.size * h) / cur), 3, 120)
          return withTextW({ ...d, size, x, y })
        }
        return d
      }),
    )

  // สัดส่วนที่ต้องล็อกตอนย่อ-ขยาย (รูปที่ล็อกสัดส่วน + ข้อความ) — null = ปรับอิสระ (รูปทรง/ตาราง)
  const resizeAspect =
    selected && selectedIds.length === 1
      ? selected.type === 'text' || (selected.type === 'image' && lockAspect)
        ? elW(selected) / (elH(selected) || 1)
        : null
      : null

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

  // สำเนาลาย/สีพื้นที่จำลองสีพิมพ์ CMYK ส่งให้ blueprint (ปิดอยู่ = ค่าเดิม)
  const proofed = useSoftProof(softProof, decos, fillColor, fillImage)
  // ความละเอียดรูปตามขนาดที่วางจริง — ป้ายเตือนบน blueprint, ค่าในแผงปรับแต่ง, และสรุปก่อนส่งออก
  const imgDpi = useImageDpi(decos, fillImage, dieline)
  const lowResMap = useMemo(
    () => new Map(imgDpi.low.filter((l) => l.id !== 'fill').map((l) => [l.id, l.dpi] as const)),
    [imgDpi],
  )
  const fillLowDpi = imgDpi.fillDpi != null && imgDpi.fillDpi < LOW_DPI ? imgDpi.fillDpi : null
  // ปุ่มเปิด/ปิด soft-proof — ส่งเข้าแถบเครื่องมือซ้ายบนของ blueprint; memo ไว้ไม่ให้ DielineSVG (memo) re-render ทุกรอบ
  const proofToggle = useMemo(
    () => (
      <button
        type="button"
        className={`proof-toggle${softProof ? ' on' : ''}`}
        aria-pressed={softProof}
        title={
          softProof
            ? `กำลังจำลองสีงานพิมพ์ CMYK (${CMYK_PROOF_PROFILE}) — สีที่หม่นลงคือสีที่หมึกพิมพ์ทำไม่ได้ · ไฟล์ส่งออกไม่เปลี่ยน`
            : 'จำลองสีเมื่อพิมพ์จริงด้วยหมึก CMYK — ดูว่าสีไหนจะหม่นลง (เฉพาะการแสดงผล)'
        }
        onClick={() => setSoftProof((v) => !v)}
      >
        <span className="proof-dots" aria-hidden>
          <i style={{ background: '#00a3e0' }} />
          <i style={{ background: '#d6007e' }} />
          <i style={{ background: '#f5e100' }} />
          <i style={{ background: '#222' }} />
        </span>
        {softProof ? 'พรีวิวสีพิมพ์ CMYK' : 'ดูสีแบบพิมพ์'}
      </button>
    ),
    [softProof],
  )

  // มุมมอง 3D (ใช้ซ้ำได้ทั้งจอเล็ก PiP และจอหลักในแท็บออกแบบ)
  // ป้ายขนาดบนมุมมอง 3D — ป้ายชื่อตามชนิดงาน (ภาชนะ W/D = เส้นผ่านศูนย์กลางตัว/ปาก)
  const dims3d: Dim3D[] =
    kind === 'vessel'
      ? [
          { label: '⌀ ตัว', mm: W },
          { label: '⌀ ปาก', mm: D },
          { label: 'สูง', mm: H },
        ]
      : [
          { label: 'กว้าง', mm: W },
          { label: 'ลึก', mm: D },
          { label: 'สูง', mm: H },
        ]
  // จอ 3D เล็กมุมจอ (PiP ในแท็บตกแต่ง/ส่งออก ที่ยังไม่ได้ขยาย): ซ่อนปุ่มและเส้นบอกขนาดให้เห็นโมเดลเต็ม ๆ
  // — กดขยายเป็นหน้าต่างใหญ่หรืออยู่แท็บออกแบบ (จอหลัก) ค่อยแสดง; โหมดแสงที่ตั้งไว้ยังมีผลเหมือนเดิม
  const pip3dCompact = sideTab !== 'design' && !expand3d
  const dims3dOn = showDims3d && !pip3dCompact ? dims3d : undefined
  const viewer3D = (
    <>
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
            dims={dims3dOn}
            imperial={imperial}
            dimVariant="lines"
            lightMode={lightMode3d}
          />
        ) : kind === 'vessel' ? (
          <VesselViewer3D vessel={vessel!} mat={mat} decos={decos} fillColor={fillColor} fillImage={fillImage} dims={dims3dOn} imperial={imperial} lightMode={lightMode3d} />
        ) : (
          <PouchViewer3D pouch={pouch!} mat={mat} decos={decos} fillColor={fillColor} fillImage={fillImage} dims={dims3dOn} imperial={imperial} dimVariant="lines" lightMode={lightMode3d} />
        )}
      </Suspense>
      {!pip3dCompact && (
      <div className="viewer3d-tools">
        <button
          type="button"
          className={`dim3d-toggle${showDims3d ? ' on' : ''}`}
          aria-pressed={showDims3d}
          title={showDims3d ? 'ซ่อนขนาดบนโมเดล' : 'แสดงขนาดบนโมเดล'}
          onClick={() => setShowDims3d((v) => !v)}
        >
          <span className="dim3d-toggle-ic" aria-hidden>
            ⟺
          </span>
          ขนาด
        </button>
        <button
          type="button"
          className={`light3d-toggle${vivid3d ? ' on' : ''}`}
          aria-pressed={vivid3d}
          title={vivid3d ? 'ปิดแสงสด (โทนฟิล์มนุ่ม)' : 'เปิดแสงสด (สีสด/สว่างขึ้น)'}
          onClick={() => setVivid3d((v) => !v)}
        >
          <span className="light3d-toggle-ic" aria-hidden>
            ☀
          </span>
          แสงสด
        </button>
        {vivid3d && (
          <div className="light-rig" role="group" aria-label="รูปแบบแสง">
            {(
              [
                ['studio', 'สตูดิโอ', 'แสงฟุ้งรอบด้าน เงาน้อย — เช็กลาย/สีได้ทุกด้าน'],
                ['threePoint', '3 จุด', 'ไฟหลัก + ไฟเติม + ไฟส่องขอบ — มีมิติแบบภาพโฆษณาสินค้า'],
              ] as const
            ).map(([id, label, tip]) => (
              <button
                key={id}
                type="button"
                className={lightRig3d === id ? 'on' : ''}
                aria-pressed={lightRig3d === id}
                title={tip}
                onClick={() => setLightRig3d(id)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      )}
    </>
  )
  // แท็บ "ออกแบบ" = โชว์ 3D ของแพ็กเกจเป็นจอหลัก (แทน blueprint)
  const design3D = sideTab === 'design'
  const renderStepTabs = (className: string) => (
    <div className={`tabbar ${className}`} role="tablist" aria-label={t('ขั้นตอนงาน', 'Workflow steps')}>
      {(
        [
          ['design', t('ออกแบบ', 'Design')],
          ['artwork', t('ตกแต่ง', 'Decorate')],
          ['export', t('ส่งออก', 'Export')],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          role="tab"
          className={`tab${sideTab === id ? ' active' : ''}`}
          aria-selected={sideTab === id}
          onClick={() => {
            setSideTab(id)
            if (className === 'mobile-tabbar') {
              requestAnimationFrame(() => {
                const aside = asideRef.current
                const header = headerRef.current
                if (!aside || !header) return
                aside.scrollTop = 0
                window.scrollTo({ top: window.scrollY + aside.getBoundingClientRect().top - header.getBoundingClientRect().height - 8 })
              })
            }
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )

  return (
    <LangCtx.Provider value={lang}>
    <div className="app">
      <header ref={headerRef}>
        <h1>PackIt</h1>
        <ProjectGallery
          items={cloud?.items ?? projects}
          activeId={activeId}
          activeProject={projects.find((project) => project.id === activeId)}
          busy={aiBusy || projectBusy}
          createDisabled={aiBusy || projectBusy || (cloud !== undefined && !cloud.online)}
          deleteDisabled={aiBusy || projectBusy || (cloud !== undefined && !cloud.online)}
          onCreate={newProject}
          onSwitch={(id) => void switchProject(id)}
          onRename={renameProject}
          onDelete={deleteProject}
        />
        {cloud && (
          <div className="cloud-save-wrap">
            <span
              className={`cloud-save-state ${projectOperationLabel ? 'saving' : cloud.saveState}`}
              title={projectOperationLabel || 'สถานะบันทึก cloud'}
              role={projectOperationLabel ? 'status' : undefined}
              aria-live={projectOperationLabel ? 'polite' : undefined}
            >
              {projectOperationLabel || cloudSaveLabel(cloud.saveState)}
            </span>
            {cloud.saveState === 'conflict' && (
              <>
                <button
                  className="cloud-conflict-btn"
                  disabled={projectBusy || !cloud.online}
                  onClick={() => {
                    const current = flushInto(projects).find((project) => project.id === activeId)
                    if (!current || !window.confirm('ทิ้ง draft ในแท็บนี้แล้วโหลด cloud ล่าสุด?')) return
                    startProjectOperation('reload')
                    void cloud.resolveConflict(current, 'reload').then((resolved) => {
                      setProjects([resolved])
                      openProject(resolved)
                    }).catch((error: unknown) => {
                      window.alert(error instanceof Error ? error.message : 'โหลด cloud ล่าสุดไม่สำเร็จ')
                    }).finally(() => setProjectOperation(null))
                  }}
                >โหลดล่าสุด</button>
                <button
                  className="cloud-conflict-btn"
                  disabled={projectBusy || !cloud.online}
                  onClick={() => {
                    const current = flushInto(projects).find((project) => project.id === activeId)
                    if (!current) return
                    startProjectOperation('copy')
                    void cloud.resolveConflict(current, 'copy').then((resolved) => {
                      setProjects([resolved])
                      openProject(resolved)
                    }).catch((error: unknown) => {
                      window.alert(error instanceof Error ? error.message : 'บันทึกเป็นสำเนาไม่สำเร็จ')
                    }).finally(() => setProjectOperation(null))
                  }}
                >เก็บเป็นสำเนา</button>
              </>
            )}
            {cloud.saveState === 'error' && (
              <button
                className="cloud-conflict-btn"
                disabled={projectBusy || !cloud.online}
                onClick={() => void cloud.retrySave()}
              >ลองอีกครั้ง</button>
            )}
          </div>
        )}
        <PromptBar
          current={{ template: templateId, materialId, W, D, H, handle }}
          hasDesign={history.length > 0}
          onApply={applySpec}
          onLoadingChange={setAiBusy}
          apiKeyRequired={Boolean(cloud)}
          requestSpec={cloud?.requestAiSpec}
        />
        <button
          className="lang-btn"
          title={lang === 'en' ? 'เปลี่ยนเป็นภาษาไทย' : 'Switch to English'}
          aria-label="Toggle language / สลับภาษา"
          onClick={() => setLang((l) => (l === 'en' ? 'th' : 'en'))}
        >
          {lang === 'en' ? 'ไทย' : 'EN'}
        </button>
        <button
          className="theme-btn"
          title={t('สลับเป็นโหมดมืด', 'Switch to dark mode')}
          aria-label={t('สลับธีมสว่าง/มืด', 'Toggle light/dark theme')}
          aria-pressed={dark}
          onClick={() => setDark((d) => !d)}
        >
          {dark ? '☀' : '☾'}
        </button>
        {onLogout && (
          <button
            className="logout-btn"
            title={t('ออกจากระบบ','Sign out')}
            aria-label={t('ออกจากระบบ','Sign out')}
            disabled={projectBusy}
            onClick={() => {
              const current = flushInto(projects).find((project) => project.id === activeId)
              startProjectOperation('logout')
              void (async () => {
                if (cloud && current) await cloud.beforeLogout(current)
                await onLogout()
              })().catch((error: unknown) => {
                window.alert(error instanceof Error ? error.message : 'ออกจากระบบไม่สำเร็จ')
              }).finally(() => setProjectOperation(null))
            }}
          >
            <LogOut size={16} aria-hidden="true" />
            <span>{t('ออกจากระบบ','Sign out')}</span>
          </button>
        )}
        {renderStepTabs('mobile-tabbar')}
        {projectOperationLabel && (
          <div className="project-progress" role="progressbar" aria-label={projectOperationLabel}>
            <span className="project-progress-beat" />
            <span className="project-progress-beat" />
            <span className="project-progress-beat" />
          </div>
        )}
      </header>
      <div className="body">
        <aside ref={asideRef}>
          {renderStepTabs('aside-tabbar')}

          {sideTab === 'design' && (
          <>
          <Group title={t('ประเภทงาน', 'Job type')} open={groups.mode} onToggle={() => toggleGroup('mode')}>
            <div className="pick-list">
              <button
                className={`pick-item mode${kind === 'box' && !isCard && !isSticker ? ' active' : ''}`}
                disabled={aiBusy}
                aria-pressed={kind === 'box' && !isCard && !isSticker}
                onClick={() => {
                  if (kind !== 'box' || isSticker) changeMaterial('carton-300')
                  if (templateId === 'card' || templateId === 'sticker') changeTemplate('tuck-end')
                }}
              >
                <span className="mode-ic">
                  <IconBox size={20} />
                </span>
                <span className="pick-body">
                  <span className="pick-name">{t('กล่องพับ', 'Folding box')}</span>
                  <span className="pick-detail">{t('เครื่องสำอาง · อาหาร/ขนม · ส่งของออนไลน์', 'Cosmetics · food/snacks · e-commerce')}</span>
                </span>
              </button>
              <button
                className={`pick-item mode${kind === 'vessel' && !isTube ? ' active' : ''}`}
                disabled={aiBusy}
                aria-pressed={kind === 'vessel' && !isTube}
                onClick={() => {
                  if (kind !== 'vessel' || isTube) changeMaterial('pet-bottle')
                }}
              >
                <span className="mode-ic">
                  <IconBottle size={20} />
                </span>
                <span className="pick-body">
                  <span className="pick-name">{t('ภาชนะ + ฉลาก', 'Vessel + label')}</span>
                  <span className="pick-detail">{t('น้ำดื่ม/เครื่องดื่ม · ครีม/โลชั่น · อาหารในโหล', 'Drinks/beverages · cream/lotion · jarred food')}</span>
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
                  <span className="pick-name">{t('ถุงฟิล์ม (ตั้งได้)', 'Film pouch (stand-up)')}</span>
                  <span className="pick-detail">{t('กาแฟ/ชา · ขนม/ของแห้ง · ผงชง/อาหารเสริม', 'Coffee/tea · snacks/dry goods · drink mixes')}</span>
                </span>
              </button>
              <button
                className={`pick-item mode${isTube ? ' active' : ''}`}
                disabled={aiBusy}
                aria-pressed={isTube}
                onClick={() => {
                  if (!isTube) {
                    changeMaterial('tube-laminate')
                    // หลอดครีมทรงชะลูด — ตั้งสัดส่วนเริ่มต้นให้ดูเป็นหลอด ไม่ใช่กระปุก
                    setW(40)
                    setD(20)
                    setH(150)
                  }
                }}
              >
                <span className="mode-ic">
                  <IconTube size={20} />
                </span>
                <span className="pick-body">
                  <span className="pick-name">{t('หลอดครีม (tube)', 'Cosmetic tube')}</span>
                  <span className="pick-detail">{t('ครีม/โลชั่น · ยาสีฟัน · เจล/ยาทา', 'Cream/lotion · toothpaste · gel/topical')}</span>
                </span>
              </button>
              <button
                className={`pick-item mode${isCard ? ' active' : ''}`}
                disabled={aiBusy}
                aria-pressed={isCard}
                onClick={() => {
                  if (kind !== 'box' || materialId.startsWith('sticker-')) changeMaterial('carton-300')
                  changeTemplate('card')
                }}
              >
                <span className="mode-ic">
                  <IconCard size={20} />
                </span>
                <span className="pick-body">
                  <span className="pick-name">{t('นามบัตร', 'Business card')}</span>
                  <span className="pick-detail">{t('นามบัตร · การ์ดสะสม · คูปอง/การ์ดเชิญ', 'Business cards · collectible cards · coupons/invites')}</span>
                </span>
              </button>
              <button
                className={`pick-item mode${isSticker ? ' active' : ''}`}
                disabled={aiBusy}
                aria-pressed={isSticker}
                onClick={() => {
                  if (!materialId.startsWith('sticker-')) changeMaterial('sticker-vinyl')
                  changeTemplate('sticker')
                }}
              >
                <span className="mode-ic">
                  <IconSticker size={20} />
                </span>
                <span className="pick-body">
                  <span className="pick-name">{t('สติกเกอร์', 'Sticker')}</span>
                  <span className="pick-detail">{t('ฉลากสินค้า · โลโก้แบรนด์ · สติกเกอร์ตกแต่ง', 'Product labels · brand logos · decorative stickers')}</span>
                </span>
              </button>
            </div>
          </Group>

          {mat.foldable && !isCard && !isSticker && (
            <Group title={t('รูปแบบบรรจุภัณฑ์', 'Package style')} open={groups.tpl} onToggle={() => toggleGroup('tpl')}>
              <div className="pick-list">
                {TEMPLATES.filter((tp) => tp.id !== 'card' && tp.id !== 'sticker').map((tp) => (
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
            <Group title={t('รูปแบบถุง', 'Pouch style')} open={groups.label} onToggle={() => toggleGroup('label')}>
              <div className="pick-list">
                {POUCH_STYLES.filter((s) => s.id !== 'box').map((s) => (
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
            title={
              isCard
                ? t('กระดาษนามบัตร', 'Card stock')
                : isSticker
                  ? t('วัสดุสติกเกอร์', 'Sticker material')
                  : isTube
                    ? t('วัสดุหลอด', 'Tube material')
                    : kind === 'box'
                      ? t('วัสดุกล่อง', 'Box material')
                      : kind === 'pouch'
                        ? t('ชนิดถุง', 'Pouch type')
                        : t('ชนิดภาชนะ', 'Vessel type')
            }
            open={groups.mat}
            onToggle={() => toggleGroup('mat')}
          >
            <div className="pick-list">
              {MATERIALS.filter((m) => {
                if (packKind(m) !== kind) return false
                const sticker = m.id.startsWith('sticker-')
                const tube = m.form === 'tube'
                // นามบัตรใช้กระดาษการ์ดเท่านั้น (ไม่ใช่ลูกฟูก/พลาสติกใส/สติกเกอร์)
                if (isCard) return m.id === 'carton-300' || m.id === 'carton-400' || m.id === 'kraft-350'
                if (isSticker) return sticker // สติกเกอร์โชว์เฉพาะวัสดุสติกเกอร์
                if (isTube) return tube // หลอดครีมโชว์เฉพาะวัสดุหลอด
                // กล่อง/ภาชนะทั่วไปไม่ปนวัสดุสติกเกอร์/หลอด
                return !sticker && !tube
              }).map((m) => (
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
            <Group title={t('รูปแบบฉลาก', 'Label style')} open={groups.label} onToggle={() => toggleGroup('label')}>
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

          {isSticker && (
            <Group title={t('ไดคัท', 'Die cut')} open={groups.label} onToggle={() => toggleGroup('label')}>
              <div className="unit-toggle sticker-seg" role="group" aria-label={t('รูปทรงไดคัท', 'Cut shape')}>
                <button
                  type="button"
                  className={stickerCut.shape === 'rect' ? 'active' : ''}
                  aria-pressed={stickerCut.shape === 'rect'}
                  disabled={aiBusy}
                  onClick={() => setStickerCut({ ...stickerCut, shape: 'rect' })}
                >
                  {t('สี่เหลี่ยมมุมมน', 'Rounded rect')}
                </button>
                <button
                  type="button"
                  className={stickerCut.shape === 'contour' ? 'active' : ''}
                  aria-pressed={stickerCut.shape === 'contour'}
                  disabled={aiBusy}
                  onClick={() => setStickerCut({ ...stickerCut, shape: 'contour' })}
                >
                  {t('ตามรูป', 'Follow artwork')}
                </button>
              </div>
              {stickerCut.shape === 'contour' && (
                <>
                  <div className="unit-toggle sticker-seg" role="group" aria-label={t('ขอบ', 'Border')}>
                    <button
                      type="button"
                      className={stickerCut.border === 'white' ? 'active' : ''}
                      aria-pressed={stickerCut.border === 'white'}
                      disabled={aiBusy}
                      onClick={() => setStickerCut({ ...stickerCut, border: 'white' })}
                    >
                      {t('มีขอบขาว', 'White border')}
                    </button>
                    <button
                      type="button"
                      className={stickerCut.border === 'none' ? 'active' : ''}
                      aria-pressed={stickerCut.border === 'none'}
                      disabled={aiBusy}
                      onClick={() => setStickerCut({ ...stickerCut, border: 'none' })}
                    >
                      {t('ไม่มีขอบขาว', 'No border')}
                    </button>
                  </div>
                  {stickerCut.border === 'white' && (
                    <DimField
                      imperial={imperial}
                      label={t('ความกว้างขอบขาว', 'Border width')}
                      value={stickerCut.offset}
                      min={STICKER_OFFSET_MIN}
                      max={STICKER_OFFSET_MAX}
                      disabled={aiBusy}
                      onChange={(v) => setStickerCut({ ...stickerCut, offset: v })}
                    />
                  )}
                  <p className="hint">
                    {contourStatus === 'no-art'
                      ? t(
                          'ยังไม่มีลายบนแผ่น — วางรูป (แนะนำ PNG พื้นใส) หรือข้อความในแท็บตกแต่ง ระบบจะสร้างเส้นตัดตามรูปให้เอง ระหว่างนี้ใช้สี่เหลี่ยมไปก่อน',
                          'No artwork yet — add an image (transparent PNG works best) or text in Decorate and the cut line will follow it; a rectangle is used meanwhile',
                        )
                      : contourStatus === 'pending'
                        ? t('กำลังสร้างเส้นตัดตามรูป…', 'Tracing the cut line…')
                        : contourStatus === 'empty'
                          ? stickerCut.border === 'none'
                            ? t(
                                `ลายบางเกินไปสำหรับแบบไม่มีขอบขาว — ตัดเข้าเนื้อ ${NO_BORDER_INSET} มม. แล้วไม่เหลือชิ้นที่ตัดได้ (เส้นที่บางกว่า ~2 มม. หายหมด) ลองใช้แบบมีขอบขาว หรือขยาย/หนาลาย`,
                                `Artwork too thin for no-border — after cutting ${NO_BORDER_INSET} mm inside nothing is left (strokes under ~2 mm vanish); use a white border or enlarge/thicken the art`,
                              )
                            : t('ลายเล็กเกินไป ไม่พบชิ้นที่ตัดได้ — ขยายลาย', 'Artwork too small to cut — enlarge it')
                          : stickerCut.border === 'white'
                        ? t(
                            `เส้นตัดห่างขอบลาย ${stickerCut.offset} มม. รอบตัว (ขั้นต่ำ ${STICKER_RULES.minBorder} มม.) มุมโค้งมนให้ตัดสวย`,
                            `Cut runs ${stickerCut.offset} mm outside the artwork (min ${STICKER_RULES.minBorder} mm), corners rounded`,
                          )
                        : t(
                            `ตัดเข้าในเนื้อลาย ${NO_BORDER_INSET} มม. — สีจึงเลยเส้นตัดออกไปพอดีเงื่อนไขเผื่อสี ≥${STICKER_RULES.minBleed} มม. (ส่วนที่บางกว่า 2 มม. อาจหาย)`,
                            `Cut sits ${NO_BORDER_INSET} mm inside the artwork so colour runs past it (bleed ≥${STICKER_RULES.minBleed} mm); parts thinner than 2 mm may drop out`,
                          )}
                  </p>
                </>
              )}
              <StickerIssues issues={stickerIssues} />
            </Group>
          )}

          {isSticker && (
            <Group title={t('แผ่นสติกเกอร์', 'Sticker sheet')} open={groups.label} onToggle={() => toggleGroup('label')}>
              <div className="unit-toggle sticker-seg" role="group" aria-label={t('ขนาดแผ่น', 'Sheet size')}>
                <button
                  type="button"
                  className={!stickerCut.sheet ? 'active' : ''}
                  aria-pressed={!stickerCut.sheet}
                  disabled={aiBusy}
                  onClick={() => updateSheet({ sheet: undefined, perSheet: undefined })}
                >
                  {t('ดวงเดียว', 'Single')}
                </button>
                {STICKER_SHEETS.map((sh) => (
                  <button
                    key={sh.id}
                    type="button"
                    className={stickerCut.sheet === sh.id ? 'active' : ''}
                    aria-pressed={stickerCut.sheet === sh.id}
                    disabled={aiBusy}
                    onClick={() => updateSheet({ sheet: sh.id })}
                  >
                    {sh.nameTh}
                  </button>
                ))}
                <button
                  type="button"
                  className={stickerCut.sheet === 'custom' ? 'active' : ''}
                  aria-pressed={stickerCut.sheet === 'custom'}
                  disabled={aiBusy}
                  onClick={() => updateSheet({ sheet: 'custom' })}
                >
                  {t('กำหนดเอง', 'Custom')}
                </button>
              </div>
              {stickerCut.sheet === 'custom' && (
                <>
                  <DimField
                    imperial={imperial}
                    label={t('กว้างแผ่น', 'Sheet width')}
                    value={stickerCut.sheetW ?? DEFAULT_CUSTOM_SHEET.w}
                    min={CUSTOM_SHEET_MIN}
                    max={CUSTOM_SHEET_MAX}
                    disabled={aiBusy}
                    onChange={(v) => updateSheet({ sheetW: v })}
                  />
                  <DimField
                    imperial={imperial}
                    label={t('ยาวแผ่น', 'Sheet height')}
                    value={stickerCut.sheetH ?? DEFAULT_CUSTOM_SHEET.h}
                    min={CUSTOM_SHEET_MIN}
                    max={CUSTOM_SHEET_MAX}
                    disabled={aiBusy}
                    onChange={(v) => updateSheet({ sheetH: v })}
                  />
                  <div className="sheet-presets">
                    {[
                      { label: 'SRA3', w: 320, h: 450 },
                      { label: 'SRA4', w: 225, h: 320 },
                      { label: '13×19″', w: 330, h: 483 },
                    ].map((pz) => (
                      <button
                        key={pz.label}
                        type="button"
                        disabled={aiBusy}
                        onClick={() => updateSheet({ sheetW: pz.w, sheetH: pz.h })}
                      >
                        {pz.label} <span>{pz.w}×{pz.h}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {stickerCut.sheet && (
                <DimField
                  imperial={imperial}
                  label={t('ขอบแผ่น (ตามโรงพิมพ์)', 'Sheet margin (per printer)')}
                  value={sheetMargin}
                  min={0}
                  max={SHEET_MARGIN_MAX}
                  disabled={aiBusy}
                  onChange={(v) => updateSheet({ sheetMargin: v === SHEET_MARGIN ? undefined : v })}
                />
              )}
              {sheetLayout && (
                <>
                  <div className="unit-toggle sticker-seg" role="group" aria-label={t('วิธีกำหนด', 'Sizing')}>
                    <button
                      type="button"
                      className={!stickerCut.perSheet ? 'active' : ''}
                      aria-pressed={!stickerCut.perSheet}
                      disabled={aiBusy}
                      onClick={() => updateSheet({ perSheet: undefined })}
                    >
                      {t('กำหนดขนาด', 'Set size')}
                    </button>
                    <button
                      type="button"
                      className={stickerCut.perSheet ? 'active' : ''}
                      aria-pressed={!!stickerCut.perSheet}
                      disabled={aiBusy}
                      onClick={() => updateSheet({ perSheet: Math.max(1, sheetLayout.count || 1) })}
                    >
                      {t('กำหนดจำนวน', 'Set count')}
                    </button>
                  </div>
                  {!!stickerCut.perSheet && (
                    <PerSheetField
                      value={stickerCut.perSheet}
                      disabled={aiBusy}
                      onCommit={(n) => updateSheet({ perSheet: n })}
                      label={t('จำนวนต่อแผ่น', 'Stickers per sheet')}
                      unit={t('ดวง', 'pcs')}
                    />
                  )}
                  {perSheetErr && (
                    <div className="sticker-issues has-err" role="alert">
                      {t(
                        `ใส่ ${stickerCut.perSheet} ดวงไม่ได้ — ดวงจะเล็กกว่า ${STICKER_MIN_SIZE} มม. (หรือขอบขาวกว้างเกินช่อง) ลดจำนวน หรือเลือกแผ่นใหญ่ขึ้น`,
                        `Can't fit ${stickerCut.perSheet} — stickers would be under ${STICKER_MIN_SIZE} mm (or the border is too wide); lower the count or pick a bigger sheet`,
                      )}
                    </div>
                  )}
                  {!perSheetErr && !!stickerCut.perSheet && sheetLayout.count < stickerCut.perSheet && (
                    <div className="sticker-issues" role="alert">
                      {t(
                        `ตอนนี้ได้ ${sheetLayout.count} จาก ${stickerCut.perSheet} ดวง (ลายถูกแก้หลังจัดขนาด) — `,
                        `Currently ${sheetLayout.count} of ${stickerCut.perSheet} fit (artwork changed after sizing) — `,
                      )}
                      <button type="button" className="link-btn" onClick={() => updateSheet({})}>
                        {t('จัดขนาดใหม่', 'Resize again')}
                      </button>
                    </div>
                  )}
                </>
              )}
              {!sheetLayout ? (
                <p className="hint">
                  {t(
                    'เลือกขนาดแผ่นเพื่อเรียงสติกเกอร์ดวงนี้ซ้ำเต็มแผ่นอัตโนมัติ (แบบแผ่นสติกเกอร์ไดคัท) — ไฟล์ส่งออกจะเป็นทั้งแผ่น',
                    'Pick a sheet size to repeat this sticker across a kiss-cut sheet automatically — exports become the whole sheet',
                  )}
                </p>
              ) : sheetLayout.count === 0 ? (
                <div className="sticker-issues has-err" role="alert">
                  {t(
                    `ดวงใหญ่เกินแผ่น ${sheetLayout.sheet.nameTh} (${sheetLayout.sheet.w}×${sheetLayout.sheet.h} มม. เว้นขอบ ${sheetMargin} มม.) — ลดขนาดสติกเกอร์ ลดขอบแผ่น หรือเลือกแผ่นใหญ่ขึ้น`,
                    `Sticker is larger than ${sheetLayout.sheet.nameTh} (${sheetLayout.sheet.w}×${sheetLayout.sheet.h} mm, ${sheetMargin} mm margin) — shrink it, reduce the margin or pick a bigger sheet`,
                  )}
                </div>
              ) : (
                <>
                  <StickerSheetPreview
                    layout={sheetLayout}
                    sheetDieline={exportDieline}
                    piece={dieline}
                    thumb={stickerThumb}
                    fillColor={fillImage ? null : fillColor}
                  />
                  <div className="sheet-stats">
                    <b>
                      {t(
                        `${sheetLayout.count} ดวง/แผ่น ${sheetLayout.sheet.nameTh}`,
                        `${sheetLayout.count} per ${sheetLayout.sheet.nameTh} sheet`,
                      )}
                    </b>
                    <span>
                      {t('ดวงละ', 'each')} {fmtMm(cutBox(dieline).x1 - cutBox(dieline).x0)}×
                      {fmtMm(cutBox(dieline).y1 - cutBox(dieline).y0)} {t('มม.', 'mm')} · {sheetLayout.cols}×{sheetLayout.rows}
                      {sheetLayout.rotated ? t(' · หมุน 90°', ' · rotated 90°') : ''}
                      {sheetLayout.sheet.perA3 > 1 &&
                        ' · ' +
                          t(
                            `A3 1 แผ่น = ${sheetLayout.sheet.perA3} แผ่น = ${sheetLayout.count * sheetLayout.sheet.perA3} ดวง`,
                            `1 A3 = ${sheetLayout.sheet.perA3} sheets = ${sheetLayout.count * sheetLayout.sheet.perA3} stickers`,
                          )}
                    </span>
                    <span>
                      {t(
                        `สั่ง ${qty.toLocaleString('th-TH')} ดวง → ${stickerSheetsNeeded(qty, sheetLayout.count).toLocaleString('th-TH')} แผ่น ${sheetLayout.sheet.nameTh}` +
                          (sheetLayout.sheet.perA3 > 1
                            ? ` (≈ ${Math.ceil(stickerSheetsNeeded(qty, sheetLayout.count) / sheetLayout.sheet.perA3).toLocaleString('th-TH')} แผ่น A3)`
                            : ''),
                        `${qty.toLocaleString('en-US')} stickers → ${stickerSheetsNeeded(qty, sheetLayout.count).toLocaleString('en-US')} ${sheetLayout.sheet.nameTh} sheets` +
                          (sheetLayout.sheet.perA3 > 1
                            ? ` (≈ ${Math.ceil(stickerSheetsNeeded(qty, sheetLayout.count) / sheetLayout.sheet.perA3).toLocaleString('en-US')} A3)`
                            : ''),
                      )}
                    </span>
                  </div>
                  <p className="hint">
                    {t(
                      `เส้นตัดแต่ละดวงห่างกัน ${SHEET_GAP} มม. · ห่างขอบแผ่น ${sheetMargin} มม. · ไฟล์ PDF/SVG/DXF ที่ดาวน์โหลดเป็นทั้งแผ่น`,
                      `Cut lines ${SHEET_GAP} mm apart · ${sheetMargin} mm from the sheet edge · PDF/SVG/DXF downloads contain the whole sheet`,
                    )}
                  </p>
                </>
              )}
            </Group>
          )}

          {sizeFloatEl && createPortal(
          <Group
            title={
              kind === 'box'
                ? templateId === 'card'
                  ? t('ขนาดนามบัตร', 'Card size')
                  : templateId === 'sticker'
                    ? t('ขนาดสติกเกอร์', 'Sticker size')
                    : t('ขนาดกล่อง (ด้านใน)', 'Box size (inside)')
                : kind === 'pouch'
                  ? t('ขนาดถุง', 'Pouch size')
                  : isTube
                    ? t('ขนาดหลอด', 'Tube size')
                    : t('ขนาดภาชนะ', 'Vessel size')
            }
            open={groups.size}
            onToggle={() => toggleGroup('size')}
          >
            <div className="unit-toggle" role="group" aria-label={t('หน่วยวัด', 'Unit')}>
              <button
                type="button"
                className={!imperial ? 'active' : ''}
                aria-pressed={!imperial}
                onClick={() => setUnit('mm')}
              >
                {t('มม.', 'mm')}
              </button>
              <button
                type="button"
                className={imperial ? 'active' : ''}
                aria-pressed={imperial}
                onClick={() => setUnit('in')}
              >
                {t('นิ้ว', 'inch')}
              </button>
            </div>
            <DimField
              imperial={imperial}
              label={
                kind === 'box'
                  ? t('กว้าง W', 'Width W')
                  : kind === 'pouch'
                    ? pouchStyle === 'flat'
                      ? t('กว้างซอง W', 'Sachet width W')
                      : pouchStyle === 'gusset' || pouchStyle === 'box'
                        ? t('กว้างหน้า W', 'Front width W')
                        : pouchStyle === 'pillow'
                          ? t('กว้าง W', 'Width W')
                          : t('กว้างถุง W', 'Pouch width W')
                    : t('⌀ ตัว W', '⌀ body W')
              }
              value={W}
              min={isSticker ? STICKER_MIN_SIZE : 30}
              max={250}
              disabled={aiBusy || perSheetLocked}
              onChange={setW}
            />
            {/* ซองแบน/หลังกลางไม่มีก้น-จีบ, นามบัตร/สติกเกอร์เป็นแผ่นแบน → ซ่อนช่อง D */}
            {!(kind === 'pouch' && (pouchStyle === 'flat' || pouchStyle === 'pillow')) &&
              !(kind === 'box' && (templateId === 'card' || templateId === 'sticker')) && (
              <DimField
                imperial={imperial}
                label={
                  kind === 'box'
                    ? t('ลึก D', 'Depth D')
                    : kind === 'pouch'
                      ? pouchStyle === 'gusset' || pouchStyle === 'box'
                        ? t('จีบข้าง D', 'Side gusset D')
                        : t('ลึกก้น D', 'Bottom depth D')
                      : t('⌀ ปาก/คอ D', '⌀ mouth/neck D')
                }
                value={D}
                min={20}
                max={150}
                disabled={aiBusy}
                onChange={setD}
              />
            )}
            <DimField
              imperial={imperial}
              label={kind === 'pouch' ? t('สูงลำตัว H', 'Body height H') : t('สูง H', 'Height H')}
              value={H}
              min={isSticker ? STICKER_MIN_SIZE : 30}
              max={300}
              disabled={aiBusy || perSheetLocked}
              onChange={setH}
            />
            {perSheetLocked && (
              <p className="hint">
                {t(
                  `ขนาดถูกกำหนดจากจำนวน ${stickerCut.perSheet} ดวงต่อแผ่น — เปลี่ยนเป็น "กำหนดขนาด" ในกลุ่มแผ่นสติกเกอร์เพื่อแก้เอง`,
                  `Size is set by ${stickerCut.perSheet} per sheet — switch to "Set size" in Sticker sheet to edit`,
                )}
              </p>
            )}
            {capacityMl != null && (
              <div className="capacity">
                <span className="capacity-label">{t('ความจุโดยประมาณ', 'Est. capacity')}</span>
                <span className="capacity-value">{formatCapacity(capacityMl, imperial)}</span>
              </div>
            )}
            {mat.foldable && template.supportsHandle && (
              <label className="check" style={{ marginTop: 12 }}>
                <input
                  type="checkbox"
                  checked={handle}
                  disabled={aiBusy}
                  onChange={(e) => setHandle(e.target.checked)}
                />
                {t('เจาะรูหิ้ว (die-cut handle)', 'Die-cut handle')}
              </label>
            )}
            {mat.foldable && kind === 'box' && template.supportsVents && (
              <div className="vent-block" style={{ marginTop: 12 }}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={vents.on}
                    disabled={aiBusy}
                    onChange={(e) => setVents((v) => ({ ...v, on: e.target.checked }))}
                  />
                  {t('รูระบายอากาศ (ผลไม้/ผัก)', 'Vent holes (produce)')}
                </label>
                {vents.on && (
                  <div className="vent-opts">
                    <div className="vent-walls" role="group" aria-label={t('ผนังที่เจาะรู', 'Walls to vent')}>
                      {(
                        [
                          ['sides', t('ด้านกว้าง', 'Wide sides')],
                          ['ends', t('หัวท้าย', 'Ends')],
                          ['all', t('ทุกด้าน', 'All sides')],
                        ] as [VentWalls, string][]
                      ).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          className={vents.walls === id ? 'active' : ''}
                          aria-pressed={vents.walls === id}
                          disabled={aiBusy}
                          onClick={() => setVents((v) => ({ ...v, walls: id }))}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <DimField
                      label={t('⌀ ขนาดรู (mm)', '⌀ hole size (mm)')}
                      value={vents.dia}
                      min={VENT_DIA_MIN}
                      max={VENT_DIA_MAX}
                      disabled={aiBusy}
                      onChange={(n) => setVents((v) => ({ ...v, dia: n }))}
                    />
                    <DimField
                      label={t('แถว', 'Rows')}
                      value={vents.rows}
                      min={1}
                      max={VENT_ROWS_MAX}
                      disabled={aiBusy}
                      onChange={(n) => setVents((v) => ({ ...v, rows: n }))}
                    />
                    <DimField
                      label={t('คอลัมน์', 'Columns')}
                      value={vents.cols}
                      min={1}
                      max={VENT_COLS_MAX}
                      disabled={aiBusy}
                      onChange={(n) => setVents((v) => ({ ...v, cols: n }))}
                    />
                    <p className="hint">{t('เจาะเป็นกริดกลางผนัง — โชว์ในภาพ 3D และไฟล์ตัด (DXF/PDF)', 'Punched as a centered grid — shown in 3D and the cut files (DXF/PDF)')}</p>
                  </div>
                )}
              </div>
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
                  {t('ซิปล็อก + รอยฉีก (เปิด-ปิดซ้ำได้)', 'Zip-lock + tear notch (reclosable)')}
                </label>
                {zipper && pouch?.zipY !== undefined && pouch.tearY !== undefined && (
                  <div className="zip-pos" style={{ margin: '6px 0 4px 24px' }}>
                    <DimField
                      imperial={imperial}
                      label={t('ซิปห่างขอบบน', 'Zipper from top')}
                      value={pouch.zipY}
                      min={pouch.frontRect.y + 1}
                      max={Math.min(ZIP_AT_MAX, pouch.frontRect.y + H - 1)}
                      disabled={aiBusy}
                      onChange={(v) => setPouchAddons((a) => ({ ...a, zipAt: v }))}
                    />
                    <label className="check" style={{ marginTop: 6 }}>
                      <input
                        type="checkbox"
                        checked={pouchAddons.tearAt === undefined}
                        disabled={aiBusy}
                        onChange={(e) =>
                          setPouchAddons((a) => {
                            const { tearAt: _old, ...rest } = a
                            return e.target.checked ? rest : { ...rest, tearAt: pouch.tearY }
                          })
                        }
                      />
                      {t(`วางรอยฉีกอัตโนมัติ (เหนือซิป ${TEAR_GAP} มม.)`, `Place tear notch automatically (${TEAR_GAP} mm above zipper)`)}
                    </label>
                    {pouchAddons.tearAt !== undefined && (
                      <DimField
                        imperial={imperial}
                        label={t('รอยฉีกห่างขอบบน', 'Tear notch from top')}
                        value={pouch.tearY}
                        min={3}
                        max={Math.min(ZIP_AT_MAX, pouch.frontRect.y + H - 3)}
                        disabled={aiBusy}
                        onChange={(v) => setPouchAddons((a) => ({ ...a, tearAt: v }))}
                      />
                    )}
                    {(pouchAddons.zipAt !== undefined || pouchAddons.tearAt !== undefined) && (
                      <button
                        type="button"
                        className="link-btn"
                        disabled={aiBusy}
                        onClick={() =>
                          setPouchAddons((a) => {
                            const { zipAt: _z, tearAt: _t, ...rest } = a
                            return rest
                          })
                        }
                      >
                        {t('คืนค่าตำแหน่งเริ่มต้น', 'Reset to default position')}
                      </button>
                    )}
                    <p className="hint">
                      {t(
                        `วัดจากขอบบนถุง: ซีลบน ${fmtMm(pouch.frontRect.y)} มม. → รอยฉีก (ต้องพ้นซีล) → ซิป; ทั่วไปรอยฉีก ~12–20 มม. ซิป ~25–40 มม. (มีรูแขวน/ถุงใหญ่ลงได้ถึง ~50) — ยืนยันกับโรงพิมพ์อีกครั้ง`,
                        `Measured from the top edge: top seal ${fmtMm(pouch.frontRect.y)} mm → tear notch (below the seal) → zipper; typically notch ~12–20 mm, zipper ~25–40 mm (down to ~50 with a hang hole/large bags) — confirm with your converter`,
                      )}
                    </p>
                    <StickerIssues issues={zipIssues} okText={['ตำแหน่งซิป/รอยฉีกผ่านหลักการผลิต', 'Zipper/tear position meets production rules']} />
                  </div>
                )}
                <label className="check" style={{ marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={pouchAddons.hangHole ?? false}
                    disabled={aiBusy}
                    onChange={(e) => setPouchAddons((a) => ({ ...a, hangHole: e.target.checked }))}
                  />
                  {t('รูแขวน (euro-hole)', 'Hang hole (euro-hole)')}
                </label>
                <label className="check" style={{ marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={pouchAddons.valve ?? false}
                    disabled={aiBusy}
                    onChange={(e) => setPouchAddons((a) => ({ ...a, valve: e.target.checked }))}
                  />
                  {t('วาล์วกาแฟ (degassing valve)', 'Coffee degassing valve')}
                </label>
                <label className="check" style={{ marginTop: 8 }}>
                  <input
                    type="checkbox"
                    checked={pouchAddons.tinTie ?? false}
                    disabled={aiBusy}
                    onChange={(e) => setPouchAddons((a) => ({ ...a, tinTie: e.target.checked }))}
                  />
                  {t('ที่รัดปาก (tin-tie)', 'Tin-tie')}
                </label>
                <p className="hint">
                  {t(
                    'แนะนำการจับคู่: วาล์ว/ที่รัดปาก → ถุงกาแฟ (ข้างจีบ · ก้นแบน) · ซิปล็อก → ถุงตั้ง/ก้นแบน · รูแขวน → ได้ทุกแบบ (ผู้ใช้เลือกเองได้ตามต้องการ)',
                    'Pairing tips: valve/tin-tie → coffee bags (gusset · flat-bottom) · zip-lock → stand-up/flat-bottom · hang hole → any style (your choice)',
                  )}
                </p>
              </>
            )}
          </Group>,
            sizeFloatEl,
          )}

          <div className="step-nav">
            <span className="step-saved">{t('✓ บันทึกงานอัตโนมัติ', '✓ Auto-saved')}</span>
            <div className="step-btns">
              <button className="step-next" onClick={() => goStep('artwork')}>
                {t('ไปต่อ: ตกแต่ง →', 'Next: Decorate →')}
              </button>
            </div>
          </div>
          </>
          )}

          {sideTab === 'artwork' && (
          <>
              {bgFloatEl && createPortal(
              <Group title={t('พื้นหลังแพ็กเกจ', 'Package background')} open={groups.bg} onToggle={() => toggleGroup('bg')}>
                <div className="fill-color-row">
                  <ColorField
                    value={fillColor ?? '#2f8a99'}
                    onChange={setFillColor}
                    palette={palette}
                    onSave={saveSwatch}
                    disabled={aiBusy}
                    label={t('สีพื้นแพ็กเกจ', 'Package base color')}
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
                      accept={cloud ? 'image/png,image/jpeg' : 'image/*,.svg'}
                      disabled={aiBusy || (cloud !== undefined && !cloud.online)}
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
              </Group>,
                bgFloatEl,
              )}

              <Group title={t('เพิ่มองค์ประกอบ', 'Add element')} open={groups.add} onToggle={() => toggleGroup('add')}>
                <div className="art-actions">
                  <label className="file-pick inline">
                    <input
                      type="file"
                      accept={cloud ? 'image/png,image/jpeg' : 'image/*,.svg'}
                      disabled={aiBusy || projectBusy || (cloud !== undefined && !cloud.online)}
                      onChange={(e) => {
                        void addImage(e.target.files?.[0])
                        e.target.value = ''
                      }}
                    />
                    <span className="ico-btn"><IconImage /> {t('รูปภาพ', 'Image')}</span>
                  </label>
                  <button className="ico-btn" disabled={aiBusy} onClick={addText}>
                    <IconText /> {t('ข้อความ', 'Text')}
                  </button>
                </div>
                <div className="art-actions" style={{ marginTop: 8 }}>
                  <button className="ico-btn" disabled={aiBusy} title={t('สี่เหลี่ยม', 'Rectangle')} onClick={() => addShape('rect')}>
                    <IconRect /> {t('สี่เหลี่ยม', 'Rectangle')}
                  </button>
                  <button className="ico-btn" disabled={aiBusy} title={t('วงกลม/วงรี', 'Circle / ellipse')} onClick={() => addShape('ellipse')}>
                    <IconEllipse /> {t('วงกลม', 'Circle')}
                  </button>
                  <button className="ico-btn" disabled={aiBusy} title={t('เส้น', 'Line')} onClick={() => addShape('line')}>
                    <IconLine /> {t('เส้น', 'Line')}
                  </button>
                  <button className="ico-btn" disabled={aiBusy} title={t('สามเหลี่ยม', 'Triangle')} onClick={() => addShape('triangle')}>
                    <IconTriangle /> {t('สามเหลี่ยม', 'Triangle')}
                  </button>
                  <button className="ico-btn" disabled={aiBusy} title={t('หลายเหลี่ยม', 'Polygon')} onClick={() => addShape('polygon')}>
                    <IconPolygon /> {t('หลายเหลี่ยม', 'Polygon')}
                  </button>
                  <button className="ico-btn" disabled={aiBusy} title={t('ดาว', 'Star')} onClick={() => addShape('star')}>
                    <IconStar /> {t('ดาว', 'Star')}
                  </button>
                  {SHOW_PEN_TOOL && (
                    <button
                      className={`ico-btn${penMode ? ' active' : ''}`}
                      disabled={aiBusy}
                      title="ปากกา (Pen) — คลิกวางจุด/ลากสร้างโค้ง, คลิกจุดแรกเพื่อปิดรูป, Enter จบเส้น, Esc ยกเลิก"
                      aria-pressed={penMode}
                      onClick={() => (penMode ? setPenMode(false) : startPen())}
                    >
                      <IconPen /> ปากกา
                    </button>
                  )}
                </div>
                <div className="art-actions" style={{ marginTop: 8 }}>
                  <button className="ico-btn" disabled={aiBusy} title={t('ตารางข้อมูลโภชนาการ (อย.)', 'Nutrition facts table')} onClick={addNutrition}>
                    <IconNutrition /> {t('ตารางโภชนาการ (อย.)', 'Nutrition facts')}
                  </button>
                </div>
              </Group>

              <Group title={t('ไลบรารีลาย', 'Pattern library')} open={groups.lib} onToggle={() => toggleGroup('lib')}>
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
                            disabled={aiBusy || (cloud !== undefined && !cloud.online)}
                            onClick={() => void addPreset(p)}
                          >
                            <img src={presetDataUrl(p.svg(presetColor))} alt={p.nameTh} />
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Group>

              <Group title={t('เลเยอร์', 'Layers')} open={groups.layers} onToggle={() => toggleGroup('layers')} badge={decos.length}>
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
                        ) : d.type === 'path' ? (
                          <span
                            className="deco-sw"
                            style={{
                              background: d.closed && d.fill !== 'none' ? d.fill : 'transparent',
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
                        <button
                          className="deco-toggle deco-del"
                          title={t('ลบชิ้นนี้','Delete this item')}
                          aria-label={t('ลบชิ้นนี้','Delete this item')}
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
                <Group title={t('ปรับแต่งที่เลือก', 'Selection')} open={groups.props} onToggle={() => toggleGroup('props')}>
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
                      <button className="tb-ic" title={t('ทำสำเนา','Duplicate')} aria-label={t('ทำสำเนา','Duplicate')} onClick={duplicateSelected}>⧉</button>
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
                            aria-label={t('ฟอนต์', 'Font')}
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

                    {((selected.type === 'shape' && selected.shape !== 'line') || selected.type === 'path') && (
                      <>
                        {/* สีพื้น/ไล่สี: เฉพาะรูปทรง หรือ path ที่ปิดรูป (เส้นเปิดไม่มีพื้น) */}
                        {(selected.type === 'shape' || (selected.type === 'path' && selected.closed)) && (
                          <>
                        <div className="art-actions">
                          <div className="deco-color" title="สีพื้น">
                            <span className="deco-ic" aria-hidden="true"><IconFill /></span>
                            <ColorField
                              value={selected.fill === 'none' ? '#2f8a99' : selected.fill}
                              onChange={(hex) => patchSelected((d) => (d.type === 'shape' || d.type === 'path' ? { ...d, fill: hex } : d))}
                              palette={palette}
                              onSave={saveSwatch}
                              disabled={aiBusy}
                              label="สีพื้น"
                            />
                          </div>
                          <button
                            className="tb-ic"
                            title="ไม่มีพื้น (โปร่งใส)"
                            aria-label="ไม่มีพื้น"
                            disabled={aiBusy || selected.fill === 'none'}
                            onClick={() => patchSelected((d) => (d.type === 'shape' || d.type === 'path' ? { ...d, fill: 'none', strokeW: d.strokeW > 0 ? d.strokeW : 2, stroke: d.stroke === 'none' ? '#222222' : d.stroke } : d))}
                          >
                            <IconNoFill />
                          </button>
                        </div>
                        <button
                          className="tb-ic"
                          title="ไล่สี (gradient)"
                          aria-label="ไล่สี (gradient)"
                          aria-pressed={!!selected.grad}
                          disabled={aiBusy}
                          onClick={() =>
                            patchSelected((d) =>
                              d.type === 'shape' || d.type === 'path'
                                ? {
                                    ...d,
                                    grad: !d.grad
                                      ? { from: d.fill !== 'none' ? d.fill : '#2f8a99', to: '#ffffff', angle: 90 }
                                      : undefined,
                                  }
                                : d,
                            )
                          }
                        >
                          <IconGradient />
                        </button>
                        {selected.grad && (
                          <>
                            <div className="deco-color" title="สีเริ่มไล่">
                              <span className="deco-ic" aria-hidden="true"><IconGradStart /></span>
                              <ColorField
                                value={selected.grad.from}
                                onChange={(hex) => patchSelected((d) => ((d.type === 'shape' || d.type === 'path') && d.grad ? { ...d, grad: { ...d.grad, from: hex } } : d))}
                                palette={palette}
                                onSave={saveSwatch}
                                disabled={aiBusy}
                                label="สีเริ่มไล่"
                              />
                            </div>
                            <div className="deco-color" title="สีปลายไล่">
                              <span className="deco-ic" aria-hidden="true"><IconGradEnd /></span>
                              <ColorField
                                value={selected.grad.to}
                                onChange={(hex) => patchSelected((d) => ((d.type === 'shape' || d.type === 'path') && d.grad ? { ...d, grad: { ...d.grad, to: hex } } : d))}
                                palette={palette}
                                onSave={saveSwatch}
                                disabled={aiBusy}
                                label="สีปลายไล่"
                              />
                            </div>
                            <button
                              className="tb-ic"
                              title="ไล่สีแบบวงกลม (radial)"
                              aria-label="ไล่สีแบบวงกลม (radial)"
                              aria-pressed={!!selected.grad.radial}
                              disabled={aiBusy}
                              onClick={() => patchSelected((d) => ((d.type === 'shape' || d.type === 'path') && d.grad ? { ...d, grad: { ...d.grad, radial: !d.grad.radial || undefined } } : d))}
                            >
                              <IconRadial />
                            </button>
                            {!selected.grad.radial && (
                              <DimField
                                label="มุมไล่สี (องศา)"
                                icon={<IconAngle />}
                                value={selected.grad.angle}
                                min={0}
                                max={360}
                                disabled={aiBusy}
                                onChange={(v) => patchSelected((d) => ((d.type === 'shape' || d.type === 'path') && d.grad ? { ...d, grad: { ...d.grad, angle: v } } : d))}
                              />
                            )}
                          </>
                        )}
                          </>
                        )}
                        <div className="deco-color" title="สีเส้นขอบ">
                          <span className="deco-ic" aria-hidden="true"><IconStroke /></span>
                          <ColorField
                            value={selected.stroke === 'none' ? '#222222' : selected.stroke}
                            onChange={(hex) => patchSelected((d) => (d.type === 'shape' || d.type === 'path' ? { ...d, stroke: hex, strokeW: d.strokeW > 0 ? d.strokeW : 2 } : d))}
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
                          onChange={(v) => patchSelected((d) => (d.type === 'shape' || d.type === 'path' ? { ...d, strokeW: v, stroke: v > 0 && d.stroke === 'none' ? '#222222' : d.stroke } : d))}
                        />
                        {selected.strokeW > 0 && (
                          <button
                            className="tb-ic"
                            title="เส้นขอบประ (dashed)"
                            aria-label="เส้นขอบประ (dashed)"
                            aria-pressed={!!selected.dash}
                            disabled={aiBusy}
                            onClick={() => patchSelected((d) => (d.type === 'shape' || d.type === 'path' ? { ...d, dash: !d.dash || undefined } : d))}
                          >
                            <IconDash />
                          </button>
                        )}
                        {selected.type === 'shape' && (selected.shape === 'polygon' || selected.shape === 'star') && (
                          <DimField
                            label={selected.shape === 'star' ? 'จำนวนแฉก' : 'จำนวนด้าน'}
                            icon={selected.shape === 'star' ? <IconStar /> : <IconPolygon />}
                            value={selected.sides ?? (selected.shape === 'star' ? 5 : 6)}
                            min={3}
                            max={12}
                            disabled={aiBusy}
                            onChange={(v) => patchSelected((d) => (d.type === 'shape' ? { ...d, sides: Math.round(v) } : d))}
                          />
                        )}
                        <DimField
                          label="กว้าง"
                          icon={<IconWidth />}
                          value={Math.round(selected.w * 10) / 10}
                          min={2}
                          max={Math.round(dieline.width)}
                          disabled={aiBusy}
                          onChange={(v) => patchSelected((d) => (d.type === 'shape' || d.type === 'path' ? { ...d, w: v } : d))}
                        />
                        <DimField
                          label="สูง"
                          icon={<IconHeight />}
                          value={Math.round(selected.h * 10) / 10}
                          min={2}
                          max={Math.round(dieline.height)}
                          disabled={aiBusy}
                          onChange={(v) => patchSelected((d) => (d.type === 'shape' || d.type === 'path' ? { ...d, h: v } : d))}
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
                          value={selected.presetColor ?? '#2f8a99'}
                          onChange={(hex) => void changePresetColor(selected.id, selected.preset!, hex)}
                          palette={palette}
                          onSave={saveSwatch}
                          disabled={aiBusy || (cloud !== undefined && !cloud.online)}
                          label="สีลาย"
                        />
                      </div>
                    )}
                    {selected.type === 'image' && (
                      <>
                        <DimField
                          label="กรอบ กว้าง"
                          icon={<IconWidth />}
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
                          icon={<IconHeight />}
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
                          className="tb-ic"
                          aria-pressed={lockAspect}
                          aria-label="ล็อกสัดส่วนรูป"
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
                          {lockAspect ? <IconLock /> : <IconUnlock />}
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
                        {imgDpi.dpiById.has(selected.id) &&
                          (() => {
                            const dpi = imgDpi.dpiById.get(selected.id)!
                            const lvl = dpi < LOW_DPI ? 'low' : dpi < GOOD_DPI ? 'ok' : 'good'
                            return (
                              <div className={`dpi-note ${lvl}`}>
                                ความละเอียดที่ขนาดนี้ ≈ {dpi} dpi
                                {lvl === 'good'
                                  ? ' · คมพอสำหรับพิมพ์'
                                  : lvl === 'ok'
                                    ? ' · พอใช้ (แนะนำ ≥ 300)'
                                    : ` · ต่ำ อาจแตกเมื่อพิมพ์ — ใช้รูปกว้าง ≥ ${pixelsNeeded(imageDrawMm(selected).w)} px หรือย่อรูปลง`}
                              </div>
                            )
                          })()}
                        <DimField
                          label="มุมโค้ง (มม.)"
                          icon={<IconCorner />}
                          value={selected.radius ?? 0}
                          min={0}
                          max={Math.round(Math.min(selected.w, selected.h) / 2)}
                          disabled={aiBusy || !!selected.circle || !!selected.maskShape || (!!selected.frame && selected.frame !== 'none')}
                          onChange={(v) => patchSelected((d) => (d.type === 'image' ? { ...d, radius: v || undefined, maskShape: undefined, circle: undefined, frame: undefined } : d))}
                        />
                        <ToolPopover
                          title={t('กรอบรูป (crop)', 'Image frame (crop)')}
                          icon={
                            selected.frame && selected.frame !== 'none' ? (
                              <svg width="18" height="18" viewBox="-1 -1 22 22" aria-hidden="true">
                                <path d={framePath(selected.frame, 20, 20)} fill="currentColor" />
                              </svg>
                            ) : (
                              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2" />
                              </svg>
                            )
                          }
                        >
                          <div className="pop-title">{t('กรอบครอปรูป', 'Crop frame')}</div>
                          <div className="frame-grid">
                            {FRAMES.map((f) => {
                              const active = (selected.frame ?? 'none') === f.id
                              return (
                                <button
                                  key={f.id}
                                  type="button"
                                  className={`frame-opt${active ? ' active' : ''}`}
                                  aria-label={`${t('กรอบ','Frame')} ${t(f.nameTh, f.nameEn)}`}
                                  aria-pressed={active}
                                  disabled={aiBusy}
                                  onClick={() =>
                                    patchSelected((d) =>
                                      d.type === 'image'
                                        ? {
                                            ...d,
                                            frame: f.id === 'none' ? undefined : f.id,
                                            circle: undefined,
                                            maskShape: undefined,
                                            maskSides: undefined,
                                            radius: undefined,
                                          }
                                        : d,
                                    )
                                  }
                                >
                                  {f.id === 'none' ? (
                                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                                      <rect x="3" y="3" width="14" height="14" rx="2" strokeDasharray="2.5 2.5" />
                                      <path d="M5 15 15 5" />
                                    </svg>
                                  ) : (
                                    <svg viewBox="-1 -1 22 22" aria-hidden="true">
                                      <path d={framePath(f.id, 20, 20)} fill="currentColor" />
                                    </svg>
                                  )}
                                  <span>{t(f.nameTh, f.nameEn)}</span>
                                </button>
                              )
                            })}
                          </div>
                        </ToolPopover>
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
                <span className="step-saved">{t('✓ บันทึกงานอัตโนมัติ', '✓ Auto-saved')}</span>
                <div className="step-btns">
                  <button className="step-back" onClick={() => goStep('design')}>
                    {t('← ออกแบบ','← Design')}
                  </button>
                  <button className="step-next" onClick={() => goStep('export')}>
                    {t('ไปต่อ: ส่งออก →','Next: Export →')}
                  </button>
                </div>
              </div>
          </>
          )}

          {sideTab === 'export' && (
          <>
              <Group title={t('ดาวน์โหลดไฟล์', 'Download files')} open={groups.exp} onToggle={() => toggleGroup('exp')}>
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
                {isSticker && <StickerIssues issues={stickerIssues} />}
                {kind === 'pouch' && zipIssues.length > 0 && <StickerIssues issues={zipIssues} />}
                {isSticker && mat.underbase && (
                  <p className="hint">
                    {t(
                      `PDF/SVG มีเลเยอร์ "${WHITE_SPOT}" (หมึกขาวรอง) ให้อัตโนมัติ — ${fillColor || fillImage ? 'เต็มรูปทรงดวง เพราะมีสีพื้น' : 'ตามรูปทรงลาย เว้นรูในตัวอักษรให้ใส'}; PDF ใช้สี spot ชื่อ ${WHITE_SPOT} (แสดงเป็นฟ้าอ่อนบนจอ)`,
                      `PDF/SVG include a "${WHITE_SPOT}" layer (white underbase) automatically — ${fillColor || fillImage ? 'covering the whole sticker because of the background colour' : 'following the artwork, leaving letter counters clear'}; the PDF uses a spot colour named ${WHITE_SPOT} (shown light blue on screen)`,
                    )}
                  </p>
                )}
                {isSticker && mat.clear && !mat.underbase && (
                  <p className="hint">
                    {t(
                      'ฟิล์มใสไม่มีหมึกขาว — ส่วนที่เป็นสีขาวในงานจะใส และสีอ่อนจะจาง (ดูตัวอย่างได้ในมุมมอง 3D)',
                      'Clear film without white ink — white areas print transparent and light colours fade (see the 3D view)',
                    )}
                  </p>
                )}
                {sheetOut && (
                  <p className="hint">
                    {t(
                      `ไฟล์ที่ดาวน์โหลดเป็นแผ่น ${sheetOut.layout.sheet.nameTh} (${sheetOut.layout.sheet.w}×${sheetOut.layout.sheet.h} มม.) เรียง ${sheetOut.layout.count} ดวง`,
                      `Downloads contain the whole ${sheetOut.layout.sheet.nameTh} sheet (${sheetOut.layout.sheet.w}×${sheetOut.layout.sheet.h} mm) with ${sheetOut.layout.count} stickers`,
                    )}
                  </p>
                )}
                {imgDpi.low.length > 0 && (
                  <div className="lowres-warn" role="alert">
                    <b>⚠ รูปความละเอียดต่ำ {imgDpi.low.length} ชิ้น</b> — พิมพ์ออกมาอาจแตก/เบลอ (แนะนำ ≥ {GOOD_DPI} dpi)
                    <ul>
                      {imgDpi.low.map((l) => (
                        <li key={l.id}>
                          {l.label}: {l.dpi} dpi → ใช้รูปกว้าง ≥ {l.wantPx} px หรือย่อรูปลง
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
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

              <Group title={t('จำนวน & จำนวนต่อแผ่น', 'Quantity & yield')} open={groups.qty} onToggle={() => toggleGroup('qty')}>
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

              <Group title={t('สำรอง / ย้ายงาน', 'Backup / transfer')} open={groups.backup} onToggle={() => toggleGroup('backup')}>
                <div className="art-actions">
                  <button disabled={aiBusy} onClick={exportProject}>
                    ⬇ ส่งออกงานนี้
                  </button>
                  <label className="file-pick inline">
                    <input
                      type="file"
                      accept=".json,application/json"
                      disabled={aiBusy || projectBusy || (cloud !== undefined && !cloud.online)}
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
                <span className="step-saved">{t('✓ บันทึกงานอัตโนมัติ', '✓ Auto-saved')} · ครบทุกขั้นตอนแล้ว</span>
                <div className="step-btns">
                  <button className="step-back" onClick={() => goStep('artwork')}>
                    {t('← ตกแต่ง','← Decorate')}
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
          <div className={`panels${design3D ? ' show3d' : ''}`}>
            {design3D ? (
              /* แท็บออกแบบ: จอหลักเป็น 3D ของแพ็กเกจที่เลือก (พร้อมแถบพับ) + โมดูลขนาดลอยขวา */
              <>
                <div className="viewer-main card">
                  {foldBar}
                  <div className="viewer-3d">{viewer3D}</div>
                </div>
                <FloatModule kind="size" hostRef={setSizeFloatEl} />
              </>
            ) : (
            <>
            {/* host แถบเครื่องมือ (Canva) — ลอยทับบน dieline (portal มาลงที่นี่เมื่อเลือกชิ้น) */}
            <div className="deco-topbar-host" ref={setDecoBar} />
            <div className="blueprint card">
              <DielineSVG
                dieline={dieline}
                showDims={showDims}
                decos={proofed.decos}
                guides={guides}
                fillColor={proofed.fillColor}
                fillImage={proofed.fillImage}
                selectedIds={selectedIds}
                onSelect={selectDeco}
                onMove={moveDeco}
                onRotate={rotateDeco}
                onResize={resizeDeco}
                resizeAspect={resizeAspect}
                penMode={penMode}
                onAddPath={addPath}
                onPenExit={() => setPenMode(false)}
                onEditPath={editPath}
                onCrop={cropDeco}
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
                imperial={imperial}
                toolsExtra={proofToggle}
                lowResDpi={lowResMap}
                fillLowDpi={fillLowDpi}
                clearFilm={isSticker && !!mat.clear}
              />
              <span className="bp-legend">
                <i className="sw-cut" /> เส้นตัด
                <i className="sw-crease" />{' '}
                {kind === 'box' ? 'เส้นพับ' : kind === 'pouch' ? 'รอยพับ/ซีล' : 'แนวทับกาว'}
                {/* ตัวเลขบนแบบ = ระยะเส้นพับจริง (ด้านใน + เผื่อความหนา) จึงมากกว่าขนาดที่ตั้ง/ที่ 3D แสดงเล็กน้อย */}
                {kind === 'box' && showDims && (
                  <span className="bp-legend-note">
                    · ตัวเลข = ระยะเส้นพับ (ด้านใน + ความหนา)
                  </span>
                )}
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
              <div className="viewer-3d">{viewer3D}</div>
            </div>
            )}
            {/* โมดูลพื้นหลังแพ็กเกจ ลอยขวา (เฉพาะแท็บตกแต่ง) */}
            {sideTab === 'artwork' && <FloatModule kind="bg" hostRef={setBgFloatEl} />}
            </>
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
    </LangCtx.Provider>
  )
}
