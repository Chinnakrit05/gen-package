import { memo, useRef, useState } from 'react'
import type { Dieline, DimMark } from '../core/types'
import { elW, elH, elCenter, type Deco } from '../core/artwork'
import { snapTargets, applySnap, type SnapTargets } from '../core/snap'
import type { Guides } from '../core/guides'

const DIM_COLOR = '#1b6ea8'
const SEL_COLOR = '#1b6ea8'
const SAFE_COLOR = '#1b6ea8'
const BLEED_COLOR = '#c0158a'
const DEL_COLOR = '#c0392b'
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
function DecoBody({ e }: { e: Deco }) {
  const w = elW(e)
  const h = elH(e)
  if (e.type === 'image') {
    return <image href={e.src} x={e.x} y={e.y} width={w} height={h} preserveAspectRatio="none" />
  }
  const c = elCenter(e)
  return (
    <text
      x={c.x}
      y={c.y}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={e.size}
      fill={e.color}
      stroke="none"
      style={{ userSelect: 'none' }}
    >
      {e.text}
    </text>
  )
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
  selectedId,
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
  selectedId?: string | null
  onSelect?: (id: string | null) => void
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
    onSelect?.(d.id)
    const p = toSheet(e.clientX, e.clientY)
    if (!p) return
    grab.current = { mode: 'move', id: d.id, dx: p.x - d.x, dy: p.y - d.y }
    // เส้นเป้าหมายคงที่ตลอดการลาก (แผงนิ่ง, ชิ้นอื่นนิ่ง) — คิดครั้งเดียวตอนเริ่ม
    snapT.current = snapTargets(dieline.panels, decos, d.id, dieline.width, dieline.height)
    setActive(true)
    capture(e)
    e.stopPropagation()
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
    grab.current = null
    snapT.current = null
    setActive(false)
    setSnap({ vx: null, vy: null })
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  return (
    <svg
      ref={svgRef}
      className="dieline-svg"
      viewBox={`${-pad} ${-pad} ${dieline.width + pad * 2} ${dieline.height + pad * 2}`}
      preserveAspectRatio="xMidYMid meet"
      onPointerMove={onMoveEvt}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      // คลิกที่ว่าง = ยกเลิกการเลือก
      onPointerDown={() => editable && !grab.current && onSelect?.(null)}
    >
      {fillColor && (
        <g className="fill" pointerEvents="none">
          {dieline.panels.map((p, i) => (
            <polygon key={i} points={p.outline.map((q) => `${q.x},${q.y}`).join(' ')} fill={fillColor} />
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

      {decos.map((d) => {
        const w = elW(d)
        const h = elH(d)
        const c = elCenter(d)
        const sel = d.id === selectedId
        const handleY = d.y - Math.max(8, h * 0.25) // ก้านหมุนเหนือกล่อง
        return (
          <g
            key={d.id}
            className={`deco${sel ? ' selected' : ''}${active && sel ? ' dragging' : ''}`}
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
                {editable && (
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
                {editable && onRemove && (
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
  )
})
