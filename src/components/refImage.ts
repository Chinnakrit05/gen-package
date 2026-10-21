// รูปอ้างอิงที่ส่งให้ AI: ย่อฝั่ง client ให้เหลือด้านยาวสุด 1024px เป็น JPEG — payload เล็กและตัด EXIF ทิ้ง
// ใช้โดย CopilotDrawer (รูปอ้างอิงสไตล์ + โลโก้ ทั้งโหมดโครงกล่องและออกแบบหน้าตา)
export interface RefImage {
  base64: string // ไม่มี data: prefix
  preview: string // data URL สำหรับโชว์ thumbnail
  name: string
}

export async function toRefImage(file: File): Promise<RefImage> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, 1024 / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no canvas')
  // โลโก้ PNG โปร่งใส: รองพื้นขาวก่อนแปลงเป็น JPEG ไม่งั้นพื้นกลายเป็นดำ
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  const dataUrl = canvas.toDataURL('image/jpeg', 0.82)
  return { base64: dataUrl.split(',')[1], preview: dataUrl, name: file.name }
}
