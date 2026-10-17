// "ภาษาแผง" (panel grammar) — คำอธิบายโครงสร้างกล่องพับเชิงสัญลักษณ์ที่ AI เขียนได้ แล้ว compile.ts แปลงเป็น Dieline
// หลัก: AI ไม่วาดเส้น มันบอกแค่ว่ามีแผงอะไร ต่อกับแผงไหนที่ขอบไหน ลึกเท่าไร และมีลิ้นชนิดไหนจากคลัง
// ส่วนตำแหน่งบนแผ่นคลี่ ระยะเผื่อความหนา รูปร่างลิ้น ลำดับพับ และชั้นวัสดุ (zOffset) เป็นหน้าที่ของคอมไพเลอร์
// — ผลจึงผลิตได้จริงโดยโครงสร้าง (manufacturable by construction) และตรวจซ้ำได้ด้วย validate.ts

// ขนาดเชิงสัญลักษณ์: อ้างขนาดด้านในของกล่อง (W/D/H) หรือครึ่งหนึ่ง หรือระบุเป็น มม. ตรง ๆ
export type Dim = 'W' | 'D' | 'H' | 'W/2' | 'D/2' | 'H/2' | number

export const DIM_NAMES = ['W', 'D', 'H', 'W/2', 'D/2', 'H/2'] as const

export type Edge = 'top' | 'bottom' | 'left' | 'right'
export const EDGES: readonly Edge[] = ['top', 'bottom', 'left', 'right']

// body = ผนัง/ฐาน (ลำตัวกล่อง), lid = ฝาที่ปิดช่องเปิด (ลึกกว่าช่องน้อยกว่า t ให้สอดได้), glue = ปีกทากาว (ขอบเฉียง)
export type PanelKind = 'body' | 'lid' | 'glue'
export const PANEL_KINDS: readonly PanelKind[] = ['body', 'lid', 'glue']

// dust = ลิ้นกันฝุ่น (คางหมู พับเข้าช่องเปิด), tuck = ลิ้นเสียบปลายฝา (มุมมน ไถลเข้าในผนัง), tab = ลิ้นสี่เหลี่ยมมุมเฉียงทั่วไป
export type FlapType = 'dust' | 'tuck' | 'tab'
export const FLAP_TYPES: readonly FlapType[] = ['dust', 'tuck', 'tab']

// 90 = พับตั้งฉากเข้าด้านใน (ปกติ), 180 = พับทบ (ม้วนขอบ/ผนังสองชั้น),
// -90 = พับตั้งฉากออกด้านนอก (แผงหูหิ้วตั้งขึ้นจากปลายฝา), 0 = ต่อตรงไม่พับ (ยืดแผงให้สูงขึ้น)
export type FoldTurn = 90 | 180 | -90 | 0
export const FOLD_TURNS: readonly FoldTurn[] = [90, 180, -90, 0]

export interface StructureAttach {
  to: string
  edge: Edge
  fold: FoldTurn
}

export interface StructurePanel {
  id: string
  kind: PanelKind
  // null = แผงราก (มีได้แผงเดียว) ต้องระบุ w/h; แผงอื่นต่อจากขอบของแผงแม่ ขนาดตามขอบนั้น + size = ระยะยื่นออกจากขอบ
  attach: StructureAttach | null
  w: Dim | null
  h: Dim | null
  size: Dim | null // null สำหรับ glue = ความกว้างปีกทากาวมาตรฐาน
}

export interface StructureFlap {
  id: string
  type: FlapType
  on: string // id ของแผงที่ลิ้นเกาะ
  edge: Edge
  depth: Dim | null // null = คอมไพเลอร์คำนวณให้ตามชนิดลิ้นและช่องเปิด
  // ลิ้นนอนแนบผนังที่ไปถึงจาก "ด้านใน" (ปกติ: ลิ้นกันฝุ่น/ลิ้นเสียบ) หรือ "ด้านนอก" (ปีกข้างฝาที่ห่อทับผนัง)
  // — แผ่นหนา 0 ตัดสินเองไม่ได้ ต้องบอก; null = in
  side: 'in' | 'out' | null
}

// รูเจาะบนแผง: hand-hole = รูมือทรงแคปซูล (obround) สำหรับหูหิ้ว, window = หน้าต่างสี่เหลี่ยมมุมมน
export type HoleType = 'hand-hole' | 'window'
export const HOLE_TYPES: readonly HoleType[] = ['hand-hole', 'window']
// ตำแหน่งตามแนวที่แผงยื่นจากบานพับ: near = ใกล้บานพับ, center = กลาง, far = ใกล้ขอบไกล (ปลายแผง)
export type HoleAnchor = 'center' | 'near' | 'far'
export const HOLE_ANCHORS: readonly HoleAnchor[] = ['center', 'near', 'far']

