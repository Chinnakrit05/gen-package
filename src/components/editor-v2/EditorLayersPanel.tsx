import { useEffect, useId, useRef, useState } from 'react'
import { EyeOff, LockKeyhole, Ungroup } from 'lucide-react'
import {
  decoLabel, drawDecoPreview, elH, elW, ensureThaiFont, expandGroups, fontCss,
  layerRows, selectionBounds, transformSelection, withTextW,
  type AlignMode, type Deco,
} from '../../core/artwork'
import { useT } from '../../i18n'
import gripIcon from '../../assets/editor-v2/layers/6ec36.svg'
import visibleIcon from '../../assets/editor-v2/layers/6d2bd.svg'
import unlockedIcon from '../../assets/editor-v2/layers/0ff7c.svg'
import alignTopIcon from '../../assets/editor-v2/layers/ab061.svg'
import alignMiddleIcon from '../../assets/editor-v2/layers/e87f4.svg'
import alignBottomIcon from '../../assets/editor-v2/layers/5f4ec.svg'
import alignLeftIcon from '../../assets/editor-v2/layers/80f33.svg'
import alignCenterIcon from '../../assets/editor-v2/layers/a49d3.svg'
import alignRightIcon from '../../assets/editor-v2/layers/c8bc0.svg'
import sendBackIcon from '../../assets/editor-v2/layers/c7937.svg'
import bringForwardIcon from '../../assets/editor-v2/layers/f095c.svg'
import bringFrontIcon from '../../assets/editor-v2/layers/09928.svg'
import sendBehindIcon from '../../assets/editor-v2/layers/08388.svg'
import aspectIcon from '../../assets/editor-v2/layers/48b2c.svg'
import flipHorizontalIcon from '../../assets/editor-v2/layers/531a8.svg'
import flipVerticalIcon from '../../assets/editor-v2/layers/489fb.svg'
import './EditorLayersPanel.css'

export interface EditorLayersPanelProps {
  decos: Deco[]
  selectedIds: string[]
  disabled: boolean
  lockAspect: boolean
  onLockAspect(value: boolean): void
  onSelect(id: string | null, additive?: boolean): void
  onToggleHidden(id: string): void
  onToggleLocked(id: string): void
  onRename(id: string, name: string): void
  onEdit(update: (decos: Deco[]) => Deco[]): void
  onPatch(update: (deco: Deco) => Deco): void
  onAlign(mode: AlignMode): void
  onRestack(direction: 1 | -1, toEnd?: boolean): void
  onAdvanced?(): void
}

const ALIGNMENTS: { mode: AlignMode; th: string; en: string; icon: string }[][] = [
  [
    { mode: 'top', th: 'ชิดบน', en: 'Align top', icon: alignTopIcon },
    { mode: 'vcenter', th: 'กึ่งกลางแนวตั้ง', en: 'Align middle', icon: alignMiddleIcon },
    { mode: 'bottom', th: 'ชิดล่าง', en: 'Align bottom', icon: alignBottomIcon },
  ],
  [
    { mode: 'left', th: 'ชิดซ้าย', en: 'Align left', icon: alignLeftIcon },
    { mode: 'hcenter', th: 'กึ่งกลางแนวนอน', en: 'Align center', icon: alignCenterIcon },
    { mode: 'right', th: 'ชิดขวา', en: 'Align right', icon: alignRightIcon },
  ],
]
const STACK_ACTIONS = [
  { direction: 1 as const, toEnd: true, th: 'ย้ายไปด้านบนสุด', en: 'Bring to front', icon: bringFrontIcon },
  { direction: -1 as const, toEnd: true, th: 'ย้ายไปด้านล่างสุด', en: 'Send to back', icon: sendBehindIcon },
  { direction: 1 as const, toEnd: false, th: 'ขึ้นไปด้านบน', en: 'Bring forward', icon: bringForwardIcon },
  { direction: -1 as const, toEnd: false, th: 'ลงด้านล่าง', en: 'Send backward', icon: sendBackIcon },
]

