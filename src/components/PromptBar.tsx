import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { requestBoxSpec, type AiBoxSpec, type CurrentSpec } from '../core/ai'
import { useT } from '../i18n'
import { ApiClientError } from '../services/api/client'

// prompt ที่ส่ง AI เป็นไทยเสมอ (system prompt ฝั่ง server เป็นไทย) — แปลเฉพาะป้ายบนปุ่ม
const QUICK_ADJUSTS = [
  { label: 'หรูขึ้น', labelEn: 'More premium', prompt: 'ปรับให้ดูหรูพรีเมียมขึ้น' },
  { label: 'ถูกลง', labelEn: 'Cheaper', prompt: 'ปรับให้ต้นทุนถูกลง' },
  { label: 'โชว์ของข้างใน', labelEn: 'Show the product', prompt: 'อยากให้มองเห็นสินค้าข้างในกล่อง' },
  { label: 'แข็งแรงส่งไปรษณีย์', labelEn: 'Sturdy for shipping', prompt: 'ต้องส่งไปรษณีย์ ให้ทนแรงกระแทก' },
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
  // cloud: สั่ง AI ไม่ได้ตอนนี้ (เครดิต 0) — ปุ่มยังกดได้ แต่กดแล้วเรียก onBlocked (App เปิดหน้าแพ็กเกจ) แทนเปิดแผงพิมพ์;
  // เหตุผลอยู่ใน title + ข้อความสำหรับ screen reader และมีป้าย "0" บนปุ่มให้ผู้ใช้จอสัมผัสเห็น
  blockedReason?: string
  onBlocked?: () => void
  // true เฉพาะ local-demo = โชว์ช่อง Anthropic API key (BYOK ไป legacy /api/box-spec); cloud ใช้คีย์ของระบบ ไม่ส่งคีย์เลย
  allowApiKey?: boolean
  // เครดิต AI คงเหลือ (cloud) — โชว์ในหัวแถบ; ไม่ส่ง = ไม่แสดง (local ไม่มีเครดิต)
  credits?: number | null
  // แจ้งรหัส error จาก API (เช่น AI_CREDITS_EXHAUSTED) ให้ App เปิด paywall ก่อนขึ้นข้อความ error
  onError?: (code: string, message: string) => void
  requestSpec?: typeof requestBoxSpec
}

