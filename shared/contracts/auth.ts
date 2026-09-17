export interface AppUserSummary {
  id: string
  displayName: string
  email: string | null
}

export interface WorkspaceSummary {
  id: string
  kind: 'personal'
  name: string
  role: 'owner'
}

export interface SessionBootstrapData {
  user: AppUserSummary
  personalWorkspace: WorkspaceSummary
}
