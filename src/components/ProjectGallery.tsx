import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, LayoutGrid, Package, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import type { Project } from '../core/project'
import type { ProjectSummary } from '../../shared/contracts/projects'
import { getMaterial, packKind } from '../core/materials'
import { TEMPLATES } from '../core/templates'
import { IconBottle, IconBox, IconCard, IconPouch } from './icons'

type ProjectItem = Project | ProjectSummary

export interface GalleryItem {
  id: string
  name: string
  updatedAt: number
  detail?: Project
}

const PAGE_SIZE = 48

const timestamp = (item: ProjectItem) =>
  typeof item.updatedAt === 'number'
    ? Number.isFinite(item.updatedAt) ? item.updatedAt : 0
    : Date.parse(item.updatedAt) || 0

export function galleryItems(items: readonly ProjectItem[], activeId: string, activeProject?: Project): GalleryItem[] {
  return items.map((item) => ({
    id: item.id,
    name: item.id === activeId && activeProject ? activeProject.name : item.name,
    updatedAt: item.id === activeId && activeProject
      ? Math.max(timestamp(item), activeProject.updatedAt)
      : timestamp(item),
    detail: 'live' in item ? item : item.id === activeId ? activeProject : undefined,
  })).sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name, 'th'))
}

export function filterGalleryItems(items: readonly GalleryItem[], query: string): GalleryItem[] {
  const needle = query.trim().toLocaleLowerCase('th')
  return needle ? items.filter((item) => item.name.toLocaleLowerCase('th').includes(needle)) : [...items]
}

interface ProjectGalleryProps {
  items: readonly ProjectItem[]
  activeId: string
  activeProject?: Project
  busy: boolean
  createDisabled: boolean
  deleteDisabled: boolean
  onCreate: () => void
  onSwitch: (id: string) => void
  onRename: () => void
  onDelete: (id: string) => void
}

function projectKind(project?: Project): 'box' | 'vessel' | 'pouch' | 'card' | 'unknown' {
  if (!project) return 'unknown'
  if (project.live.template === 'card') return 'card'
  return packKind(getMaterial(project.live.materialId))
}

export function projectTypeLabel(project: Project): string {
  const kind = projectKind(project)
  if (kind === 'card') return 'นามบัตร'
  if (kind === 'vessel' || kind === 'pouch') return getMaterial(project.live.materialId).nameTh
  return TEMPLATES.find((template) => template.id === project.live.template)?.nameTh ?? 'กล่องพับ'
}

function ProjectThumb({ project }: { project?: Project }) {
  const kind = projectKind(project)
  const color = project?.fillColor ?? (project ? getMaterial(project.live.materialId).color : undefined)
  const style = color ? { '--project-thumb-color': color } as CSSProperties : undefined
  const Icon = kind === 'vessel' ? IconBottle : kind === 'pouch' ? IconPouch : kind === 'card' ? IconCard : kind === 'box' ? IconBox : Package
  return (
    <div className={`project-gallery-thumb ${kind}`} style={style}>
      {project?.fillImage?.src && <img src={project.fillImage.src} alt="" loading="lazy" />}
      <span className="project-gallery-thumb-icon"><Icon size={48} /></span>
    </div>
  )
}

