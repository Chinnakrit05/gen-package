// ย่อ-ขยายจากมือจับมุม (pure): ชิ้นที่ขนาดจริงไม่เท่ากรอบที่ลากขอ (ข้อความปัดขนาดฟอนต์/วัดความกว้างจากตัวอักษร,
// รูปล็อกสัดส่วน, ตารางโภชนาการสูงตามเนื้อหา) ต้องวางใหม่ให้มุมตรึงอยู่ตำแหน่งเดิม — ไม่งั้นลากมุมซ้าย/บนแล้วชิ้นเลื่อน
// sx/sy = เครื่องหมายของมุมตรึงจากกึ่งกลาง (−1 ซ้าย/บน, 1 ขวา/ล่าง) ในแกนของชิ้นก่อนหมุน; rot เป็นองศา

export interface ResizeAnchor {
  sx: number
  sy: number
}

export function reanchorBox(
  requested: { x: number; y: number; w: number; h: number },
  actual: { w: number; h: number },
  rotDeg: number,
  anchor: ResizeAnchor,
): { x: number; y: number } {
  const rad = (rotDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  // จุดตรึงบนจอ = กึ่งกลางกรอบที่ขอ + หมุน(offset ไปมุมตรึง)
  const lx = (anchor.sx * requested.w) / 2
  const ly = (anchor.sy * requested.h) / 2
  const ax = requested.x + requested.w / 2 + (cos * lx - sin * ly)
  const ay = requested.y + requested.h / 2 + (sin * lx + cos * ly)
  // กึ่งกลางใหม่ = จุดตรึง − หมุน(offset ของกรอบจริง)
  const nx = (anchor.sx * actual.w) / 2
  const ny = (anchor.sy * actual.h) / 2
  const cx = ax - (cos * nx - sin * ny)
  const cy = ay - (sin * nx + cos * ny)
  return { x: cx - actual.w / 2, y: cy - actual.h / 2 }
}
