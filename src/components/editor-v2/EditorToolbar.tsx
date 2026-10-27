import { useEffect, useRef, useState } from 'react'
import { FONTS, withTextW, type Deco, type TextEl } from '../../core/artwork'
import { useT } from '../../i18n'
import * as assets from './assets'

interface Props {
  selected: Deco | undefined
  count: number
  disabled: boolean
  advanced: boolean
  onAdvanced: () => void
  onPatch: (update: (deco: Deco) => Deco) => void
  onDuplicate: () => void
  onLock: () => void
  onDelete: () => void
  onLayers: () => void
}

export function EditorToolbar({ selected, count, disabled, advanced, onAdvanced, onPatch, onDuplicate, onLock, onDelete, onLayers }: Props) {
  const t = useT()
  const [popover, setPopover] = useState<'opacity' | 'align' | null>(null)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!popover) return
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setPopover(null) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setPopover(null) }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [popover])
  useEffect(() => { setPopover(null) }, [selected?.id, selected?.locked, disabled])
  const text = selected?.type === 'text' ? selected : null
  const blocked = disabled || !selected || !!selected.locked
  const color = selected?.type === 'text' ? selected.color : selected?.type === 'shape' && selected.shape === 'line' ? selected.stroke : selected?.type === 'shape' || selected?.type === 'path' ? selected.fill : undefined
  const patchText = (patch: Partial<TextEl>) => !blocked && onPatch(d => d.type === 'text' ? withTextW({ ...d, ...patch }) : d)
  const changeSize = (size: number) => { if (Number.isFinite(size)) patchText({ size: Math.max(1, Math.min(400, size)) }) }
  return (
    <div ref={root} className={`v2-toolbar${advanced ? ' expanded' : ''}`} role="toolbar" aria-label={t('ปรับแต่งองค์ประกอบ', 'Element formatting')}>
      {(text || !count) && <>
        <select aria-label={t('ฟอนต์', 'Font')} value={text?.font ?? 'noto'} disabled={blocked} onChange={e => patchText({ font: e.target.value })}>
          {!text ? <option value="noto">Font.</option> : FONTS.map(f => <option key={f.id} value={f.id}>{f.nameTh}</option>)}
        </select>
        <div className="v2-font-size">
          <button type="button" aria-label={t('ลดขนาดตัวอักษร', 'Decrease font size')} disabled={blocked} onClick={() => changeSize((text?.size ?? 6) - .5)}><img src={assets.imgSectionDefaultIconMinusStateNormal} alt="" /></button>
          <input type="number" min="1" max="400" step="0.5" aria-label={t('ขนาดตัวอักษร (มม.)', 'Font size (mm)')} disabled={blocked} value={text?.size ?? 6} onChange={e => changeSize(e.target.valueAsNumber)} />
          <button type="button" aria-label={t('เพิ่มขนาดตัวอักษร', 'Increase font size')} disabled={blocked} onClick={() => changeSize((text?.size ?? 6) + .5)}><img src={assets.imgSectionDefaultIconPlusStateNormal} alt="" /></button>
        </div><span className="v2-toolbar-divider" />
      </>}
      {count > 1 && <span className="v2-selection-count">{t(`${count} ชิ้น`, `${count} items`)}</span>}
      <label className="v2-color" title={t('สีองค์ประกอบ', 'Element color')} style={{ background: color && color !== 'none' ? color : '#00a896' }}>
        <input type="color" aria-label={t('สีองค์ประกอบ', 'Element color')} value={color && color !== 'none' ? color : '#00a896'} disabled={blocked || color === undefined}
          onChange={e => { const value = e.target.value; onPatch(d => d.type === 'text' ? { ...d, color: value, grad: undefined } : d.type === 'shape' && d.shape === 'line' ? { ...d, stroke: value, grad: undefined } : d.type === 'shape' || d.type === 'path' ? { ...d, fill: value, grad: undefined } : d) }} />
      </label>
      <button type="button" className="v2-opacity" title={t('ความทึบ', 'Opacity')} aria-label={t('ความทึบ', 'Opacity')} aria-expanded={popover === 'opacity'} disabled={blocked} onClick={() => setPopover(popover === 'opacity' ? null : 'opacity')} />
      {(text || !count) && <>
        <button type="button" title={t('จัดชิดข้อความ', 'Text alignment')} aria-label={t('จัดชิดข้อความ', 'Text alignment')} aria-expanded={popover === 'align'} disabled={blocked} onClick={() => setPopover(popover === 'align' ? null : 'align')}><img src={assets.imgSectionToolbarIconLeftAlignStateNormal} alt="" /></button>
        <button type="button" title={t('ตัวหนา', 'Bold')} aria-label={t('ตัวหนา', 'Bold')} aria-pressed={text?.weight === 700} disabled={blocked} onClick={() => patchText({ weight: text?.weight === 700 ? 400 : 700 })}><img src={assets.imgSectionToolbarIconBoldStateNormal} alt="" /></button>
        <button type="button" className="v2-toolbar-secondary" title={t('ตัวเอียง', 'Italic')} aria-label={t('ตัวเอียง', 'Italic')} aria-pressed={!!text?.italic} disabled={blocked} onClick={() => patchText({ italic: !text?.italic || undefined })}><img src={assets.imgSectionToolbarIconItalicStateNormal} alt="" /></button>
        <button type="button" className="v2-toolbar-secondary" title={t('ขีดเส้นใต้', 'Underline')} aria-label={t('ขีดเส้นใต้', 'Underline')} aria-pressed={!!text?.underline} disabled={blocked} onClick={() => patchText({ underline: !text?.underline || undefined })}><img src={assets.imgSectionToolbarIconUnderlineStateNormal} alt="" /></button>
        <button type="button" className="v2-toolbar-secondary" title={t('ระยะและเอฟเฟกต์ตัวอักษร', 'Text spacing & effects')} aria-label={t('ระยะและเอฟเฟกต์ตัวอักษร', 'Text spacing & effects')} disabled={blocked} onClick={onAdvanced}><img src={assets.imgSectionToolbarIconALargeSmallStateNormal} alt="" /></button>
      </>}
      <button type="button" className="v2-toolbar-secondary v2-toolbar-label" onClick={onLayers}>{t('เลเยอร์', 'Layers')}</button>
      <button type="button" className="v2-toolbar-secondary v2-toolbar-label" disabled={!count} onClick={onAdvanced}>{t('สไตล์', 'Style')}</button>
      <span className="v2-toolbar-divider v2-toolbar-secondary" />
      <button type="button" className="v2-toolbar-secondary" aria-label={t('ทำสำเนา', 'Duplicate')} title={t('ทำสำเนา', 'Duplicate')} disabled={disabled || !count} onClick={onDuplicate}><img src={assets.imgSectionToolbarIconCopyStateNormal} alt="" /></button>
      <button type="button" className="v2-toolbar-secondary" aria-label={t('ล็อก/ปลดล็อก', 'Lock / unlock')} title={t('ล็อก/ปลดล็อก', 'Lock / unlock')} aria-pressed={!!selected?.locked} disabled={disabled || !count} onClick={onLock}><img src={assets.imgSectionToolbarIconUnlockStateNormal} alt="" /></button>
      <button type="button" className="v2-toolbar-secondary" aria-label={t('ลบที่เลือก', 'Delete selection')} title={t('ลบที่เลือก', 'Delete selection')} disabled={blocked && count < 2 || disabled || !count} onClick={onDelete}><img src={assets.imgSectionToolbarIconTrashStateNormal} alt="" /></button>
      <button type="button" className="v2-toolbar-more" aria-label={t('เครื่องมือเพิ่มเติม', 'More tools')} title={t('เครื่องมือเพิ่มเติม', 'More tools')} aria-expanded={advanced} onClick={onAdvanced}>•••</button>
      {popover === 'opacity' && <div className="v2-toolbar-popover"><label>{t('ความทึบ', 'Opacity')} <input type="range" min="0" max="100" value={Math.round((selected?.opacity ?? 1) * 100)} onChange={e => onPatch(d => ({ ...d, opacity: Number(e.target.value) / 100 }))} />{Math.round((selected?.opacity ?? 1) * 100)}%</label></div>}
      {popover === 'align' && <div className="v2-toolbar-popover">{(['left', 'center', 'right'] as const).map((align, i) => <button key={align} type="button" aria-pressed={(text?.align ?? 'left') === align} onClick={() => { patchText({ align }); setPopover(null) }}>{[t('ชิดซ้าย', 'Left'), t('กึ่งกลาง', 'Center'), t('ชิดขวา', 'Right')][i]}</button>)}</div>}
    </div>
  )
}
