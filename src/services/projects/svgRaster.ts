// วาด SVG ลง canvas เป็น PNG โปร่งใส (หรือ JPEG เมื่อส่งสีรอง matte) data URL — browser เท่านั้น
// ใช้ร่วมกันระหว่างลายไลบรารี (trustedPresetRasterizer) และงานศิลป์จาก AI บน cloud (artworkRasterizer):
// ผู้เรียกต้องส่ง SVG ที่เชื่อถือได้/ผ่าน sanitize แล้วเท่านั้น; วาดผ่าน <img> จาก blob URL ซึ่ง SVG ในบริบทรูปภาพ
// ไม่รันสคริปต์และไม่โหลดทรัพยากรภายนอก

export interface SvgRasterOptions {
  matte?: string // ทาสีนี้รองก่อนวาดแล้วเข้ารหัส JPEG (ทึบแน่นอน เล็กกว่า PNG มาก — ใช้กับรูปพื้นทั้งแผ่นที่วางบนสีพื้นอยู่แล้ว); ไม่ใส่ = PNG โปร่งใส
  maxBytes?: number // ใหญ่เกิน → ลดขนาด 70% ซ้ำได้ 2 ครั้ง (asset cloud รับไม่เกิน 10 MiB)
}

export async function svgToRasterDataUrl(svg: string, width: number, height: number, options: SvgRasterOptions = {}): Promise<string> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    throw new Error('การแปลง SVG เป็นภาพต้องทำใน browser')
  }
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const image = await loadImage(url)
    let w = width
    let h = height
    for (let attempt = 0; ; attempt++) {
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const context = canvas.getContext('2d')
      if (!context) throw new Error('browser นี้ไม่รองรับ canvas 2D')
      if (options.matte) {
        context.fillStyle = options.matte
        context.fillRect(0, 0, w, h)
      }
      context.drawImage(image, 0, 0, w, h)
      const blob = await canvasBlob(canvas, options.matte ? 'image/jpeg' : 'image/png')
      if (!options.maxBytes || blob.size <= options.maxBytes || attempt >= 2) return blobToDataUrl(blob)
      w = Math.max(1, Math.round(w * 0.7))
      h = Math.max(1, Math.round(h * 0.7))
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('แปลง SVG เป็นภาพไม่สำเร็จ'))
    image.src = url
  })
}

function canvasBlob(canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('เข้ารหัสภาพไม่สำเร็จ'))
    }, type, type === 'image/jpeg' ? 0.92 : undefined)
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('อ่านภาพที่แปลงแล้วไม่สำเร็จ'))
    reader.readAsDataURL(blob)
  })
}
