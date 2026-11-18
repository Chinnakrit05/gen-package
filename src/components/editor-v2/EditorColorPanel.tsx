import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { GradientDef } from '../../core/artwork'
import { useT } from '../../i18n'
import { imgSectionDefaultIconPlusStateNormal } from './assets'
import './editor-color-panel.css'

export interface EditorColorPanelProps {
  title?: string
  value: string | null
  onChange(hex: string): void
  palette: string[]
  onSave?(hex: string): void
  onClear?(): void
  opacity?: number
  onOpacityChange?(opacity: number): void
  gradient?: GradientDef
  onGradientChange?(gradient: GradientDef | undefined): void
  initialOpen?: boolean
  disabled?: boolean
  children?: ReactNode
}

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))

function normalizeHex(value: string | null): string | null {
  const hex = value?.trim().replace(/^#/, '') ?? ''
  if (/^[0-9a-f]{3}$/i.test(hex)) return `#${[...hex].map(channel => channel + channel).join('').toLowerCase()}`
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : null
}

function rgb(hex: string) {
  return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
}

function hexFromRgb(channels: number[]) {
  return `#${channels.map(channel => Math.round(clamp(channel) * 255).toString(16).padStart(2, '0')).join('')}`
}

function hsvFromHex(hex: string) {
  const [red, green, blue] = rgb(hex)
  const high = Math.max(red, green, blue)
  const low = Math.min(red, green, blue)
  const chroma = high - low
  let hue = 0
  if (chroma > 0) {
    if (high === red) hue = ((green - blue) / chroma) % 6
    else if (high === green) hue = (blue - red) / chroma + 2
    else hue = (red - green) / chroma + 4
  }
  return { hue: (hue * 60 + 360) % 360, saturation: high === 0 ? 0 : chroma / high, brightness: high }
}

function hexFromHsv(hue: number, saturation: number, brightness: number) {
  const chroma = brightness * saturation
  const part = hue / 60
  const intermediate = chroma * (1 - Math.abs(part % 2 - 1))
  const segments = [[chroma, intermediate, 0], [intermediate, chroma, 0], [0, chroma, intermediate], [0, intermediate, chroma], [intermediate, 0, chroma], [chroma, 0, intermediate]]
  return hexFromRgb(segments[Math.floor(part) % 6].map(channel => channel + brightness - chroma))
}

function cmykFromHex(hex: string) {
  const channels = rgb(hex)
  const black = 1 - Math.max(...channels)
  // Match the unprofiled CMYK conversion already used by the PDF exporter.
  return [...channels.map(channel => black >= 1 ? 0 : (1 - channel - black) / (1 - black)), black]
}

function PipetteIcon() {
  return <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 2l5 5-9 9H4v-5z" /><path d="M11.5 6.5l2 2" /></svg>
}

function NumericField({ label, value, onCommit, disabled, suffix = '%', max = 100 }: { label: string; value: number; onCommit(value: number): void; disabled?: boolean; suffix?: string; max?: number }) {
  const [draft, setDraft] = useState<string | null>(null)
  const cancelled = useRef(false)
  const commit = () => {
    if (!cancelled.current && draft?.trim() && Number.isFinite(Number(draft))) onCommit(clamp(Number(draft), 0, max))
    cancelled.current = false
    setDraft(null)
  }
  return <label className="v2-cp-number"><span>{label}</span><input type="number" min="0" max={max} step="1" value={draft ?? Math.round(value)} disabled={disabled} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => {
    if (event.key === 'Enter') event.currentTarget.blur()
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelled.current = true; event.currentTarget.blur() }
  }} /><span>{suffix}</span></label>
}

function GradientColorField({ label, value, endpoint, onChange }: { label: string; value: string; endpoint: 'from' | 'to'; onChange(value: string): void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const cancelled = useRef(false)
  return <label className="v2-cp-gradient-color" data-endpoint={endpoint}><input type="color" aria-label={label} value={value} onChange={event => onChange(event.target.value)} /><input aria-label={`${label} HEX`} spellCheck={false} autoComplete="off" value={draft ?? value} onChange={event => setDraft(event.target.value)} onBlur={() => {
    const hex = normalizeHex(draft)
    if (!cancelled.current && hex) onChange(hex)
    cancelled.current = false
    setDraft(null)
  }} onKeyDown={event => {
    if (event.key === 'Enter') event.currentTarget.blur()
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelled.current = true; event.currentTarget.blur() }
  }} /></label>
}

