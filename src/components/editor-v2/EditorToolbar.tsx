import { useEffect, useRef, useState } from 'react'
import { FONTS, withTextW, type AlignMode, type Deco, type TextEl } from '../../core/artwork'
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
  // โหมดเลือกหลายรายการ: แตะชิ้นเพื่อเพิ่ม/เอาออก แล้วสั่งกับทั้งชุด; ยืนยัน = จัดกลุ่มแล้วออก, ยกเลิก = ออกเฉย ๆ
  multiMode: boolean
  onMultiMode: () => void
  onMultiConfirm: () => void
  onMultiCancel: () => void
  onAlign: (mode: AlignMode) => void
}

const ALIGN_MODES: { mode: AlignMode; th: string; en: string }[] = [
  { mode: 'left', th: 'ชิดซ้าย', en: 'Left' },
  { mode: 'hcenter', th: 'กึ่งกลางแนวนอน', en: 'Center' },
  { mode: 'right', th: 'ชิดขวา', en: 'Right' },
  { mode: 'top', th: 'ชิดบน', en: 'Top' },
  { mode: 'vcenter', th: 'กึ่งกลางแนวตั้ง', en: 'Middle' },
  { mode: 'bottom', th: 'ชิดล่าง', en: 'Bottom' },
]

export function EditorToolbar({ selected, count, disabled, advanced, onAdvanced, onPatch, onDuplicate, onLock, onDelete, onLayers, multiMode, onMultiMode, onMultiConfirm, onMultiCancel, onAlign }: Props) {
  const t = useT()
  const [popover, setPopover] = useState<'opacity' | 'align' | 'multiAlign' | null>(null)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!popover) return
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setPopover(null) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setPopover(null) }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [popover])
  useEffect(() => { setPopover(null) }, [selected?.id, selected?.locked, disabled, multiMode])
  if (multiMode) {
    const few = disabled || count < 2 // เมนูคำสั่งใช้ได้เมื่อเลือกตั้งแต่ 2 ชิ้น
    return (
      <div ref={root} className="v2-toolbar v2-multi-bar" role="toolbar" aria-label={t('เลือกหลายรายการ', 'Multi-select')}>
        <span className="v2-multi-title">{t('เลือกหลายรายการ', 'Multi-select')} · <b>{t(`${count} ชิ้น`, `${count} items`)}</b></span>
        <span className="v2-multi-hint">{t('แตะชิ้นเพื่อเพิ่ม/เอาออก', 'Tap items to add or remove')}</span>
        <span className="v2-toolbar-divider" />
        <button type="button" className="v2-multi-act" aria-label={t('ลบที่เลือก', 'Delete selection')} title={t('ลบ', 'Delete')} disabled={few} onClick={onDelete}><img src={assets.imgSectionToolbarIconTrashStateNormal} alt="" /><span>{t('ลบ', 'Delete')}</span></button>
        <button type="button" className="v2-multi-act" aria-label={t('ทำสำเนา', 'Duplicate')} title={t('ทำสำเนา', 'Duplicate')} disabled={few} onClick={onDuplicate}><img src={assets.imgSectionToolbarIconCopyStateNormal} alt="" /><span>{t('ทำสำเนา', 'Duplicate')}</span></button>
        <button type="button" className="v2-multi-act" aria-label={t('จัดแนว', 'Align')} title={t('จัดแนว', 'Align')} aria-expanded={popover === 'multiAlign'} disabled={few} onClick={() => setPopover(popover === 'multiAlign' ? null : 'multiAlign')}><img src={assets.imgSectionToolbarIconLeftAlignStateNormal} alt="" /><span>{t('จัดแนว', 'Align')}</span></button>
        <button type="button" className="v2-multi-act" aria-label={t('ล็อก/ปลดล็อก', 'Lock / unlock')} title={t('ล็อก/ปลดล็อก', 'Lock / unlock')} aria-pressed={!!selected?.locked} disabled={few} onClick={onLock}><img src={assets.imgSectionToolbarIconUnlockStateNormal} alt="" /><span>{t('ล็อก', 'Lock')}</span></button>
        <span className="v2-multi-spacer" />
        <button type="button" className="v2-multi-cancel" onClick={onMultiCancel}>{t('ยกเลิก', 'Cancel')}</button>
        <button type="button" className="v2-multi-confirm" title={t('จัดกลุ่มชิ้นที่เลือกแล้วออกจากโหมด', 'Group the selection and finish')} onClick={onMultiConfirm}>{t('ยืนยัน', 'Confirm')}</button>
        {popover === 'multiAlign' && (
          <div className="v2-toolbar-popover v2-multi-align">
            {ALIGN_MODES.map((a) => <button key={a.mode} type="button" onClick={() => { onAlign(a.mode); setPopover(null) }}>{t(a.th, a.en)}</button>)}
          </div>
        )}
      </div>
    )
  }
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
          <FontSizeInput key={selected?.id ?? 'none'} label={t('ขนาดตัวอักษร (มม.)', 'Font size (mm)')} disabled={blocked} value={text?.size ?? 6} onCommit={changeSize} />
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
      <button type="button" className="v2-toolbar-label v2-multi-enter" title={t('เลือกหลายรายการ — แตะชิ้นเพื่อเพิ่ม/เอาออก', 'Multi-select — tap items to add or remove')} disabled={disabled} onClick={onMultiMode}>{t('เลือกหลายรายการ', 'Multi-select')}</button>
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

