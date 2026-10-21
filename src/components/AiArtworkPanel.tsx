// แผง "ออกแบบหน้าตาด้วย AI" ในแท็บตกแต่ง: prompt + รูปอ้างอิง (สไตล์) + โลโก้ → แผนงานศิลป์จาก server →
// แปลงเป็น Deco ฝั่งนี้ (วัดความกว้างข้อความด้วยฟอนต์จริงของแอป) แล้วส่งให้ App วางลงงาน (undo ได้เหมือนแก้เอง)
import { useRef, useState } from 'react'
import { requestArtworkPlan, type ArtworkImageInput, type ArtworkRequestInput } from '../core/ai'
import { compileArtworkPlan, panelBoxes, parseArtworkPlan, type ArtIssue } from '../core/aiArtwork'
import { loadImageFile, measureText, type Deco, type FillImage } from '../core/artwork'
import type { Dieline } from '../core/types'
import { useT } from '../i18n'
import { toRefImage, type RefImage } from './refImage'

export interface AiArtworkResult {
  decos: Deco[]
  fillColor: string | null
  fillImage: FillImage | null
  mode: 'replace' | 'append'
  explanation: string
  warnings: ArtIssue[]
}

interface Props {
  dieline: Dieline
  kind: 'box' | 'vessel' | 'pouch'
  template: string
  materialId: string
  box: { W: number; D: number; H: number }
  fillColor: string | null
  existingCount: number
  disabled?: boolean
  allowApiKey?: boolean // local-demo: ช่อง Anthropic API key (BYOK) เหมือน PromptBar
  onBusy: (busy: boolean) => void
  onApply: (result: AiArtworkResult) => void
  request?: typeof requestArtworkPlan
}

const MAX_REFS = 3

interface LogoPick {
  ref: RefImage // JPEG ย่อ ส่งให้ AI ดู
  asset: { src: string; aspect: number } // รูปจริง (PNG โปร่งใสได้) ที่จะวางลงงาน
}

