import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useT } from '../../i18n'
import { modelTypeAssets } from './modelAssets'
import './model-panel.css'

export type ModelTab = 'type' | 'material' | 'size'
export type ModelFilter = 'box' | 'vessel' | 'flexible' | 'other'

export interface ModelOption {
  id: string
  title: string
  detail?: string
  searchText?: string
  category: ModelFilter
  selected: boolean
  image?: string
  icon?: ReactNode
  onSelect(): void
}

interface ModelPanelProps {
  tab: ModelTab
  onTab(tab: ModelTab): void
  options: readonly ModelOption[]
  material: ReactNode
  size: ReactNode
  onNext(): void
  disabled?: boolean
}

export function ModelPanel({ tab, onTab, options, material, size, onNext, disabled }: ModelPanelProps) {
  const t = useT()
  const id = useId()
  const tabsRef = useRef<Array<HTMLButtonElement | null>>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ModelFilter | 'all'>('all')
  const tabs = [
    { id: 'type', label: t('ประเภท', 'Type') },
    { id: 'material', label: t('วัสดุ', 'Material') },
    { id: 'size', label: t('ขนาด', 'Size') },
  ] as const
  const filters = [
    { id: 'all', label: t('ทั้งหมด', 'All'), image: null },
    { id: 'box', label: t('กล่อง', 'Boxes'), image: modelTypeAssets.box },
    { id: 'vessel', label: t('ขวดและภาชนะ', 'Bottles and vessels'), image: modelTypeAssets.vessel },
    { id: 'flexible', label: t('ถุงและหลอด', 'Pouches and tubes'), image: modelTypeAssets.tube },
  ] as const

  const search = query.trim().toLocaleLowerCase()
  const visibleOptions = options.filter((option) => {
    const matchesFilter = filter === 'all' || filter === option.category
    const terms = `${option.title} ${option.detail ?? ''} ${option.searchText ?? ''} ${option.id}`.toLocaleLowerCase()
    return matchesFilter && terms.includes(search)
  })

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number
    switch (event.key) {
      case 'ArrowLeft': next = (index + tabs.length - 1) % tabs.length; break
      case 'ArrowRight': next = (index + 1) % tabs.length; break
      case 'Home': next = 0; break
      case 'End': next = tabs.length - 1; break
      default: return
    }
    event.preventDefault()
    onTab(tabs[next].id)
    tabsRef.current[next]?.focus()
  }

  return (
    <div className="v2-model-panel">
      <div className="v2-model-tabs" role="tablist" aria-label={t('ตั้งค่าโมเดล', 'Model settings')}>
        {tabs.map(({ id: key, label }, index) => (
          <button
            key={key}
            ref={(button) => { tabsRef.current[index] = button }}
            type="button"
            role="tab"
            id={`${id}-tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`${id}-panel-${key}`}
            tabIndex={tab === key ? 0 : -1}
            onClick={() => onTab(key)}
            onKeyDown={(event) => moveTab(event, index)}
          >{label}</button>
        ))}
      </div>

      {tabs.map(({ id: key }) => (
        <div
          key={key}
          className="v2-model-tabpanel"
          role="tabpanel"
          id={`${id}-panel-${key}`}
          aria-labelledby={`${id}-tab-${key}`}
          hidden={tab !== key}
        >
          {tab === key && (key === 'type' ? (
            <>
              <div className="v2-model-type-tools">
                <label className="v2-model-search">
                  <input
                    type="search"
                    aria-label={t('ค้นหารูปแบบภาชนะ', 'Search package types')}
                    placeholder={t('ค้นหา', 'Search')}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  <img src={modelTypeAssets.search} alt="" />
                </label>
                <div className="v2-model-filters" role="group" aria-label={t('หมวดรูปแบบภาชนะ', 'Package categories')}>
                  {filters.map(({ id: key, label, image }) => (
                    <button
                      key={key}
                      type="button"
                      title={label}
                      data-model-filter={key}
                      aria-label={label}
                      aria-pressed={filter === key}
                      onClick={() => setFilter(key)}
                    >{image ? <img src={image} alt="" /> : 'All'}</button>
                  ))}
                </div>
              </div>
              <div className="v2-model-scroll">
                <h2 className="v2-model-heading">{t('รูปแบบภาชนะ', 'Package styles')}</h2>
                {visibleOptions.length > 0 ? (
                  <div className="v2-model-options">
                    {visibleOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className="v2-model-option"
                        aria-pressed={option.selected}
                        disabled={disabled}
                        onClick={option.onSelect}
                      >
                        <span className="v2-model-option-picture" aria-hidden="true">
                          {option.image ? <img className="v2-model-option-image" src={option.image} alt="" /> : option.icon}
                        </span>
                        <span className="v2-model-option-copy">
                          <strong>{option.title}</strong>
                          {option.detail && <small>{option.detail}</small>}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : <p className="v2-model-empty">{t('ไม่พบรูปแบบภาชนะ', 'No matching package styles')}</p>}
              </div>
            </>
          ) : (
            <div className="v2-model-scroll v2-model-settings">{key === 'material' ? material : size}</div>
          ))}
        </div>
      ))}

      <button type="button" className="v2-model-next" onClick={onNext} disabled={disabled}>
        {t('ต่อไป', 'Next')}
      </button>
    </div>
  )
}

interface ModelTileProps {
  title: string
  image?: string
  selected: boolean
  onClick(): void
  disabled?: boolean
}

export function ModelTile({ title, image, selected, onClick, disabled }: ModelTileProps) {
  return (
    <button type="button" className="v2-model-tile" aria-pressed={selected} onClick={onClick} disabled={disabled}>
      {image && <img src={image} alt="" />}
      <span>{title}</span>
    </button>
  )
}
