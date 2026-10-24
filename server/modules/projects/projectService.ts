import type {
  CloudProject,
  CreateProjectInput,
  DeleteProjectInput,
  DeleteReceipt,
  LegacyImportInput,
  LegacyImportReceipt,
  ProjectPage,
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

  list(actor: Actor, query: ProjectListQuery): Promise<ProjectPage> {
    return this.repository.list(actor, query)
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