export function AiArtworkPanel({ dieline, kind, template, materialId, box, fillColor, existingCount, disabled, allowApiKey = false, onBusy, onApply, request = requestArtworkPlan }: Props) {
  const t = useT()
  const [prompt, setPrompt] = useState('')
  const [refs, setRefs] = useState<RefImage[]>([])
  const [logo, setLogo] = useState<LogoPick | null>(null)
  const [mode, setMode] = useState<'replace' | 'append'>('replace')
  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ explanation: string; warnings: ArtIssue[]; count: number; model: string; mock: boolean } | null>(null)
  const refInput = useRef<HTMLInputElement>(null)
  const logoInput = useRef<HTMLInputElement>(null)

  const pickRefs = async (files: FileList | null) => {
    if (!files?.length) return
    setError(null)
    try {
      const picked: RefImage[] = []
      for (const f of Array.from(files).slice(0, MAX_REFS - refs.length)) picked.push(await toRefImage(f))
      setRefs((r) => [...r, ...picked].slice(0, MAX_REFS))
    } catch {
      setError(t('อ่านไฟล์รูปไม่ได้ — รองรับ JPG / PNG / WebP', 'Could not read the image — JPG / PNG / WebP only'))
    } finally {
      if (refInput.current) refInput.current.value = ''
    }
  }

  const pickLogo = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    try {
      const [ref, asset] = await Promise.all([toRefImage(file), loadImageFile(file)])
      setLogo({ ref, asset })
    } catch {
      setError(t('อ่านไฟล์โลโก้ไม่ได้ — รองรับ PNG / JPG / SVG', 'Could not read the logo — PNG / JPG / SVG only'))
    } finally {
      if (logoInput.current) logoInput.current.value = ''
    }
  }

  const run = async () => {
    if (!prompt.trim() || loading) return
    setLoading(true)
    onBusy(true)
    setError(null)
    setDone(null)
    try {
      const panels = panelBoxes(dieline)
      const images: ArtworkImageInput[] = [
        ...refs.map((r) => ({ data: r.base64, mediaType: 'image/jpeg', role: 'reference' as const, note: r.name })),
        ...(logo ? [{ data: logo.ref.base64, mediaType: 'image/jpeg', role: 'logo' as const, assetId: 'logo', note: logo.ref.name }] : []),
      ]
      const input: ArtworkRequestInput = {
        prompt: prompt.trim(),
        kind,
        template,
        materialId,
        box,
        sheet: { w: dieline.width, h: dieline.height },
        panels,
        fillColor,
        existing: mode === 'replace' ? 0 : existingCount,
        images,
      }
      const res = await request(input, allowApiKey && apiKey.trim() ? apiKey.trim() : undefined)
      // server ส่งแผนที่ parse แล้ว — parse ซ้ำฝั่งนี้เป็นด่านสุดท้าย (กรอง SVG อีกรอบ) ก่อนแปลงด้วยฟอนต์จริง
      const parsed = parseArtworkPlan(res.plan)
      if (!parsed.ok) throw new Error(res.issues[0]?.message ?? t('AI ยังออกแบบไม่สำเร็จ ลองใหม่อีกครั้ง', 'The AI could not finish the design, please retry'))
      const compiled = compileArtworkPlan(parsed.plan, panels, {
        measure: (text, size, font, weight) => measureText(text, size, font, weight),
        assets: logo ? { logo: logo.asset } : undefined,
      })
      if (!compiled.decos.length) throw new Error(t('AI ไม่ได้วางชิ้นงานบนแผงที่พิมพ์ได้เลย ลองใหม่', 'The AI placed nothing on a printable panel, please retry'))
      onApply({ decos: compiled.decos, fillColor: compiled.fillColor, fillImage: compiled.fillImage, mode, explanation: parsed.plan.explanation, warnings: compiled.warnings })
      setDone({ explanation: parsed.plan.explanation, warnings: compiled.warnings, count: compiled.decos.length, model: res.model, mock: res.mock })
    } catch (e) {
      setError(e instanceof Error ? e.message : t('เกิดข้อผิดพลาด', 'Something went wrong'))
    } finally {
      setLoading(false)
      onBusy(false)
    }
  }

  const busy = loading || !!disabled
  return (
    <div className="ai-art">
      <textarea
        className="ai-art-prompt"
        rows={3}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        disabled={busy}
        placeholder={t('บอกสินค้า อารมณ์ สี และข้อมูลที่ต้องมี เช่น "ชาดอกอัญชัน 20 ซอง โทนครามกับทอง มินิมอล ใส่ชื่อแบรนด์ ฟ้าคราม"', 'Describe the product, mood, colours and required info')}
      />
      <div className="ai-art-row">
        <label className="file-pick inline">
          <input ref={refInput} type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy || refs.length >= MAX_REFS} onChange={(e) => void pickRefs(e.target.files)} />
          {t('แนบรูปอ้างอิงสไตล์', 'Add style references')} ({refs.length}/{MAX_REFS})
        </label>
        <label className="file-pick inline">
          <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/svg+xml,.svg" disabled={busy} onChange={(e) => void pickLogo(e.target.files?.[0])} />
          {logo ? t('เปลี่ยนโลโก้', 'Change logo') : t('แนบโลโก้ของคุณ', 'Add your logo')}
        </label>
      </div>
      {(refs.length > 0 || logo) && (
        <div className="ai-art-thumbs">
          {refs.map((r, i) => (
            <figure key={i} className="ai-art-thumb">
              <img src={r.preview} alt={r.name} />
              <button type="button" aria-label={t('เอารูปออก', 'Remove image')} disabled={busy} onClick={() => setRefs((xs) => xs.filter((_, j) => j !== i))}>×</button>
              <figcaption>{t('อ้างอิง', 'Reference')}</figcaption>
            </figure>
          ))}
          {logo && (
            <figure className="ai-art-thumb">
              <img src={logo.asset.src} alt={logo.ref.name} />
              <button type="button" aria-label={t('เอาโลโก้ออก', 'Remove logo')} disabled={busy} onClick={() => setLogo(null)}>×</button>
              <figcaption>{t('โลโก้', 'Logo')}</figcaption>
            </figure>
          )}
        </div>
      )}
      {existingCount > 0 && (
        <div className="ai-art-row ai-art-mode">
          <label><input type="radio" name="ai-art-mode" checked={mode === 'replace'} disabled={busy} onChange={() => setMode('replace')} /> {t('แทนที่ลายเดิม', 'Replace current artwork')} ({existingCount})</label>
          <label><input type="radio" name="ai-art-mode" checked={mode === 'append'} disabled={busy} onChange={() => setMode('append')} /> {t('เพิ่มต่อจากลายเดิม', 'Add to current artwork')}</label>
        </div>
      )}
      {allowApiKey && (
        <input
          className="ai-art-key"
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          disabled={busy}
          placeholder={t('Anthropic API key (ไม่ใส่ = ใช้ CLI/โหมดจำลองของ dev server)', 'Anthropic API key (optional)')}
        />
      )}
      <button type="button" className="ai-art-run" disabled={busy || !prompt.trim()} onClick={() => void run()}>
        {loading ? t('AI กำลังออกแบบ… (อาจใช้เวลา 1-3 นาที)', 'Designing… (1-3 minutes)') : t('ให้ AI ออกแบบหน้าตา', 'Design artwork with AI')}
      </button>
      {error && <p className="ai-art-error" role="alert">{error}</p>}
      {done && (
        <div className="ai-art-done">
          <p>
            <strong>{t('วางแล้ว', 'Placed')} {done.count} {t('ชิ้น', 'elements')}</strong>
            {done.mock ? ` · ${t('โหมดจำลอง', 'mock mode')}` : ` · ${done.model}`}
          </p>
          <p>{done.explanation}</p>
          {done.warnings.length > 0 && (
            <details>
              <summary>{t('ระบบปรับให้อัตโนมัติ', 'Auto-adjusted')} ({done.warnings.length})</summary>
              <ul>{done.warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
            </details>
          )}
          <p className="ai-art-hint">{t('แก้ต่อได้ทุกชิ้นใน blueprint หรือกด Ctrl+Z เพื่อย้อนกลับ', 'Edit any element in the blueprint, or press Ctrl+Z to undo')}</p>
        </div>
      )}
    </div>
  )
}
