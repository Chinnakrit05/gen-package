import type {
  CloudProject,
  CreateProjectInput,
  DeleteProjectInput,
  DeleteReceipt,
  ProjectPage,
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
  save(actor: Actor, input: SaveProjectInput, hash: string): Promise<SaveReceipt>
  remove(actor: Actor, input: DeleteProjectInput, hash: string): Promise<DeleteReceipt>
}
