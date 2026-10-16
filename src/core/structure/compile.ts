// คอมไพเลอร์ภาษาแผง → Dieline: วางแผงบนแผ่นคลี่ตามต้นไม้การต่อ, สร้างลิ้นจากคลัง, เดาลำดับพับ/ชั้นวัสดุ
// ด้วย fold engine จริง แล้วตรวจ (ซ้อนทับบนแผ่น, กวาดทะลุ, ด้านที่เปิด) — ผลเป็น Dieline ชุดเดียวกับ template
// ปกติ (panels + segments จาก autoSegments) จึงเข้า 3D/blueprint/ไฟล์ส่งออกเดิมได้เลย
import { Matrix4, Vector3 } from 'three'
import type { BoxParams, Dieline, DimMark, Material, Panel, Vec2 } from '../types'
import { P, autoSegments, fmt } from '../templates/shared'
import { computeMatrices, to3D } from '../fold'
import type { BoxStructure, Dim, Edge, FlapType, StructureIssue } from './grammar'
import {
  checkFoldSweep,
  coverageByFace,
  findLandings,
  isAncestor,
  normalOf,
  polygonsOverlap,
  rayExtent,
  type Face,
} from './validate'

export interface CompileResult {
  ok: boolean // ไม่มี issue ระดับ error
  dieline: Dieline | null // null เมื่อโครงสร้างผิดจนวางแผงไม่ได้
  tilt: number // ส่งให้ Viewer3D (ถาด/ฐานวางพื้นเอียง −90° เหมือน template mailer/tray)
  foldDepth: number
  stages: number
  issues: StructureIssue[]
  coverage: Partial<Record<Face, number>>
}

// แผงที่วางบนแผ่นคลี่แล้ว (ก่อนรวมเป็น Panel ของ Dieline)
interface Placed {
  id: string
  kind: 'body' | 'lid' | 'glue' | 'flap'
  flapType?: FlapType
  parentId: string | null
  rect: { x0: number; y0: number; x1: number; y1: number }
  outline: Vec2[]
  hingeA?: Vec2
  hingeB?: Vec2
  foldAngle?: number
  stage: number
  zOffset: number
  tuck?: boolean
  side: 'in' | 'out'
  depth: number // ระยะยื่นจากบานพับ (มม.)
  lateralInset: number // ฝาที่สอดระหว่างผนังถูกหดข้างละเท่านี้ (ลิ้นบนฝานั้นไม่ต้องหดซ้ำ)
}

interface EdgeFrame {
  a: Vec2 // ปลายบานพับตามลำดับที่ fold engine ใช้: แนวตั้ง บน→ล่าง, แนวนอน ซ้าย→ขวา
  b: Vec2
  along: Vec2 // ทิศ a→b (หน่วย)
  out: Vec2 // ทิศออกจากแผง (หน่วย)
  len: number
  sign: 1 | -1 // เครื่องหมายมุมพับที่ทำให้พับ "เข้าด้านใน" (+z) — ดูการพิสูจน์ใน fold.ts/tuckEnd.ts
}

function edgeFrame(r: Placed['rect'], edge: Edge): EdgeFrame {
  switch (edge) {
    case 'top':
      return { a: P(r.x0, r.y0), b: P(r.x1, r.y0), along: P(1, 0), out: P(0, -1), len: r.x1 - r.x0, sign: 1 }
    case 'bottom':
      return { a: P(r.x0, r.y1), b: P(r.x1, r.y1), along: P(1, 0), out: P(0, 1), len: r.x1 - r.x0, sign: -1 }
    case 'left':
      return { a: P(r.x0, r.y0), b: P(r.x0, r.y1), along: P(0, 1), out: P(-1, 0), len: r.y1 - r.y0, sign: -1 }
    case 'right':
      return { a: P(r.x1, r.y0), b: P(r.x1, r.y1), along: P(0, 1), out: P(1, 0), len: r.y1 - r.y0, sign: 1 }
  }
}

