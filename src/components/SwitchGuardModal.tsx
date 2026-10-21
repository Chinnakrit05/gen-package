// กล่องเตือนก่อนสลับประเภทงาน/รูปแบบบรรจุภัณฑ์/รูปแบบถุง เมื่อมีงานตกแต่งอยู่แล้ว:
// บอกชัดว่างานบนรูปแบบเดิม "จะถูกลบไปเลย" พร้อมรายการที่จะหาย ปุ่มยืนยันสีอันตราย โฟกัสเริ่มที่ "ยกเลิก"
// (Esc/คลิกนอกกล่อง = ยกเลิก) — ผู้เรียก (App) เป็นคนลบงานแล้วสลับเมื่อยืนยัน
import { useEffect, useRef } from 'react'
import { describeDesignWork, type DesignWorkSummary } from '../core/designWork'
import { useT } from '../i18n'

export interface SwitchGuardModalProps {
  what: string // สิ่งที่กำลังจะเปลี่ยน (แปลแล้ว) เช่น "ประเภทงาน" / "รูปแบบบรรจุภัณฑ์" / "รูปแบบถุง"
  fromName: string
  toName: string
  summary: DesignWorkSummary
  onConfirm(): void
  onCancel(): void
}

export function SwitchGuardModal({ what, fromName, toName, summary, onConfirm, onCancel }: SwitchGuardModalProps) {
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
        className="modal modal-danger"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="switch-guard-title"
        aria-describedby="switch-guard-desc"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 id="switch-guard-title">{t(`เปลี่ยน${what}แล้ว งานของรูปแบบเดิมจะถูกลบไปเลย`, `Changing the ${what} deletes the work on the current one`)}</h3>
        <div id="switch-guard-desc" className="switch-guard-body">
          <p>
            {t(
              `ลายและการตกแต่งทั้งหมดบน «${fromName}» (${summary.total} รายการ) จะหายไป ไม่ย้ายตามไป «${toName}»`,
              `Everything you decorated on “${fromName}” (${summary.total} items) will be gone; nothing carries over to “${toName}”.`,
            )}
          </p>
          <p className="switch-guard-list">{describeDesignWork(summary, t)}</p>
          <p className="switch-guard-q">{t('ต้องการจะเปลี่ยนใช่ไหม', 'Do you really want to switch?')}</p>
          <p className="switch-guard-hint">{t('ถ้าเปลี่ยนพลาด กด Ctrl+Z ทันทีเพื่อเอางานเดิมกลับมา', 'Switched by mistake? Press Ctrl+Z right away to bring the work back.')}</p>
        </div>
        <div className="modal-actions">
          <button ref={cancelRef} type="button" onClick={onCancel}>{t('ยกเลิก เก็บงานเดิมไว้', 'Cancel, keep my work')}</button>
          <button type="button" className="danger" onClick={onConfirm}>{t('ลบงานเดิมแล้วเปลี่ยน', 'Delete it and switch')}</button>
        </div>
      </div>
    </div>
  )
}