export function ProjectGallery({
  items, activeId, activeProject, busy, createDisabled, deleteDisabled,
  onCreate, onSwitch, onRename, onDelete,
}: ProjectGalleryProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [panelTop, setPanelTop] = useState(80)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const allItems = useMemo(() => galleryItems(items, activeId, activeProject), [items, activeId, activeProject])
  const current = allItems.find((item) => item.id === activeId)
  const filtered = useMemo(() => filterGalleryItems(allItems, query), [allItems, query])
  const galleryWidth = Math.max(360, Math.min(4, allItems.length) * 264 + 44)

  const close = () => {
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  const position = () => {
    const bottom = triggerRef.current?.closest('header')?.getBoundingClientRect().bottom ?? 72
    setPanelTop(Math.min(bottom + 8, Math.max(90, window.innerHeight * 0.24)))
  }

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    requestAnimationFrame(() => inputRef.current?.focus())
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
    }
  }, [open])

  const trapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')
    if (!focusable?.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <nav className="projects" aria-label="งานที่บันทึกไว้">
      <button
        ref={triggerRef}
        className="project-gallery-trigger"
        aria-label={`เลือกงาน ปัจจุบัน ${current?.name ?? 'งาน'} มีทั้งหมด ${allItems.length} งาน`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="เลือกงาน"
        onClick={() => {
          if (open) close()
          else {
            position()
            setQuery('')
            setVisibleCount(PAGE_SIZE)
            setOpen(true)
          }
        }}
      >
        <span className="project-gallery-trigger-icon"><LayoutGrid size={18} aria-hidden="true" /></span>
        <span className="project-gallery-trigger-copy">
          <strong>{current?.name ?? 'งาน'}</strong>
        </span>
        <span className="project-gallery-count">{allItems.length} งาน</span>
        <ChevronDown className="project-gallery-chevron" size={17} aria-hidden="true" />
      </button>
      <button className="proj-new" disabled={createDisabled} onClick={onCreate} title="สร้างงานใหม่">
        <Plus size={17} aria-hidden="true" /><span>สร้างงาน</span>
      </button>
      {open && createPortal(
        <div className="project-gallery-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) close()
        }}>
          <div
            ref={panelRef}
            className="project-gallery-panel"
            data-single={allItems.length === 1 || undefined}
            role="dialog"
            aria-modal="true"
            aria-label="งานทั้งหมด"
            style={{ top: panelTop, maxHeight: `calc(100dvh - ${panelTop + 12}px)`, width: `min(${galleryWidth}px, calc(100vw - 24px))` }}
            onKeyDown={trapFocus}
          >
            <div className="project-gallery-toolbar">
              <div className="project-gallery-heading">
                <div><strong>งานทั้งหมด</strong><span>{allItems.length} งาน</span></div>
                <button className="project-gallery-close" title="ปิดรายการงาน" aria-label="ปิดรายการงาน" onClick={close}><X size={18} /></button>
              </div>
              <div className="project-gallery-controls">
                <label className="project-gallery-search">
                  <Search size={17} aria-hidden="true" />
                  <input
                    ref={inputRef}
                    type="search"
                    placeholder="ค้นหาชื่องาน"
                    aria-label="ค้นหาชื่องาน"
                    value={query}
                    onChange={(event) => { setQuery(event.target.value); setVisibleCount(PAGE_SIZE) }}
                  />
                </label>
                <button className="project-gallery-create" disabled={createDisabled} onClick={() => { close(); onCreate() }}>
                  <Plus size={16} aria-hidden="true" /> งานใหม่
                </button>
              </div>
            </div>
            <div className="project-gallery-results" aria-live="polite">
              <span>{query ? `พบ ${filtered.length} งาน` : 'แก้ไขล่าสุด'}</span>
            </div>
            {filtered.length ? (
              <div className="project-gallery-grid">
                {filtered.slice(0, visibleCount).map((item) => {
                  const active = item.id === activeId
                  const typeLabel = item.detail ? projectTypeLabel(item.detail) : undefined
                  return (
                    <article key={item.id} className={`project-gallery-card${active ? ' active' : ''}`}>
                      <button
                        className="project-gallery-open"
                        aria-current={active ? 'true' : undefined}
                        aria-label={`${active ? 'งานปัจจุบัน ' : 'เปิดงาน '}${item.name}`}
                        disabled={busy}
                        onClick={() => { close(); onSwitch(item.id) }}
                      >
                        <ProjectThumb project={item.detail} />
                        {active && <span className="project-gallery-active-tag" aria-hidden="true">เปิดอยู่</span>}
                        <span className="project-gallery-card-body">
                          <span className="project-gallery-card-name">{item.name}</span>
                          <span className="project-gallery-card-meta">{typeLabel ?? 'โปรเจกต์'}</span>
                        </span>
                      </button>
                      <div className="project-gallery-card-actions">
                        <time dateTime={new Date(item.updatedAt).toISOString()}>{new Date(item.updatedAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}</time>
                        {active && <button title="ตั้งชื่องาน" aria-label={`ตั้งชื่องาน ${item.name}`} disabled={busy} onClick={() => { close(); onRename() }}><Pencil size={16} /></button>}
                        <button title="ลบงาน" aria-label={`ลบงาน ${item.name}`} disabled={deleteDisabled} onClick={() => { close(); onDelete(item.id) }}><Trash2 size={16} /></button>
                      </div>
                    </article>
                  )
                })}
              </div>
            ) : <p className="project-gallery-empty">ไม่พบงานที่ตรงกับคำค้นหา</p>}
            {filtered.length > visibleCount && (
              <button className="project-gallery-more" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
                แสดงเพิ่ม ({filtered.length - visibleCount} งาน)
              </button>
            )}
          </div>
        </div>, document.body,
      )}
    </nav>
  )
}