const add = (p: Vec2, ...terms: [Vec2, number][]): Vec2 =>
  terms.reduce((acc, [v, k]) => P(acc.x + v.x * k, acc.y + v.y * k), p)

// โค้งจาก c ตามทิศ d0 ไป d1 (ควอเตอร์วง) รัศมี r — n ช่วง เหมือน arcPts ของ template
function quarterArc(c: Vec2, r: number, d0: Vec2, d1: Vec2, n = 5): Vec2[] {
  const pts: Vec2[] = []
  for (let i = 0; i <= n; i++) {
    const s = (Math.PI / 2) * (i / n)
    pts.push(add(c, [d0, r * Math.cos(s)], [d1, r * Math.sin(s)]))
  }
  return pts
}

export const SHEET_LIMIT = 600 // มม. — แผ่นคลี่ใหญ่กว่านี้เตือน (เครื่องตัด/แผ่นมาตรฐาน)
const MAX_STAGES = 7 // fold.ts มีชุดจังหวะถึง 7 (WINDOWS_7)

export function compileStructure(structure: BoxStructure, box: BoxParams, mat: Material): CompileResult {
  const issues: StructureIssue[] = []
  const err = (code: string, message: string, ids?: string[]) => issues.push({ severity: 'error', code, message, ids })
  const warn = (code: string, message: string, ids?: string[]) => issues.push({ severity: 'warning', code, message, ids })
  const t = mat.thickness
  const layer = t + 0.05
  const tilt = structure.orientation === 'base' ? -Math.PI / 2 : 0
  const fail = (): CompileResult => ({ ok: false, dieline: null, tilt, foldDepth: 0, stages: 0, issues, coverage: {} })

  // ขนาดเชิงสัญลักษณ์ → ระยะ score (ด้านใน + 2t ต่อแกน เหมือน template); ตัวเลข = มม. ตรง ๆ
  const padded = { W: box.W + 2 * t, D: box.D + 2 * t, H: box.H + 2 * t }
  const resolve = (d: Dim): number => {
    if (typeof d === 'number') return d
    const [name, half] = d.split('/') as ['W' | 'D' | 'H', string | undefined]
    return padded[name] / (half ? 2 : 1)
  }

  // --- 1. วางแผงตามต้นไม้ ---
  const byId = new Map(structure.panels.map((p) => [p.id, p]))
  const root = structure.panels.find((p) => !p.attach)
  if (!root || !root.w || !root.h) {
    err('root', 'ไม่พบแผงรากที่มี w/h')
    return fail()
  }
  const placed = new Map<string, Placed>()
  const order: Placed[] = []
  const rw = resolve(root.w)
  const rh = resolve(root.h)
  const rootP: Placed = {
    id: root.id, kind: root.kind === 'glue' ? 'body' : root.kind, parentId: null,
    rect: { x0: 0, y0: 0, x1: rw, y1: rh }, outline: [P(0, 0), P(rw, 0), P(rw, rh), P(0, rh)],
    stage: 0, zOffset: 0, side: 'in', depth: 0, lateralInset: 0,
  }
  if (root.kind !== 'body') warn('root-kind', `แผงราก "${root.id}" ควรเป็น kind body (ใช้เป็น body)`, [root.id])
  placed.set(root.id, rootP)
  order.push(rootP)

  const children = new Map<string, typeof structure.panels>()
  for (const p of structure.panels) if (p.attach) children.set(p.attach.to, [...(children.get(p.attach.to) ?? []), p])
  const glueW = Math.max(12, 10 + 2 * t)
  const taper = 4
  const dustIn = Math.max(1.5, 2 * t + 0.5)
  const tuckIn = Math.max(1, t + 0.5)
  // ฝาที่สอดเข้าช่องเปิดต้องแคบกว่าช่องเล็กน้อย (หลบความหนาผนังข้าง) — ยกเว้นฝาที่มีปีกห่อนอกผนัง (side out)
  // ซึ่งต้องกว้างเต็มช่องให้ปีกตกลงนอกผนังพอดี
  const lidInset = (lidId: string, edge: Edge): number => {
    const sides: Edge[] = edge === 'top' || edge === 'bottom' ? ['left', 'right'] : ['top', 'bottom']
    return structure.flaps.some((f) => f.on === lidId && f.side === 'out' && sides.includes(f.edge)) ? 0 : tuckIn
  }
  const stack = [root.id]
  while (stack.length) {
    const parentId = stack.shift()!
    const parent = placed.get(parentId)!
    for (const sp of children.get(parentId) ?? []) {
      const { edge, fold } = sp.attach!
      const f = edgeFrame(parent.rect, edge)
      let size = sp.kind === 'glue' ? glueW : resolve(sp.size ?? 0)
      if (sp.kind === 'lid') size = Math.max(6, size - t) // ฝาสั้นกว่าช่องเปิดเล็กน้อยให้สอด/ปิดได้
      if (sp.kind === 'glue' && sp.size) size = resolve(sp.size)
      if (!(size >= 3)) {
        err('size', `แผง "${sp.id}" ขนาด ${fmt(size)} มม. เล็กเกินไป`, [sp.id])
        continue
      }
      const r = parent.rect
      const li = sp.kind === 'lid' ? Math.min(lidInset(sp.id, edge), f.len / 4) : 0
      if (sp.kind !== 'glue' && f.len - 2 * li < 6) {
        err('size', `แผง "${sp.id}" ต่อขอบ ${edge} ของ "${parentId}" ที่ยาวแค่ ${fmt(f.len)} มม. แคบเกินไป`, [sp.id])
        continue
      }
      const rect =
        edge === 'top' ? { x0: r.x0 + li, y0: r.y0 - size, x1: r.x1 - li, y1: r.y0 }
        : edge === 'bottom' ? { x0: r.x0 + li, y0: r.y1, x1: r.x1 - li, y1: r.y1 + size }
        : edge === 'left' ? { x0: r.x0 - size, y0: r.y0 + li, x1: r.x0, y1: r.y1 - li }
        : { x0: r.x1, y0: r.y0 + li, x1: r.x1 + size, y1: r.y1 - li }
      const hingeA = add(f.a, [f.along, li])
      const hingeB = add(f.b, [f.along, -li])
      let outline: Vec2[]
      if (sp.kind === 'glue') {
        // ปีกทากาวขอบไกลเฉียง (taper) เหมือน template
        const tp = Math.min(taper, f.len / 3)
        outline = [f.a, f.b, add(f.b, [f.out, size], [f.along, -tp]), add(f.a, [f.out, size], [f.along, tp])]
      } else {
        outline = [P(rect.x0, rect.y0), P(rect.x1, rect.y0), P(rect.x1, rect.y1), P(rect.x0, rect.y1)]
      }
      const stage = sp.kind === 'lid' ? parent.stage + 1 : parent.stage
      const pl: Placed = {
        id: sp.id, kind: sp.kind, parentId, rect, outline,
        hingeA, hingeB, foldAngle: f.sign * fold, stage, zOffset: 0, side: 'in', depth: size, lateralInset: li,
      }
      placed.set(sp.id, pl)
      order.push(pl)
      stack.push(sp.id)
    }
  }
  for (const sp of structure.panels) if (!placed.has(sp.id) && byId.has(sp.attach?.to ?? '')) {
    // แม่ไม่ถูกวาง (ขนาดผิด) — ข้ามพร้อมแจ้ง
    if (!issues.some((i) => i.ids?.includes(sp.id))) err('orphan', `แผง "${sp.id}" วางไม่ได้เพราะแผงแม่มีปัญหา`, [sp.id])
  }
  if (issues.some((i) => i.severity === 'error')) return fail()

  const toPanel = (p: Placed): Panel => ({
    id: p.id, parentId: p.parentId, outline: p.outline,
    hingeA: p.hingeA, hingeB: p.hingeB, foldAngle: p.foldAngle, stage: p.stage,
    zOffset: p.zOffset || undefined, tuck: p.tuck || undefined,
  })

  // --- 2. ช่องเปิดในสภาพพับสุด: ระยะจากขอบหนึ่งของแผงไปชนแผงตรงข้าม ตามทิศที่ฝา/ลิ้นจะนอนหลังพับ ---
  const bodyPanels = order.map(toPanel)
  const bodyEnd = computeMatrices(bodyPanels, 1)
  // เริ่มยิงจากจุดที่ขยับเข้ากล่อง 0.5 มม. จากขอบ ไม่งั้นจุดชนตกบนขอบแผงตรงข้ามพอดี (inPoly ก้ำกึ่ง)
  const openingExtent = (hostId: string, f: EdgeFrame, skip: string[]): number | null => {
    const hostM = bodyEnd.get(hostId)!
    const mid = to3D(P((f.a.x + f.b.x) / 2, (f.a.y + f.b.y) / 2)).applyMatrix4(hostM)
    const outWorld = new Vector3(f.out.x, -f.out.y, 0).transformDirection(hostM)
    const origin = mid.addScaledVector(outWorld, -0.5)
    return rayExtent(bodyPanels, bodyEnd, origin, normalOf(hostM), new Set([hostId, ...skip]))
  }
  // ฝาลึกเกินช่องเปิด = พับแล้วทะลุผนังตรงข้าม (ตรวจตรงนี้เพราะฝาไม่ได้ "นอนแนบ" แผงใดให้ checkFoldSweep จับ)
  for (const sp of structure.panels) {
    if (sp.kind !== 'lid' || !sp.attach) continue
    const lid = placed.get(sp.id)
    const parent = placed.get(sp.attach.to)
    if (!lid || !parent) continue
    const extent = openingExtent(parent.id, edgeFrame(parent.rect, sp.attach.edge), [sp.id])
    if (extent === null) continue
    if (lid.depth > extent - t + 0.6) {
      err('lid-deep', `ฝา "${sp.id}" ลึก ${fmt(lid.depth)} มม. แต่ช่องเปิดลึกแค่ ${fmt(extent)} มม. — ตั้ง size ไม่เกิน ${fmt(extent - t)}`, [sp.id])
    } else if (lid.depth < extent - t - 4) {
      warn('lid-short', `ฝา "${sp.id}" ลึก ${fmt(lid.depth)} มม. ไม่ถึงขอบตรงข้าม (${fmt(extent)} มม.) — ถ้าไม่ได้ตั้งใจให้ปิดไม่สนิท ตั้ง size = ${fmt(extent - t)}`, [sp.id])
    }
  }
  if (issues.some((i) => i.severity === 'error')) return fail()

  // --- 3. ลิ้นจากคลัง (ความลึกเริ่มต้นวัดจากช่องเปิด) ---
  for (const fl of structure.flaps) {
    const host = placed.get(fl.on)
    if (!host) {
      err('flap-target', `ลิ้น "${fl.id}" เกาะแผง "${fl.on}" ที่วางไม่ได้`, [fl.id])
      continue
    }
    const f = edgeFrame(host.rect, fl.edge)
    const inset = Math.max(0, (fl.type === 'dust' ? dustIn : tuckIn) - host.lateralInset)
    if (f.len - 2 * inset < 6) {
      err('flap-narrow', `ลิ้น "${fl.id}": ขอบ ${fl.edge} ของ "${fl.on}" ยาว ${fmt(f.len)} มม. แคบเกินกว่าจะมีลิ้น`, [fl.id])
      continue
    }
    const extent = openingExtent(host.id, f, [])
    let depth: number
    if (fl.depth !== null) depth = typeof fl.depth === 'number' ? fl.depth : resolve(fl.depth) - t - 1
    else if (fl.type === 'dust') {
      const across = extent ?? 0.8 * f.len
      depth = Math.max(8, Math.min(0.75 * f.len, across / 2 - inset - 2) - t)
    } else if (fl.type === 'tuck') {
      depth = Math.min(22, Math.max(10, 0.6 * (host.depth + t)))
    } else depth = Math.min(25, 0.6 * f.len)
    if (!(depth >= 5)) {
      err('flap-depth', `ลิ้น "${fl.id}" ลึก ${fmt(depth)} มม. สั้นเกินไป (อย่างน้อย 5)`, [fl.id])
      continue
    }
    if (extent !== null && depth > extent - t) {
      warn('flap-long', `ลิ้น "${fl.id}" ลึก ${fmt(depth)} มม. แต่ช่องเปิดกว้างแค่ ${fmt(extent)} มม. — ลดเหลือ ${fmt(extent - t)}`, [fl.id])
      depth = extent - t
    }
    const a = add(f.a, [f.along, inset])
    const b = add(f.b, [f.along, -inset])
    let outline: Vec2[]
    if (fl.type === 'dust') {
      const slant = Math.min(5, depth * 0.45)
      outline = [a, add(a, [f.along, slant], [f.out, depth]), add(b, [f.along, -slant], [f.out, depth]), b]
    } else if (fl.type === 'tuck') {
      const r = Math.min(7, depth * 0.45, (f.len - 2 * inset) / 2)
      const c1 = add(a, [f.along, r], [f.out, depth - r])
      const c2 = add(b, [f.along, -r], [f.out, depth - r])
      const back = P(-f.along.x, -f.along.y)
      outline = [a, ...quarterArc(c1, r, back, f.out), ...quarterArc(c2, r, f.out, f.along), b]
    } else {
      const ch = Math.min(4, depth * 0.4)
      outline = [a, add(a, [f.along, ch], [f.out, depth]), add(b, [f.along, -ch], [f.out, depth]), b]
    }
    const pl: Placed = {
      id: fl.id, kind: 'flap', flapType: fl.type, parentId: host.id,
      rect: { x0: Math.min(...outline.map((v) => v.x)), y0: Math.min(...outline.map((v) => v.y)), x1: Math.max(...outline.map((v) => v.x)), y1: Math.max(...outline.map((v) => v.y)) },
      outline, hingeA: a, hingeB: b, foldAngle: f.sign * 90, stage: host.stage + 1, zOffset: 0,
      tuck: fl.type === 'tuck', side: fl.side ?? 'in', depth, lateralInset: 0,
    }
    placed.set(fl.id, pl)
    order.push(pl)
  }
  if (issues.some((i) => i.severity === 'error')) return fail()

  // --- 4. ซ้อนทับบนแผ่นคลี่ ---
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      if (polygonsOverlap(order[i].outline, order[j].outline)) {
        err('overlap-2d', `"${order[i].id}" กับ "${order[j].id}" ทับกันบนแผ่นคลี่ — ย้ายไปต่อขอบอื่นหรือลดขนาด`, [order[i].id, order[j].id])
      }
    }
  }
  if (issues.some((i) => i.severity === 'error')) return fail()

  // --- 5. ชั้นวัสดุ (zOffset) จากคู่ที่นอนแนบกันในสภาพพับสุด ---
  let panels = order.map(toPanel)
  let end = computeMatrices(panels, 1)
  const landings = findLandings(panels, end)
  const landOn = new Map<string, string>()
  for (const l of landings) {
    // ถ้าแนบหลายแผง เลือกแผงลำตัว/ฝาก่อนลิ้น
    const prev = landOn.get(l.p)
    const kindOf = (id: string) => placed.get(id)!.kind
    if (!prev || (kindOf(prev) === 'flap' && kindOf(l.q) !== 'flap')) landOn.set(l.p, l.q)
  }
  for (const [pid, qid] of landOn) {
    const p = placed.get(pid)!
    const dirQ = normalOf(end.get(qid)!) // +z ของ q = ด้านในกล่องเทียบ q
    const want = p.side === 'in' ? dirQ : dirQ.clone().negate() // ดัน p ออกห่าง q ไปฝั่งที่ p อยู่
    const s = Math.sign(normalOf(end.get(pid)!).dot(want)) || 1
    p.zOffset = s * layer
  }

  // --- 6. ลำดับพับ: จำลองด้วย fold engine แล้วขยับจังหวะของแผงที่ถูกกวาดทะลุให้ช้าลง ---
  const placedById = new Map(order.map((p) => [p.id, p]))
  const descendants = (id: string): Placed[] => order.filter((p) => p.id !== id && isAncestorPlaced(placedById, id, p.id))
  let violations: ReturnType<typeof checkFoldSweep> = []
  for (let iter = 0; iter < 8; iter++) {
    panels = order.map(toPanel)
    violations = checkFoldSweep(panels)
    const panelById = new Map(panels.map((p) => [p.id, p]))
    const fixable = violations.filter((v) => !isAncestor(panelById, panelById.get(v.q)!, panelById.get(v.p)!))
    if (!fixable.length) break
    const bump = new Map<string, number>()
    for (const v of fixable) {
      const need = placedById.get(v.p)!.stage + 1 - placedById.get(v.q)!.stage
      if (need > 0) bump.set(v.q, Math.max(bump.get(v.q) ?? 0, need))
    }
    if (!bump.size) break
    for (const [qid, delta] of bump) {
      placedById.get(qid)!.stage += delta
      for (const d of descendants(qid)) d.stage += delta
    }
  }
  panels = order.map(toPanel)
  end = computeMatrices(panels, 1)
  for (const v of violations) {
    const q = placedById.get(v.q)!
    const p = placedById.get(v.p)!
    if (isAncestorPlaced(placedById, q.id, p.id)) {
      err('sweep-through', `"${p.id}" กวาดทะลุแผงแม่ "${q.id}" ตอนพับ — ลิ้น/ฝายาวเกินช่องเปิด ลด depth/size`, [p.id, q.id])
    } else {
      err('fold-order', `"${p.id}" กวาดทะลุ "${q.id}" ตอนพับ แม้จัดลำดับใหม่แล้ว — ลดขนาดหรือย้ายไปขอบอื่น`, [p.id, q.id])
    }
  }
  const stages = Math.max(...order.map((p) => p.stage)) + 1
  if (stages > MAX_STAGES) warn('stages-many', `ลำดับพับมี ${stages} จังหวะ (เครื่องรองรับ ${MAX_STAGES}) — จังหวะท้ายจะพับพร้อมกัน`)

  // --- 7. ด้านที่ปิด/เปิด ---
  const boxIds = new Set(order.filter((p) => p.kind === 'body' || p.kind === 'lid').map((p) => p.id))
  const coverage = coverageByFace(panels, boxIds, structure.orientation, t, end)
  const open = (Object.keys(coverage) as Face[]).filter((f) => coverage[f] < 0.85)
  if (open.length) {
    warn('open-faces', `ด้านที่ยังเปิดอยู่: ${open.map((f) => `${faceTh(f)} (ปิด ${Math.round(coverage[f] * 100)}%)`).join(', ')} — ถ้าตั้งใจเปิด (ถาด/ปลอก) ไม่ต้องแก้`, open)
  }

  // --- 8. ประกอบ Dieline (เลื่อนให้มุมซ้ายบนเป็น 0,0) ---
  const all = panels.flatMap((p) => p.outline)
  const minX = Math.min(...all.map((v) => v.x))
  const minY = Math.min(...all.map((v) => v.y))
  const sh = (v: Vec2): Vec2 => P(v.x - minX, v.y - minY)
  const shifted: Panel[] = panels.map((p) => ({
    ...p,
    outline: p.outline.map(sh),
    hingeA: p.hingeA && sh(p.hingeA),
    hingeB: p.hingeB && sh(p.hingeB),
  }))
  const width = Math.max(...all.map((v) => v.x)) - minX
  const height = Math.max(...all.map((v) => v.y)) - minY
  if (width > SHEET_LIMIT || height > SHEET_LIMIT) {
    warn('sheet-large', `แผ่นคลี่ ${fmt(width)} × ${fmt(height)} มม. ใหญ่กว่า ${SHEET_LIMIT} — อาจเกินแผ่นมาตรฐาน`)
  }
  const rr = rootP.rect
  const label = (d: Dim | null, v: number) => (typeof d === 'string' ? `${d.replace('/2', '/2')} ${fmt(v)}` : fmt(v))
  const dims: DimMark[] = [
    { a: sh(P(rr.x0, rr.y1 + 12)), b: sh(P(rr.x1, rr.y1 + 12)), label: label(root.w, rw) },
    { a: sh(P(rr.x0 - 8, rr.y0)), b: sh(P(rr.x0 - 8, rr.y1)), label: label(root.h, rh) },
    { a: P(0, -10), b: P(width, -10), label: fmt(width) },
    { a: P(width + 10, 0), b: P(width + 10, height), label: fmt(height) },
  ]
  // ระยะลึก (D) จากแผงข้างแผงแรกที่ต่อซ้าย/ขวาของราก
  const sideChild = structure.panels.find((p) => p.attach?.to === root.id && (p.attach.edge === 'left' || p.attach.edge === 'right') && p.kind === 'body')
  if (sideChild) {
    const s = placed.get(sideChild.id)!
    dims.push({ a: sh(P(s.rect.x0, rr.y0 - 8)), b: sh(P(s.rect.x1, rr.y0 - 8)), label: label(sideChild.size, s.depth) })
  }

  const dieline: Dieline = { width, height, segments: autoSegments(shifted), panels: shifted, dims }
  const foldDepth = structure.orientation === 'front' ? padded.D : padded.H
  return { ok: !issues.some((i) => i.severity === 'error'), dieline, tilt, foldDepth, stages, issues, coverage }
}

