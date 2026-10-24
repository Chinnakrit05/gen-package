import type { ReadyAssetMetadata } from './assets'

export interface CloudProjectDocumentV1 {
  live: {
    template: string
    materialId: string
    W: number
    D: number
    H: number
    handle: boolean
  }
  qty: number
  fillColor: string | null
  fillImage?: Record<string, unknown> | null
  labelStyle?: string
  neckH?: number
  shoulderH?: number
  rectDepth?: number
  shoulderStyle?: string
  labelBox?: Record<string, number>
  capStyle?: string
  capColor?: string
  pouchStyle?: string
  zipper?: boolean
  pouchAddons?: Record<string, boolean | number | string>
  stickerCut?: Record<string, unknown>
  decos: Record<string, unknown>[]
  history: Record<string, unknown>[]
  histIdx: number
}

export interface CloudProject {
  id: string
  workspaceId: string
  name: string
  documentSchemaVersion: 1
  document: CloudProjectDocumentV1
  revision: number
  createdAt: string
  updatedAt: string
  assets: ReadyAssetMetadata[]
}

export interface ProjectSummary {
  id: string
  workspaceId: string
  name: string
  revision: number
  updatedAt: string
  // ภาพย่อ 3D ล่าสุดของงาน (ไม่มี = ยังไม่เคยถ่าย) — ตัวรูปขอแยกผ่าน POST /projects/thumbnails ตาม version
  thumbnail?: ProjectThumbnailMeta | null
}

// ภาพย่อ 3D ในแกลเลอรีงาน — ชนิดงาน/ชื่อชนิดมากับภาพย่อ เพราะรายการงานบน cloud ไม่มีเนื้องาน
export const THUMBNAIL_KINDS = ['box', 'vessel', 'pouch', 'card'] as const
export type ThumbnailKind = (typeof THUMBNAIL_KINDS)[number]
export const THUMBNAIL_MIME_TYPES = ['image/webp', 'image/jpeg'] as const
export type ThumbnailMime = (typeof THUMBNAIL_MIME_TYPES)[number]
export const THUMBNAIL_MAX_BYTES = 65536
export const THUMBNAIL_BATCH_MAX = 24

export interface ProjectThumbnailMeta {
  version: string
  kind: ThumbnailKind
  label: string
}

export interface PutProjectThumbnailInput {
  mimeType: ThumbnailMime
  imageBase64: string
  kind: ThumbnailKind
  label: string
}

export interface ProjectThumbnailReceipt {
  projectId: string
  version: string
}

export interface ProjectThumbnailImage {
  projectId: string
  version: string
  mimeType: ThumbnailMime
  imageBase64: string
}

export interface ProjectCursor {
  updatedAt: string
  id: string
}

export interface ProjectPage {
  items: ProjectSummary[]
  nextCursor: string | null
}

export interface CreateProjectInput {
  workspaceId: string
  operationId: string
  name: string
  documentSchemaVersion: 1
  document: CloudProjectDocumentV1
}

export interface SaveProjectInput {
  projectId: string
  operationId: string
  expectedRevision: number
  name: string
  documentSchemaVersion: 1
  document: CloudProjectDocumentV1
}

export interface SaveReceipt {
  projectId: string
  revision: number
  updatedAt: string
  operationId: string
}

export interface DeleteProjectInput {
  projectId: string
  operationId: string
  expectedRevision: number
}

export interface DeleteReceipt {
  projectId: string
  revision: number
  deletedAt: string
  operationId: string
}

export interface LegacyImportInput {
  workspaceId: string
  operationId: string
  sourceInstallationId: string
  sourceProjectKey: string
  sourceHash: string
  name: string
  documentSchemaVersion: 1
  document: CloudProjectDocumentV1
}

export interface LegacyImportReceipt {
  sourceInstallationId: string
  sourceProjectKey: string
  sourceHash: string
  project: CloudProject
  completedAt: string
}
