import type { SessionBootstrapData } from '../../../shared/contracts/auth'

export interface SessionService {
  bootstrap(accessToken: string, requestId: string): Promise<SessionBootstrapData>
}
