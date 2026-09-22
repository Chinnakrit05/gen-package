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
  pouchStyle?: string
  zipper?: boolean
  pouchAddons?: Record<string, boolean>
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