export function PromptBar({
  current,
  hasDesign,
  onApply,
  onLoadingChange,
  blockedReason,
  onBlocked,
  allowApiKey = false,
  credits,
  onError,
  requestSpec = requestBoxSpec,
}: PromptBarProps) {
  const t = useT()
  const [text, setText] = useState('')
  const [image, setImage] = useState<RefImage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AiBoxSpec | null>(null)
  const [quickOpen, setQuickOpen] = useState(false)
  const [open, setOpen] = useState(false) // แถบลอยล่าง: ย่อเป็นปุ่มก่อน คลิกแล้วป็อปอัปช่องพิมพ์
  const [apiKey, setApiKey] = useState('')
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
      setError(t('อ่านไฟล์รูปไม่ได้ — รองรับ JPG / PNG / WebP', 'Could not read the image — JPG / PNG / WebP only'))
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
      const spec = await requestSpec(
        prompt,
        withCurrent ? current : undefined,
        image?.base64,
        // คีย์ส่งเฉพาะโหมดที่อนุญาต (local-demo) — cloud ไม่มีทางส่งคีย์แม้ state จะมีค่าค้าง
        allowApiKey ? apiKey.trim() || undefined : undefined,
      )
      setResult(spec)
      onApply(spec, label)
      setImage(null)
      return true
    } catch (e) {
      // รหัสที่รู้จักแปลฝั่ง client (ข้อความ server ของเครดิตหมดชวนซื้อ ซึ่งอาจยังไม่เปิดขาย — App เปิดหน้าแพ็กเกจให้ดูเอง)
      const message = e instanceof ApiClientError && e.code === 'AI_CREDITS_EXHAUSTED'
        ? t('เครดิต AI หมดแล้ว', 'You are out of AI credits')
        : e instanceof ApiClientError && e.code === 'NETWORK_ERROR'
          ? t('เชื่อมต่อ server ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่', 'Cannot reach the server — check your connection and try again')
          : e instanceof Error ? e.message : t('เกิดข้อผิดพลาด', 'Something went wrong')
      if (e instanceof ApiClientError) onError?.(e.code, message)
      setError(message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const showChips = result && (result.assumptions.length > 0 || result.layoutNote !== '-')
  const creditsLabel = credits === undefined || credits === null ? null : t(`เครดิต AI: ${credits}`, `AI credits: ${credits}`)
  const fabTitle = t('สั่ง AI สร้าง/แก้กล่องด้วยข้อความ', 'Ask AI to create or edit the box')
  const blocked = Boolean(blockedReason)

  // ปุ่มทริกเกอร์อยู่บน header (หน้าปุ่มโหมดมืด) คลิกแล้วแผงช่องพิมพ์หย่อนลงมา
  // ถูกบล็อก (เครดิตหมด): ไม่ disable ปุ่ม — กดแล้วไปหน้าแพ็กเกจ; ถ้าแผงเปิดค้างอยู่ กดอีกครั้ง = ปิดแผงตามปกติ
  return (
    <div className={`promptbar-dock${open ? ' open' : ''}`}>
      <button
        type="button"
        className={`pb-fab primary${blocked ? ' blocked' : ''}`}
        aria-expanded={blocked && !open ? undefined : open}
        aria-haspopup={blocked && !open ? 'dialog' : undefined}
        title={blockedReason ?? (creditsLabel ? `${fabTitle} · ${creditsLabel}` : fabTitle)}
        onClick={() => {
          if (blocked && !open) {
            onBlocked?.()
            return
          }
          setOpen((v) => !v)
        }}
      >
        <span aria-hidden="true">✨</span> {t('สั่ง AI', 'Ask AI')}
        {blocked && (
          <>
            <span className="pb-fab-zero" aria-hidden="true">0</span>
            <span className="sr-only"> — {blockedReason}</span>
          </>
        )}
      </button>
      {open && createPortal(
      <div className="promptbar card">
      <div className="pb-dockhead">
        <span className="pb-docktitle">✨ {t('สั่ง AI สร้าง/แก้กล่อง', 'Ask AI to create or edit the box')}</span>
        {creditsLabel && <span className="pb-credits">{creditsLabel}</span>}
        <button type="button" className="pb-min" aria-label={t('ปิดแถบ AI', 'Close the AI panel')} onClick={() => setOpen(false)}>
          ✕
        </button>
      </div>
      {allowApiKey && (
      <div className="pb-keyrow">
        <label htmlFor="anthropic-api-key">Anthropic API key</label>
        <input
          id="anthropic-api-key"
          type="password"
          value={apiKey}
          autoComplete="off"
          spellCheck={false}
          placeholder={t('sk-ant-… (ไม่บันทึก)', 'sk-ant-… (not saved)')}
          aria-describedby="anthropic-api-key-note"
          onChange={(event) => setApiKey(event.target.value)}
        />
        {apiKey && (
          <button type="button" className="pb-keyclear" onClick={() => setApiKey('')}>{t('ล้าง', 'Clear')}</button>
        )}
        <span id="anthropic-api-key-note" className="hint">
          {t(
            'ใช้เฉพาะแท็บนี้และส่งตรงไป backend ของแอปเมื่อกดสร้าง (ไม่ใส่ = ใช้คีย์/CLI ของเครื่อง)',
            'Used only in this tab and sent straight to the app backend when you generate (empty = use this machine’s key/CLI)',
          )}
        </span>
      </div>
      )}
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
              ? t('ปรับต่อจากแบบปัจจุบันได้เลย เช่น “เพิ่มเป็น 6 ขวด” หรือสั่งแบบใหม่ทั้งหมด', 'Refine the current design, e.g. “make it 6 bottles”, or ask for something new')
              : t('บอกมาเลยว่าอยากได้กล่องแบบไหน เช่น “กล่องของฝาก ใส่ขวดแยม 3 ขวด แนวอีโค่”', 'Describe the box you want, e.g. “gift box for 3 jam jars, eco style”')
          }
          aria-label={t('อธิบายกล่องที่ต้องการ', 'Describe the box you want')}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="button"
          className="pb-attach"
          aria-disabled={loading}
          title={t('แนบรูปสินค้า/กล่องตัวอย่างให้ AI ดูประกอบ', 'Attach a product or sample-box photo for the AI')}
          aria-label={t('แนบรูปสินค้า/กล่องตัวอย่างให้ AI ดูประกอบ', 'Attach a product or sample-box photo for the AI')}
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
          aria-label={t('แนบรูปอ้างอิง', 'Attach a reference image')}
          onChange={(e) => void pickImage(e.target.files?.[0])}
        />
        <div className="pb-quickwrap" ref={quickRef}>
          <button
            type="button"
            className="pb-quickbtn"
            aria-haspopup="true"
            aria-expanded={quickOpen}
            title={t('คำสั่งปรับเร็ว', 'Quick adjustments')}
            onClick={() => setQuickOpen((v) => !v)}
          >
            ⚡ {t('ปรับเร็ว', 'Quick')}
          </button>
          {quickOpen && (
            <div className="pb-quickpop card" role="menu">
              {QUICK_ADJUSTS.map((q) => (
                <button
                  key={q.label}
                  role="menuitem"
                  aria-disabled={loading}
                  disabled={loading}
                  onClick={() => {
                    setQuickOpen(false)
                    void run(q.prompt, true, q.label) // ป้ายประวัติเก็บลงงาน — คงไทยเหมือนป้ายประวัติอื่น
                  }}
                >
                  {t(q.label, q.labelEn)}
                </button>
              ))}
              <span className="hint">{t('หรือลากปรับขนาด/วัสดุเองได้ตลอด', 'Or adjust size/material yourself anytime')}</span>
            </div>
          )}
        </div>
        <button
          type="submit"
          className="primary pb-go"
          aria-disabled={loading || !text.trim()}
          disabled={loading || !text.trim()}
        >
          {loading ? t('กำลังคิด…', 'Thinking…') : t('สร้างกล่อง', 'Generate')}
        </button>
      </form>

      {image && (
        <div className="pb-imgrow">
          <img src={image.preview} alt={t(`รูปอ้างอิง: ${image.name}`, `Reference image: ${image.name}`)} />
          <span className="pb-imgname">{image.name}</span>
          <span className="hint">{t('AI จะดูรูปนี้ประกอบการออกแบบ', 'The AI will use this image as a reference')}</span>
          <button type="button" aria-label={t('ลบรูปอ้างอิง', 'Remove the reference image')} onClick={() => setImage(null)}>
            ✕ {t('ลบรูป', 'Remove')}
          </button>
        </div>
      )}

      {error && (
        <div className="pb-error" role="alert">
          {error}
        </div>
      )}

      <div aria-live="polite" aria-atomic="true">
        {loading && <span className="sr-only">{t('กำลังคำนวณสเปกกล่อง', 'Working out the box spec')}</span>}
        {result && !error && !loading && (
          <div className="pb-result">
            {result.mock && (
              <div className="pb-mock">
                {t(
                  'โหมดจำลอง — ไม่พบทั้ง ANTHROPIC_API_KEY และ claude CLI จึงใช้ตัวเดาอย่างง่ายแทน AI จริง',
                  'Mock mode — neither ANTHROPIC_API_KEY nor the claude CLI was found, so a simple guesser stands in for the AI',
                )}
              </div>
            )}
            {showChips && (
              <div className="pb-chips">
                <span className="hint">{t('สิ่งที่ระบบเดา (แก้ได้ที่แถบซ้าย):', 'What the system assumed (edit in the left panel):')}</span>
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
      </div>,
        document.body,
      )}
    </div>
  )
}
