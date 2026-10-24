import type {
  CloudProject,
  CreateProjectInput,
  DeleteProjectInput,
  DeleteReceipt,
  LegacyImportInput,
  LegacyImportReceipt,
  ProjectPage,
  ProjectThumbnailImage,
  ProjectThumbnailMeta,
  ProjectThumbnailReceipt,
  PutProjectThumbnailInput,
  SaveProjectInput,
  SaveReceipt,
} from '../../../shared/contracts/projects'
import type { Actor } from '../identity/actor'

export interface ProjectListQuery {
  workspaceId: string
  cursor: { updatedAt: string; id: string } | null
  limit: number
}

export interface ProjectRepository {
  list(actor: Actor, query: ProjectListQuery): Promise<ProjectPage>
  get(actor: Actor, projectId: string): Promise<CloudProject>
  create(actor: Actor, input: CreateProjectInput, hash: string): Promise<CloudProject>
  importLegacy(actor: Actor, input: LegacyImportInput, hash: string): Promise<LegacyImportReceipt>
  save(actor: Actor, input: SaveProjectInput, hash: string): Promise<SaveReceipt>
  remove(actor: Actor, input: DeleteProjectInput, hash: string): Promise<DeleteReceipt>
  // ภาพย่อ 3D (แกลเลอรี) — meta ต่อ id ของหน้ารายการ; ตัวรูปทีละชุด
  putThumbnail(actor: Actor, projectId: string, input: PutProjectThumbnailInput): Promise<ProjectThumbnailReceipt>
  thumbnailMeta(actor: Actor, workspaceId: string, projectIds: string[]): Promise<Map<string, ProjectThumbnailMeta>>
  thumbnails(actor: Actor, workspaceId: string, projectIds: string[]): Promise<ProjectThumbnailImage[]>
}
