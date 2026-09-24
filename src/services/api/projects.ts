import type {
  CloudProject,
  CreateProjectInput,
  DeleteReceipt,
  LegacyImportInput,
  LegacyImportReceipt,
  ProjectPage,
  SaveProjectInput,
  SaveReceipt,
} from '../../../shared/contracts/projects'
import { requestApi } from './client'

export function listProjects(
  apiBaseUrl: string,
  accessToken: string,
  query: { workspaceId: string; cursor?: string; limit?: number },
  signal?: AbortSignal,
): Promise<ProjectPage> {
  const search = new URLSearchParams({ workspaceId: query.workspaceId })
  if (query.cursor) search.set('cursor', query.cursor)
  if (query.limit !== undefined) search.set('limit', String(query.limit))
  return requestApi<ProjectPage>(`${apiBaseUrl}/projects?${search}`, accessToken, { method: 'GET', signal })
}

export function getProject(
  apiBaseUrl: string,
  accessToken: string,
  projectId: string,
  signal?: AbortSignal,
): Promise<CloudProject> {
  return requestApi<CloudProject>(
    `${apiBaseUrl}/projects/${encodeURIComponent(projectId)}`,
    accessToken,
    { method: 'GET', signal },
  )
}

export function createProject(
  apiBaseUrl: string,
  accessToken: string,
  input: CreateProjectInput,
  signal?: AbortSignal,
): Promise<CloudProject> {
  return requestApi<CloudProject>(`${apiBaseUrl}/projects`, accessToken, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
}

export function importLegacyProject(
  apiBaseUrl: string,
  accessToken: string,
  input: LegacyImportInput,
  signal?: AbortSignal,
): Promise<LegacyImportReceipt> {
  return requestApi<LegacyImportReceipt>(`${apiBaseUrl}/projects/import-legacy`, accessToken, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
}

export function saveProject(
  apiBaseUrl: string,
  accessToken: string,
  input: SaveProjectInput,
  signal?: AbortSignal,
): Promise<SaveReceipt> {
  const { projectId, ...body } = input
  return requestApi<SaveReceipt>(
    `${apiBaseUrl}/projects/${encodeURIComponent(projectId)}`,
    accessToken,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    },
  )
}

export function deleteProject(
  apiBaseUrl: string,
  accessToken: string,
  input: { projectId: string; operationId: string; expectedRevision: number },
  signal?: AbortSignal,
): Promise<DeleteReceipt> {
  return requestApi<DeleteReceipt>(
    `${apiBaseUrl}/projects/${encodeURIComponent(input.projectId)}`,
    accessToken,
    {
      method: 'DELETE',
      headers: {
        'x-expected-revision': String(input.expectedRevision),
        'idempotency-key': input.operationId,
      },
      signal,
    },
  )
}
