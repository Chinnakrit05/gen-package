export interface Vec2 {
  x: number
  y: number
}

export type LineKind = 'cut' | 'crease'

export interface Segment {
  kind: LineKind
  d: string
}

export interface Panel {
  id: string
  parentId: string | null
  outline: Vec2[]
  holes?: Vec2[][]
  hingeA?: Vec2
  hingeB?: Vec2
  foldAngle?: number
  stage: number
  zOffset?: number
  // ลิ้นเสียบที่ต่อจากฝา: มุมพับผูกกับมุมฝา (แผงแม่) ให้ปลายลิ้นไม่ล้ำแนวที่ลิ้นจะอยู่ตอนปิด
  // — ลิ้นพับเข้าระหว่างฝากำลังปิดแล้วไถลลงตามผนังด้านใน แทนการกวาดทะลุผนังหน้า (ดู fold.ts)
  tuck?: boolean
  // ประกอบชิ้น (เช่นฝาครอบพลิกไปวางบนฐาน): หมุนทั้งชิ้นรอบแกนสมมติ ไม่ใช่รอยพับจริง — ไม่สร้างสันม้วน 180°
  assemble?: boolean
  // เลื่อนต่ออีกจังหวะตามแกน z ท้องถิ่น (มม.) ในช่วง stage ที่กำหนด — เช่นฝาครอบพลิกมาวางบนขอบฐานแล้วค่อยสวมลง
  slide?: { dz: number; stage: number }
  // พับซ้ำรอบบานพับเดิมอีกจังหวะ (มุมบวกเพิ่มจาก foldAngle) + เลื่อนชั้น dz ตามแกน z ท้องถิ่น — สำหรับแผงที่ต้อง
  // พับแนบไว้ก่อนแล้วค่อยกางออกทีหลัง (เช่นหูลิ้นหน้า rollover: พับทบแนบลิ้นตอนเสียบ แล้วกางเข้าข้างในผนังข้างตอนจบ)
  refold?: { angle: number; stage: number; dz?: number }
  // พับในช่วงย่อยของหน้าต่าง stage ตัวเอง (สัดส่วน 0..1) — เช่นปีกข้างฝาพับพร้อมฝาปิดแต่ต้องพับเสร็จก่อนฝาลงครึ่งทาง
  within?: [number, number]
}

export interface DimMark {
  a: Vec2
  b: Vec2
  label: string
}

export interface Dieline {
  width: number
  height: number
  segments: Segment[]
  panels: Panel[]
  dims: DimMark[]
  // ป้ายกำกับหน้าบน blueprint (เช่น หน้า/หลัง ของนามบัตร) — โชว์ในพรีวิวเท่านั้น ไม่เข้าไฟล์ผลิต
  captions?: { x: number; y: number; text: string }[]
}

export interface Material {
  id: string
  nameTh: string
  detail: string
  thickness: number
  foldable: boolean
  // ชนิดการขึ้นรูปสำหรับวัสดุที่ foldable=false: 'revolve' = ภาชนะหมุนขึ้นรูป (ค่าเริ่มต้นเมื่อไม่ระบุ),
  // 'pouch' = ถุงฟิล์มซีลขอบ (doypack), 'tube' = หลอดครีม (revolve + ปลายซีลแบน)
  // — ใช้แยก path 3D/dieline; วัสดุพับได้ (foldable) ไม่ใช้ฟิลด์นี้
  form?: 'revolve' | 'pouch' | 'tube'
  process: string
  color: string
  opacity?: number
  roughness?: number
  // ความเป็นโลหะ (0–1) สำหรับผิว 3D — ฟอยล์/อะลูมิเนียมตั้งสูงเพื่อสะท้อน environment ให้ดูเงา
  metalness?: number
  // ฟิล์มใส (สติกเกอร์ PP ใส): ส่วนที่ไม่มีลายมองทะลุ; หมึก CMYK โปร่งแสง — สีขาวในงานจะใส สีอ่อนจะจาง
  clear?: boolean
  // พิมพ์หมึกขาวรองใต้ลาย (white underbase) บนฟิล์มใส → ลายทึบสด; ไฟล์ส่งออกมีเลเยอร์ White อัตโนมัติ
  underbase?: boolean
  // ผิวกระดาษพิเศษ (นามบัตร/สติกเกอร์): felt = เนื้อฟูแบบคอตตอน/เท็กซ์เจอร์, linen = ลายผ้าลินิน,
  // kraft = เส้นใยคราฟท์, holo = ฟิล์มโฮโลแกรมเหลือบรุ้ง, pearl = กระดาษมุกเหลือบรุ้งจาง ๆ
  // — 3D เป็นแผนที่นูนต่ำ (`paperGrain`) / พื้นรุ้งใน texture (`paintHolo`), blueprint เป็นลายจาง ๆ
  surface?: PaperSurface
  // ไม่มีหมึกขาว บนกระดาษสี (ดำ/คราฟท์): หมึก CMYK ทับสีกระดาษแบบ multiply — สีขาว/สีอ่อนในงานแทบไม่ขึ้น
  inkMultiply?: boolean
  note?: string
}

export type PaperSurface = 'felt' | 'linen' | 'kraft' | 'holo' | 'pearl'

export interface BoxParams {
  W: number
  D: number
  H: number
  handle?: boolean
}
