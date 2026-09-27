import { describe, expect, it } from 'vitest'
import type { ProjectSummary } from '../../shared/contracts/projects'
import { freshProject } from '../core/project'
import { filterGalleryItems, galleryItems, projectTypeLabel } from './ProjectGallery'

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