export interface StructureHole {
  id: string
  type: HoleType
  on: string // id ของแผง (body/lid เท่านั้น)
  anchor: HoleAnchor
  length: Dim | null // ด้านขนานบานพับ (null = มาตรฐานตามชนิด)
  height: Dim | null // ด้านตามแนวยื่น (null = มาตรฐาน)
}

// front = แผงรากเป็นผนังหน้า (กล่องท่อ ตั้งตรง), base = แผงรากเป็นฐานวางพื้น (ถาด/กล่องไปรษณีย์)
export type Orientation = 'front' | 'base'

export interface BoxStructure {
  name: string
  orientation: Orientation
  panels: StructurePanel[]
  flaps: StructureFlap[]
  holes: StructureHole[]
  // คำอธิบายสั้น ๆ ถึงผู้ใช้ (AI กรอก) — ไม่มีผลกับเรขาคณิต
  explanation: string
}

// structured outputs ของ Claude ไม่รับ minimum/maximum/minItems/maxItems/minLength (ตอบ 400) — ขอบเขตตัวเลข
// และจำนวนแผงจึงบังคับใน parseStructure แทน และบอกไว้ใน description ให้โมเดลรู้
// จำนวนแผง/ลิ้นสูงสุด (บังคับใน parseStructure เพราะ schema ใส่ maxItems ไม่ได้)
export const MAX_ELEMENTS = 24

const dimSchema = {
  anyOf: [
    { type: 'number', description: 'มม. (1-400)' },
    { type: 'string', enum: [...DIM_NAMES], description: 'ขนาดด้านในของกล่อง หรือครึ่งหนึ่ง' },
  ],
}
const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] })

// JSON schema สำหรับ structured outputs ของ Claude (ทุก object ต้อง additionalProperties:false + required ครบ,
// ห้ามใช้ keyword ที่ API ไม่รองรับ — เทสต์ใน compile.test.ts กันไว้) ตรงกับ parseStructure ด้านล่าง — แก้ฝั่งหนึ่งต้องแก้อีกฝั่ง
export const STRUCTURE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', description: 'ชื่อแบบกล่อง ภาษาไทยสั้น ๆ' },
    orientation: {
      type: 'string',
      enum: ['front', 'base'],
      description: 'front = แผงรากคือผนังหน้า (กล่องท่อตั้งตรง), base = แผงรากคือฐานที่วางพื้น (ถาด/กล่องฝาพับ)',
    },
    panels: {
      type: 'array',
      description: `แผง 1-${MAX_ELEMENTS} แผง (แผงราก 1 แผง attach = null)`,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: 'ตัวระบุไม่ซ้ำ a-z0-9- เช่น front, side-left' },
          kind: { type: 'string', enum: [...PANEL_KINDS] },
          attach: nullable({
            type: 'object',
            additionalProperties: false,
            properties: {
              to: { type: 'string' },
              edge: { type: 'string', enum: [...EDGES] },
              fold: {
                type: 'integer',
                enum: [...FOLD_TURNS],
                description: '90 พับเข้าด้านใน (ปกติ), 180 พับทบแนบแผงแม่, -90 พับออกด้านนอก/ตั้งขึ้น (หูหิ้วจากปลายฝา), 0 ต่อตรงไม่พับ',
              },
            },
            required: ['to', 'edge', 'fold'],
          }),
          w: nullable(dimSchema),
          h: nullable(dimSchema),
          size: nullable(dimSchema),
        },
        required: ['id', 'kind', 'attach', 'w', 'h', 'size'],
      },
    },
    flaps: {
      type: 'array',
      description: `ลิ้น 0-${MAX_ELEMENTS} ชิ้น`,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          type: { type: 'string', enum: [...FLAP_TYPES] },
          on: { type: 'string' },
          edge: { type: 'string', enum: [...EDGES] },
          depth: nullable(dimSchema),
          side: nullable({
            type: 'string',
            enum: ['in', 'out'],
            description: 'ลิ้นนอนแนบผนังจากด้านใน (ปกติ) หรือด้านนอก (ปีกข้างฝาที่ห่อทับผนังข้าง)',
          }),
        },
        required: ['id', 'type', 'on', 'edge', 'depth', 'side'],
      },
    },
    holes: {
      type: 'array',
      description: `รูเจาะ 0-${MAX_ELEMENTS} รู (รูมือสำหรับหูหิ้ว, หน้าต่าง) บนแผง body/lid`,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          type: { type: 'string', enum: [...HOLE_TYPES], description: 'hand-hole = รูมือทรงแคปซูล, window = หน้าต่างมุมมน' },
          on: { type: 'string' },
          anchor: { type: 'string', enum: [...HOLE_ANCHORS], description: 'near = ใกล้บานพับ, center = กลางแผง, far = ใกล้ปลายแผง' },
          length: nullable(dimSchema),
          height: nullable(dimSchema),
        },
        required: ['id', 'type', 'on', 'anchor', 'length', 'height'],
      },
    },
    explanation: { type: 'string', description: 'อธิบายโครงสร้างให้ลูกค้า 1-2 ประโยค' },
  },
  required: ['name', 'orientation', 'panels', 'flaps', 'holes', 'explanation'],
}

