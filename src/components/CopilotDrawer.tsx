// Copilot: แผง AI ด้านขวาแบบคุยต่อเนื่อง (แทน popover "สั่ง AI" เดิม) — สองโหมดในช่องเดียว
//   spec    = เลือกแบบกล่อง/วัสดุ/ขนาดจากคำสั่ง (legacy /api/box-spec หรือ cloud requestAiSpec) ใช้ได้ทุกที่
//   artwork = ออกแบบหน้าตาบน template ปัจจุบัน (src/core/aiArtwork + /api/ai-artwork) — local dev ก่อน (cloud ยังไม่มี)
// ผลลัพธ์ทุกแบบถูก "วางลงงานทันที" (undo ได้) แล้วโชว์เป็นการ์ดในบทสนทนา; ผล artwork เก็บเป็น snapshot ให้เปิดดู/สลับบนเวที 3D
import { useEffect, useRef, useState } from 'react'
import { requestArtworkPlan, requestBoxSpec, type AiBoxSpec, type ArtworkImageInput, type ArtworkRequestInput, type CurrentSpec } from '../core/ai'
import { compileArtworkPlan, panelBoxes, parseArtworkPlan, type ArtIssue } from '../core/aiArtwork'
import { loadImageFile, measureText, type Deco, type FillImage } from '../core/artwork'
import type { Dieline } from '../core/types'
import { useT } from '../i18n'
import { ApiClientError } from '../services/api/client'
import { toRefImage, type RefImage } from './refImage'

export type CopilotMode = 'spec' | 'artwork'

export interface AiArtworkResult {
  decos: Deco[]
  fillColor: string | null
  fillImage: FillImage | null
  mode: 'replace' | 'append'
  explanation: string
  warnings: ArtIssue[]
}

// บริบทของโหมด artwork — App ส่งมาเมื่อใช้ได้ (local); null = ยังไม่เปิดบน cloud
export interface CopilotArtworkContext {
  dieline: Dieline
  kind: 'box' | 'vessel' | 'pouch'
  template: string
  materialId: string
  box: { W: number; D: number; H: number }
  fillColor: string | null
  existingCount: number
  onApply: (result: AiArtworkResult) => void
  request?: typeof requestArtworkPlan
}

// prompt ที่ส่ง AI เป็นไทยเสมอ (system prompt ฝั่ง server เป็นไทย) — แปลเฉพาะป้ายบนปุ่ม
export const QUICK_ADJUSTS = [
  { label: 'หรูขึ้น', labelEn: 'More premium', prompt: 'ปรับให้ดูหรูพรีเมียมขึ้น' },
  { label: 'ถูกลง', labelEn: 'Cheaper', prompt: 'ปรับให้ต้นทุนถูกลง' },
  { label: 'โชว์ของข้างใน', labelEn: 'Show the product', prompt: 'อยากให้มองเห็นสินค้าข้างในกล่อง' },
  { label: 'แข็งแรงส่งไปรษณีย์', labelEn: 'Sturdy for shipping', prompt: 'ต้องส่งไปรษณีย์ ให้ทนแรงกระแทก' },
]
const STYLE_CHIPS = ['อบอุ่น', 'พรีเมียม', 'มินิมอล', 'สดใส', 'ธรรมชาติ']
const MAX_REFS = 3
// ลำดับงานของ AI ออกแบบหน้าตา ตามเวลาที่ผ่านไป (โดยประมาณ — server ไม่ได้สตรีมความคืบหน้า)
const ART_PHASES: { at: number; th: string; en: string }[] = [
  { at: 0, th: 'อ่านโจทย์และรูปอ้างอิง', en: 'Reading the brief and references' },
  { at: 20, th: 'วางหน้ากล่อง: แบรนด์ สโลแกน โลโก้', en: 'Laying out the front panel' },
  { at: 50, th: 'วาดภาพหลักและลายประดับ', en: 'Drawing the hero art' },
  { at: 95, th: 'ข้อมูลด้านหลังและด้านข้าง', en: 'Back and side information' },
  { at: 140, th: 'ตรวจระยะขอบและวางลงแผ่นคลี่', en: 'Checking margins and placing on the sheet' },
]
const ART_EXPECTED_S = 160

