import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { elCenter, elH, elW, renderArtworkCanvas, type Deco, type FillImage } from '../core/artwork'
import type { ArtworkAnchorPanel, LegacyArtworkMatch } from '../core/artworkResize'
import type { Dieline, Panel, Vec2 } from '../core/types'
import { drawWatermark } from '../core/watermark'
import { useT } from '../i18n'
import './LegacyArtworkMatchDialog.css'

interface Props {
  dieline: Dieline
  decos: readonly Deco[]
  fillColor: string | null
  fillImage: FillImage | null
  watermark: string | null
  matches: readonly LegacyArtworkMatch[]
  onConfirm(choices: ReadonlyMap<string, string>): void
  onCancel(): void
}

const panelNames: Record<string, [string, string]> = {
  front: ['ด้านหน้า', 'Front'],
  back: ['ด้านหลัง', 'Back'],
  'side-left': ['ด้านซ้าย', 'Left side'],
  'side-right': ['ด้านขวา', 'Right side'],
  'tuck-top': ['ฝาบน', 'Top flap'],
  'tuck-bot': ['ฝาล่าง', 'Bottom flap'],
  'tongue-top': ['ลิ้นเสียบบน', 'Top tuck tab'],
  'tongue-bot': ['ลิ้นเสียบล่าง', 'Bottom tuck tab'],
  'dust-tl': ['ลิ้นกันฝุ่นบนซ้าย', 'Top left dust flap'],
  'dust-tr': ['ลิ้นกันฝุ่นบนขวา', 'Top right dust flap'],
  'dust-bl': ['ลิ้นกันฝุ่นล่างซ้าย', 'Bottom left dust flap'],
  'dust-br': ['ลิ้นกันฝุ่นล่างขวา', 'Bottom right dust flap'],
  label: ['ฉลาก', 'Label'],
  'label-front-face': ['ด้านหน้าแบนของฉลาก', 'Flat front of the label'],
  film: ['แผ่นฟิล์ม', 'Film'],
  'pouch-front-body': ['ลำตัวซองด้านหน้า', 'Pouch front'],
  'pouch-back-body': ['ลำตัวซองด้านหลัง', 'Pouch back'],
  'pouch-back-left-body': ['ซองด้านหลังฝั่งซ้าย', 'Pouch back left'],
}

const layerNames: Record<Deco['type'], [string, string]> = {
  image: ['รูปภาพ', 'Image'],
  text: ['ข้อความ', 'Text'],
  shape: ['รูปทรง', 'Shape'],
  path: ['เส้นวาด', 'Path'],
  nutrition: ['ตารางโภชนาการ', 'Nutrition table'],
}

function ringPath(points: readonly Vec2[]) {
  return points.length ? `M${points.map(({ x, y }) => `${x},${y}`).join('L')}Z` : ''
}

function panelPath(panel: Panel) {
  return ringPath(panel.outline) + (panel.holes ?? []).map(ringPath).join('')
}

function panelHighlight(dieline: Dieline, region: ArtworkAnchorPanel) {
  const panel = dieline.panels.find(({ id }) => id === region.id)
  return panel ? panelPath(panel) : `M${region.x0},${region.y0}h${region.w}v${region.h}h${-region.w}Z`
}

