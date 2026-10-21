// เวที 3D: โอเวอร์เลย์เต็มจอพื้นมืด ให้กล่องเป็นพระเอก — ดูผลงานที่ AI ออกแบบ สลับระหว่างแบบที่เคยได้ในรอบนี้
// (snapshot ของ decos/สีพื้น/รูปพื้น) แล้วกลับไปแก้ต่อใน blueprint; viewer คือ JSX มุมมอง 3D ชุดเดียวกับหน้าหลัก
import { useEffect, type ReactNode } from 'react'
import type { Deco, FillImage } from '../core/artwork'
import { useT } from '../i18n'

export interface ArtworkSnapshot {
  id: string
  label: string
  decos: Deco[]
  fillColor: string | null
  fillImage: FillImage | null
  explanation: string
  at: number
}

interface Props {
  onClose: () => void
  viewer: ReactNode
  snapshots: ArtworkSnapshot[]
  currentId: string | null
  onPick: (id: string) => void
}

// สีเด่น 3 สีแรกของแบบ (ไว้ทำไทล์โดยไม่ต้องเรนเดอร์ 3D ซ้ำ)
export function snapshotSwatches(s: ArtworkSnapshot): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (c?: string) => {
    if (!c || !/^#[0-9a-fA-F]{6}$/.test(c) || seen.has(c.toLowerCase())) return
    seen.add(c.toLowerCase())
    out.push(c)
  }
  add(s.fillColor ?? undefined)
  for (const d of s.decos) {
    if (out.length >= 4) break
    if (d.type === 'shape' || d.type === 'path') add(d.fill)
    else if (d.type === 'text') add(d.color)
  }
  return out.length ? out : ['#efe2cb']
}

export function CopilotStage({ onClose, viewer, snapshots, currentId, onPick }: Props) {
  const t = useT()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  const current = snapshots.find((s) => s.id === currentId) ?? snapshots[snapshots.length - 1] ?? null

  return (
    <div className="stage" role="dialog" aria-modal="true" aria-label={t('เวที 3D', '3D stage')}>
      <div className="stage-light" aria-hidden="true" />
      <div className="stage-top">
        <strong>PackIt</strong>
        <span className="stage-badge">AI STUDIO</span>
        <span className="stage-sub">{current ? current.label : t('ยังไม่มีแบบจาก AI', 'No AI design yet')}{snapshots.length > 1 ? ` · ${t(`ทั้งหมด ${snapshots.length} แบบ`, `${snapshots.length} designs`)}` : ''}</span>
        <span className="copilot-spacer" />
        <button type="button" className="stage-btn" onClick={onClose}>{t('ออกจากเวที', 'Leave the stage')}</button>
      </div>
      <div className="stage-viewer">
        <div className="viewer-3d">{viewer}</div>
      </div>
      <span className="stage-hint">{t('ลากเพื่อหมุน · ล้อเมาส์เพื่อซูม', 'Drag to rotate · scroll to zoom')}</span>
      {current && (
        <aside className="stage-card">
          <span className="stage-card-k">{t('แนวคิด', 'Concept')} · {current.label}</span>
          <p>{current.explanation || t('(AI ไม่ได้อธิบาย)', '(no explanation)')}</p>
          <span className="stage-card-k">{t(`${current.decos.length} ชิ้นงาน`, `${current.decos.length} elements`)}</span>
        </aside>
      )}
      {snapshots.length > 0 && (
        <div className="stage-tiles" role="listbox" aria-label={t('แบบที่ AI ออกแบบ', 'AI designs')}>
          {snapshots.map((s) => {
            const on = s.id === current?.id
            return (
              <button key={s.id} type="button" role="option" aria-selected={on} className={`stage-tile${on ? ' on' : ''}`} onClick={() => onPick(s.id)}>
                <span className="stage-swatches" aria-hidden="true">
                  {snapshotSwatches(s).map((c) => <i key={c} style={{ background: c }} />)}
                </span>
                <span className="stage-tile-body">
                  <strong>{s.label}</strong>
                  <em>{on ? t('อยู่บนเวที', 'On stage') : t('ดูบนเวที', 'Show on stage')}</em>
                </span>
              </button>
            )
          })}
        </div>
      )}
      <div className="stage-bar">
        <span>{t('แบบที่อยู่บนเวทีคือแบบที่วางในงานตอนนี้ · ย้อนกลับได้ด้วย Ctrl+Z', 'The design on stage is the one in the job · Ctrl+Z to undo')}</span>
        <span className="copilot-spacer" />
        <button type="button" className="stage-btn primary" onClick={onClose}>{t('ใช้แบบนี้ แล้วแก้ต่อ', 'Keep this and edit')}</button>
      </div>
    </div>
  )
}
