export interface AppUserSummary {
  id: string
  displayName: string
  email: string | null
}

export interface WorkspaceSummary {
  id: string
  kind: 'personal' | 'team'
  name: string
  role: 'owner' | 'editor' | 'viewer'
}

export interface SessionBootstrapData {
  user: AppUserSummary
  personalWorkspace: WorkspaceSummary
}

export interface MeData {
  user: AppUserSummary
  workspaces: WorkspaceSummary[]
}