export function EditorColorPanel({ title, value, onChange, palette, onSave, onClear, opacity = 1, onOpacityChange, gradient, onGradientChange, initialOpen = false, disabled, children }: EditorColorPanelProps) {
  const t = useT()
  const [open, setOpen] = useState(initialOpen)
  const [stop, setStop] = useState<'from' | 'to'>('from')
  const [hexDraft, setHexDraft] = useState<string | null>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const [lastHue, setLastHue] = useState(0)
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const nativePicker = useRef<HTMLInputElement>(null)
  const dirtyColor = useRef<string | null>(null)
  const cancelledHex = useRef(false)
  const id = useId()
  const activeHex = normalizeHex(gradient ? gradient[stop] : value) ?? '#ffffff'
  const hsv = hsvFromHex(activeHex)
  const hue = hsv.saturation === 0 || hsv.brightness === 0 ? lastHue : hsv.hue
  const cmyk = cmykFromHex(activeHex)
  const panelTitle = title ?? t('สีพื้น', 'Fill color')
  const visibleColors = [...new Set([...(normalizeHex(value) ? [normalizeHex(value)!] : []), ...palette.map(normalizeHex).filter((color): color is string => color !== null)])].slice(0, 2)

  const changeColor = (hex: string) => {
    dirtyColor.current = hex
    setHexDraft(null)
    if (gradient && onGradientChange) onGradientChange({ ...gradient, [stop]: hex })
    else onChange(hex)
  }
  const close = () => {
    if (dirtyColor.current) onSave?.(dirtyColor.current)
    dirtyColor.current = null
    setOpen(false)
  }
  const pickFromScreen = async () => {
    if (!window.EyeDropper) { nativePicker.current?.click(); return }
    try {
      const result = await new window.EyeDropper().open()
      changeColor(result.sRGBHex)
      onSave?.(result.sRGBHex)
    } catch { /* Escape cancels the browser eyedropper without changing the artwork. */ }
  }

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const bounds = trigger.current?.getBoundingClientRect()
      if (!bounds) return
      const width = Math.min(316, window.innerWidth - 24)
      const height = popup.current?.offsetHeight ?? 465
      setPosition({ left: clamp(bounds.left, 12, Math.max(12, window.innerWidth - width - 12)), top: clamp(bounds.bottom + 10, 12, Math.max(12, window.innerHeight - height - 12)) })
    }
    const outside = (event: PointerEvent) => {
      if (!popup.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close()
    }
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      event.stopPropagation()
      close()
      trigger.current?.focus()
    }
    place()
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, onSave, !!gradient, !!onOpacityChange])

  useLayoutEffect(() => {
    if (open) popup.current?.querySelector<HTMLButtonElement>('[role=tab][aria-selected=true]')?.focus({ preventScroll: true })
  }, [open])

  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  useEffect(() => { if (initialOpen && !disabled) setOpen(true) }, [initialOpen, disabled])

  const changeSaturation = (saturation: number, brightness: number) => {
    setLastHue(hue)
    changeColor(hexFromHsv(hue, clamp(saturation), clamp(brightness)))
  }
  const saturationKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const amount = event.shiftKey ? .1 : .01
    if (event.key === 'ArrowLeft') changeSaturation(hsv.saturation - amount, hsv.brightness)
    else if (event.key === 'ArrowRight') changeSaturation(hsv.saturation + amount, hsv.brightness)
    else if (event.key === 'ArrowUp') changeSaturation(hsv.saturation, hsv.brightness + amount)
    else if (event.key === 'ArrowDown') changeSaturation(hsv.saturation, hsv.brightness - amount)
    else return
    event.preventDefault()
    event.stopPropagation()
  }
  const commitHex = () => {
    const hex = normalizeHex(hexDraft)
    if (!cancelledHex.current && hex) changeColor(hex)
    cancelledHex.current = false
    setHexDraft(null)
  }
  const changeCmyk = (index: number, percent: number) => {
    const channels = [...cmyk]
    channels[index] = percent / 100
    changeColor(hexFromRgb(channels.slice(0, 3).map(channel => (1 - channel) * (1 - channels[3]))))
  }

  return <div className="v2-color-panel">
    {onOpacityChange && <div className="v2-cp-opacity"><div><strong>{t('ความทึบแสง', 'Opacity')}</strong><span>{Math.round(clamp(opacity) * 100)}%</span></div><input type="range" min="0" max="100" value={Math.round(clamp(opacity) * 100)} disabled={disabled} aria-label={t('ความทึบแสง', 'Opacity')} onChange={event => onOpacityChange(Number(event.target.value) / 100)} /></div>}
    <h3>{panelTitle}</h3>
    <div className="v2-cp-swatches">
      <button ref={trigger} type="button" className="v2-cp-swatch v2-cp-add" aria-label={t('เลือกสีเพิ่มเติม', 'More colors')} title={t('เลือกสีเพิ่มเติม', 'More colors')} aria-haspopup="dialog" aria-controls={id} aria-expanded={open} disabled={disabled} onClick={() => open ? close() : setOpen(true)}><img src={imgSectionDefaultIconPlusStateNormal} alt="" /></button>
      {onClear && <button type="button" className="v2-cp-swatch v2-cp-clear" aria-label={t('ไม่มีสี', 'No color')} title={t('ไม่มีสี', 'No color')} aria-pressed={!value || value === 'none'} disabled={disabled} onClick={onClear} />}
      <button type="button" className="v2-cp-swatch v2-cp-pipette" aria-label={t('ดูดสีจากหน้าจอ', 'Pick a color')} title={t('ดูดสีจากหน้าจอ', 'Pick a color')} disabled={disabled} onClick={() => void pickFromScreen()}><PipetteIcon /></button>
      {visibleColors.map(color => <button key={color} type="button" className="v2-cp-swatch" style={{ backgroundColor: color }} aria-label={`${t('ใช้สี', 'Use color')} ${color}`} title={color} aria-pressed={!gradient && normalizeHex(value) === color} disabled={disabled} onClick={() => onChange(color)} />)}
    </div>
    <input ref={nativePicker} type="color" className="v2-cp-native" tabIndex={-1} aria-label={t('ตัวเลือกสีของเบราว์เซอร์', 'Browser color picker')} value={activeHex} disabled={disabled} onChange={event => changeColor(event.target.value)} />
    {children}
    {open && createPortal(<div ref={popup} id={id} className={`v2-color-popover${gradient ? ' is-gradient' : ''}`} role="dialog" aria-label={panelTitle} style={{ left: position.left, top: position.top }} onKeyDown={event => {
      event.stopPropagation()
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); close(); trigger.current?.focus() }
    }}>
      <button type="button" className="v2-cp-close" aria-label={t('ปิดตัวเลือกสี', 'Close color picker')} onClick={() => { close(); trigger.current?.focus() }}><X size={17} aria-hidden="true" /></button>
      <div className="v2-cp-tabs" role="tablist" aria-label={t('ประเภทสี', 'Color type')} onKeyDown={event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')]
        const current = tabs.indexOf(document.activeElement as HTMLButtonElement)
        const next = (current + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length
        event.preventDefault()
        event.stopPropagation()
        tabs[next]?.focus()
        tabs[next]?.click()
      }}>
        <button type="button" role="tab" aria-selected={!gradient} onClick={() => { if (gradient) onGradientChange?.(undefined); setHexDraft(null) }}>{t('สี', 'Color')}</button>
        {onGradientChange && <button type="button" role="tab" aria-selected={!!gradient} onClick={() => { onGradientChange(gradient ?? { from: activeHex, to: activeHex, angle: 0 }); setHexDraft(null) }}>{t('ไล่สี', 'Gradient')}</button>}
      </div>
      {gradient && onGradientChange ? <div className="v2-cp-gradient">
        <div className="v2-cp-gradient-stops" style={{ backgroundImage: `linear-gradient(90deg, ${gradient.from}, ${gradient.to})` }}>{(['from', 'to'] as const).map(endpoint => <button key={endpoint} type="button" style={{ backgroundColor: gradient[endpoint] }} aria-pressed={stop === endpoint} aria-label={endpoint === 'from' ? t('สีเริ่มไล่', 'Start color') : t('สีปลายไล่', 'End color')} onClick={() => { setStop(endpoint); popup.current?.querySelector<HTMLInputElement>(`[data-endpoint="${endpoint}"] input[type=color]`)?.click() }} />)}</div>
        <h4>Gradient</h4>
        {(['from', 'to'] as const).map(endpoint => <GradientColorField key={endpoint} endpoint={endpoint} label={endpoint === 'from' ? t('สีเริ่มไล่', 'Start color') : t('สีปลายไล่', 'End color')} value={gradient[endpoint]} onChange={hex => { dirtyColor.current = hex; onGradientChange({ ...gradient, [endpoint]: hex }) }} />)}
        <h4>{t('สไตล์', 'Style')}</h4>
        <div className="v2-cp-gradient-options"><select aria-label={t('รูปแบบไล่สี', 'Gradient type')} value={gradient.radial ? 'radial' : 'linear'} onChange={event => onGradientChange({ ...gradient, radial: event.target.value === 'radial' || undefined })}><option value="linear">{t('เส้นตรง', 'Linear')}</option><option value="radial">{t('วงกลม', 'Radial')}</option></select>{!gradient.radial && <NumericField label={t('มุม', 'Angle')} value={gradient.angle} max={360} suffix="°" onCommit={angle => onGradientChange({ ...gradient, angle })} />}</div>
      </div> : <>
      <div className="v2-cp-saturation" role="slider" tabIndex={0} aria-label={t('ความอิ่มสีและความสว่าง', 'Saturation and brightness')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hsv.saturation * 100)} aria-valuetext={`${t('ความอิ่มสี', 'Saturation')} ${Math.round(hsv.saturation * 100)}%, ${t('ความสว่าง', 'Brightness')} ${Math.round(hsv.brightness * 100)}%`} style={{ backgroundColor: `hsl(${hue} 100% 50%)` }} onKeyDown={saturationKeyboard} onPointerDown={event => {
        if (event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        event.currentTarget.focus()
        const bounds = event.currentTarget.getBoundingClientRect()
        changeSaturation((event.clientX - bounds.left) / bounds.width, 1 - (event.clientY - bounds.top) / bounds.height)
      }} onPointerMove={event => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        const bounds = event.currentTarget.getBoundingClientRect()
        changeSaturation((event.clientX - bounds.left) / bounds.width, 1 - (event.clientY - bounds.top) / bounds.height)
      }}><span style={{ left: `${hsv.saturation * 100}%`, top: `${(1 - hsv.brightness) * 100}%` }} /></div>
      <input className="v2-cp-hue" type="range" min="0" max="359" step="1" aria-label={t('เฉดสี', 'Hue')} value={Math.round(hue)} onChange={event => { const nextHue = Number(event.target.value); setLastHue(nextHue); changeColor(hexFromHsv(nextHue, hsv.saturation, hsv.brightness)) }} />
      {onOpacityChange && <input className="v2-cp-alpha" type="range" min="0" max="100" aria-label={t('ความทึบแสงของสี', 'Color opacity')} value={Math.round(clamp(opacity) * 100)} style={{ '--v2-cp-color': activeHex } as CSSProperties} onChange={event => onOpacityChange(Number(event.target.value) / 100)} />}
      <div className="v2-cp-cmyk">{['C', 'M', 'Y', 'K'].map((label, index) => <NumericField key={label} label={label} value={cmyk[index] * 100} onCommit={percent => changeCmyk(index, percent)} />)}</div>
      <div className="v2-cp-hex"><label><span className="v2-cp-hex-swatch" style={{ backgroundColor: activeHex }} /><input aria-label={t('รหัสสี HEX', 'HEX color')} spellCheck={false} autoComplete="off" maxLength={7} value={hexDraft ?? activeHex} onChange={event => setHexDraft(event.target.value)} onBlur={commitHex} onKeyDown={event => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelledHex.current = true; event.currentTarget.blur() }
      }} /></label><button type="button" aria-label={t('ดูดสีจากหน้าจอ', 'Pick a color')} onClick={() => void pickFromScreen()}><PipetteIcon /></button></div>
      </>}
    </div>, document.body)}
  </div>
}
