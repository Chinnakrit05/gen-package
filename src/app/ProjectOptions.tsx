import { useEffect, useId, useRef, useState } from 'react'
import { Ellipsis, Trash2 } from 'lucide-react'
import './ProjectOptions.css'

interface ProjectOptionsProps {
  name: string
  disabled?: boolean
  disabledReason?: string
  onDelete(): void
}

export function ProjectOptions({ name, disabled, disabledReason, onDelete }: ProjectOptionsProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const popover = useRef<HTMLDivElement>(null)
  const deleteButton = useRef<HTMLButtonElement>(null)
  const optionsId = useId()

  useEffect(() => {
    if (!open) return
    deleteButton.current?.focus({ preventScroll: true })
    popover.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    function closeOnOutsidePress(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePress)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePress)
  }, [open])

  function closeAndRefocus() {
    trigger.current?.focus()
    setOpen(false)
  }

  return (
    <div
      ref={root}
      className="project-options"
      data-open={open || undefined}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
      onKeyDown={(event) => {
        if (!open || event.key !== 'Escape') return
        event.stopPropagation()
        closeAndRefocus()
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="project-options-trigger"
        aria-label={`ตัวเลือกงาน ${name}`}
        aria-expanded={open}
        aria-controls={open ? optionsId : undefined}
        onClick={() => setOpen(!open)}
      >
        <Ellipsis size={18} aria-hidden="true" />
      </button>
      {open && (
        <div ref={popover} className="project-options-popover" id={optionsId}>
          <button
            ref={deleteButton}
            type="button"
            aria-disabled={disabled || undefined}
            aria-describedby={disabled && disabledReason ? `${optionsId}-reason` : undefined}
            onClick={() => {
              if (disabled) return
              closeAndRefocus()
              onDelete()
            }}
          >
            <Trash2 size={16} aria-hidden="true" /> ลบงาน
          </button>
          {disabled && disabledReason && <p id={`${optionsId}-reason`}>{disabledReason}</p>}
        </div>
      )}
    </div>
  )
}