export interface StructureIssue {
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string // ภาษาไทย อ่านได้ทั้งคนและ AI (ใช้ส่งกลับให้ AI แก้)
  ids?: string[]
}

export type ParseResult = { ok: true; structure: BoxStructure } | { ok: false; issues: StructureIssue[] }

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/

function isDim(v: unknown): v is Dim {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 1 && v <= 400
  return typeof v === 'string' && (DIM_NAMES as readonly string[]).includes(v)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// ตรวจรูปร่าง JSON (ไม่ตรวจเรขาคณิต — นั่นคือหน้าที่ compile/validate); ข้อความผิดพลาดบอกตำแหน่งชัดให้ AI แก้ได้
export function parseStructure(raw: unknown): ParseResult {
  const issues: StructureIssue[] = []
  const err = (code: string, message: string, ids?: string[]) => issues.push({ severity: 'error', code, message, ids })
  if (!isRecord(raw)) return { ok: false, issues: [{ severity: 'error', code: 'not-object', message: 'โครงสร้างต้องเป็น JSON object' }] }

  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 80) : 'กล่องออกแบบเอง'
  const orientation: Orientation = raw.orientation === 'base' ? 'base' : 'front'
  if (raw.orientation !== 'base' && raw.orientation !== 'front') err('orientation', 'orientation ต้องเป็น "front" หรือ "base"')
  const explanation = typeof raw.explanation === 'string' ? raw.explanation.trim().slice(0, 600) : ''

  const panels: StructurePanel[] = []
  const ids = new Set<string>()
  if (!Array.isArray(raw.panels) || raw.panels.length === 0) err('panels', 'ต้องมี panels อย่างน้อย 1 แผง')
  else if (raw.panels.length > MAX_ELEMENTS) err('panels', `panels มี ${raw.panels.length} แผง เกิน ${MAX_ELEMENTS}`)
  else {
    raw.panels.forEach((p: unknown, i: number) => {
      if (!isRecord(p)) return err('panel', `panels[${i}] ต้องเป็น object`)
      const id = typeof p.id === 'string' ? p.id.trim().toLowerCase() : ''
      if (!ID_RE.test(id)) return err('panel-id', `panels[${i}].id "${String(p.id)}" ต้องเป็น a-z0-9 ขีดกลาง ยาว 1-32`)
      if (ids.has(id)) return err('duplicate-id', `id "${id}" ซ้ำ`, [id])
      ids.add(id)
      const kind = (PANEL_KINDS as readonly string[]).includes(p.kind as string) ? (p.kind as PanelKind) : null
      if (!kind) return err('panel-kind', `แผง "${id}": kind ต้องเป็น body/lid/glue`, [id])
      let attach: StructureAttach | null = null
      if (p.attach !== null && p.attach !== undefined) {
        if (!isRecord(p.attach)) return err('attach', `แผง "${id}": attach ต้องเป็น object หรือ null`, [id])
        const to = typeof p.attach.to === 'string' ? p.attach.to.trim().toLowerCase() : ''
        const edge = (EDGES as readonly string[]).includes(p.attach.edge as string) ? (p.attach.edge as Edge) : null
        const fold = p.attach.fold === undefined ? 90 : (FOLD_TURNS as readonly unknown[]).includes(p.attach.fold) ? (p.attach.fold as FoldTurn) : null
        if (!to || !edge || fold === null) {
          return err('attach', `แผง "${id}": attach ต้องมี to (id แผงแม่), edge (top/bottom/left/right), fold (90, 180, -90 หรือ 0)`, [id])
        }
        attach = { to, edge, fold }
      }
      const dim = (key: 'w' | 'h' | 'size'): Dim | null | undefined => {
        const v = p[key]
        if (v === null || v === undefined) return null
        if (isDim(v)) return v
        err('dim', `แผง "${id}": ${key} ต้องเป็นตัวเลข มม. (1-400) หรือ "W"/"D"/"H"/"W/2"/"D/2"/"H/2"`, [id])
        return undefined
      }
      const w = dim('w')
      const h = dim('h')
      const size = dim('size')
      if (w === undefined || h === undefined || size === undefined) return
      if (!attach && (w === null || h === null)) return err('root-size', `แผงราก "${id}" ต้องระบุ w และ h`, [id])
      if (attach && size === null && kind !== 'glue') return err('size', `แผง "${id}": ต้องระบุ size (ระยะยื่นจากขอบแผงแม่)`, [id])
      panels.push({ id, kind, attach, w, h, size })
    })
  }

  const flaps: StructureFlap[] = []
  if (raw.flaps !== undefined && !Array.isArray(raw.flaps)) err('flaps', 'flaps ต้องเป็น array')
  else if (Array.isArray(raw.flaps) && raw.flaps.length > MAX_ELEMENTS) err('flaps', `flaps มี ${raw.flaps.length} ชิ้น เกิน ${MAX_ELEMENTS}`)
  else {
    ;((raw.flaps as unknown[]) ?? []).forEach((f: unknown, i: number) => {
      if (!isRecord(f)) return err('flap', `flaps[${i}] ต้องเป็น object`)
      const id = typeof f.id === 'string' ? f.id.trim().toLowerCase() : ''
      if (!ID_RE.test(id)) return err('flap-id', `flaps[${i}].id "${String(f.id)}" ต้องเป็น a-z0-9 ขีดกลาง ยาว 1-32`)
      if (ids.has(id)) return err('duplicate-id', `id "${id}" ซ้ำ`, [id])
      ids.add(id)
      const type = (FLAP_TYPES as readonly string[]).includes(f.type as string) ? (f.type as FlapType) : null
      if (!type) return err('flap-type', `ลิ้น "${id}": type ต้องเป็น dust/tuck/tab`, [id])
      const on = typeof f.on === 'string' ? f.on.trim().toLowerCase() : ''
      const edge = (EDGES as readonly string[]).includes(f.edge as string) ? (f.edge as Edge) : null
      if (!on || !edge) return err('flap-attach', `ลิ้น "${id}": ต้องมี on (id แผง) และ edge`, [id])
      let depth: Dim | null = null
      if (f.depth !== null && f.depth !== undefined) {
        if (!isDim(f.depth)) return err('dim', `ลิ้น "${id}": depth ต้องเป็นตัวเลข มม. หรือ "W"/"D"/"H"/…`, [id])
        depth = f.depth
      }
      let side: 'in' | 'out' | null = null
      if (f.side !== null && f.side !== undefined) {
        if (f.side !== 'in' && f.side !== 'out') return err('flap-side', `ลิ้น "${id}": side ต้องเป็น "in", "out" หรือ null`, [id])
        side = f.side
      }
      flaps.push({ id, type, on, edge, depth, side })
    })
  }

  const holes: StructureHole[] = []
  if (raw.holes !== undefined && !Array.isArray(raw.holes)) err('holes', 'holes ต้องเป็น array')
  else if (Array.isArray(raw.holes) && raw.holes.length > MAX_ELEMENTS) err('holes', `holes มี ${raw.holes.length} รู เกิน ${MAX_ELEMENTS}`)
  else {
    ;((raw.holes as unknown[]) ?? []).forEach((h: unknown, i: number) => {
      if (!isRecord(h)) return err('hole', `holes[${i}] ต้องเป็น object`)
      const id = typeof h.id === 'string' ? h.id.trim().toLowerCase() : ''
      if (!ID_RE.test(id)) return err('hole-id', `holes[${i}].id "${String(h.id)}" ต้องเป็น a-z0-9 ขีดกลาง ยาว 1-32`)
      if (ids.has(id)) return err('duplicate-id', `id "${id}" ซ้ำ`, [id])
      ids.add(id)
      const type = (HOLE_TYPES as readonly string[]).includes(h.type as string) ? (h.type as HoleType) : null
      if (!type) return err('hole-type', `รู "${id}": type ต้องเป็น hand-hole/window`, [id])
      const on = typeof h.on === 'string' ? h.on.trim().toLowerCase() : ''
      if (!on) return err('hole-target', `รู "${id}": ต้องมี on (id แผง)`, [id])
      const anchor = h.anchor === undefined || h.anchor === null ? 'center' : (HOLE_ANCHORS as readonly string[]).includes(h.anchor as string) ? (h.anchor as HoleAnchor) : null
      if (!anchor) return err('hole-anchor', `รู "${id}": anchor ต้องเป็น center/near/far`, [id])
      const dimOf = (key: 'length' | 'height'): Dim | null | undefined => {
        const v = h[key]
        if (v === null || v === undefined) return null
        if (isDim(v)) return v
        err('dim', `รู "${id}": ${key} ต้องเป็นตัวเลข มม. หรือ "W"/"D"/"H"/…`, [id])
        return undefined
      }
      const length = dimOf('length')
      const height = dimOf('height')
      if (length === undefined || height === undefined) return
      holes.push({ id, type, on, anchor, length, height })
    })
  }

  // อ้างอิงข้ามองค์ประกอบ
  const panelIds = new Set(panels.map((p) => p.id))
  const roots = panels.filter((p) => !p.attach)
  if (panels.length && roots.length !== 1) {
    err('root', `ต้องมีแผงรากที่ attach = null พอดี 1 แผง (ตอนนี้ ${roots.length})`, roots.map((p) => p.id))
  }
  for (const p of panels) {
    if (p.attach && !panelIds.has(p.attach.to)) err('attach-target', `แผง "${p.id}" ต่อกับ "${p.attach.to}" ที่ไม่มีอยู่`, [p.id])
    if (p.attach && p.attach.to === p.id) err('attach-self', `แผง "${p.id}" ต่อกับตัวเอง`, [p.id])
  }
  for (const f of flaps) {
    if (!panelIds.has(f.on)) err('flap-target', `ลิ้น "${f.id}" เกาะแผง "${f.on}" ที่ไม่มีอยู่`, [f.id])
    const host = panels.find((p) => p.id === f.on)
    if (host?.kind === 'glue') err('flap-on-glue', `ลิ้น "${f.id}" เกาะปีกทากาว "${f.on}" ไม่ได้`, [f.id])
    if (f.type === 'tuck' && host && host.kind !== 'lid') err('tuck-not-on-lid', `ลิ้นเสียบ "${f.id}" ต้องเกาะแผง kind "lid" เท่านั้น`, [f.id])
  }
  for (const h of holes) {
    const host = panels.find((p) => p.id === h.on)
    if (!host) err('hole-target', `รู "${h.id}" เจาะบนแผง "${h.on}" ที่ไม่มีอยู่ (เจาะได้เฉพาะแผง ไม่ใช่ลิ้น)`, [h.id])
    else if (host.kind === 'glue') err('hole-on-glue', `รู "${h.id}" เจาะบนปีกทากาว "${h.on}" ไม่ได้`, [h.id])
  }
  // วงวน (แม่ → ลูก → แม่) ตรวจตอน compile ด้วย แต่จับที่นี่ให้ข้อความชัด
  const byId = new Map(panels.map((p) => [p.id, p]))
  for (const p of panels) {
    const seen = new Set<string>([p.id])
    let cur = p.attach ? byId.get(p.attach.to) : undefined
    while (cur) {
      if (seen.has(cur.id)) {
        err('cycle', `แผง "${p.id}" ต่อกันเป็นวง (ผ่าน "${cur.id}")`, [p.id, cur.id])
        break
      }
      seen.add(cur.id)
      cur = cur.attach ? byId.get(cur.attach.to) : undefined
    }
  }
  // ขอบหนึ่งรับได้อย่างเดียว: แผงลูกหรือลิ้น (ซ้อนกันบนขอบเดียว = ทับกันบนแผ่นคลี่)
  const used = new Map<string, string>()
  const claim = (panelId: string, edge: Edge, by: string) => {
    const k = `${panelId}:${edge}`
    const prev = used.get(k)
    if (prev) err('edge-used', `ขอบ ${edge} ของแผง "${panelId}" ถูกใช้โดย "${prev}" และ "${by}" พร้อมกัน`, [prev, by])
    else used.set(k, by)
  }
  for (const p of panels) if (p.attach) claim(p.attach.to, p.attach.edge, p.id)
  for (const f of flaps) claim(f.on, f.edge, f.id)
  // ขอบที่แผงลูกใช้ต่อแผงแม่ (ด้านตรงข้ามของ attach.edge) ก็ถูกใช้แล้ว
  for (const p of panels) if (p.attach) claim(p.id, opposite(p.attach.edge), `บานพับไป "${p.attach.to}"`)

  if (issues.length) return { ok: false, issues }
  return { ok: true, structure: { name, orientation, panels, flaps, holes, explanation } }
}

export function opposite(edge: Edge): Edge {
  return edge === 'top' ? 'bottom' : edge === 'bottom' ? 'top' : edge === 'left' ? 'right' : 'left'
}
