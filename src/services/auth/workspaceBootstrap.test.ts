import { describe, expect, it, vi } from 'vitest'
import type { SessionBootstrapData } from '../../../shared/contracts/auth'
import { ApiClientError } from '../api/client'
import { WorkspaceBootstrapController, type WorkspaceSession } from './workspaceBootstrap'

const session = (userId = 'a', token = `token-${userId}`): WorkspaceSession => ({
  user: { id: userId }, access_token: token,
})
const data = (userId = 'a'): SessionBootstrapData => ({
  user: { id: `app-${userId}`, displayName: 'Tester', email: null },
  personalWorkspace: { id: `workspace-${userId}`, kind: 'personal', name: 'Personal', role: 'owner' },
})
const unauthorized = () => new ApiClientError(401, 'SESSION_INVALID', 'Session invalid')

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function fixture() {
  const bootstrap = vi.fn<(token: string, signal: AbortSignal) => Promise<SessionBootstrapData>>()
    .mockResolvedValue(data())
  const refreshSession = vi.fn<() => Promise<WorkspaceSession | null>>().mockResolvedValue(session('a', 'fresh'))
  const onSessionRefreshed = vi.fn<(value: WorkspaceSession) => void>()
  const controller = new WorkspaceBootstrapController({ bootstrap, refreshSession, onSessionRefreshed })
  return { controller, bootstrap, refreshSession, onSessionRefreshed }
}

