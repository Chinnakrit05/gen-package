import type { SessionBootstrapData } from '../../../shared/contracts/auth'
import { ApiClientError } from '../api/client'

export interface WorkspaceSession {
  access_token: string
  user: { id: string }
}

export type WorkspaceBootstrapState =
  | { status: 'idle' }
  | { status: 'loading'; identityUserId: string }
  | { status: 'ready'; identityUserId: string; data: SessionBootstrapData }
  | { status: 'error'; identityUserId: string; message: string }

interface WorkspaceBootstrapOptions<Session extends WorkspaceSession> {
  bootstrap(accessToken: string, signal: AbortSignal): Promise<SessionBootstrapData>
  refreshSession(): Promise<Session | null>
  onSessionRefreshed(session: Session): void
}

/** Bootstrap an account once, not every time Supabase confirms its session. */
export class WorkspaceBootstrapController<Session extends WorkspaceSession> {
  private state: WorkspaceBootstrapState = { status: 'idle' }
  private session: Session | null = null
  private pending: AbortController | null = null
  private epoch = 0
  private readonly listeners = new Set<(state: WorkspaceBootstrapState) => void>()

  constructor(private readonly options: WorkspaceBootstrapOptions<Session>) {}

  getState(): WorkspaceBootstrapState {
    return this.state
  }

  subscribe(listener: (state: WorkspaceBootstrapState) => void): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => { this.listeners.delete(listener) }
  }

  acceptSession(session: Session | null | undefined): void {
    const previous = this.session
    this.session = session ?? null
    if (!session) {
      this.cancel()
      this.publish({ status: 'idle' })
      return
    }

    const sameAccount = previous?.user.id === session.user.id
    // SIGNED_IN fires again on tab focus. TOKEN_REFRESHED updates credentials,
    // but neither event should unmount an already verified account's editor.
    if (sameAccount && this.state.status === 'ready') return
    if (sameAccount && this.pending && previous.access_token === session.access_token) return

    this.cancel()
    const pending = new AbortController()
    this.pending = pending
    const epoch = this.epoch
    this.publish({ status: 'loading', identityUserId: session.user.id })
    void this.run(session, pending, epoch)
  }

  cancel(): void {
    this.epoch += 1
    this.pending?.abort()
    this.pending = null
  }

  private publish(state: WorkspaceBootstrapState): void {
    this.state = state
    for (const listener of this.listeners) listener(state)
  }

  private async run(session: Session, pending: AbortController, epoch: number): Promise<void> {
    const active = () => this.epoch === epoch && !pending.signal.aborted
    try {
      let data: SessionBootstrapData
      try {
        data = await this.options.bootstrap(session.access_token, pending.signal)
      } catch (error) {
        if (!active()) return
        if (!(error instanceof ApiClientError) || error.status !== 401) throw error

        const refreshed = await this.options.refreshSession()
        if (!active()) return
        if (!refreshed) throw new Error('ต่ออายุ session ไม่สำเร็จ กรุณาเข้าสู่ระบบใหม่')
        if (refreshed.user.id !== session.user.id) {
          this.acceptSession(refreshed)
          this.options.onSessionRefreshed(refreshed)
          return
        }
        this.session = refreshed
        this.options.onSessionRefreshed(refreshed)
        // One bounded retry. Later Auth events with this token are deduplicated.
        data = await this.options.bootstrap(refreshed.access_token, pending.signal)
      }
      if (!active()) return
      this.pending = null
      this.publish({ status: 'ready', identityUserId: session.user.id, data })
    } catch (error) {
      if (!active()) return
      this.pending = null
      this.publish({
        status: 'error',
        identityUserId: session.user.id,
        message: error instanceof Error ? error.message : 'เริ่ม session ไม่สำเร็จ',
      })
    }
  }
}
