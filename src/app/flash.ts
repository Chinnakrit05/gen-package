// ข้อความแจ้งครั้งเดียวข้าม route (เช่น "บันทึกในเครื่องแล้ว" หลังออกจาก Editor) — อยู่ในหน่วยความจำของแท็บเท่านั้น
let pending: string | null = null

export function setFlash(message: string): void {
  pending = message
}

export function takeFlash(): string | null {
  const message = pending
  pending = null
  return message
}