async function settle() {
  // Drain the bounded bootstrap/refresh chain without timers or a real network.
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

describe('workspace bootstrap lifecycle', () => {
  it('does not reset the workspace for repeated SIGNED_IN events on tab focus', async () => {
    const { controller, bootstrap } = fixture()
    const listener = vi.fn()
    controller.subscribe(listener)
    controller.acceptSession(session())
    await settle()
    const ready = controller.getState()
    expect(ready.status).toBe('ready')
    listener.mockClear()

    for (let index = 0; index < 5; index += 1) controller.acceptSession(session())
    await settle()
    expect(bootstrap).toHaveBeenCalledTimes(1)
    expect(controller.getState()).toBe(ready)
    expect(listener).not.toHaveBeenCalled()
  })

  it('keeps an already ready workspace mounted when its access token rotates', async () => {
    const { controller, bootstrap } = fixture()
    controller.acceptSession(session())
    await settle()
    const ready = controller.getState()
    controller.acceptSession(session('a', 'rotated-token'))
    await settle()
    expect(controller.getState()).toBe(ready)
    expect(bootstrap).toHaveBeenCalledTimes(1)
  })

  it('deduplicates identical notifications while the first bootstrap is pending', async () => {
    const { controller, bootstrap } = fixture()
    const pending = deferred<SessionBootstrapData>()
    bootstrap.mockReturnValue(pending.promise)
    controller.acceptSession(session())
    controller.acceptSession(session())
    expect(bootstrap).toHaveBeenCalledTimes(1)
    expect(bootstrap.mock.calls[0][1].aborted).toBe(false)
    pending.resolve(data())
    await settle()
    expect(controller.getState().status).toBe('ready')
  })

  it('restarts an unfinished bootstrap with a newer token and ignores its stale result', async () => {
    const { controller, bootstrap } = fixture()
    const old = deferred<SessionBootstrapData>()
    bootstrap.mockReturnValueOnce(old.promise)
    controller.acceptSession(session())
    controller.acceptSession(session('a', 'fresh'))
    expect(bootstrap.mock.calls[0][1].aborted).toBe(true)
    expect(bootstrap.mock.calls[1][0]).toBe('fresh')
    await settle()
    const ready = controller.getState()
    old.resolve(data('obsolete'))
    await settle()
    expect(controller.getState()).toBe(ready)
  })

  it('clears a signed-out/expired session and bootstraps even the same account on re-login', async () => {
    const { controller, bootstrap } = fixture()
    controller.acceptSession(session())
    await settle()
    controller.acceptSession(null)
    expect(controller.getState()).toEqual({ status: 'idle' })
    controller.acceptSession(session())
    expect(controller.getState().status).toBe('loading')
    await settle()
    expect(bootstrap).toHaveBeenCalledTimes(2)
  })

  it('immediately removes account A readiness when account B signs in', async () => {
    const { controller, bootstrap } = fixture()
    controller.acceptSession(session())
    await settle()
    bootstrap.mockResolvedValueOnce(data('b'))
    controller.acceptSession(session('b'))
    expect(controller.getState()).toEqual({ status: 'loading', identityUserId: 'b' })
    await settle()
    expect(controller.getState()).toEqual({ status: 'ready', identityUserId: 'b', data: data('b') })
  })

  it('never restores account A from a late response after an account switch', async () => {
    const { controller, bootstrap } = fixture()
    const old = deferred<SessionBootstrapData>()
    bootstrap.mockReturnValueOnce(old.promise).mockResolvedValueOnce(data('b'))
    controller.acceptSession(session())
    controller.acceptSession(session('b'))
    await settle()
    old.resolve(data())
    await settle()
    expect(controller.getState()).toEqual({ status: 'ready', identityUserId: 'b', data: data('b') })
  })

  it('ignores late failures after sign-out', async () => {
    const { controller, bootstrap, refreshSession } = fixture()
    const old = deferred<SessionBootstrapData>()
    bootstrap.mockReturnValue(old.promise)
    controller.acceptSession(session())
    controller.acceptSession(null)
    old.reject(unauthorized())
    await settle()
    expect(controller.getState()).toEqual({ status: 'idle' })
    expect(refreshSession).not.toHaveBeenCalled()
  })

  it('refreshes once on a bootstrap 401 and deduplicates the refreshed Auth event', async () => {
    const { controller, bootstrap, refreshSession, onSessionRefreshed } = fixture()
    bootstrap.mockRejectedValueOnce(unauthorized()).mockResolvedValueOnce(data())
    onSessionRefreshed.mockImplementation(value => controller.acceptSession(value))
    controller.acceptSession(session())
    await settle()
    expect(refreshSession).toHaveBeenCalledTimes(1)
    expect(bootstrap.mock.calls.map(call => call[0])).toEqual(['token-a', 'fresh'])
    expect(controller.getState().status).toBe('ready')
  })

  it('stops after one refresh retry instead of looping on an invalid session', async () => {
    const { controller, bootstrap, refreshSession } = fixture()
    bootstrap.mockRejectedValue(unauthorized())
    controller.acceptSession(session())
    await settle()
    expect(bootstrap).toHaveBeenCalledTimes(2)
    expect(refreshSession).toHaveBeenCalledTimes(1)
    expect(controller.getState()).toMatchObject({ status: 'error', identityUserId: 'a' })
  })

  it('does not refresh credentials for ordinary server/network failures', async () => {
    const { controller, bootstrap, refreshSession } = fixture()
    bootstrap.mockRejectedValueOnce(new Error('Server unavailable'))
    controller.acceptSession(session())
    await settle()
    expect(refreshSession).not.toHaveBeenCalled()
    expect(controller.getState()).toMatchObject({ status: 'error', message: 'Server unavailable' })
  })

  it('does not resurrect a session if sign-out happens while refresh is in flight', async () => {
    const { controller, bootstrap, refreshSession, onSessionRefreshed } = fixture()
    const refresh = deferred<WorkspaceSession | null>()
    bootstrap.mockRejectedValueOnce(unauthorized())
    refreshSession.mockReturnValueOnce(refresh.promise)
    controller.acceptSession(session())
    await settle()
    controller.acceptSession(null)
    refresh.resolve(session('a', 'fresh'))
    await settle()
    expect(controller.getState()).toEqual({ status: 'idle' })
    expect(onSessionRefreshed).not.toHaveBeenCalled()
    expect(bootstrap).toHaveBeenCalledTimes(1)
  })

  it('bootstraps the new identity when a refresh returns another account', async () => {
    const { controller, bootstrap, refreshSession, onSessionRefreshed } = fixture()
    bootstrap.mockRejectedValueOnce(unauthorized()).mockResolvedValueOnce(data('b'))
    refreshSession.mockResolvedValueOnce(session('b'))
    onSessionRefreshed.mockImplementation(value => controller.acceptSession(value))
    controller.acceptSession(session())
    await settle()
    expect(controller.getState()).toEqual({ status: 'ready', identityUserId: 'b', data: data('b') })
    expect(bootstrap.mock.calls.map(call => call[0])).toEqual(['token-a', 'token-b'])
  })

  it('can restart after effect cleanup without being stuck in loading (StrictMode)', async () => {
    const { controller, bootstrap } = fixture()
    const old = deferred<SessionBootstrapData>()
    bootstrap.mockReturnValueOnce(old.promise)
    controller.acceptSession(session())
    controller.cancel()
    controller.acceptSession(session())
    await settle()
    expect(bootstrap).toHaveBeenCalledTimes(2)
    expect(controller.getState().status).toBe('ready')
    expect(bootstrap.mock.calls[0][1].aborted).toBe(true)
  })

  it('reports failed refresh without leaving an unhandled rejection', async () => {
    const { controller, bootstrap, refreshSession } = fixture()
    bootstrap.mockRejectedValueOnce(unauthorized())
    refreshSession.mockRejectedValueOnce(new Error('Refresh failed'))
    controller.acceptSession(session())
    await settle()
    expect(controller.getState()).toMatchObject({ status: 'error', message: 'Refresh failed' })
  })
})
