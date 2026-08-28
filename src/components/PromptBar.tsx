import { useEffect, useRef, useState } from 'react'
import { requestBoxSpec, type AiBoxSpec, type CurrentSpec } from '../core/ai'

const QUICK_ADJUSTS = [
  { label: 'หรูขึ้น', prompt: 'ปรับให้ดูหรูพรีเมียมขึ้น' },
  { label: 'ถูกลง', prompt: 'ปรับให้ต้นทุนถูกลง' },
  { label: 'โชว์ของข้างใน', prompt: 'อยากให้มองเห็นสินค้าข้างในกล่อง' },
  { label: 'แข็งแรงส่งไปรษณีย์', prompt: 'ต้องส่งไปรษณีย์ ให้ทนแรงกระแทก' },
]

interface RefImage {
  base64: string
  preview: string
  name: string
}

// ย่อรูปฝั่ง client ให้เหลือด้านยาวสุด 1024px เป็น JPEG — payload เล็กและตัด EXIF ทิ้ง
async function toRefImage(file: File): Promise<RefImage> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, 1024 / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no canvas')
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  const dataUrl = canvas.toDataURL('image/jpeg', 0.82)
  return { base64: dataUrl.split(',')[1], preview: dataUrl, name: file.name }
}

interface PromptBarProps {
  current: CurrentSpec
  hasDesign: boolean
  onApply: (spec: AiBoxSpec, label: string) => void
  onLoadingChange: (loading: boolean) => void
}

