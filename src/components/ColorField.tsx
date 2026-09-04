// ช่องเลือกสีที่ใช้ซ้ำได้ทุกที่ — สวอทช์สี + ดูดสีจากหน้าจอ (EyeDropper) + จานสีบันทึกไว้
// จานสี (palette) เก็บระดับแอปแล้วส่งลงมา ใช้ร่วมกันทุกช่อง (สีพื้น/ข้อความ/รูปทรง)

declare global {
  interface Window {
    EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> }
  }
}

export function ColorField({
  value,
  onChange,
  palette,
  onSave,
  disabled,
  label,
}: {
  value: string
  onChange: (hex: string) => void
  palette: string[]
  onSave: (hex: string) => void
  disabled?: boolean
  label: string
}) {
  const canEyedrop = typeof window !== 'undefined' && !!window.EyeDropper
  const pick = async () => {
    if (!window.EyeDropper) return
    try {
      const res = await new window.EyeDropper().open()
      if (res?.sRGBHex) onChange(res.sRGBHex)
    } catch {
      /* ผู้ใช้กด Esc ยกเลิก */
    }
  }
  return (
    <div className="color-field">
      <div className="cf-main">
        <input
          type="color"
          value={value}
          disabled={disabled}
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
        />
        {canEyedrop && (
          <button type="button" className="cf-btn" title="ดูดสีจากหน้าจอ" aria-label="ดูดสีจากหน้าจอ" disabled={disabled} onClick={pick}>
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2l5 5-9 9H4v-5z" />
              <path d="M11.5 6.5l2 2" />
            </svg>
          </button>
        )}
        <button type="button" className="cf-btn" title="บันทึกสีลงจาน" aria-label="บันทึกสีลงจาน" disabled={disabled} onClick={() => onSave(value)}>
          ＋
        </button>
      </div>
      {palette.length > 0 && (
        <div className="cf-swatches">
          {palette.map((c) => (
            <button
              key={c}
              type="button"
              className={`cf-swatch${c.toLowerCase() === value.toLowerCase() ? ' on' : ''}`}
              style={{ background: c }}
              title={c}
              aria-label={`ใช้สี ${c}`}
              disabled={disabled}
              onClick={() => onChange(c)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