// ขนาดตัวอักษรสำเร็จรูปในรายการเลือก (มม.)
const FONT_SIZE_PRESETS = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 60, 72]

// ช่องขนาดตัวอักษร: เก็บข้อความที่กำลังพิมพ์แยกจากขนาดจริง — ลบจนว่าง/พิมพ์ "1" ก่อนจะเป็น "14" ได้
// โดยข้อความบนแผ่นไม่หดตามตัวเลขครึ่งทาง; ใช้ค่าเมื่อกด Enter หรือออกจากช่อง, Esc = คืนค่าเดิม
// คลิกช่อง 1 ครั้ง = เปิดรายการขนาด (เคอร์เซอร์อยู่ในช่อง พิมพ์ต่อได้), ดับเบิลคลิก = คลุมตัวเลขทั้งหมด + เปิดรายการ;
// ปุ่ม − / + อยู่นอกคอมโพเนนต์นี้ จึงไม่เปิดรายการ
function FontSizeInput({ label, value, disabled, onCommit }: { label: string; value: number; disabled: boolean; onCommit: (size: number) => void }) {
  const t = useT()
  const [draft, setDraft] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const commit = () => {
    if (draft === null) return
    const n = Number(draft)
    if (draft.trim() !== '' && Number.isFinite(n)) onCommit(n)
    setDraft(null)
  }
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  // เปิดรายการแล้วเลื่อนให้ขนาดปัจจุบัน (หรือที่ใกล้สุด) อยู่ในมุมมอง
  useEffect(() => {
    if (!open || !list.current) return
    const near = FONT_SIZE_PRESETS.reduce((b, s) => (Math.abs(s - value) < Math.abs(b - value) ? s : b), FONT_SIZE_PRESETS[0])
    const item = list.current.querySelector<HTMLElement>(`[data-size="${near}"]`)
    if (item) list.current.scrollTop = item.offsetTop - (list.current.clientHeight - item.offsetHeight) / 2
  }, [open, value])
  const pick = (size: number) => {
    setDraft(null)
    onCommit(size)
    setOpen(false)
  }
  return (
    <div ref={box} className="v2-font-size-field">
      <input
        type="number"
        min="1"
        max="400"
        step="0.5"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        value={draft ?? value}
        onChange={e => setDraft(e.target.value)}
        onClick={() => setOpen(true)}
        onDoubleClick={e => { e.currentTarget.select(); setOpen(true) }}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { commit(); setOpen(false) }
          else if (e.key === 'Escape') { setDraft(null); setOpen(false) }
        }}
      />
      {open && (
        <ul ref={list} className="v2-font-size-menu" role="listbox" aria-label={t('ขนาดตัวอักษร', 'Font sizes')}>
          {FONT_SIZE_PRESETS.map(size => (
            <li
              key={size}
              data-size={size}
              role="option"
              aria-selected={size === value}
              // กันช่องเสียโฟกัส (ไม่งั้น blur จะ commit ตัวเลขที่พิมพ์ค้างก่อนค่าที่เลือก)
              onPointerDown={e => e.preventDefault()}
              onClick={() => pick(size)}
            >
              {size}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