export function EditorLayersPanel(props: EditorLayersPanelProps) {
  const t = useT()
  const [tab, setTab] = useState<'layers' | 'position' | 'size'>('layers')
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropId, setDropId] = useState<string | null>(null)
  const tabId = useId()
  const selected = props.decos.filter((deco) => props.selectedIds.includes(deco.id))
  const single = selected.length === 1 ? selected[0] : undefined
  const bounds = selectionBounds(props.decos, props.selectedIds)
  const blocked = props.disabled || !selected.length || selected.some((deco) => deco.locked)
  const uniform = selected.length > 1 || single?.type === 'nutrition'
  const linked = uniform || props.lockAspect
  const tabs = [
    { id: 'layers' as const, th: 'เลเยอร์', en: 'Layers' },
    { id: 'position' as const, th: 'ตำแหน่ง', en: 'Position' },
    { id: 'size' as const, th: 'ขนาด', en: 'Size' },
  ]

  const move = (axis: 'x' | 'y', value: number) => {
    if (blocked || !bounds) return
    const delta = value - (axis === 'x' ? bounds.x0 : bounds.y0)
    props.onEdit((decos) => decos.map((deco) => props.selectedIds.includes(deco.id) ? { ...deco, [axis]: deco[axis] + delta } : deco))
  }
  const resize = (axis: 'w' | 'h', value: number) => {
    if (blocked || !bounds || value <= 0) return
    const current = axis === 'w' ? bounds.x1 - bounds.x0 : bounds.y1 - bounds.y0
    if (current <= 0) return
    if (linked || single?.type === 'text' && axis === 'h') {
      props.onEdit((decos) => transformSelection(decos, props.selectedIds, { kind: 'scale', k: value / current, ax: bounds.x0, ay: bounds.y0 }))
      return
    }
    props.onPatch((deco) => deco.type === 'text' ? withTextW({ ...deco, boxW: value, sx: undefined })
      : deco.type === 'nutrition' ? deco
        : deco.type === 'shape' && deco.shape === 'line' && axis === 'h' ? { ...deco, h: value, strokeW: value }
          : { ...deco, [axis]: value })
  }
  const rotate = (value: number) => {
    if (blocked || !bounds) return
    if (single) props.onPatch((deco) => ({ ...deco, rot: value }))
    else props.onEdit((decos) => transformSelection(decos, props.selectedIds, {
      kind: 'rotate', deg: value - selected[0].rot, cx: (bounds.x0 + bounds.x1) / 2, cy: (bounds.y0 + bounds.y1) / 2,
    }))
  }
  const flip = (axis: 'flipX' | 'flipY') => {
    if (blocked) return
    if (single) props.onPatch((deco) => ({ ...deco, [axis]: !deco[axis] }))
    else if (bounds) {
      const horizontal = axis === 'flipX'
      const center = horizontal ? bounds.x0 + bounds.x1 : bounds.y0 + bounds.y1
      props.onEdit((decos) => decos.map((deco) => !props.selectedIds.includes(deco.id) ? deco : {
        ...deco, [axis]: !deco[axis], rot: -deco.rot,
        ...(horizontal ? { x: center - deco.x - elW(deco) } : { y: center - deco.y - elH(deco) }),
      }))
    }
  }
  const restack = (direction: 1 | -1, toEnd: boolean) => {
    if (blocked) return
    if (single) { props.onRestack(direction, toEnd); return }
    props.onEdit((decos) => {
      const moving = decos.filter((deco) => props.selectedIds.includes(deco.id))
      const remaining = decos.filter((deco) => !props.selectedIds.includes(deco.id))
      const indices = decos.flatMap((deco, index) => props.selectedIds.includes(deco.id) ? [index] : [])
      const above = Math.max(...indices) + 1
      const below = Math.min(...indices) - 1
      const neighbor = direction > 0 ? decos[above] : decos[below]
      const target = neighbor ? remaining.findIndex((deco) => deco.id === neighbor.id) : direction > 0 ? remaining.length : 0
      const at = toEnd ? direction > 0 ? remaining.length : 0 : Math.max(0, target + (direction > 0 && neighbor ? 1 : 0))
      return [...remaining.slice(0, at), ...moving, ...remaining.slice(at)]
    })
  }
  const reorder = (source: string, target: string, before: boolean) => {
    if (props.disabled || source === target) return
    props.onEdit((decos) => {
      const ids = new Set(expandGroups(decos, [source]))
      if (ids.has(target) || decos.some((deco) => ids.has(deco.id) && deco.locked)) return decos
      const targetIds = new Set(expandGroups(decos, [target]))
      const moving = decos.filter((deco) => ids.has(deco.id))
      const remaining = decos.filter((deco) => !ids.has(deco.id))
      const positions = remaining.flatMap((deco, index) => targetIds.has(deco.id) ? [index] : [])
      if (!positions.length) return decos
      const at = before ? Math.max(...positions) + 1 : Math.min(...positions)
      return [...remaining.slice(0, at), ...moving, ...remaining.slice(at)]
    })
  }

  return <section className="v2-layers-panel" aria-label={t('เลเยอร์และการจัดวาง', 'Layers and layout')}>
    <div className="v2-layers-tabs" role="tablist" aria-label={t('ปรับแต่งเลเยอร์', 'Layer properties')}>
      {tabs.map((item, index) => <button key={item.id} type="button" role="tab" id={`${tabId}-${item.id}`}
        aria-controls={`${tabId}-content`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1}
        onClick={() => setTab(item.id)} onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          event.stopPropagation()
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
          setTab(tabs[next].id)
          document.getElementById(`${tabId}-${tabs[next].id}`)?.focus()
        }}>{t(item.th, item.en)}</button>)}
    </div>
    <div className="v2-layers-content" role="tabpanel" id={`${tabId}-content`} aria-labelledby={`${tabId}-${tab}`}>
      {tab === 'layers' ? <>
        <h3>{t('เลเยอร์', 'Layers')}</h3>
        {props.decos.length === 0 && <p className="v2-layers-hint">{t('เพิ่มรูปทรง รูปภาพ หรือข้อความเพื่อเริ่มออกแบบ', 'Add a shape, image or text to start designing')}</p>}
        <ol className="v2-layers-list">
          {layerRows(props.decos).map((row) => {
            if (row.kind === 'head') return <li key={`group-${row.groupId}`} className="v2-layer-group">
              <button type="button" aria-pressed={row.members.every((deco) => props.selectedIds.includes(deco.id))}
                onClick={(event) => props.onSelect(row.members[0].id, event.shiftKey || event.ctrlKey || event.metaKey)}>
                {t(`กลุ่ม (${row.members.length} ชิ้น)`, `Group (${row.members.length} items)`)}
              </button>
              <button type="button" disabled={props.disabled} aria-label={t('แยกกลุ่มนี้', 'Ungroup this group')}
                title={t('แยกกลุ่ม', 'Ungroup')} onClick={() => props.onEdit((decos) => decos.map((deco) => deco.groupId === row.groupId ? { ...deco, groupId: undefined } : deco))}>
                <Ungroup size={16} aria-hidden="true" />
              </button>
            </li>
            const deco = row.d
            const label = decoLabel(deco)
            const chosen = props.selectedIds.includes(deco.id)
            const groupIds = new Set(expandGroups(props.decos, [deco.id]))
            const groupLocked = props.decos.some((item) => groupIds.has(item.id) && item.locked)
            return <li key={deco.id} data-layer-id={deco.id}
              className={`v2-layer-card${chosen ? ' is-selected' : ''}${deco.hidden ? ' is-hidden' : ''}${row.inGroup ? ' in-group' : ''}${dropId === deco.id ? ' is-drop-target' : ''}`}
              onDragOver={(event) => {
                if (!draggedId || props.disabled) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setDropId(deco.id)
              }} onDrop={(event) => {
                event.preventDefault()
                if (draggedId) reorder(draggedId, deco.id, event.clientY < event.currentTarget.getBoundingClientRect().top + event.currentTarget.clientHeight / 2)
                setDraggedId(null)
                setDropId(null)
              }}>
              <LayerName deco={deco} disabled={props.disabled} selected={chosen} onSelect={props.onSelect} onRename={props.onRename} />
              <div className="v2-layer-card-tools">
                <button type="button" className="v2-layer-grip" draggable={!props.disabled && !groupLocked}
                  disabled={props.disabled || groupLocked} aria-label={t(`ย้ายลำดับ ${label}`, `Reorder ${label}`)}
                  title={t('ลากเพื่อจัดลำดับ · ปุ่มลูกศรขึ้น/ลงเพื่อย้าย', 'Drag to reorder · Up/Down to move')}
                  onDragStart={(event) => { event.dataTransfer.setData('text/plain', deco.id); event.dataTransfer.effectAllowed = 'move'; setDraggedId(deco.id) }}
                  onDragEnd={() => { setDraggedId(null); setDropId(null) }}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                    event.preventDefault()
                    event.stopPropagation()
                    const rows = layerRows(props.decos).filter((item) => item.kind === 'item')
                    const at = rows.findIndex((item) => item.d.id === deco.id)
                    const step = event.key === 'ArrowUp' ? -1 : 1
                    const ownGroup = new Set(expandGroups(props.decos, [deco.id]))
                    const neighbor = rows.slice(0, at).reverse().find((item) => !ownGroup.has(item.d.id))
                    const next = step < 0 ? neighbor : rows.slice(at + 1).find((item) => !ownGroup.has(item.d.id))
                    if (next) reorder(deco.id, next.d.id, step < 0)
                  }}><img src={gripIcon} alt="" /></button>
                <button type="button" className="v2-layer-preview" aria-label={t(`เลือก ${label}`, `Select ${label}`)}
                  aria-pressed={chosen} onClick={(event) => props.onSelect(deco.id, event.shiftKey || event.ctrlKey || event.metaKey)}>
                  {deco.type === 'text' ? <span className="v2-layer-text-preview" style={{ color: deco.color, fontFamily: fontCss(deco.font), fontWeight: deco.weight, fontStyle: deco.italic ? 'italic' : undefined }}>{deco.text}</span> : <LayerPreview deco={deco} />}
                </button>
                <div className="v2-layer-toggles">
                  <button type="button" disabled={props.disabled} aria-pressed={!deco.hidden}
                    aria-label={t(deco.hidden ? `แสดง ${label}` : `ซ่อน ${label}`, `${deco.hidden ? 'Show' : 'Hide'} ${label}`)}
                    title={t(deco.hidden ? 'แสดง' : 'ซ่อน', deco.hidden ? 'Show' : 'Hide')} onClick={() => props.onToggleHidden(deco.id)}>
                    {deco.hidden ? <EyeOff size={16} aria-hidden="true" /> : <img src={visibleIcon} alt="" />}
                  </button>
                  <button type="button" disabled={props.disabled} aria-pressed={!!deco.locked}
                    aria-label={t(deco.locked ? `ปลดล็อก ${label}` : `ล็อก ${label}`, `${deco.locked ? 'Unlock' : 'Lock'} ${label}`)}
                    title={t(deco.locked ? 'ปลดล็อก' : 'ล็อก', deco.locked ? 'Unlock' : 'Lock')} onClick={() => props.onToggleLocked(deco.id)}>
                    {deco.locked ? <LockKeyhole size={16} aria-hidden="true" /> : <img src={unlockedIcon} alt="" />}
                  </button>
                </div>
              </div>
            </li>
          })}
        </ol>
      </> : <>
        {!selected.length && <p className="v2-layers-hint">{t('เลือกชิ้นงานบนแบบหรือในเลเยอร์', 'Select an item on the canvas or in Layers')}</p>}
        {selected.some((deco) => deco.locked) && <p className="v2-layers-hint">{t('ปลดล็อกเลเยอร์ก่อนปรับแต่ง', 'Unlock the layer to edit it')}</p>}
        {tab === 'position' ? <>
          <h3>{t('จัดตำแหน่งในหน้า', 'Position on page')}</h3>
          <div className="v2-layer-alignment"><span>{t('การจัดแนว', 'Alignment')}</span>
            <div>{ALIGNMENTS.map((line, index) => <div className="v2-layer-segment" role="group" aria-label={t(index === 0 ? 'แนวตั้ง' : 'แนวนอน', index === 0 ? 'Vertical' : 'Horizontal')} key={index}>
              {line.map((item) => <button key={item.mode} type="button" disabled={blocked} title={t(item.th, item.en)}
                aria-label={t(item.th, item.en)} onClick={() => props.onAlign(item.mode)}><img src={item.icon} alt="" /></button>)}
            </div>)}</div>
          </div>
          <h3>{t('ระบุตำแหน่งแบบอิงแกน', 'Coordinates')}</h3>
          <div className="v2-layer-coordinates">
            <label>X<LayerNumber label={t('ตำแหน่ง X (มม.)', 'X position (mm)')} value={bounds?.x0 ?? 0} disabled={blocked} onCommit={(value) => move('x', value)} /></label>
            <label>Y<LayerNumber label={t('ตำแหน่ง Y (มม.)', 'Y position (mm)')} value={bounds?.y0 ?? 0} disabled={blocked} onCommit={(value) => move('y', value)} /></label>
          </div>
          <h3>{t('จัดวางเลเยอร์', 'Layer order')}</h3>
          <div className="v2-layer-stack">{STACK_ACTIONS.map((item) => <button key={item.en} type="button" disabled={blocked || !selected.some((deco) => props.decos.indexOf(deco) !== (item.direction > 0 ? props.decos.length - 1 : 0))}
            onClick={() => restack(item.direction, item.toEnd)}><img src={item.icon} alt="" /><span>{t(item.th, item.en)}</span></button>)}</div>
        </> : <>
          <div className="v2-layer-size-heading"><h3>{t('ปรับขนาดชิ้นส่วน', 'Element size')}</h3><span>{t('มม.', 'mm')}</span></div>
          <div className="v2-layer-dimensions"><div>
            {(['w', 'h'] as const).map((axis) => {
              const value = bounds ? axis === 'w' ? bounds.x1 - bounds.x0 : bounds.y1 - bounds.y0 : 0
              const label = axis === 'w' ? t('ความกว้าง', 'Width') : t('ความยาว', 'Height')
              return <div className="v2-layer-dimension" key={axis}><span>{label}</span>
                <input type="range" min={1} max={Math.max(500, value * 1.5)} step={0.5} value={value} disabled={blocked}
                  aria-label={`${label} ${t('(เลื่อน)', '(slider)')}`} onChange={(event) => resize(axis, Number(event.target.value))} />
                <LayerNumber label={`${label} ${t('(มม.)', '(mm)')}`} value={value} min={1} disabled={blocked} onCommit={(next) => resize(axis, next)} />
              </div>
            })}
          </div><button type="button" className="v2-layer-aspect" aria-pressed={linked} disabled={blocked || uniform}
            aria-label={t('ล็อกสัดส่วน', 'Lock aspect ratio')} title={t('ล็อกสัดส่วน', 'Lock aspect ratio')}
            onClick={() => props.onLockAspect(!props.lockAspect)}><img src={aspectIcon} alt="" /></button></div>
          <div className="v2-layer-property"><label htmlFor={`${tabId}-rotation`}>{t('หมุน', 'Rotation')}</label>
            <LayerNumber id={`${tabId}-rotation`} label={t('มุมหมุน (องศา)', 'Rotation (degrees)')} value={selected[0]?.rot ?? 0}
              disabled={blocked} onCommit={rotate} />
          </div>
          <div className="v2-layer-property"><span>{t('พลิกด้าน', 'Flip')}</span><div className="v2-layer-segment">
            <button type="button" disabled={blocked} aria-pressed={!!single?.flipX} aria-label={t('พลิกแนวนอน', 'Flip horizontally')} title={t('พลิกแนวนอน', 'Flip horizontally')} onClick={() => flip('flipX')}><img src={flipHorizontalIcon} alt="" /></button>
            <button type="button" disabled={blocked} aria-pressed={!!single?.flipY} aria-label={t('พลิกแนวตั้ง', 'Flip vertically')} title={t('พลิกแนวตั้ง', 'Flip vertically')} onClick={() => flip('flipY')}><img src={flipVerticalIcon} alt="" /></button>
          </div></div>
        </>}
        {props.onAdvanced && selected.length > 0 && <button type="button" className="v2-layer-advanced" onClick={props.onAdvanced}>{t('ปรับแต่งเพิ่มเติม', 'More properties')}</button>}
      </>}
    </div>
  </section>
}

