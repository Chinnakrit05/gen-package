import { useState, type ReactNode } from 'react'
import { useT } from '../../i18n'
import type { ShapeKind } from '../../core/artwork'
import * as assets from './assets'

export type EditorTool = 'model' | 'elements' | 'text' | 'images' | 'templates' | 'layers' | 'background' | 'account' | 'export'
export type FreeShape = 'heart' | 'cross' | 'arrow'

export function EditorRail({ active, onSelect }: { active: EditorTool; onSelect: (tool: EditorTool) => void }) {
  const t = useT()
  const items = [
    ['model', t('โมเดล', 'Model'), assets.imgIconButton1],
    ['elements', t('ตกแต่ง', 'Elements'), assets.imgIconButton2],
    ['text', t('ตัวอักษร', 'Text'), assets.imgIconButton3],
    ['images', t('เพิ่มรูป', 'Images'), assets.imgIconButton4],
    ['templates', t('เทมเพลต', 'Patterns'), assets.imgIconButton5],
  ] as const
  return (
    <nav className="v2-rail" aria-label={t('เครื่องมือออกแบบ', 'Design tools')}>
      <div className="v2-rail-top">{items.map(([id, label, src]) => (
        <button key={id} type="button" aria-label={label} title={label} aria-pressed={active === id} onClick={() => onSelect(id)}>
          <img src={src} alt="" />{active === id && <span>{label}</span>}
        </button>
      ))}</div>
      <div className="v2-rail-bottom">
        <img className="v2-rail-divider" src={assets.imgLine4} alt="" />
        <button type="button" title={t('พื้นที่ทำงาน', 'Workspace')} aria-label={t('พื้นที่ทำงาน', 'Workspace')} aria-pressed={active === 'account'} onClick={() => onSelect('account')}><img src={assets.imgIconButton6} alt="" /></button>
        <button type="button" title={t('ส่งออกและไฟล์', 'Export & files')} aria-label={t('ส่งออกและไฟล์', 'Export & files')} aria-pressed={active === 'export'} onClick={() => onSelect('export')}><img src={assets.imgIconButton7} alt="" /></button>
      </div>
    </nav>
  )
}

function ElementGroup({ title, children }: { title: string; children: ReactNode }) {
  return <details className="v2-element-group" open><summary>{title}<img src={assets.imgSectionDefaultIconDropdownStateNormal} alt="" /></summary><div>{children}</div></details>
}

export function ElementLibrary({ disabled, onShape, onFreeShape, onNutrition, onNext }: {
  disabled: boolean; onShape: (kind: ShapeKind) => void; onFreeShape: (kind: FreeShape) => void; onNutrition: () => void; onNext: () => void
}) {
  const t = useT()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const matches = (th: string, en: string) => `${th} ${en}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  const geometry = category === 'all' || category === 'geometry'
  const free = category === 'all' || category === 'free'
  const table = category === 'all' || category === 'table'
  const shapes = [
    ['rect', 'สี่เหลี่ยม', 'Rectangle', null], ['triangle', 'สามเหลี่ยม', 'Triangle', assets.imgFrame58],
    ['ellipse', 'วงกลม', 'Circle ellipse', assets.imgFrame59], ['line', 'เส้น', 'Line', null],
  ] as const
  const freeShapes = [['heart', 'หัวใจ', 'Heart', assets.imgLucideHeart], ['cross', 'กากบาท', 'Cross', assets.imgLucideCross], ['arrow', 'ลูกศร', 'Arrow', assets.imgLucideArrowBigUp]] as const
  const hasGeometry = geometry && [...shapes.map(s => matches(s[1], s[2])), matches('ดาว', 'Star'), matches('หกเหลี่ยม หลายเหลี่ยม', 'Hexagon polygon')].some(Boolean)
  const hasFree = free && freeShapes.some(s => matches(s[1], s[2]))
  const hasTable = table && matches('ตาราง โภชนาการ', 'Table nutrition')
  return (
    <div className="v2-library">
      <div className="v2-library-head">
        <label className="v2-search"><input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('ค้นหาองค์ประกอบ', 'Search elements')} aria-label={t('ค้นหาองค์ประกอบ', 'Search elements')} /><img src={assets.imgIconButton12} alt="" /></label>
        <div className="v2-categories" role="group" aria-label={t('หมวดองค์ประกอบ', 'Element categories')}>
          {[
            ['all', t('ทั้งหมด', 'All'), null], ['geometry', t('รูปร่างเรขาคณิต', 'Geometry'), assets.imgIconButton13],
            ['free', t('รูปร่างอิสระ', 'Free shapes'), assets.imgIconButton14], ['table', t('ตาราง', 'Tables'), assets.imgIconButton15],
          ].map(([id, label, src]) => <button key={id} type="button" title={label!} aria-label={label!} aria-pressed={category === id} onClick={() => setCategory(id!)}>{src ? <img src={src} alt="" /> : 'All'}</button>)}
        </div>
      </div>
      <div className="v2-library-scroll">
        {hasGeometry && <ElementGroup title={t('รูปร่างเรขาคณิต', 'Geometric shapes')}>
          <div className="v2-shape-grid">{shapes.filter(s => matches(s[1], s[2])).map(([id, th, en, src]) => <button key={id} type="button" className={`v2-shape ${id}`} title={t(th, en)} aria-label={t(`เพิ่ม${th}`, `Add ${en.toLowerCase()}`)} disabled={disabled} onClick={() => onShape(id)}>{src ? <img src={src} alt="" /> : <span />}</button>)}</div>
          <div className="v2-polygon-row">
            <img src={assets.imgFrame57} alt="" />
            <button type="button" title={t('ดาว', 'Star')} aria-label={t('เพิ่มดาว', 'Add star')} className={!matches('ดาว', 'Star') ? 'filtered' : ''} disabled={disabled || !matches('ดาว', 'Star')} onClick={() => onShape('star')} />
            <button type="button" title={t('หกเหลี่ยม', 'Hexagon')} aria-label={t('เพิ่มหกเหลี่ยม', 'Add hexagon')} className={!matches('หกเหลี่ยม หลายเหลี่ยม', 'Hexagon polygon') ? 'filtered' : ''} disabled={disabled || !matches('หกเหลี่ยม หลายเหลี่ยม', 'Hexagon polygon')} onClick={() => onShape('polygon')} />
          </div>
        </ElementGroup>}
        {hasFree && <ElementGroup title={t('รูปร่างอิสระ', 'Free shapes')}><div className="v2-free-shapes">{freeShapes.filter(s => matches(s[1], s[2])).map(([id, th, en, src]) => <button key={id} type="button" title={t(th, en)} aria-label={t(`เพิ่ม${th}`, `Add ${en.toLowerCase()}`)} disabled={disabled} onClick={() => onFreeShape(id)}><img src={src} alt="" /></button>)}</div></ElementGroup>}
        {hasTable && <ElementGroup title={t('ตาราง', 'Tables')}><button type="button" className="v2-table-shape" title={t('ตารางโภชนาการ', 'Nutrition facts')} aria-label={t('เพิ่มตารางโภชนาการ', 'Add nutrition facts')} disabled={disabled} onClick={onNutrition}><img src={assets.imgIconButton16} alt="" /></button></ElementGroup>}
        {!hasGeometry && !hasFree && !hasTable && <p className="hint">{t('ไม่พบองค์ประกอบ ลองค้นหาคำอื่น', 'No elements found. Try another search.')}</p>}
      </div>
      <button type="button" className="v2-next" onClick={onNext}>{t('ต่อไป', 'Next')}</button>
    </div>
  )
}
