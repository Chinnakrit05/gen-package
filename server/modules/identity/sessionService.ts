import type { MeData, SessionBootstrapData } from '../../../shared/contracts/auth'
import type { Actor } from './actor'

export interface ActorAuthenticationOptions {
  verifyMfa: boolean
  includeVerifiedEmail?: boolean
}

export interface SessionService {
  bootstrap(accessToken: string, requestId: string): Promise<SessionBootstrapData>
  authenticate(accessToken: string, requestId: string, options?: ActorAuthenticationOptions): Promise<Actor>
  getMe(actor: Actor): Promise<MeData>
}
