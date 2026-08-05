import { memo, useEffect, useRef, useState } from 'react'
import type { Dieline, DimMark } from '../core/types'
import { elW, elH, elCenter, flipTransform, fontCss, gradientId, gradientSVGString, type Deco } from '../core/artwork'
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
    return <image href={e.src} x={e.x} y={e.y} width={w} height={h} preserveAspectRatio="none" />
  }
  if (e.type === 'shape') {
    const strokeProps =
      e.stroke !== 'none' && e.strokeW > 0 ? { stroke: e.stroke, strokeWidth: e.strokeW } : {}
    if (e.shape === 'line') {
      const cy = e.y + e.h / 2
      return <line x1={e.x} y1={cy} x2={e.x + e.w} y2={cy} stroke={e.stroke} strokeWidth={e.strokeW} strokeLinecap="round" />
    }
    const gid = gradientId(e.id)
    const fill = e.grad ? `url(#${gid})` : e.fill
    // ไล่สี: ฝัง <defs> จากสตริงเดียวกับ export (กัน logic ต่างกัน) ผ่าน dangerouslySetInnerHTML บน <g>
    const defs = e.grad ? (
      <g dangerouslySetInnerHTML={{ __html: `<defs>${gradientSVGString(e)}</defs>` }} />
    ) : null
    const body =
      e.shape === 'ellipse' ? (
        <ellipse cx={e.x + w / 2} cy={e.y + h / 2} rx={w / 2} ry={h / 2} fill={fill} {...strokeProps} />
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
  const c = elCenter(e)
  return (
    <text
      x={c.x}
      y={c.y}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={e.size}
      fontWeight={e.weight ?? 400}
      fontFamily={`${fontCss(e.font)}, sans-serif`}
      fill={e.color}
      stroke="none"
      style={{ userSelect: 'none' }}
    >
      {e.text}
    </text>
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
  selectedIds = [],
  onSelect,
  onMove,
  onRotate,
  onRemove,
}: {
  dieline: Dieline
  showDims: boolean
  decos?: Deco[]
  guides?: Guides | null
  fillColor?: string | null
  selectedIds?: string[]
  onSelect?: (id: string | null, additive?: boolean) => void
  onMove?: (id: string, x: number, y: number) => void
  onRotate?: (id: string, deg: number) => void
  onRemove?: (id: string) => void
}) {
  const pad = showDims ? 26 : 12
  const svgRef = useRef<SVGSVGElement>(null)
  const grab = useRef<Grab | null>(null)
  const snapT = useRef<SnapTargets | null>(null)
  const [active, setActive] = useState(false)
  // เส้นไกด์ที่กำลังดูดติด (ค่า x ของเส้นตั้ง / y ของเส้นนอน) — null = ไม่มี
  const [snap, setSnap] = useState<{ vx: number | null; vy: number | null }>({ vx: null, vy: null })
  // ซูม/แพน blueprint ผ่าน viewBox — zoom=1 คือพอดีจอ, center=null คือกึ่งกลาง
  const [zoom, setZoom] = useState(1)
  const [center, setCenter] = useState<{ x: number; y: number } | null>(null)
  const [showGrid, setShowGrid] = useState(false)
  const pan = useRef<{ sx: number; sy: number; cx: number; cy: number; moved: boolean } | null>(null)
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
    // เส้นเป้าหมายคงที่ตลอดการลาก (แผงนิ่ง, ชิ้นอื่นนิ่ง) — คิดครั้งเดียวตอนเริ่ม
    snapT.current = snapTargets(dieline.panels, decos, d.id, dieline.width, dieline.height)
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
  }

  // กดพื้นที่ว่าง = เริ่มลาก pan (ตอนซูม) หรือถ้าไม่ขยับก็ยกเลิกการเลือกตอนปล่อย
  const onBgDown = (e: React.PointerEvent) => {
    if (!editable || grab.current) return
    pan.current = { sx: e.clientX, sy: e.clientY, cx: viewCx, cy: viewCy, moved: false }
    capture(e)
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

  // เปลี่ยนขนาดแผ่น (เปลี่ยน template/ขนาด) → กลับไปพอดีจอ
  useEffect(() => {
    setZoom(1)
    setCenter(null)
  }, [dieline.width, dieline.height])

  // ล้อเมาส์ซูมที่ตำแหน่งเคอร์เซอร์ (ต้อง non-passive เพื่อ preventDefault กันหน้าเลื่อน)
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !editable) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const f = toSheet(e.clientX, e.clientY)
      if (f) zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, f.x, f.y)
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, center, pad, dieline.width, dieline.height])

  return (
    <div className="bp-canvas">
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
    >
      {fillColor && (
        <g className="fill" pointerEvents="none">
          {dieline.panels.map((p, i) => (
            <polygon key={i} points={p.outline.map((q) => `${q.x},${q.y}`).join(' ')} fill={fillColor} />
          ))}
        </g>
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

      {showDims && dieline.dims.map((d, i) => <Dim key={i} d={d} />)}
    </svg>
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
        <button type="button" title="พอดีจอ" aria-label="พอดีจอ" onClick={fit}>
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" title="ซูมเข้า" aria-label="ซูมเข้า" disabled={zoom >= MAXZOOM} onClick={() => zoomAt(1.3, viewCx, viewCy)}>
          ＋
        </button>
      </div>
    )}
    </div>
  )
})
