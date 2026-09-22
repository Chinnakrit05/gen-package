import type { MeData, SessionBootstrapData } from '../../../shared/contracts/auth'
import type { Actor } from './actor'

export interface SessionService {
  bootstrap(accessToken: string, requestId: string): Promise<SessionBootstrapData>
  authenticate(accessToken: string, requestId: string): Promise<Actor>
  getMe(actor: Actor): Promise<MeData>
}
