import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ProjectSummary } from '../../shared/contracts/projects'
import { freshProject } from '../core/project'
import { LangCtx } from '../i18n'
import { ProjectGallery, filterGalleryItems, galleryItems, projectTypeLabel } from './ProjectGallery'

describe('project gallery list', () => {
  it('orders local projects by recent edit without changing the source list', () => {
    const older = { ...freshProject(1), id: 'older', name: 'กล่องชา', updatedAt: 100 }
    const newer = { ...freshProject(2), id: 'newer', name: 'กล่องสบู่', updatedAt: 300 }
    const source = [older, newer]

    const result = galleryItems(source, older.id, older)

    expect(result.map((item) => item.id)).toEqual(['newer', 'older'])
    expect(result[0].detail).toBe(newer)
    expect(source.map((item) => item.id)).toEqual(['older', 'newer'])
  })

  it('shows the current cloud draft name while keeping other summaries lightweight', () => {
    const current = { ...freshProject(1), id: 'current', name: 'ชื่อใหม่', updatedAt: 300 }
    const summaries: ProjectSummary[] = [
      { id: 'current', workspaceId: 'space', name: 'ชื่อเก่า', revision: 1, updatedAt: new Date(100).toISOString() },
      { id: 'other', workspaceId: 'space', name: 'งานอื่น', revision: 1, updatedAt: new Date(200).toISOString() },
    ]

    const result = galleryItems(summaries, current.id, current)

    expect(result[0]).toMatchObject({ id: 'current', name: 'ชื่อใหม่', updatedAt: 300, detail: current })
    expect(result[1].detail).toBeUndefined()
  })

  it('filters Thai and Latin project names without requiring horizontal browsing', () => {
    const items = galleryItems([
      { ...freshProject(1), id: 'a', name: 'กล่องชา Matcha', updatedAt: 1 },
      { ...freshProject(2), id: 'b', name: 'ฉลากน้ำผึ้ง', updatedAt: 2 },
    ], 'a')

    expect(filterGalleryItems(items, ' MATCHA ').map((item) => item.id)).toEqual(['a'])
    expect(filterGalleryItems(items, 'น้ำผึ้ง').map((item) => item.id)).toEqual(['b'])
    expect(filterGalleryItems(items, '')).toHaveLength(2)
  })

  it('labels a vessel from its actual material rather than a stale box template', () => {
    const vessel = { ...freshProject(1), live: { ...freshProject(1).live, materialId: 'pet-bottle' } }
    expect(projectTypeLabel(vessel)).toBe('ขวด PET')
  })
})

describe('project gallery licensed tag', () => {
  const project = { ...freshProject(1), id: 'paid', name: 'กล่องชา', updatedAt: 100 }
  const element = (licensedIds?: ReadonlySet<string>) => createElement(ProjectGallery, {
    items: [project],
    activeId: project.id,
    activeProject: project,
    busy: false,
    createDisabled: false,
    deleteDisabled: false,
    onCreate: vi.fn(),
    onSwitch: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    licensedIds,
  })
  const render = (licensedIds?: ReadonlySet<string>) => renderToStaticMarkup(element(licensedIds))

  it('marks the current project as purchased only when its id is licensed', () => {
    expect(render(new Set(['paid']))).toContain('ซื้อแล้ว')
    expect(render(new Set(['paid']))).toContain('title="ซื้อแล้ว — ดาวน์โหลดไฟล์ผลิตได้"')
    expect(render(new Set(['other']))).not.toContain('ซื้อแล้ว')
    expect(render()).not.toContain('ซื้อแล้ว')
  })

  it('translates the purchased tag and its title with the app language', () => {
    const html = renderToStaticMarkup(createElement(LangCtx.Provider, { value: 'en' }, element(new Set(['paid']))))
    expect(html).toContain('>Purchased</span>')
    expect(html).toContain('title="Purchased — production files can be downloaded"')
    expect(html).not.toContain('ซื้อแล้ว')
  })
})
