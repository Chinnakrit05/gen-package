import type { FormEvent } from 'react'
import { SUPPLIER_CAPABILITIES, SUPPLIER_KINDS, type SupplierProfileInput } from '../../../shared/contracts/marketplace'
import { SUPPLIER_SLUG_PATTERN, supplierCapabilityNames, supplierInput, supplierKindNames } from './supplierUi'

export function SupplierForm({
  value,
  onChange,
  onSave,
  busy,
  saveLabel,
}: {
  value: SupplierProfileInput
  onChange(value: SupplierProfileInput): void
  onSave(value: SupplierProfileInput): void
  busy: boolean
  saveLabel: string
}) {
  const update = <K extends keyof SupplierProfileInput>(key: K, next: SupplierProfileInput[K]) => {
    onChange({ ...value, [key]: next })
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const input = supplierInput(value)
    if (input.name && !busy) onSave(input)
  }
  return (
    <form className="marketplace-form" onSubmit={submit} aria-busy={busy}>
      <fieldset className="marketplace-form-fields" disabled={busy}>
        <div className="marketplace-form-columns">
          <label>
            ประเภทกิจการ
            <select value={value.kind} onChange={(event) => update('kind', event.target.value as SupplierProfileInput['kind'])}>
              {SUPPLIER_KINDS.map((kind) => <option key={kind} value={kind}>{supplierKindNames[kind]}</option>)}
            </select>
          </label>
          <label>
            ชื่อกิจการ
            <input value={value.name} onChange={(event) => update('name', event.target.value)} maxLength={100} required />
          </label>
          <label>
            ชื่อในลิงก์โปรไฟล์
            <input
              value={value.slug}
              onChange={(event) => update('slug', event.target.value)}
              pattern={SUPPLIER_SLUG_PATTERN}
              minLength={3}
              maxLength={64}
              autoCapitalize="none"
              spellCheck={false}
              placeholder="example-print"
              required
            />
            <small>ใช้อักษรอังกฤษตัวเล็ก ตัวเลข และขีดคั่น 3–64 ตัว</small>
          </label>
          <label>
            อีเมลติดต่อ
            <input type="email" value={value.contactEmail} onChange={(event) => update('contactEmail', event.target.value)} maxLength={254} required />
            <small>ใช้สำหรับการตรวจสอบและจัดการโปรไฟล์</small>
          </label>
        </div>
        <label>
          รายละเอียดกิจการ
          <textarea value={value.description} onChange={(event) => update('description', event.target.value)} maxLength={1000} rows={4} />
        </label>
        <fieldset className="marketplace-options">
          <legend>ความสามารถในการผลิต</legend>
          <div className="marketplace-options-grid">
            {SUPPLIER_CAPABILITIES.map((capability) => (
              <label key={capability}>
                <input
                  type="checkbox"
                  checked={value.capabilities.includes(capability)}
                  onChange={(event) => update('capabilities', event.target.checked
                    ? [...value.capabilities, capability]
                    : value.capabilities.filter((item) => item !== capability))}
                />
                {supplierCapabilityNames[capability]}
              </label>
            ))}
          </div>
        </fieldset>
      </fieldset>
      <button type="submit" className="primary" disabled={busy || !value.name.trim()}>
        {busy ? 'กำลังบันทึก…' : saveLabel}
      </button>
    </form>
  )
}
