// กล่องถามก่อนเปลี่ยนประเภทงาน/รูปแบบบรรจุภัณฑ์/รูปแบบถุง เมื่องานนี้มีการตกแต่งแล้ว:
// ไม่ลบงานเดิม — ยืนยัน = บันทึกงานนี้ไว้ตามเดิมแล้วเปิด "ชิ้นงานใหม่" ที่ไม่มีการตั้งค่า/การตกแต่งของงานเก่าเลย
// (App เป็นคนสร้างงานใหม่ผ่าน `freshProjectFor`) — โฟกัสเริ่มที่ "ยกเลิก", Esc/คลิกนอกกล่อง = ยกเลิก
import { useEffect, useRef } from 'react'
import { useT } from '../i18n'

export interface SwitchGuardModalProps {
  onConfirm(): void
  onCancel(): void
}

export function SwitchGuardModal({ onConfirm, onCancel }: SwitchGuardModalProps) {
  const t = useT()
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    cancelRef.current?.focus()
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div
        className="modal modal-newwork"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="switch-guard-title"
        aria-describedby="switch-guard-desc"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 id="switch-guard-title">{t('เริ่มชิ้นงานใหม่', 'Start a new piece')}</h3>
        <p id="switch-guard-desc">
          {t('การกระทำนี้จะ', 'This will')} <strong>{t('บันทึก', 'save')}</strong>{' '}
          {t('งานนี้และเริ่มชิ้นงานใหม่', 'this work and start a new piece.')}
          <br />
          {t('การตกแต่งในชิ้นงานนี้ของคุณจะไม่ถูกนำไปใช้ในงานใหม่', 'Your decoration on this piece will not carry over to the new one.')}
        </p>
        <div className="modal-actions">
          <button ref={cancelRef} type="button" onClick={onCancel}>{t('ยกเลิก', 'Cancel')}</button>
          <button type="button" className="go" onClick={onConfirm}>{t('เริ่มชิ้นงานใหม่', 'Start new piece')}</button>
        </div>
      </div>
    </div>
  )
}
