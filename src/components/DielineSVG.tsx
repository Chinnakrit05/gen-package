import { memo, useEffect, useRef, useState } from 'react'
import type { Dieline, DimMark } from '../core/types'
import { elW, elH, elCenter, flipTransform, fontCss, gradientId, gradientSVGString, imgPAR, imageMaskSVG, maskId, panelsBBox, fillImageRect, textLinesOf, textAnchor, textAnchorX, textLineY, shapeVertices, isPolyShape, dashArray, TEXT_STROKE_MUL, textShadowSVG, textShadowId, isCurvedText, curvedGlyphs, nutritionInnerSVG, type Deco, type FillImage } from '../core/artwork'
import { snapTargets, applySnap, type SnapTargets } from '../core/snap'
import type { Guides } from '../core/guides'

const DIM_COLOR = '#1b6ea8'
const SEL_COLOR = '#1b6ea8'
const SAFE_COLOR = '#1b6ea8'
const BLEED_COLOR = '#c0158a'
const DEL_COLOR = '#c0392b'
const GRID = 10 // ระยะกริด (มม.)
// ค่าตำแหน่งเส้นกริด 0..max ทีละ GRID (รวมเส้นสุดท้ายถ้าหารลงตัว)
const gridTicks = (max: number): number[] => {
  const out: number[] = []
  for (let v = 0; v <= max + 0.01; v += GRID) out.push(Math.round(v))
  return out
}

const SNAP_COLOR = '#ff7a00'
const GUIDE_COLOR = '#0aa5c9'
let guideSeq = 0
const SNAP_PX = 6 // ระยะดูดบนจอ (พิกเซล) — แปลงเป็น มม. ตามซูมปัจจุบัน จะได้รู้สึกคงที่ทุกขนาดแผ่น

function Dim({ d }: { d: DimMark }) {
  const vert = Math.abs(d.a.x - d.b.x) < 0.001
  const mx = (d.a.x + d.b.x) / 2
  const my = (d.a.y + d.b.y) / 2
  return (
    <g stroke={DIM_COLOR} strokeWidth={0.8} vectorEffect="non-scaling-stroke">
      <line x1={d.a.x} y1={d.a.y} x2={d.b.x} y2={d.b.y} vectorEffect="non-scaling-stroke" />
      {vert ? (
        <>
          <line x1={d.a.x - 2.5} y1={d.a.y} x2={d.a.x + 2.5} y2={d.a.y} vectorEffect="non-scaling-stroke" />
          <line x1={d.b.x - 2.5} y1={d.b.y} x2={d.b.x + 2.5} y2={d.b.y} vectorEffect="non-scaling-stroke" />
          <text
            x={mx}
            y={my}
            transform={`rotate(-90 ${mx} ${my})`}
            dy={-2}
            textAnchor="middle"
            stroke="none"
            fill={DIM_COLOR}
            fontSize={6}
          >
            {d.label}
          </text>
        </>
      ) : (
        <>
          <line x1={d.a.x} y1={d.a.y - 2.5} x2={d.a.x} y2={d.a.y + 2.5} vectorEffect="non-scaling-stroke" />
          <line x1={d.b.x} y1={d.b.y - 2.5} x2={d.b.x} y2={d.b.y + 2.5} vectorEffect="non-scaling-stroke" />
          <text x={mx} y={my - 2} textAnchor="middle" stroke="none" fill={DIM_COLOR} fontSize={6}>
            {d.label}
          </text>
        </>
      )}
    </g>
  )
}