export function PromptBar({ current, hasDesign, onApply, onLoadingChange }: PromptBarProps) {
  const [text, setText] = useState('')
  const [image, setImage] = useState<RefImage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AiBoxSpec | null>(null)
  const [quickOpen, setQuickOpen] = useState(false)
  const [open, setOpen] = useState(false) // แถบลอยล่าง: ย่อเป็นปุ่มก่อน คลิกแล้วป็อปอัปช่องพิมพ์
  const fileRef = useRef<HTMLInputElement>(null)
  const quickRef = useRef<HTMLDivElement>(null)

  // ปิด popover ปรับเร็วเมื่อคลิกนอกกรอบ หรือกด Esc
  useEffect(() => {
    if (!quickOpen) return
    const onDoc = (e: MouseEvent) => {
      if (quickRef.current && !quickRef.current.contains(e.target as Node)) setQuickOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setQuickOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [quickOpen])

  const setBusy = (v: boolean) => {
    setLoading(v)
    onLoadingChange(v)
  }

  const pickImage = async (file: File | undefined) => {
    if (!file) return
    try {
      setError(null)
      setImage(await toRefImage(file))
    } catch {
      setError('อ่านไฟล์รูปไม่ได้ — รองรับ JPG / PNG / WebP')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const run = async (prompt: string, withCurrent: boolean, label: string): Promise<boolean> => {
    if (!prompt.trim() || loading) return false
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const spec = await requestBoxSpec(prompt, withCurrent ? current : undefined, image?.base64)
      setResult(spec)
      onApply(spec, label)
      setImage(null)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด')
      return false
    } finally {
      setBusy(false)
    }
  }

  const showChips = result && (result.assumptions.length > 0 || result.layoutNote !== '-')

  // ย่ออยู่: โชว์แค่ปุ่มลอยล่าง คลิกแล้วค่อยกางช่องพิมพ์ (เปิดพื้นที่ให้ blueprint เต็มที่)
  if (!open) {
    return (
      <div className="promptbar-dock">
        <button type="button" className="pb-fab primary" onClick={() => setOpen(true)}>
          <span aria-hidden="true">✨</span> สั่ง AI สร้าง/แก้กล่อง
        </button>
      </div>
    )
  }

  return (
    <div className="promptbar-dock open">
      <div className="promptbar card">
      <div className="pb-dockhead">
        <span className="pb-docktitle">✨ สั่ง AI</span>
        <button type="button" className="pb-min" aria-label="ย่อเก็บแถบ AI" onClick={() => setOpen(false)}>
          –
        </button>
      </div>
      <form
        className="pb-row"
        onSubmit={(e) => {
          e.preventDefault()
          const label = text.trim()
          void run(text, hasDesign, label).then((ok) => {
            if (ok) setText('')
          })
        }}
      >
        <input
          type="text"
          value={text}
          placeholder={
            hasDesign
              ? 'ปรับต่อจากแบบปัจจุบันได้เลย เช่น “เพิ่มเป็น 6 ขวด” หรือสั่งแบบใหม่ทั้งหมด'
              : 'บอกมาเลยว่าอยากได้กล่องแบบไหน เช่น “กล่องของฝาก ใส่ขวดแยม 3 ขวด แนวอีโค่”'
          }
          aria-label="อธิบายกล่องที่ต้องการ"
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="button"
          className="pb-attach"
          aria-disabled={loading}
          title="แนบรูปสินค้า/กล่องตัวอย่างให้ AI ดูประกอบ"
          aria-label="แนบรูปสินค้า/กล่องตัวอย่างให้ AI ดูประกอบ"
          onClick={() => {
            if (!loading) fileRef.current?.click()
          }}
        >
          📎
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          aria-label="แนบรูปอ้างอิง"
          onChange={(e) => void pickImage(e.target.files?.[0])}
        />
        <div className="pb-quickwrap" ref={quickRef}>
          <button
            type="button"
            className="pb-quickbtn"
            aria-haspopup="true"
            aria-expanded={quickOpen}
            title="คำสั่งปรับเร็ว"
            onClick={() => setQuickOpen((v) => !v)}
          >
            ⚡ ปรับเร็ว
          </button>
          {quickOpen && (
            <div className="pb-quickpop card" role="menu">
              {QUICK_ADJUSTS.map((q) => (
                <button
                  key={q.label}
                  role="menuitem"
                  aria-disabled={loading}
                  onClick={() => {
                    setQuickOpen(false)
                    void run(q.prompt, true, q.label)
                  }}
                >
                  {q.label}
                </button>
              ))}
              <span className="hint">หรือลากปรับขนาด/วัสดุเองได้ตลอด</span>
            </div>
          )}
        </div>
        <button
          type="submit"
          className="primary pb-go"
          aria-disabled={loading || !text.trim()}
        >
          {loading ? 'กำลังคิด…' : 'สร้างกล่อง'}
        </button>
      </form>

      {image && (
        <div className="pb-imgrow">
          <img src={image.preview} alt={`รูปอ้างอิง: ${image.name}`} />
          <span className="pb-imgname">{image.name}</span>
          <span className="hint">AI จะดูรูปนี้ประกอบการออกแบบ</span>
          <button type="button" aria-label="ลบรูปอ้างอิง" onClick={() => setImage(null)}>
            ✕ ลบรูป
          </button>
        </div>
      )}

      {error && (
        <div className="pb-error" role="alert">
          {error}
        </div>
      )}

      <div aria-live="polite" aria-atomic="true">
        {loading && <span className="sr-only">กำลังคำนวณสเปกกล่อง</span>}
        {result && !error && !loading && (
          <div className="pb-result">
            {result.mock && (
              <div className="pb-mock">
                โหมดจำลอง — ไม่พบทั้ง ANTHROPIC_API_KEY และ claude CLI จึงใช้ตัวเดาอย่างง่ายแทน AI จริง
              </div>
            )}
            {showChips && (
              <div className="pb-chips">
                <span className="hint">สิ่งที่ระบบเดา (แก้ได้ที่แถบซ้าย):</span>
                {result.assumptions.map((a, i) => (
                  <span
                    key={i}
                    className={`pb-chip${a.startsWith('ข้อจำกัด') ? ' limit' : ''}${a.startsWith('จากรูป') ? ' fromimg' : ''}`}
                  >
                    {a}
                  </span>
                ))}
                {result.layoutNote !== '-' && <span className="pb-chip">{result.layoutNote}</span>}
              </div>
            )}
            {result.reasoning && <div className="pb-reason">{result.reasoning}</div>}
          </div>
        )}
      </div>
      </div>
    </div>
  )
}