function ArtworkMap({
  dieline, decos, fillColor, fillImage, watermark, active, suggested,
}: Pick<Props, 'dieline' | 'decos' | 'fillColor' | 'fillImage' | 'watermark'> & {
  active: LegacyArtworkMatch | undefined
  suggested: ArtworkAnchorPanel | undefined
}) {
  const t = useT()
  const [preview, setPreview] = useState<{ src: string | null; watermark: string | null; failed?: boolean } | null>(null)
  const clipId = useId()
  const labelId = useId()
  const width = dieline.width
  const height = dieline.height
  const padding = Math.max(width, height) * 0.045
  const layer = active?.deco
  const center = layer && elCenter(layer)
  const regions = suggested ? [suggested] : active?.candidates ?? []

  useEffect(() => {
    let current = true
    const dpi = Math.min(180, 25.4 * 1200 / Math.max(width, height))
    void renderArtworkCanvas([...decos], width, height, dpi, { dieline, fillColor, fillImage })
      .then((canvas) => {
        if (!current) return
        if (watermark && canvas) {
          const context = canvas.getContext('2d')
          if (context) drawWatermark(context, width, height, dpi / 25.4, watermark)
        }
        setPreview({ src: canvas?.toDataURL() ?? null, watermark })
      })
      .catch(() => {
        if (current) setPreview({ src: null, watermark, failed: true })
      })
    return () => { current = false }
  }, [decos, dieline, fillColor, fillImage, height, watermark, width])

  return (
    <figure className="legacy-match-map">
      <svg role="img" aria-labelledby={labelId} viewBox={`${-padding} ${-padding} ${width + 2 * padding} ${height + 2 * padding}`}>
        <title id={labelId}>{t('พรีวิวตำแหน่งลายบนแผ่นคลี่', 'Artwork placement preview on the dieline')}</title>
        <defs>
          <clipPath id={clipId}>
            {dieline.panels.map((panel) => <path key={panel.id} d={panelPath(panel)} clipRule="evenodd" />)}
          </clipPath>
        </defs>
        {dieline.panels.map((panel) => <path key={panel.id} d={panelPath(panel)} fill={fillColor ?? '#ffffff'} fillRule="evenodd" />)}
        {preview?.src && preview.watermark === watermark && <image href={preview.src} width={width} height={height} preserveAspectRatio="none" clipPath={`url(#${clipId})`} />}
        {dieline.segments.map(({ d, kind }, index) => (
          <path key={index} d={d} className={`legacy-match-${kind}`} fill="none" vectorEffect="non-scaling-stroke" />
        ))}
        {regions.map((region) => (
          <path key={region.id} d={panelHighlight(dieline, region)} className="legacy-match-region"
            fill="none" vectorEffect="non-scaling-stroke" />
        ))}
        {layer && center && (
          <rect className="legacy-match-frame" x={layer.x} y={layer.y} width={elW(layer)} height={elH(layer)}
            transform={`rotate(${layer.rot} ${center.x} ${center.y})`} fill="none" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      <figcaption>
        <span className="legacy-match-key-region">{t('แผงที่เสนอ', 'Suggested panel')}</span>
        <span className="legacy-match-key-layer">{t('เลเยอร์ที่เลือก', 'Selected layer')}</span>
        {preview?.failed && <span role="status">{t('โหลดภาพลายไม่ได้ ตรวจตำแหน่งจากกรอบเลเยอร์ได้', 'Artwork image unavailable. Use the layer outline to check placement.')}</span>}
      </figcaption>
    </figure>
  )
}

export function LegacyArtworkMatchDialog({ dieline, decos, fillColor, fillImage, watermark, matches, onConfirm, onCancel }: Props) {
  const t = useT()
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const [activeId, setActiveId] = useState(() => (matches.find(({ candidates }) => candidates.length === 1) ?? matches[0])?.deco.id)
  const [choices, setChoices] = useState(() => {
    const initial = new Map<string, string>()
    for (const { deco, candidates } of matches) {
      if (candidates.length === 1) initial.set(deco.id, candidates[0].id)
    }
    return initial
  })
  const active = matches.find(({ deco }) => deco.id === activeId)
  const suggested = active?.candidates.find(({ id }) => id === choices.get(active.deco.id))

  useLayoutEffect(() => {
    const element = dialog.current
    if (!element) return
    const previous = document.activeElement
    element.showModal()
    heading.current?.focus({ preventScroll: true })
    element.scrollTop = 0
    return () => {
      element.close()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])

  function choosePanel(layerId: string, panelId: string) {
    setChoices((previous) => {
      const next = new Map(previous)
      if (panelId) next.set(layerId, panelId)
      else next.delete(layerId)
      return next
    })
  }

  return (
    <dialog ref={dialog} className="legacy-match-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
      onKeyDown={(event) => event.stopPropagation()} onCancel={(event) => { event.preventDefault(); onCancel() }}>
      <div className="legacy-match-heading">
        <h2 id={titleId} ref={heading} tabIndex={-1}>{t('จับคู่ลาย AI เก่ากับแผง', 'Match older AI artwork to panels')}</h2>
        <p id={descriptionId}>{t('เลือกเลเยอร์เพื่อดูตำแหน่งบนแผ่นคลี่ ตรวจแผงที่เสนอหรือเลือกข้ามก่อนยืนยัน', 'Select a layer to see it on the dieline. Review the suggested panel or skip the layer before confirming.')}</p>
      </div>
      <div className="legacy-match-content">
        <ArtworkMap dieline={dieline} decos={decos} fillColor={fillColor} fillImage={fillImage} watermark={watermark} active={active} suggested={suggested} />
        <ul className="legacy-match-list" aria-label={t('เลเยอร์ลาย AI เก่า', 'Older AI artwork layers')}>
          {matches.map(({ deco, candidates }) => {
            const name = deco.name?.trim() || (deco.type === 'text' && deco.text.trim()) || t(...layerNames[deco.type])
            return (
              <li key={deco.id} className={deco.id === activeId ? 'is-active' : undefined} onFocus={() => setActiveId(deco.id)}>
                <button type="button" className="legacy-match-layer" aria-pressed={deco.id === activeId} onClick={() => setActiveId(deco.id)}>
                  {name}
                  {deco.hidden && <span>{t('ซ่อนอยู่', 'Hidden')}</span>}
                </button>
                {candidates.length ? (
                  <select aria-label={t(`แผงสำหรับ ${name}`, `Panel for ${name}`)} value={choices.get(deco.id) ?? ''}
                    onChange={(event) => { setActiveId(deco.id); choosePanel(deco.id, event.target.value) }}>
                    <option value="">{t('ข้ามเลเยอร์นี้', 'Skip this layer')}</option>
                    {candidates.map(({ id }) => <option key={id} value={id}>{t(...(panelNames[id] ?? [id, id]))}</option>)}
                  </select>
                ) : <p>{t('ยังระบุแผงที่ตรงกับเลเยอร์นี้ไม่ได้', 'No matching panel for this layer')}</p>}
              </li>
            )
          })}
        </ul>
      </div>
      <footer>
        <p role="status">{t(`เลือกจับคู่ ${choices.size} จาก ${matches.length} เลเยอร์`, `${choices.size} of ${matches.length} layers selected`)}</p>
        <div className="legacy-match-actions">
          <button type="button" onClick={onCancel}>{t('ยกเลิก', 'Cancel')}</button>
          <button type="button" className="legacy-match-confirm" disabled={!choices.size} onClick={() => onConfirm(choices)}>
            {t('ยืนยันการจับคู่', 'Confirm matches')}
          </button>
        </div>
      </footer>
    </dialog>
  )
}
