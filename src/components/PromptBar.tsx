import { useState } from 'react'
import { requestBoxSpec, type AiBoxSpec, type CurrentSpec } from '../core/ai'

const QUICK_ADJUSTS = [
  { label: 'หรูขึ้น', prompt: 'ปรับให้ดูหรูพรีเมียมขึ้น' },
  { label: 'ถูกลง', prompt: 'ปรับให้ต้นทุนถูกลง' },
  { label: 'โชว์ของข้างใน', prompt: 'อยากให้มองเห็นสินค้าข้างในกล่อง' },
  { label: 'แข็งแรงส่งไปรษณีย์', prompt: 'ต้องส่งไปรษณีย์ ให้ทนแรงกระแทก' },
]

interface PromptBarProps {
  current: CurrentSpec
  hasDesign: boolean
  onApply: (spec: AiBoxSpec, label: string) => void
  onLoadingChange: (loading: boolean) => void
}

export function PromptBar({ current, hasDesign, onApply, onLoadingChange }: PromptBarProps) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AiBoxSpec | null>(null)

  const setBusy = (v: boolean) => {
    setLoading(v)
    onLoadingChange(v)
  }

  const run = async (prompt: string, withCurrent: boolean, label: string): Promise<boolean> => {
    if (!prompt.trim() || loading) return false
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const spec = await requestBoxSpec(prompt, withCurrent ? current : undefined)
      setResult(spec)
      onApply(spec, label)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด')
      return false
    } finally {
      setBusy(false)
    }
  }

  const showChips = result && (result.assumptions.length > 0 || result.layoutNote !== '-')

  return (
    <div className="promptbar card">
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
          type="submit"
          className="primary pb-go"
          aria-disabled={loading || !text.trim()}
        >
          {loading ? 'กำลังคิด…' : 'สร้างกล่อง'}
        </button>
      </form>

      <div className="pb-quick">
        <span className="hint">ปรับเร็ว:</span>
        {QUICK_ADJUSTS.map((q) => (
          <button
            key={q.label}
            aria-disabled={loading}
            onClick={() => void run(q.prompt, true, q.label)}
          >
            {q.label}
          </button>
        ))}
        <span className="hint pb-tail">หรือลากปรับขนาด/วัสดุเองได้ตลอด</span>
      </div>

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
                  <span key={i} className="pb-chip">
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
  )
}