function isAncestorPlaced(byId: Map<string, Placed>, ancestorId: string, id: string): boolean {
  for (let c = byId.get(id); c; c = c.parentId ? byId.get(c.parentId) : undefined) if (c.id === ancestorId) return true
  return false
}

export function faceTh(face: Face): string {
  return { top: 'บน', bottom: 'ล่าง', left: 'ซ้าย', right: 'ขวา', front: 'หน้า', back: 'หลัง' }[face]
}

// รายงาน issue เป็นข้อความบรรทัดต่อข้อ (ส่งกลับให้ AI แก้ หรือโชว์ผู้ใช้)
export function describeIssues(issues: StructureIssue[]): string {
  return issues.map((i) => `${i.severity === 'error' ? '✗' : i.severity === 'warning' ? '△' : '·'} ${i.message}`).join('\n')
}

// ขนาดกล่อง (มม.) จากแผงที่พับแล้ว — ไว้แสดง/ตรวจเทียบ W×D×H ที่ขอ
export function foldedExtent(dieline: Dieline): { x: number; y: number; z: number } {
  const end = computeMatrices(dieline.panels, 1)
  const min = new Vector3(Infinity, Infinity, Infinity)
  const max = new Vector3(-Infinity, -Infinity, -Infinity)
  for (const p of dieline.panels) {
    const m: Matrix4 = end.get(p.id)!
    for (const v of p.outline) {
      const w = to3D(v).applyMatrix4(m)
      min.min(w)
      max.max(w)
    }
  }
  return { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z }
}