type Msg =
  | { id: string; role: 'user'; text: string; mode: CopilotMode; images: RefImage[]; logo: RefImage | null }
  | { id: string; role: 'ai'; kind: 'spec'; spec: AiBoxSpec; label: string }
  | { id: string; role: 'ai'; kind: 'artwork'; snapshotId: string; explanation: string; count: number; warnings: ArtIssue[]; placeholders: string[]; model: string; mock: boolean }
  | { id: string; role: 'ai'; kind: 'error'; text: string }
  | { id: string; role: 'ai'; kind: 'cancelled' }

export interface CopilotDrawerProps {
  open: boolean
  onClose: () => void
  current: CurrentSpec
  hasDesign: boolean
  onApplySpec: (spec: AiBoxSpec, label: string) => void
  requestSpec?: typeof requestBoxSpec
  artwork: CopilotArtworkContext | null
  // snapshot id ที่ App สร้างหลัง onApply (ใช้ผูกการ์ดกับเวที)
  lastSnapshotId: string | null
  onOpenStage: () => void
  onLoadingChange: (loading: boolean) => void
  allowApiKey?: boolean
  credits?: number | null
  blockedReason?: string
  onBlocked?: () => void
  onError?: (code: string, message: string) => void
}

let seq = 0
const nextId = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`

// ช่องที่ AI เว้นไว้ให้กรอก เช่น "[กรอกที่อยู่]" — ดึงจากข้อความทุกชิ้นมาเตือน
export function placeholderFields(decos: Deco[]): string[] {
  const out = new Set<string>()
  for (const d of decos) {
    if (d.type !== 'text') continue
    for (const m of d.text.matchAll(/\[([^\]\n]{1,30})\]/g)) out.add(m[1].trim())
  }
  return [...out].slice(0, 8)
}

export function CopilotDrawer({
  open,
  onClose,
  current,
  hasDesign,
  onApplySpec,
  requestSpec = requestBoxSpec,
  artwork,
  lastSnapshotId,
  onOpenStage,
  onLoadingChange,
  allowApiKey = false,
  credits,
  blockedReason,
  onBlocked,
  onError,
}: CopilotDrawerProps) {
  const t = useT()
  const [mode, setMode] = useState<CopilotMode>(artwork && hasDesign ? 'artwork' : 'spec')
  const [text, setText] = useState('')
  const [refs, setRefs] = useState<RefImage[]>([])
  const [logo, setLogo] = useState<{ ref: RefImage; asset: { src: string; aspect: number } } | null>(null)
  const [artMode, setArtMode] = useState<'replace' | 'append'>('replace')
  const [apiKey, setApiKey] = useState('')
  const [keyOpen, setKeyOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [busy, setBusy] = useState<{ mode: CopilotMode; startedAt: number } | null>(null)
  const [now, setNow] = useState(Date.now())
  const abortRef = useRef<AbortController | null>(null)
  const refInput = useRef<HTMLInputElement>(null)
  const logoInput = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  // นาฬิกาตอนรอ AI
  useEffect(() => {
    if (!busy) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [busy])

  // เลื่อนบทสนทนาลงล่างเมื่อมีข้อความใหม่
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, busy])

  useEffect(() => {
    if (open) textRef.current?.focus()
  }, [open])

  const push = (m: Msg) => setMessages((ms) => [...ms, m])
  const setLoading = (v: boolean) => {
    onLoadingChange(v)
  }

  const pickRefs = async (files: FileList | null) => {
    if (!files?.length) return
    try {
      const picked: RefImage[] = []
      for (const f of Array.from(files).slice(0, MAX_REFS - refs.length)) picked.push(await toRefImage(f))
      setRefs((r) => [...r, ...picked].slice(0, MAX_REFS))
    } catch {
      push({ id: nextId(), role: 'ai', kind: 'error', text: t('อ่านไฟล์รูปไม่ได้ — รองรับ JPG / PNG / WebP', 'Could not read the image — JPG / PNG / WebP only') })
    } finally {
      if (refInput.current) refInput.current.value = ''
    }
  }

  const pickLogo = async (file: File | undefined) => {
    if (!file) return
    try {
      const [ref, asset] = await Promise.all([toRefImage(file), loadImageFile(file)])
      setLogo({ ref, asset })
    } catch {
      push({ id: nextId(), role: 'ai', kind: 'error', text: t('อ่านไฟล์โลโก้ไม่ได้ — รองรับ PNG / JPG / SVG', 'Could not read the logo — PNG / JPG / SVG only') })
    } finally {
      if (logoInput.current) logoInput.current.value = ''
    }
  }

  const runSpec = async (prompt: string, withCurrent: boolean, label: string) => {
    const spec = await requestSpec(prompt, withCurrent ? current : undefined, refs[0]?.base64, allowApiKey && apiKey.trim() ? apiKey.trim() : undefined)
    onApplySpec(spec, label)
    push({ id: nextId(), role: 'ai', kind: 'spec', spec, label })
  }

  const runArtwork = async (prompt: string, signal: AbortSignal) => {
    if (!artwork) throw new Error(t('ยังไม่มีแบบให้ออกแบบหน้าตา', 'There is no design to decorate yet'))
    const panels = panelBoxes(artwork.dieline)
    const images: ArtworkImageInput[] = [
      ...refs.map((r) => ({ data: r.base64, mediaType: 'image/jpeg', role: 'reference' as const, note: r.name })),
      ...(logo ? [{ data: logo.ref.base64, mediaType: 'image/jpeg', role: 'logo' as const, assetId: 'logo', note: logo.ref.name }] : []),
    ]
    const input: ArtworkRequestInput = {
      prompt,
      kind: artwork.kind,
      template: artwork.template,
      materialId: artwork.materialId,
      box: artwork.box,
      sheet: { w: artwork.dieline.width, h: artwork.dieline.height },
      panels,
      fillColor: artwork.fillColor,
      existing: artMode === 'replace' ? 0 : artwork.existingCount,
      images,
    }
    const request = artwork.request ?? requestArtworkPlan
    const res = await request(input, allowApiKey && apiKey.trim() ? apiKey.trim() : undefined, signal)
    const parsed = parseArtworkPlan(res.plan)
    if (!parsed.ok) throw new Error(res.issues[0]?.message ?? t('AI ยังออกแบบไม่สำเร็จ ลองใหม่อีกครั้ง', 'The AI could not finish the design, please retry'))
    const compiled = compileArtworkPlan(parsed.plan, panels, {
      measure: (txt, size, font, weight) => measureText(txt, size, font, weight),
      assets: logo ? { logo: logo.asset } : undefined,
    })
    if (!compiled.decos.length) throw new Error(t('AI ไม่ได้วางชิ้นงานบนแผงที่พิมพ์ได้เลย ลองใหม่', 'The AI placed nothing on a printable panel, please retry'))
    artwork.onApply({ decos: compiled.decos, fillColor: compiled.fillColor, fillImage: compiled.fillImage, mode: artMode, explanation: parsed.plan.explanation, warnings: compiled.warnings })
    push({
      id: nextId(), role: 'ai', kind: 'artwork', snapshotId: '', explanation: parsed.plan.explanation, count: compiled.decos.length,
      warnings: compiled.warnings, placeholders: placeholderFields(compiled.decos), model: res.model, mock: res.mock,
    })
  }

  const send = async (prompt: string, label = prompt.trim(), withCurrent = hasDesign) => {
    const p = prompt.trim()
    if (!p || busy) return
    if (blockedReason) {
      onBlocked?.()
      return
    }
    const runMode: CopilotMode = mode === 'artwork' && artwork ? 'artwork' : 'spec'
    push({ id: nextId(), role: 'user', text: p, mode: runMode, images: refs, logo: runMode === 'artwork' ? logo?.ref ?? null : null })
    setText('')
    const ac = new AbortController()
    abortRef.current = ac
    setBusy({ mode: runMode, startedAt: Date.now() })
    setNow(Date.now())
    setLoading(true)
    try {
      if (runMode === 'artwork') await runArtwork(p, ac.signal)
      else await runSpec(p, withCurrent, label)
      setRefs([])
    } catch (e) {
      if (ac.signal.aborted) push({ id: nextId(), role: 'ai', kind: 'cancelled' })
      else {
        const message =
          e instanceof ApiClientError && e.code === 'AI_CREDITS_EXHAUSTED'
            ? t('เครดิต AI หมดแล้ว — ดูแพ็กเกจเพื่อเติม', 'AI credits are used up — see plans to top up')
            : e instanceof ApiClientError && e.code === 'NETWORK_ERROR'
              ? t('เชื่อมต่อ server ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่', 'Cannot reach the server — check your connection and try again')
              : e instanceof Error ? e.message : t('เกิดข้อผิดพลาด', 'Something went wrong')
        if (e instanceof ApiClientError) onError?.(e.code, message)
        push({ id: nextId(), role: 'ai', kind: 'error', text: message })
      }
    } finally {
      abortRef.current = null
      setBusy(null)
      setLoading(false)
    }
  }

  // ผูกการ์ด artwork ล่าสุดกับ snapshot ที่ App สร้าง (App ตั้ง lastSnapshotId หลัง onApply)
  useEffect(() => {
    if (!lastSnapshotId) return
    setMessages((ms) => {
      const i = [...ms].reverse().findIndex((m) => m.role === 'ai' && m.kind === 'artwork' && !m.snapshotId)
      if (i < 0) return ms
      const idx = ms.length - 1 - i
      const m = ms[idx]
      if (m.role !== 'ai' || m.kind !== 'artwork') return ms
      const next = ms.slice()
      next[idx] = { ...m, snapshotId: lastSnapshotId }
      return next
    })
  }, [lastSnapshotId])

  if (!open) return null

  const elapsed = busy ? Math.max(0, Math.round((now - busy.startedAt) / 1000)) : 0
  const phaseIdx = ART_PHASES.reduce((acc, p, i) => (elapsed >= p.at ? i : acc), 0)
  const pct = Math.min(96, Math.round((elapsed / ART_EXPECTED_S) * 100))
  const mm = String(Math.floor(elapsed / 60))
  const ss = String(elapsed % 60).padStart(2, '0')
  const artworkOn = mode === 'artwork' && !!artwork
  const canSend = !busy && !!text.trim() && !blockedReason

  return (
    <section className="copilot" aria-label={t('แผง Copilot AI', 'AI Copilot panel')}>
      <div className="copilot-head">
        <span className="copilot-logo" aria-hidden="true">✦</span>
        <div className="copilot-title">
          <strong>Copilot</strong>
          <span>
            {credits !== undefined && credits !== null
              ? t(`เครดิตคงเหลือ ${credits}`, `${credits} credits left`)
              : t('สร้างกล่องหรือออกแบบหน้าตาด้วยข้อความ', 'Create a box or design artwork with text')}
          </span>
        </div>
        <span className="copilot-spacer" />
        <button type="button" className="copilot-close" aria-label={t('ปิดแผง Copilot', 'Close Copilot')} onClick={onClose}>✕</button>
      </div>

      <div className="copilot-list" ref={listRef}>
        <div className="cp-ai">
          <span className="cp-avatar" aria-hidden="true">✦</span>
          <div className="cp-bubble">
            {t('สวัสดีครับ งานนี้คือ', 'Hi — this job is')} {current.template} {current.W}×{current.D}×{current.H} {t('มม.', 'mm')} · {current.materialId}
            <br />
            {t('อยากให้ช่วยแบบไหน', 'What would you like me to do?')}
          </div>
        </div>
        <div className="cp-modes" role="radiogroup" aria-label={t('โหมด AI', 'AI mode')}>
          <button type="button" role="radio" aria-checked={mode === 'spec'} className={`cp-mode${mode === 'spec' ? ' on' : ''}`} onClick={() => setMode('spec')} disabled={!!busy}>
            <strong>{t('โครงกล่องจากคำสั่ง', 'Box from a prompt')}</strong>
            <span>{t('เลือกแบบ วัสดุ ขนาด ให้ตรงสินค้า', 'Pick the template, material and size')}</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'artwork'}
            className={`cp-mode${mode === 'artwork' ? ' on' : ''}`}
            onClick={() => artwork && setMode('artwork')}
            disabled={!!busy || !artwork}
            title={artwork ? undefined : t('ยังไม่เปิดบน cloud ในเวอร์ชันนี้', 'Not available on cloud yet')}
          >
            <strong>{t('ออกแบบหน้าตาบนแบบนี้', 'Design artwork on this box')}</strong>
            <span>{artwork ? t('ลาย ข้อความ โลโก้ ครบทุกแผง', 'Art, text and logo on every panel') : t('ต้องมีแบบในงานก่อน', 'Needs a design in the job first')}</span>
          </button>
        </div>

        {messages.map((m) => {
          if (m.role === 'user') {
            return (
              <div className="cp-user" key={m.id}>
                <div className="cp-bubble user">
                  <span className="cp-tag">{m.mode === 'artwork' ? t('หน้าตา', 'Artwork') : t('โครงกล่อง', 'Box')}</span>
                  {m.text}
                </div>
                {(m.images.length > 0 || m.logo) && (
                  <div className="cp-thumbs">
                    {m.images.map((im, i) => <img key={i} src={im.preview} alt={t(`รูปอ้างอิง ${im.name}`, `Reference ${im.name}`)} />)}
                    {m.logo && <img className="logo" src={m.logo.preview} alt={t(`โลโก้ ${m.logo.name}`, `Logo ${m.logo.name}`)} />}
                  </div>
                )}
              </div>
            )
          }
          if (m.kind === 'error') {
            return (
              <div className="cp-ai" key={m.id}>
                <span className="cp-avatar" aria-hidden="true">✦</span>
                <div className="cp-bubble error" role="alert">{m.text}</div>
              </div>
            )
          }
          if (m.kind === 'cancelled') {
            return (
              <div className="cp-ai" key={m.id}>
                <span className="cp-avatar" aria-hidden="true">✦</span>
                <div className="cp-bubble">{t('ยกเลิกแล้ว ไม่มีอะไรถูกเปลี่ยนในงาน', 'Cancelled — nothing in the job was changed')}</div>
              </div>
            )
          }
          if (m.kind === 'spec') {
            const s = m.spec
            const chips = s.assumptions.length > 0 || s.layoutNote !== '-'
            return (
              <div className="cp-ai" key={m.id}>
                <span className="cp-avatar" aria-hidden="true">✦</span>
                <div className="cp-card">
                  <div className="cp-card-head">
                    <strong>{t('ตั้งค่ากล่องให้แล้ว', 'Box set up')}</strong>
                    <span>{s.template} · {s.W}×{s.D}×{s.H} {t('มม.', 'mm')} · {s.materialId}{s.handle ? ` · ${t('มีหูหิ้ว', 'with handle')}` : ''}</span>
                  </div>
                  {s.mock && <div className="cp-note">{t('โหมดจำลอง — ไม่พบคีย์/CLI จึงใช้ตัวเดาอย่างง่าย', 'Mock mode — no key/CLI found, a simple guesser stood in')}</div>}
                  {chips && (
                    <div className="pb-chips">
                      {s.assumptions.map((a, i) => (
                        <span key={i} className={`pb-chip${a.startsWith('ข้อจำกัด') ? ' limit' : ''}${a.startsWith('จากรูป') ? ' fromimg' : ''}`}>{a}</span>
                      ))}
                      {s.layoutNote !== '-' && <span className="pb-chip">{s.layoutNote}</span>}
                    </div>
                  )}
                  {s.reasoning && <p className="cp-reason">{s.reasoning}</p>}
                  <div className="cp-quick">
                    {QUICK_ADJUSTS.map((q) => (
                      <button key={q.label} type="button" disabled={!!busy} onClick={() => { setMode('spec'); void send(q.prompt, q.label, true) }}>
                        {t(q.label, q.labelEn)}
                      </button>
                    ))}
                    {artwork && (
                      <button type="button" className="accent" disabled={!!busy} onClick={() => { setMode('artwork'); textRef.current?.focus() }}>
                        {t('ต่อไป: ออกแบบหน้าตา →', 'Next: design the artwork →')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          }
          // artwork
          return (
            <div className="cp-ai" key={m.id}>
              <span className="cp-avatar" aria-hidden="true">✦</span>
              <div className="cp-card">
                <div className="cp-card-head">
                  <strong>{t(`วางลายแล้ว ${m.count} ชิ้น`, `Placed ${m.count} elements`)}</strong>
                  <span>{m.mock ? t('โหมดจำลอง', 'mock mode') : m.model} · {t('วางในงานแล้ว · Ctrl+Z ย้อนได้', 'applied to the job · Ctrl+Z to undo')}</span>
                </div>
                <p className="cp-reason">{m.explanation}</p>
                {m.placeholders.length > 0 && (
                  <div className="cp-fill">
                    <span>{t('ต้องกรอกเอง', 'Fill in yourself')}</span>
                    {m.placeholders.map((p) => <span key={p} className="cp-fill-chip">{p}</span>)}
                  </div>
                )}
                {m.warnings.length > 0 && (
                  <details className="cp-details">
                    <summary>{t(`ระบบปรับให้อัตโนมัติ (${m.warnings.length})`, `Auto-adjusted (${m.warnings.length})`)}</summary>
                    <ul>{m.warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
                  </details>
                )}
                <div className="cp-quick">
                  <button type="button" className="accent" disabled={!!busy} onClick={onOpenStage}>{t('ดูบนเวที 3D', 'View on the 3D stage')}</button>
                  <button type="button" disabled={!!busy} onClick={() => {
                    const last = [...messages].reverse().find((x) => x.role === 'user' && x.mode === 'artwork')
                    if (last && last.role === 'user') { setMode('artwork'); setArtMode('replace'); void send(last.text) }
                  }}>{t('ลองอีกแบบ', 'Try another')}</button>
                </div>
              </div>
            </div>
          )
        })}

        {busy && (
          <div className="cp-ai">
            <span className="cp-avatar" aria-hidden="true">✦</span>
            <div className="cp-card progress" aria-live="polite">
              <div className="cp-card-head">
                <strong>{busy.mode === 'artwork' ? t('กำลังออกแบบหน้าตา…', 'Designing the artwork…') : t('กำลังคิดโครงกล่อง…', 'Working out the box…')}</strong>
                <span>{mm}:{ss}{busy.mode === 'artwork' ? ` · ${t('ปกติ 1–3 นาที', 'usually 1–3 min')}` : ''}</span>
              </div>
              {busy.mode === 'artwork' ? (
                <>
                  <div className="cp-bar"><div style={{ width: `${pct}%` }} /></div>
                  <ol className="cp-phases">
                    {ART_PHASES.map((p, i) => (
                      <li key={p.at} className={i < phaseIdx ? 'done' : i === phaseIdx ? 'now' : ''}>{t(p.th, p.en)}</li>
                    ))}
                  </ol>
                  <span className="hint">{t('ลำดับงานโดยประมาณ · ปิดแผงได้ งานจะทำต่อเอง', 'Approximate steps · you can close the panel, the job continues')}</span>
                </>
              ) : (
                <div className="cp-bar indeterminate"><div /></div>
              )}
              <div className="cp-quick">
                <button type="button" onClick={() => abortRef.current?.abort()}>{t('ยกเลิก', 'Cancel')}</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {blockedReason && (
        <div className="cp-blocked" role="status">
          <span>{blockedReason}</span>
          <button type="button" onClick={onBlocked}>{t('ดูแพ็กเกจ', 'See plans')}</button>
        </div>
      )}

      <form
        className="copilot-composer"
        onSubmit={(e) => {
          e.preventDefault()
          void send(text)
        }}
      >
        {(refs.length > 0 || (artworkOn && logo)) && (
          <div className="cp-attach-row">
            {refs.map((r, i) => (
              <span key={i} className="cp-attach">
                <img src={r.preview} alt={r.name} />
                <button type="button" aria-label={t('เอารูปออก', 'Remove image')} onClick={() => setRefs((xs) => xs.filter((_, j) => j !== i))}>×</button>
              </span>
            ))}
            {artworkOn && logo && (
              <span className="cp-attach logo">
                <img src={logo.asset.src} alt={logo.ref.name} />
                <em>{t('โลโก้', 'Logo')}</em>
                <button type="button" aria-label={t('เอาโลโก้ออก', 'Remove logo')} onClick={() => setLogo(null)}>×</button>
              </span>
            )}
          </div>
        )}
        {artworkOn && (
          <div className="cp-chiprow">
            {STYLE_CHIPS.map((s) => (
              <button key={s} type="button" disabled={!!busy} onClick={() => setText((v) => (v.includes(s) ? v : `${v.trim()} ${t('สไตล์', 'style')} ${s}`.trim()))}>{s}</button>
            ))}
            {artwork && artwork.existingCount > 0 && (
              <label className="cp-switch">
                <input type="checkbox" checked={artMode === 'append'} disabled={!!busy} onChange={(e) => setArtMode(e.target.checked ? 'append' : 'replace')} />
                {t(`เพิ่มต่อจากลายเดิม (${artwork.existingCount})`, `Add to current artwork (${artwork.existingCount})`)}
              </label>
            )}
          </div>
        )}
        <label htmlFor="copilot-text" className="sr-only">{t('ข้อความถึง Copilot', 'Message to Copilot')}</label>
        <textarea
          id="copilot-text"
          ref={textRef}
          rows={3}
          value={text}
          disabled={!!busy}
          placeholder={
            artworkOn
              ? t('บอกสินค้า อารมณ์ สี และข้อมูลที่ต้องมี เช่น "ชาดอกอัญชัน 20 ซอง โทนครามกับทอง มินิมอล"', 'Describe the product, mood, colours and required info')
              : hasDesign
                ? t('ปรับต่อจากแบบปัจจุบันได้เลย เช่น "เพิ่มเป็น 6 ขวด" หรือสั่งแบบใหม่ทั้งหมด', 'Refine the current design, e.g. "make it 6 bottles", or ask for something new')
                : t('บอกมาเลยว่าอยากได้กล่องแบบไหน เช่น "กล่องของฝาก ใส่ขวดแยม 3 ขวด แนวอีโค่"', 'Describe the box you want, e.g. "gift box for 3 jam jars, eco style"')
          }
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send(text)
            }
          }}
        />
        <div className="cp-tools">
          <input ref={refInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden aria-label={t('แนบรูปอ้างอิง', 'Attach reference images')} onChange={(e) => void pickRefs(e.target.files)} />
          <button type="button" className="cp-tool" disabled={!!busy || refs.length >= (artworkOn ? MAX_REFS : 1)} title={t('แนบรูปอ้างอิง', 'Attach reference images')} aria-label={t('แนบรูปอ้างอิง', 'Attach reference images')} onClick={() => refInput.current?.click()}>📎</button>
          {artworkOn && (
            <>
              <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/svg+xml,.svg" hidden aria-label={t('แนบโลโก้', 'Attach logo')} onChange={(e) => void pickLogo(e.target.files?.[0])} />
              <button type="button" className="cp-tool" disabled={!!busy} onClick={() => logoInput.current?.click()}>{logo ? t('เปลี่ยนโลโก้', 'Change logo') : t('+ โลโก้', '+ Logo')}</button>
            </>
          )}
          <span className="cp-modepill">{artworkOn ? t('หน้าตาบนแบบนี้', 'Artwork') : t('โครงกล่อง', 'Box')}</span>
          <span className="copilot-spacer" />
          {allowApiKey && (
            <button type="button" className="cp-tool" aria-expanded={keyOpen} onClick={() => setKeyOpen((v) => !v)}>{apiKey ? t('คีย์ ✓', 'Key ✓') : t('คีย์', 'Key')}</button>
          )}
          <button type="submit" className="primary cp-send" disabled={!canSend} aria-disabled={!canSend}>
            {busy ? t('กำลังทำ…', 'Working…') : artworkOn ? t('ออกแบบ', 'Design') : t('สร้างกล่อง', 'Generate')}
          </button>
        </div>
        {allowApiKey && keyOpen && (
          <div className="pb-keyrow">
            <label htmlFor="copilot-api-key">Anthropic API key</label>
            <input id="copilot-api-key" type="password" value={apiKey} autoComplete="off" spellCheck={false} placeholder={t('sk-ant-… (ไม่บันทึก)', 'sk-ant-… (not saved)')} onChange={(e) => setApiKey(e.target.value)} />
            <span className="hint">{t('ใช้เฉพาะแท็บนี้ ส่งตรงไป backend ของแอป (ไม่ใส่ = ใช้คีย์/CLI ของเครื่อง)', 'Used only in this tab and sent straight to the app backend (empty = this machine’s key/CLI)')}</span>
          </div>
        )}
      </form>
    </section>
  )
}

// ปุ่ม "สั่ง AI" บน header (เปิด/ปิดแผง Copilot) — ถูกบล็อก (เครดิต 0): ยังกดได้ แต่พาไปหน้าแพ็กเกจแทน
export function AiTrigger({ open, onToggle, credits, blockedReason, onBlocked }: { open: boolean; onToggle: () => void; credits?: number | null; blockedReason?: string; onBlocked?: () => void }) {
  const t = useT()
  const creditsLabel = credits === undefined || credits === null ? null : t(`เครดิต AI: ${credits}`, `AI credits: ${credits}`)
  const fabTitle = t('สั่ง AI สร้าง/แก้กล่องด้วยข้อความ', 'Ask AI to create or edit the box')
  const blocked = Boolean(blockedReason)
  return (
    <button
      type="button"
      className={`pb-fab primary${blocked ? ' blocked' : ''}${open ? ' open' : ''}`}
      aria-expanded={blocked && !open ? undefined : open}
      aria-haspopup={blocked && !open ? 'dialog' : undefined}
      title={blockedReason ?? (creditsLabel ? `${fabTitle} · ${creditsLabel}` : fabTitle)}
      onClick={() => {
        if (blocked && !open) {
          onBlocked?.()
          return
        }
        onToggle()
      }}
    >
      <span aria-hidden="true">✨</span> {t('สั่ง AI', 'Ask AI')}
      {creditsLabel && !blocked && <span className="pb-credits">{creditsLabel}</span>}
      {blocked && (
        <>
          <span className="pb-fab-zero" aria-hidden="true">0</span>
          <span className="sr-only"> — {blockedReason}</span>
        </>
      )}
    </button>
  )
}