// เนื้อขององค์ประกอบหนึ่งชิ้น (ยังไม่รวม transform หมุน — พาเรนต์เป็นคนครอบ <g rotate>)
// พลิก (flip) ครอบเฉพาะเนื้อ ไม่โดนกรอบเลือก/ก้านหมุน
function decoInner(e: Deco) {
  const w = elW(e)
  const h = elH(e)
  if (e.type === 'image') {
    const mask = imageMaskSVG(e)
    const img = (
      <image
        href={e.src}
        x={e.x}
        y={e.y}
        width={w}
        height={h}
        preserveAspectRatio={imgPAR(e.fit)}
        clipPath={mask ? `url(#${maskId(e.id)})` : undefined}
      />
    )
    return mask ? (
      <>
        <g dangerouslySetInnerHTML={{ __html: `<defs>${mask}</defs>` }} />
        {img}
      </>
    ) : (
      img
    )
  }
  if (e.type === 'shape') {
    const dashProps = e.dash && e.strokeW > 0 ? { strokeDasharray: dashArray(e.strokeW) } : {}
    const strokeProps =
      e.stroke !== 'none' && e.strokeW > 0
        ? { stroke: e.stroke, strokeWidth: e.strokeW, ...dashProps }
        : {}
    if (e.shape === 'line') {
      const cy = e.y + e.h / 2
      return (
        <line
          x1={e.x}
          y1={cy}
          x2={e.x + e.w}
          y2={cy}
          stroke={e.stroke}
          strokeWidth={e.strokeW}
          strokeLinecap="round"
          {...dashProps}
        />
      )
    }
    const gid = gradientId(e.id)
    const fill = e.grad ? `url(#${gid})` : e.fill
    // ไล่สี: ฝัง <defs> จากสตริงเดียวกับ export (กัน logic ต่างกัน) ผ่าน dangerouslySetInnerHTML บน <g>
    const defs = e.grad ? (
      <g dangerouslySetInnerHTML={{ __html: `<defs>${gradientSVGString(e)}</defs>` }} />
    ) : null
    const cx = e.x + w / 2
    const cy = e.y + h / 2
    const body = isPolyShape(e.shape) ? (
      <polygon
        points={shapeVertices(e.shape, w, h, e.sides)
          .map((p) => `${cx + p.x},${cy + p.y}`)
          .join(' ')}
        fill={fill}
        strokeLinejoin="round"
        {...strokeProps}
      />
    ) : e.shape === 'ellipse' ? (
      <ellipse cx={cx} cy={cy} rx={w / 2} ry={h / 2} fill={fill} {...strokeProps} />
    ) : (
      <rect x={e.x} y={e.y} width={w} height={h} fill={fill} {...strokeProps} />
    )
    return (
      <>
        {defs}
        {body}
      </>
    )
  }
  if (e.type === 'nutrition') {
    return <g dangerouslySetInnerHTML={{ __html: nutritionInnerSVG(e) }} />
  }
  const tStroke =
    e.strokeColor && (e.strokeW ?? 0) > 0
      ? { stroke: e.strokeColor, strokeWidth: (e.strokeW as number) * TEXT_STROKE_MUL, paintOrder: 'stroke' as const, strokeLinejoin: 'round' as const }
      : { stroke: 'none' as const }
  const shDefs = e.shadow ? <g dangerouslySetInnerHTML={{ __html: textShadowSVG(e) }} /> : null
  const fontProps = {
    fontSize: e.size,
    fontWeight: e.weight ?? 400,
    fontFamily: `${fontCss(e.font)}, sans-serif`,
    fill: e.color,
  }
  if (isCurvedText(e)) {
    const c = elCenter(e)
    return (
      <>
        {shDefs}
        <g filter={e.shadow ? `url(#${textShadowId(e.id)})` : undefined} style={{ userSelect: 'none' }}>
          {curvedGlyphs(e).map((g, i) => (
            <text
              key={i}
              transform={`translate(${c.x + g.x} ${c.y + g.y}) rotate(${g.rot})`}
              textAnchor="middle"
              dominantBaseline="central"
              {...fontProps}
              {...tStroke}
            >
              {g.ch}
            </text>
          ))}
        </g>
      </>
    )
  }
  return (
    <>
      {shDefs}
      <text
        textAnchor={textAnchor(e)}
        dominantBaseline="central"
        {...fontProps}
        filter={e.shadow ? `url(#${textShadowId(e.id)})` : undefined}
        {...tStroke}
        style={{ userSelect: 'none' }}
      >
        {textLinesOf(e).map((ln, i) => (
          <tspan key={i} x={textAnchorX(e)} y={textLineY(e, i)}>
            {ln}
          </tspan>
        ))}
      </text>
    </>
  )
}

function DecoBody({ e }: { e: Deco }) {
  const ft = flipTransform(e).trim()
  const inner = decoInner(e)
  const flipped = ft ? <g transform={ft}>{inner}</g> : inner
  return e.opacity !== undefined && e.opacity < 1 ? <g opacity={e.opacity}>{flipped}</g> : flipped
}

type Grab =
  | { mode: 'move'; id: string; dx: number; dy: number }
  | { mode: 'rotate'; id: string }

