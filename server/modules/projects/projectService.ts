import type {
  CloudProject,
  CreateProjectInput,
  DeleteProjectInput,
  DeleteReceipt,
  LegacyImportInput,
  LegacyImportReceipt,
  ProjectPage,
  ProjectThumbnailImage,
  ProjectThumbnailReceipt,
  PutProjectThumbnailInput,
  SaveProjectInput,
  SaveReceipt,
} from '../../../shared/contracts/projects'
import type { StorageQuota } from '../billing/storageQuota'
import type { Actor } from '../identity/actor'
import { requestHash } from './canonical'
import type { ProjectListQuery, ProjectRepository } from './projectRepository'

export class ProjectService {
  // quota = โควตาพื้นที่เก็บงาน ตรวจก่อนเขียนงานทุกทาง (null = ยังไม่เปิดใช้ — isStorageQuotaEnabled ใน server/http/router.ts)
  constructor(
    private readonly repository: ProjectRepository,
    private readonly quota: StorageQuota | null = null,
  ) {}

  // หน้ารายการ + meta ภาพย่อของหน้านั้น — อ่าน meta ไม่ได้ (เช่นฐานข้อมูลยังไม่ migrate) ไม่ทำให้รายการล้ม
  async list(actor: Actor, query: ProjectListQuery): Promise<ProjectPage> {
    const page = await this.repository.list(actor, query)
    if (!page.items.length) return page
    let meta: Awaited<ReturnType<ProjectRepository['thumbnailMeta']>>
    try {
      meta = await this.repository.thumbnailMeta(actor, query.workspaceId, page.items.map((item) => item.id))
    } catch {
      return page
    }
    return {
      ...page,
      items: page.items.map((item) => (meta.has(item.id) ? { ...item, thumbnail: meta.get(item.id)! } : item)),
    }
  }

  putThumbnail(actor: Actor, projectId: string, input: PutProjectThumbnailInput): Promise<ProjectThumbnailReceipt> {
    return this.repository.putThumbnail(actor, projectId, input)
  }

  thumbnails(actor: Actor, workspaceId: string, projectIds: string[]): Promise<ProjectThumbnailImage[]> {
    return this.repository.thumbnails(actor, workspaceId, projectIds)
  }

  get(actor: Actor, projectId: string): Promise<CloudProject> {
    return this.repository.get(actor, projectId)
  }

  async create(actor: Actor, input: CreateProjectInput): Promise<CloudProject> {
    await this.quota?.assert(actor, {
      workspaceId: input.workspaceId,
      projectId: null,
      operationId: input.operationId,
      document: input.document,
      extraBytes: 0,
    })
    const hash = requestHash({ operationType: 'create', ...input })
    return this.repository.create(actor, input, hash)
  }

  async importLegacy(actor: Actor, input: LegacyImportInput): Promise<LegacyImportReceipt> {
    await this.quota?.assert(actor, {
      workspaceId: input.workspaceId,
      projectId: null,
      operationId: input.operationId,
      document: input.document,
      extraBytes: 0,
    })
    const hash = requestHash({ operationType: 'legacy-import', ...input })
    return this.repository.importLegacy(actor, input, hash)
  }

  async save(actor: Actor, input: SaveProjectInput): Promise<SaveReceipt> {
    await this.quota?.assert(actor, {
      workspaceId: null,
      projectId: input.projectId,
      operationId: input.operationId,
      document: input.document,
      extraBytes: 0,
    })
    const hash = requestHash({ operationType: 'save', ...input })
    return this.repository.save(actor, input, hash)
  }

  remove(actor: Actor, input: DeleteProjectInput): Promise<DeleteReceipt> {
    const hash = requestHash({ operationType: 'delete', ...input })
    return this.repository.remove(actor, input, hash)
  }
}
