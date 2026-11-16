import { useId, useLayoutEffect, useRef } from 'react'
import { deleteProjectConfirmText, type DesignLicenseKnowledge } from '../core/designLicense'
import './ProjectDeleteDialog.css'

interface ProjectDeleteDialogProps {
  name: string
  license: DesignLicenseKnowledge
  disabled?: boolean
  onCancel(): void
  onConfirm(): void
}

const thai = (text: string) => text

export function ProjectDeleteDialog({ name, license, disabled, onCancel, onConfirm }: ProjectDeleteDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const headingId = useId()
  const descriptionId = useId()
  const warningId = useId()
  const question = deleteProjectConfirmText(name, 'none', thai)
  const warning = deleteProjectConfirmText(name, license, thai).slice(question.length).trim()

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const previousFocus = document.activeElement
    dialog.showModal()
    cancelRef.current?.focus()
    return () => {
      dialog.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="project-delete-dialog"
      aria-labelledby={headingId}
      aria-describedby={warning ? `${descriptionId} ${warningId}` : descriptionId}
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
    >
      <h2 id={headingId}>ยืนยันการลบงาน</h2>
      <p id={descriptionId}>{question}</p>
      {warning && <p id={warningId} className="project-delete-warning">{warning}</p>}
      <div className="project-delete-actions">
        <button ref={cancelRef} type="button" onClick={onCancel}>ยกเลิก</button>
        <button type="button" className="project-delete-confirm" disabled={disabled} onClick={onConfirm}>ยืนยันลบ</button>
      </div>
    </dialog>
  )
}
