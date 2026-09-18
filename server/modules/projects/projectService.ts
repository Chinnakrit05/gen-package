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
import { requestHash } from './canonical'
import type { ProjectListQuery, ProjectRepository } from './projectRepository'

export class ProjectService {
  constructor(private readonly repository: ProjectRepository) {}

  list(actor: Actor, query: ProjectListQuery): Promise<ProjectPage> {
    return this.repository.list(actor, query)
  }

  get(actor: Actor, projectId: string): Promise<CloudProject> {
    return this.repository.get(actor, projectId)
  }

  create(actor: Actor, input: CreateProjectInput): Promise<CloudProject> {
    const hash = requestHash({ operationType: 'create', ...input })
    return this.repository.create(actor, input, hash)
  }

  save(actor: Actor, input: SaveProjectInput): Promise<SaveReceipt> {
    const hash = requestHash({ operationType: 'save', ...input })
    return this.repository.save(actor, input, hash)
  }

  remove(actor: Actor, input: DeleteProjectInput): Promise<DeleteReceipt> {
    const hash = requestHash({ operationType: 'delete', ...input })
    return this.repository.remove(actor, input, hash)
  }
}