export const DielineSVG = memo(function DielineSVG({
  dieline,
  showDims,
  decos = [],
  guides,
  fillColor,
  fillImage,
  selectedIds = [],
  onSelect,
  onMove,
  onRotate,
  onRemove,
  onText,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: {
  dieline: Dieline
  showDims: boolean
  decos?: Deco[]
  guides?: Guides | null
  fillColor?: string | null
  fillImage?: FillImage | null
  selectedIds?: string[]
  onSelect?: (id: string | null, additive?: boolean) => void
  onMove?: (id: string, x: number, y: number) => void
  onRotate?: (id: string, deg: number) => void
  onRemove?: (id: string) => void
  onText?: (id: string, text: string) => void
  onUndo?: () => void
  onRedo?: () => void
  canUndo?: boolean
  canRedo?: boolean
}) {
  const [showRuler, setShowRuler] = useState(false)
  const pad = showDims || showRuler ? 26 : 12
  const svgRef = useRef<SVGSVGElement>(null)
  const grab = useRef<Grab | null>(null)
  const snapT = useRef<SnapTargets | null>(null)
  const [active, setActive] = useState(false)
  // แก้ข้อความในที่ (คลิกข้อความที่เลือกอยู่อีกที / ดับเบิลคลิก → พิมพ์แก้บน blueprint ได้เลย)
  const [editing, setEditing] = useState<string | null>(null)
  const editCandidate = useRef<string | null>(null) // ข้อความที่ "เลือกอยู่แล้ว" ตอนกด — ถ้าไม่ลากคือจะแก้
  const dragMoved = useRef(false)
  // เส้นไกด์ที่กำลังดูดติด (ค่า x ของเส้นตั้ง / y ของเส้นนอน) — null = ไม่มี
  const [snap, setSnap] = useState<{ vx: number | null; vy: number | null }>({ vx: null, vy: null })
  // ซูม/แพน blueprint ผ่าน viewBox — zoom=1 คือพอดีจอ, center=null คือกึ่งกลาง
  const [zoom, setZoom] = useState(1)
  const [center, setCenter] = useState<{ x: number; y: number } | null>(null)
  const [showGrid, setShowGrid] = useState(false)
  // เส้นไกด์ที่ผู้ใช้ลากวางเอง — axis 'x' = เส้นตั้ง (คงค่า x), 'y' = เส้นนอน (คงค่า y)
  const [guideLines, setGuideLines] = useState<{ id: string; axis: 'x' | 'y'; pos: number }[]>([])
  const [hoverGuide, setHoverGuide] = useState<string | null>(null) // เส้นไกด์ที่กำลังโฟกัส (โชว์ถังขยะที่ขอบ)
  const guideDrag = useRef<{ id: string; axis: 'x' | 'y' } | null>(null)
  // สะพานหน่วงเวลา: ออกจากเส้นแล้วหน่วงก่อนซ่อนถังขยะ เผื่อผู้ใช้เลื่อนเมาส์ไปที่ถังขยะที่ขอบทัน
  const hoverTimer = useRef<number | null>(null)
  const setGuideHover = (id: string | null) => {
    if (hoverTimer.current) {
      window.clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
    if (id === null) hoverTimer.current = window.setTimeout(() => setHoverGuide(null), 500)
    else setHoverGuide(id)
  }
  const deleteGuide = (id: string) => {
    setGuideLines((gs) => gs.filter((g) => g.id !== id))
    setHoverGuide(null)
  }
  const pan = useRef<{ sx: number; sy: number; cx: number; cy: number; moved: boolean } | null>(null)
  // พินช์สองนิ้ว (ทัช/iPad) → ซูมเข้า-ออกที่จุดกึ่งกลางสองนิ้ว (เดสก์ท็อปใช้ Ctrl+ล้อ)
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinch = useRef<{ dist: number } | null>(null)
  const editable = !!(onMove && onRotate && onSelect)

  // แปลงพิกัดหน้าจอเป็นพิกัดแผ่นคลี่ (มม.) — viewBox เป็นหน่วย มม. อยู่แล้ว
  const toSheet = (clientX: number, clientY: number) => {
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()
    if (!svg || !ctm) return null
    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    return pt.matrixTransform(ctm.inverse())
  }

  const capture = (e: React.PointerEvent) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* pointer อาจถูกปล่อยไปก่อน — ลากยังทำงานจาก pointermove */
    }
  }

  const startMove = (e: React.PointerEvent, d: Deco) => {
    if (!editable) return
    // กัน pointerdown ลอยไปโดน handler พื้นหลังของ svg (ยกเลิกการเลือก) — ต้องทำก่อน return กรณีล็อก
    e.stopPropagation()
    // ถ้ากดข้อความที่ "เลือกอยู่ชิ้นเดียว" อยู่แล้ว และไม่ลาก → เข้าโหมดพิมพ์แก้ (จำไว้ ตัดสินตอนปล่อย)
    dragMoved.current = false
    editCandidate.current =
      d.type === 'text' && selectedIds.length === 1 && selectedIds[0] === d.id ? d.id : null
    if (editing && editing !== d.id) setEditing(null)
    const additive = e.shiftKey || e.ctrlKey || e.metaKey
    if (additive) {
      onSelect?.(d.id, true) // Shift/Ctrl คลิก = สลับเข้า/ออกชุดเลือก (ไม่เริ่มลาก)
      e.preventDefault()
      return
    }
    // คลิกชิ้นที่ยังไม่ได้เลือก = เลือกชิ้นนั้น; ถ้าเลือกอยู่แล้ว (อาจเป็นชุดหลายชิ้น) คงชุดไว้เพื่อลากทั้งชุด
    if (!selectedIds.includes(d.id)) onSelect?.(d.id, false)
    if (d.locked) {
      e.preventDefault()
      return // ล็อกไว้ — เลือกได้แต่ลากไม่ได้ (กันเผลอ)
    }
    const p = toSheet(e.clientX, e.clientY)
    if (!p) return
    grab.current = { mode: 'move', id: d.id, dx: p.x - d.x, dy: p.y - d.y }
    // เส้นเป้าหมายคงที่ตลอดการลาก (แผงนิ่ง, ชิ้นอื่นนิ่ง) — คิดครั้งเดียวตอนเริ่ม + รวมเส้นไกด์ที่ผู้ใช้วาง
    const t = snapTargets(dieline.panels, decos, d.id, dieline.width, dieline.height)
    for (const gu of guideLines) (gu.axis === 'x' ? t.xs : t.ys).push(gu.pos)
    snapT.current = t
    setActive(true)
    capture(e)
    e.preventDefault()
  }

  const startRotate = (e: React.PointerEvent, d: Deco) => {
    if (!editable) return
    grab.current = { mode: 'rotate', id: d.id }
    setActive(true)
    capture(e)
    e.stopPropagation()
    e.preventDefault()
  }

  const onMoveEvt = (e: React.PointerEvent) => {
    if (pinch.current) return // กำลังพินช์สองนิ้ว — ไม่ลาก/แพนนิ้วเดียว
    if (guideDrag.current) {
      const p = toSheet(e.clientX, e.clientY)
      if (!p) return
      const gd = guideDrag.current
      setGuideLines((gs) => gs.map((g) => (g.id === gd.id ? { ...g, pos: gd.axis === 'x' ? p.x : p.y } : g)))
      return
    }
    if (pan.current) {
      const dxS = e.clientX - pan.current.sx
      const dyS = e.clientY - pan.current.sy
      if (Math.abs(dxS) + Math.abs(dyS) > 3) pan.current.moved = true
      if (zoom > 1) {
        const scale = svgRef.current?.getScreenCTM()?.a || 1
        setCenter(clampCenter(pan.current.cx - dxS / scale, pan.current.cy - dyS / scale))
      }
      return
    }
    const g = grab.current
    if (!g) return
    const p = toSheet(e.clientX, e.clientY)
    if (!p) return
    const d = decos.find((x) => x.id === g.id)
    if (!d) return
    if (g.mode === 'move') {
      dragMoved.current = true // มีการลากจริง → ไม่เข้าโหมดแก้ข้อความตอนปล่อย
      const w = elW(d)
      const h = elH(d)
      let rx = p.x - g.dx
      let ry = p.y - g.dy
      // ดูดเข้าแนว เว้นแต่กด Alt ค้าง (ลากอิสระ) — threshold แปลงจากพิกเซลเป็น มม. ตามซูมปัจจุบัน
      if (!e.altKey && snapT.current) {
        const scale = svgRef.current?.getScreenCTM()?.a || 1
        const s = applySnap(rx, ry, w, h, snapT.current, SNAP_PX / scale)
        rx = s.x
        ry = s.y
        setSnap({ vx: s.vx, vy: s.vy })
      } else if (snap.vx !== null || snap.vy !== null) {
        setSnap({ vx: null, vy: null })
      }
      // กันลากหลุดจนหาไม่เจอ แต่ยังให้เลยขอบได้ (งานจริงมักออกแบบให้ลายตกขอบ)
      const x = Math.min(Math.max(rx, -w / 2), dieline.width - w / 2)
      const y = Math.min(Math.max(ry, -h / 2), dieline.height - h / 2)
      onMove?.(d.id, x, y)
    } else {
      const c = elCenter(d)
      // handle อยู่เหนือกล่อง → ชี้ขึ้น = 0 องศา จึงบวก 90
      const deg = (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI + 90
      onRotate?.(d.id, Math.round(deg))
    }
  }

  const endDrag = (e: React.PointerEvent) => {
    if (guideDrag.current) {
      // ลากเส้นไกด์ออกนอกแผ่น = ลบทิ้ง
      const gd = guideDrag.current
      guideDrag.current = null
      setGuideLines((gs) =>
        gs.filter((g) => {
          if (g.id !== gd.id) return true
          const lim = g.axis === 'x' ? dieline.width : dieline.height
          return g.pos >= -2 && g.pos <= lim + 2
        }),
      )
      setHoverGuide(null) // ปล่อยแล้วซ่อนถังขยะ (จำเป็นบนทัชที่ไม่มี hover)
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
      return
    }
    if (pan.current) {
      // ลากพื้นที่ว่างแบบไม่ขยับ = คลิกที่ว่าง → ยกเลิกการเลือก
      if (!pan.current.moved) onSelect?.(null)
      pan.current = null
    }
    grab.current = null
    snapT.current = null
    setActive(false)
    setSnap({ vx: null, vy: null })
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    // คลิกข้อความที่เลือกอยู่แล้วโดยไม่ลาก → เข้าโหมดพิมพ์แก้บน blueprint
    if (editCandidate.current && !dragMoved.current) setEditing(editCandidate.current)
    editCandidate.current = null
  }

  // กดพื้นที่ว่าง = เริ่มลาก pan (ตอนซูม) หรือถ้าไม่ขยับก็ยกเลิกการเลือกตอนปล่อย
  const onBgDown = (e: React.PointerEvent) => {
    if (!editable || grab.current || pinch.current) return
    if (editing) setEditing(null) // คลิกพื้นที่ว่าง = ออกจากโหมดแก้ข้อความ
    pan.current = { sx: e.clientX, sy: e.clientY, cx: viewCx, cy: viewCy, moved: false }
    capture(e)
  }

  // เพิ่มเส้นไกด์ตรงกลางมุมมองปัจจุบัน
  const addGuide = (axis: 'x' | 'y') =>
    setGuideLines((gs) => [...gs, { id: `gd${guideSeq++}`, axis, pos: Math.round(axis === 'x' ? viewCx : viewCy) }])

  const startGuideDrag = (e: React.PointerEvent, g: { id: string; axis: 'x' | 'y' }) => {
    guideDrag.current = { id: g.id, axis: g.axis }
    setGuideHover(g.id) // โชว์ถังขยะที่ขอบทันทีที่จับเส้น (รองรับทัชที่ไม่มี hover)
    capture(e)
    e.stopPropagation()
    e.preventDefault()
  }

  // --- viewBox ตามซูม/แพน ---
  const MAXZOOM = 8
  const baseW = dieline.width + pad * 2
  const baseH = dieline.height + pad * 2
  const vw = baseW / zoom
  const vh = baseH / zoom
  const viewCx = center?.x ?? dieline.width / 2
  const viewCy = center?.y ?? dieline.height / 2
  const clampCenter = (x: number, y: number) => ({
    x: Math.min(Math.max(x, -pad), dieline.width + pad),
    y: Math.min(Math.max(y, -pad), dieline.height + pad),
  })
  // ซูมโดยตรึงจุดโฟกัส (fx,fy บนแผ่น) ให้อยู่ที่เดิม
  const zoomAt = (factor: number, fx: number, fy: number) => {
    const nz = Math.min(MAXZOOM, Math.max(1, zoom * factor))
    if (nz <= 1) {
      setZoom(1)
      setCenter(null)
      return
    }
    setZoom(nz)
    setCenter(clampCenter(fx - (fx - viewCx) * (zoom / nz), fy - (fy - viewCy) * (zoom / nz)))
  }
  const fit = () => {
    setZoom(1)
    setCenter(null)
  }

  // --- พินช์สองนิ้ว (ทัช/iPad) --- ติดตาม pointer ที่ capture phase เพื่อให้จับได้แม้นิ้วแรกลงบน artwork
  const pinchDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      // เข้าโหมดพินช์ → ยกเลิกการลาก/แพน/ลากไกด์นิ้วเดียวที่อาจเริ่มไปแล้ว
      grab.current = null
      pan.current = null
      guideDrag.current = null
      snapT.current = null
      setActive(false)
      setSnap({ vx: null, vy: null })
      const [a, b] = [...pointers.current.values()]
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1 }
    }
  }
  const pinchMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (!pinch.current || pointers.current.size < 2) return
    e.preventDefault()
    const [a, b] = [...pointers.current.values()]
    const dist = Math.hypot(a.x - b.x, a.y - b.y)
    const mid = toSheet((a.x + b.x) / 2, (a.y + b.y) / 2)
    if (mid && dist > 0) zoomAt(dist / pinch.current.dist, mid.x, mid.y)
    if (dist > 0) pinch.current.dist = dist
  }
  const pinchUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
  }

  // เปลี่ยนขนาดแผ่น (เปลี่ยน template/ขนาด) → กลับไปพอดีจอ
  useEffect(() => {
    setZoom(1)
    setCenter(null)
  }, [dieline.width, dieline.height])

  // ล้อเมาส์ซูมที่ตำแหน่งเคอร์เซอร์ — เฉพาะเมื่อกด Ctrl/⌘ (กันเผลอซูมตอนสกอลล์ธรรมดา)
  // (non-passive เพื่อ preventDefault กันเบราว์เซอร์ซูมทั้งหน้า)
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !editable) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return // สกอลล์เฉยๆ ไม่ซูม
      e.preventDefault()
      const f = toSheet(e.clientX, e.clientY)
      if (f) zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, f.x, f.y)
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, center, pad, dieline.width, dieline.height])

  // เส้นไกด์ที่กำลังโฟกัส (ลากอยู่ก่อน ไม่งั้นตัวที่ชี้) → ใช้เลือกว่าจะโชว์ถังขยะขอบไหน
  const activeGuide = guideLines.find((g) => g.id === (guideDrag.current?.id ?? hoverGuide)) ?? null

  // กล่องพิมพ์แก้ข้อความในที่ — วางทับตำแหน่งข้อความบน blueprint (พิกัดจอเทียบ .bp-canvas)
  const editSrc = editing != null ? decos.find((d) => d.id === editing) : undefined
  const editText = editSrc && editSrc.type === 'text' ? editSrc : undefined
  const editBox = (() => {
    const svg = svgRef.current
    if (!editText || !svg) return null
    const host = svg.parentElement
    const ctm = svg.getScreenCTM()
    if (!host || !ctm) return null
    const toScr = (x: number, y: number) => {
      const p = svg.createSVGPoint()
      p.x = x
      p.y = y
      return p.matrixTransform(ctm)
    }
    const a = toScr(editText.x, editText.y)
    const b = toScr(editText.x + elW(editText), editText.y + elH(editText))
    const hr = host.getBoundingClientRect()
    return {
      left: Math.min(a.x, b.x) - hr.left,
      top: Math.min(a.y, b.y) - hr.top,
      width: Math.abs(b.x - a.x),
      height: Math.abs(b.y - a.y),
      scale: ctm.a,
    }
  })()

  return (
    <div className="bp-canvas">
    {editable && (
      <div className={`bp-tools${selectedIds.length > 0 ? ' below-topbar' : ''}`}>
        <button
          type="button"
          className="bp-tool"
          title={showRuler ? 'ซ่อนไม้บรรทัด' : 'แสดงไม้บรรทัด'}
          aria-label="เปิด-ปิดไม้บรรทัด"
          aria-pressed={showRuler}
          onClick={() => setShowRuler((r) => !r)}
        >
          📏
        </button>
        <button type="button" className="bp-tool" title="เพิ่มเส้นไกด์ตั้ง" aria-label="เพิ่มเส้นไกด์ตั้ง" onClick={() => addGuide('x')}>
          ￨＋
        </button>
        <button type="button" className="bp-tool" title="เพิ่มเส้นไกด์นอน" aria-label="เพิ่มเส้นไกด์นอน" onClick={() => addGuide('y')}>
          －＋
        </button>
        {(onUndo || onRedo) && <span className="bp-tools-sep" />}
        {onUndo && (
          <button type="button" className="bp-tool" title="เลิกทำ (Ctrl+Z)" aria-label="เลิกทำ" aria-disabled={!canUndo} onClick={onUndo}>
            ↶
          </button>
        )}
        {onRedo && (
          <button type="button" className="bp-tool" title="ทำซ้ำ (Ctrl+Shift+Z)" aria-label="ทำซ้ำ" aria-disabled={!canRedo} onClick={onRedo}>
            ↷
          </button>
        )}
      </div>
    )}
    <svg
      ref={svgRef}
      className={`dieline-svg${zoom > 1 ? ' zoomed' : ''}`}
      viewBox={`${viewCx - vw / 2} ${viewCy - vh / 2} ${vw} ${vh}`}
      preserveAspectRatio="xMidYMid meet"
      onPointerMove={onMoveEvt}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      // กดพื้นที่ว่าง = เริ่ม pan / คลิกเปล่า = ยกเลิกการเลือก
      onPointerDown={onBgDown}
      // พินช์สองนิ้ว: ติดตามที่ capture phase (ทำงานก่อน handler ของ artwork ที่ stopPropagation)
      onPointerDownCapture={pinchDown}
      onPointerMoveCapture={pinchMove}
      onPointerUpCapture={pinchUp}
      onPointerCancelCapture={pinchUp}
    >
      {fillImage ? (
        <g className="fill" pointerEvents="none" opacity={fillImage.opacity ?? 1}>
          <defs>
            <clipPath id="bp-fillclip" clipPathUnits="userSpaceOnUse">
              {dieline.panels.map((p, i) => (
                <polygon key={i} points={p.outline.map((q) => `${q.x},${q.y}`).join(' ')} />
              ))}
            </clipPath>
          </defs>
          {(() => {
            const box = panelsBBox(dieline)
            const r = fillImageRect(box, fillImage)
            const cx = (box.x0 + box.x1) / 2
            const cy = (box.y0 + box.y1) / 2
            return (
              // clip บน <g> ชั้นนอก (ไม่หมุน) แล้วหมุนเฉพาะ <image> ข้างใน
              <g clipPath="url(#bp-fillclip)">
                <image
                  href={fillImage.src}
                  x={r.x}
                  y={r.y}
                  width={r.w}
                  height={r.h}
                  preserveAspectRatio="none"
                  transform={fillImage.rot ? `rotate(${fillImage.rot} ${cx} ${cy})` : undefined}
                />
              </g>
            )
          })()}
        </g>
      ) : (
        fillColor && (
          <g className="fill" pointerEvents="none">
            {dieline.panels.map((p, i) => (
              <polygon key={i} points={p.outline.map((q) => `${q.x},${q.y}`).join(' ')} fill={fillColor} />
            ))}
          </g>
        )
      )}
      {showGrid && (
        <g className="grid" pointerEvents="none">
          {/* เส้นกริดทุก 10 มม. เน้นทุก 50 มม. (พิกัดแผ่นคลี่ อ้างมุมกล่อง 0,0) */}
          {gridTicks(dieline.width).map((x) => (
            <line
              key={`gx${x}`}
              x1={x}
              y1={0}
              x2={x}
              y2={dieline.height}
              stroke={x % 50 === 0 ? '#c0b9a4' : '#e4dfd1'}
              strokeWidth={x % 50 === 0 ? 0.7 : 0.4}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {gridTicks(dieline.height).map((y) => (
            <line
              key={`gy${y}`}
              x1={0}
              y1={y}
              x2={dieline.width}
              y2={y}
              stroke={y % 50 === 0 ? '#c0b9a4' : '#e4dfd1'}
              strokeWidth={y % 50 === 0 ? 0.7 : 0.4}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
      )}
      {dieline.segments.map((s, i) => (
        <path
          key={i}
          d={s.d}
          fill="none"
          stroke={s.kind === 'cut' ? '#43403a' : '#12876a'}
          strokeWidth={s.kind === 'cut' ? 1.2 : 1}
          strokeDasharray={s.kind === 'crease' ? '3.5 2.5' : undefined}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {decos.filter((d) => !d.hidden).map((d) => {
        const w = elW(d)
        const h = elH(d)
        const c = elCenter(d)
        const sel = selectedIds.includes(d.id)
        const single = sel && selectedIds.length === 1 // ก้านหมุน/กากบาทลบ โชว์เฉพาะตอนเลือกชิ้นเดียว
        const handleY = d.y - Math.max(8, h * 0.25) // ก้านหมุนเหนือกล่อง
        return (
          <g
            key={d.id}
            className={`deco${sel ? ' selected' : ''}${active && sel ? ' dragging' : ''}${d.locked ? ' locked' : ''}`}
            transform={`rotate(${d.rot} ${c.x} ${c.y})`}
            onPointerDown={(e) => startMove(e, d)}
            onDoubleClick={(e) => {
              if (d.type === 'text' && editable && !d.locked) {
                e.stopPropagation()
                onSelect?.(d.id, false)
                setEditing(d.id)
              }
            }}
          >
            <DecoBody e={d} />
            {sel && (
              <>
                <rect
                  x={d.x}
                  y={d.y}
                  width={w}
                  height={h}
                  fill="none"
                  stroke={SEL_COLOR}
                  strokeWidth={1}
                  strokeDasharray="4 3"
                  vectorEffect="non-scaling-stroke"
                />
                {editable && single && !d.locked && (
                  <g className="rot-handle" onPointerDown={(e) => startRotate(e, d)}>
                    <line
                      x1={c.x}
                      y1={d.y}
                      x2={c.x}
                      y2={handleY}
                      stroke={SEL_COLOR}
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                    />
                    <circle cx={c.x} cy={handleY} r={3} fill="#fff" stroke={SEL_COLOR} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                  </g>
                )}
                {editable && single && onRemove && !d.locked && (
                  // กากบาทลบที่มุมขวาบนของชิ้น — กด pointerdown แล้วลบทันที (stopPropagation กันไปเริ่มลาก)
                  <g
                    className="del-handle"
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      onRemove(d.id)
                    }}
                  >
                    <circle cx={d.x + w} cy={d.y} r={3.4} fill="#fff" stroke={DEL_COLOR} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                    <line x1={d.x + w - 1.7} y1={d.y - 1.7} x2={d.x + w + 1.7} y2={d.y + 1.7} stroke={DEL_COLOR} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                    <line x1={d.x + w - 1.7} y1={d.y + 1.7} x2={d.x + w + 1.7} y2={d.y - 1.7} stroke={DEL_COLOR} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                  </g>
                )}
              </>
            )}
          </g>
        )
      })}

      {active && (snap.vx !== null || snap.vy !== null) && (
        <g className="snap-lines" pointerEvents="none">
          {snap.vx !== null && (
            <line
              x1={snap.vx}
              y1={-pad}
              x2={snap.vx}
              y2={dieline.height + pad}
              stroke={SNAP_COLOR}
              strokeWidth={0.8}
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {snap.vy !== null && (
            <line
              x1={-pad}
              y1={snap.vy}
              x2={dieline.width + pad}
              y2={snap.vy}
              stroke={SNAP_COLOR}
              strokeWidth={0.8}
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </g>
      )}

      {guides && (
        <g className="guides" pointerEvents="none">
          {guides.safe.map((poly, i) => (
            <polygon
              key={`s${i}`}
              points={poly.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke={SAFE_COLOR}
              strokeWidth={0.8}
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {guides.bleed.map(([a, b], i) => (
            <line
              key={`b${i}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={BLEED_COLOR}
              strokeWidth={0.8}
              strokeDasharray="3 2"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
      )}

      {/* ไม้บรรทัด: ตัวเลข มม. ตามขอบบน/ซ้าย (ในพิกัดแผ่น จึงซูม/แพนตาม) */}
      {showRuler && (
        <g className="ruler" pointerEvents="none">
          {gridTicks(dieline.width)
            .filter((x) => x % 50 === 0)
            .map((x) => (
              <text key={`rx${x}`} x={x} y={-pad + 8} textAnchor="middle" fontSize={6} fill="#8a8474" stroke="none">
                {x}
              </text>
            ))}
          {gridTicks(dieline.height)
            .filter((y) => y % 50 === 0 && y > 0)
            .map((y) => (
              <text key={`ry${y}`} x={-pad + 3} y={y} textAnchor="start" dominantBaseline="central" fontSize={6} fill="#8a8474" stroke="none">
                {y}
              </text>
            ))}
        </g>
      )}

      {/* เส้นไกด์ลากเอง (สีฟ้า) — ชี้/ลากแล้วถังขยะจะโผล่ที่ขอบ (ขวา=เส้นตั้ง, ล่าง=เส้นนอน) */}
      {guideLines.map((g) =>
        g.axis === 'x' ? (
          <g
            key={g.id}
            className="guide"
            onPointerDown={(e) => startGuideDrag(e, g)}
            onPointerEnter={() => setGuideHover(g.id)}
            onPointerLeave={() => setGuideHover(null)}
          >
            <title>ลากไปทางถังขยะขวา หรือคลิกถังขยะเพื่อลบเส้นไกด์</title>
            <line x1={g.pos} y1={-pad} x2={g.pos} y2={dieline.height + pad} stroke={GUIDE_COLOR} strokeWidth={0.7} vectorEffect="non-scaling-stroke" />
            <line x1={g.pos} y1={-pad} x2={g.pos} y2={dieline.height + pad} stroke="transparent" strokeWidth={10} vectorEffect="non-scaling-stroke" style={{ cursor: 'ew-resize' }} />
            {guideDrag.current?.id === g.id && (
              <text x={g.pos + 2} y={-pad + 8} fontSize={6} fill={GUIDE_COLOR} stroke="none">
                {Math.round(g.pos)}
              </text>
            )}
          </g>
        ) : (
          <g
            key={g.id}
            className="guide"
            onPointerDown={(e) => startGuideDrag(e, g)}
            onPointerEnter={() => setGuideHover(g.id)}
            onPointerLeave={() => setGuideHover(null)}
          >
            <title>ลากไปทางถังขยะล่าง หรือคลิกถังขยะเพื่อลบเส้นไกด์</title>
            <line x1={-pad} y1={g.pos} x2={dieline.width + pad} y2={g.pos} stroke={GUIDE_COLOR} strokeWidth={0.7} vectorEffect="non-scaling-stroke" />
            <line x1={-pad} y1={g.pos} x2={dieline.width + pad} y2={g.pos} stroke="transparent" strokeWidth={10} vectorEffect="non-scaling-stroke" style={{ cursor: 'ns-resize' }} />
            {guideDrag.current?.id === g.id && (
              <text x={-pad + 3} y={g.pos - 2} fontSize={6} fill={GUIDE_COLOR} stroke="none">
                {Math.round(g.pos)}
              </text>
            )}
          </g>
        ),
      )}

      {showDims && dieline.dims.map((d, i) => <Dim key={i} d={d} />)}
    </svg>
    {/* ถังขยะลบเส้นไกด์ที่ขอบ canvas — โผล่ตามแกนของเส้นที่ชี้/ลากอยู่ (ขวา=เส้นตั้ง, ล่าง=เส้นนอน) */}
    {editable && activeGuide && (
      <button
        type="button"
        className={`guide-del ${activeGuide.axis === 'x' ? 'guide-del-v' : 'guide-del-h'}`}
        title="ลบเส้นไกด์นี้ (หรือลากเส้นมาทางนี้)"
        aria-label="ลบเส้นไกด์"
        onPointerEnter={() => setGuideHover(activeGuide.id)}
        onPointerLeave={() => setGuideHover(null)}
        onClick={() => deleteGuide(activeGuide.id)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v5M14 11v5" />
        </svg>
      </button>
    )}
    {editable && (
      <div className="zoom-toolbar">
        <button
          type="button"
          className="grid-toggle"
          title={showGrid ? 'ซ่อนกริด' : 'แสดงกริด'}
          aria-label="เปิด-ปิดกริด"
          aria-pressed={showGrid}
          onClick={() => setShowGrid((g) => !g)}
        >
          ▦
        </button>
        <span className="zoom-sep" />
        <button type="button" title="ซูมออก" aria-label="ซูมออก" disabled={zoom <= 1} onClick={() => zoomAt(1 / 1.3, viewCx, viewCy)}>
          −
        </button>
        <button type="button" title="พอดีจอ (ซูม: Ctrl/⌘ + ล้อเมาส์)" aria-label="พอดีจอ" onClick={fit}>
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" title="ซูมเข้า" aria-label="ซูมเข้า" disabled={zoom >= MAXZOOM} onClick={() => zoomAt(1.3, viewCx, viewCy)}>
          ＋
        </button>
      </div>
    )}
    {editText && editBox && (
      <textarea
        className="deco-inline-edit"
        autoFocus
        value={editText.text}
        aria-label="แก้ข้อความ (Esc = เสร็จ)"
        onChange={(e) => onText?.(editText.id, e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') e.currentTarget.blur()
        }}
        onBlur={() => setEditing(null)}
        style={{
          left: editBox.left,
          top: editBox.top,
          width: Math.max(80, editBox.width),
          height: Math.max(30, editBox.height),
          fontFamily: `${fontCss(editText.font)}, sans-serif`,
          fontSize: Math.max(11, editText.size * editBox.scale),
          lineHeight: String(editText.lh ?? 1.25),
          color: editText.color,
          textAlign: editText.align ?? 'left',
          fontWeight: editText.weight ?? 400,
        }}
      />
    )}
    </div>
  )
})