function LayerNumber({ value, label, disabled, min, id, onCommit }: {
  value: number; label: string; disabled: boolean; min?: number; id?: string; onCommit(value: number): void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (text: string) => {
    setDraft(null)
    if (!text.trim()) return
    const parsed = Number(text)
    if (Number.isFinite(parsed)) onCommit(Math.max(min ?? -Infinity, parsed))
  }
  return <input id={id} type="number" step={0.5} min={min} aria-label={label} disabled={disabled}
    value={draft ?? String(Math.round(value * 100) / 100)} onChange={(event) => setDraft(event.target.value)}
    onBlur={(event) => { if (draft !== null) commit(event.currentTarget.value) }}
    onKeyDown={(event) => {
      if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDraft(null) }
    }} />
}

function LayerName({ deco, disabled, selected, onSelect, onRename }: Pick<EditorLayersPanelProps, 'onSelect' | 'onRename'> & { deco: Deco; disabled: boolean; selected: boolean }) {
  const t = useT()
  const [renaming, setRenaming] = useState(false)
  const label = decoLabel(deco)
  return renaming ? <input className="v2-layer-name-edit" aria-label={t('ชื่อเลเยอร์', 'Layer name')} maxLength={40} disabled={disabled}
    defaultValue={deco.name ?? ''} placeholder={label} autoFocus onFocus={(event) => event.currentTarget.select()}
    onBlur={(event) => { if (renaming && !disabled) { onRename(deco.id, event.currentTarget.value); setRenaming(false) } }}
    onKeyDown={(event) => {
      if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setRenaming(false) }
    }} /> : <button type="button" className="v2-layer-name" aria-pressed={selected}
    title={`${label} · ${t('ดับเบิลคลิกเพื่อเปลี่ยนชื่อ', 'Double-click to rename')}`}
    onClick={(event) => onSelect(deco.id, event.shiftKey || event.ctrlKey || event.metaKey)}
    onDoubleClick={() => { if (!disabled) setRenaming(true) }}>{label}</button>
}

function LayerPreview({ deco }: { deco: Deco }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let active = true
    const element = canvas.current
    const draw = async () => {
      await ensureThaiFont([deco])
      let image: HTMLImageElement | undefined
      if (deco.type === 'image') {
        image = new Image()
        image.src = deco.src
        await image.decode()
      }
      if (!active || !element) return
      const context = element.getContext('2d')
      if (!context) return
      const normalized = { ...deco, x: 0, y: 0, rot: 0 }
      const width = Math.max(1, elW(normalized))
      const height = Math.max(1, elH(normalized))
      const scale = 72 / Math.max(width, height)
      context.clearRect(0, 0, 80, 80)
      context.save()
      context.translate((80 - width * scale) / 2, (80 - height * scale) / 2)
      drawDecoPreview(context, normalized, scale, () => image)
      context.restore()
    }
    void draw().catch(() => { if (active) canvas.current?.getContext('2d')?.clearRect(0, 0, 80, 80) })
    return () => { active = false }
  }, [deco])
  return <canvas ref={canvas} width={80} height={80} aria-hidden="true" />
}
