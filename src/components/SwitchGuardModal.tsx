import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useT } from '../i18n'
import './SwitchGuardModal.css'

export interface SwitchGuardModalProps {
  variant?: 'v1' | 'v2-start' | 'v2-switch'
  onConfirm(): void
  onCancel(): void
  onReplace?(): void
}

function keepFocusInside(event: ReactKeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'Tab') return
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
  const current = buttons.findIndex((button) => button === event.target)
  if (current === -1) return
  const step = event.shiftKey ? -1 : 1
  event.preventDefault()
  buttons[(current + step + buttons.length) % buttons.length].focus()
}

export function SwitchGuardModal({ variant = 'v1', onConfirm, onCancel, onReplace }: SwitchGuardModalProps) {
  const t = useT()
  const isV2 = variant !== 'v1'
  const isSwitch = variant === 'v2-switch'
  const initialFocus = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement
    initialFocus.current?.focus()
    return () => {
      if (isV2 && previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [isV2, isSwitch])
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

  if (isV2) return (
    <div className="modal-overlay v2-work-dialog-overlay" onMouseDown={onCancel}>
      <div
        className={`modal v2-work-dialog ${isSwitch ? 'v2-work-dialog-switch' : 'v2-work-dialog-start'}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="switch-guard-title"
        aria-describedby={isSwitch ? 'switch-guard-desc switch-guard-question' : 'switch-guard-desc'}
        onKeyDown={keepFocusInside}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {isSwitch ? (
          <>
            <div className="v2-work-dialog-copy">
              <h3 id="switch-guard-title">
                <span className="v2-work-dialog-title-wide">{t('บันทึกงานนี้ไว้และเริ่มชิ้นงานใหม่', 'Save this work and start a new piece')}</span>
                <span className="v2-work-dialog-title-narrow">{t('เปลี่ยนรูปแบบบรรจุภัณฑ์', 'Change packaging style')}</span>
              </h3>
              <p id="switch-guard-desc">{t('การกระทำนี้จะเปลี่ยนรูปแบบของบรรจุภัณฑ์และเริ่มงานชิ้นใหม่ การตกแต่งในงานนี้จะไม่ถูกนำไปใช้ในงานถัดไป', 'Changing the packaging style starts a new piece without carrying over this artwork.')}</p>
              <p id="switch-guard-question"><strong>{t('คุณต้องการเก็บรูปแบบบรรจุภัณฑ์นี้ไว้หรือไม่', 'Keep this packaging design?')}</strong></p>
            </div>
            <div className="modal-actions">
              <button ref={initialFocus} type="button" className="v2-work-dialog-primary" onClick={onConfirm}>
                {t('เก็บงานนี้ไว้และเริ่มงานชิ้นใหม่', 'Keep this work and start a new piece')}
              </button>
              <button type="button" className="v2-work-dialog-secondary" onClick={onReplace ?? onCancel}>
                {onReplace ? t('เริ่มงานใหม่ทับงานนี้', 'Replace this work') : t('ยกเลิก', 'Cancel')}
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 id="switch-guard-title">{t('เริ่มชิ้นงานใหม่', 'Start a new piece')}</h3>
            <p id="switch-guard-desc">
              {t('การกระทำนี้จะ', 'This will')} <strong>{t('บันทึก', 'save')}</strong>{' '}
              {t('งานนี้และเริ่มชิ้นงานใหม่', 'this work and start a new piece.')}
              <br />
              {t('การตกแต่งเดิมของคุณจะไม่ถูกนำไปใช้ในงานใหม่', 'Your artwork will not carry over to the new piece.')}
            </p>
            <div className="modal-actions">
              <button ref={initialFocus} type="button" className="v2-work-dialog-secondary" onClick={onCancel}>{t('ยกเลิก', 'Cancel')}</button>
              <button type="button" className="v2-work-dialog-primary" onClick={onConfirm}>{t('ตกลง', 'OK')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )

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
          <button ref={initialFocus} type="button" onClick={onCancel}>{t('ยกเลิก', 'Cancel')}</button>
          <button type="button" className="go" onClick={onConfirm}>{t('เริ่มชิ้นงานใหม่', 'Start new piece')}</button>
        </div>
      </div>
    </div>
  )
}
