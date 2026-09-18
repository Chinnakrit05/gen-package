import { useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { SessionBootstrapData } from '../shared/contracts/auth'
import { Login } from './components/Login'
import type { ClientConfig } from './config'
import { CloudWorkspace } from './features/projects/CloudWorkspace'
import { ApiClientError, bootstrapSession } from './services/api/session'
import { createBrowserSupabaseClient } from './services/auth/supabaseAuth'

type BootstrapState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; data: SessionBootstrapData }
  | { status: 'error'; message: string }

export function CloudRoot({ config }: { config: ClientConfig }) {
  if (!config.supabase) throw new Error('CloudRoot ต้องมี Supabase client config')
  const auth = useMemo(() => createBrowserSupabaseClient(config.supabase!), [config.supabase])
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [bootstrap, setBootstrap] = useState<BootstrapState>({ status: 'idle' })
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loginBusy, setLoginBusy] = useState(false)
  const sessionEpoch = useRef(0)
  const bootstrapRefreshUser = useRef<string | null>(null)

  useEffect(() => {
    let active = true
    void auth.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (error) {
        setLoginError('อ่าน session ไม่สำเร็จ กรุณาเข้าสู่ระบบใหม่')
        setSession(null)
        return
      }
      setSession(data.session)
    })
    const { data: { subscription } } = auth.auth.onAuthStateChange((_event, nextSession) => {
      if (active) setSession(nextSession)
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [auth])

  useEffect(() => {
    const epoch = ++sessionEpoch.current
    if (!session) {
      setBootstrap({ status: 'idle' })
      return
    }

    const abortController = new AbortController()
    setBootstrap({ status: 'loading' })
    void bootstrapSession(config.apiBaseUrl, session.access_token, abortController.signal)
      .then((data) => {
        if (sessionEpoch.current === epoch) {
          bootstrapRefreshUser.current = null
          setBootstrap({ status: 'ready', data })
        }
      })
      .catch(async (error: unknown) => {
        if (abortController.signal.aborted || sessionEpoch.current !== epoch) return
        if (
          error instanceof ApiClientError
          && error.status === 401
          && bootstrapRefreshUser.current !== session.user.id
        ) {
          bootstrapRefreshUser.current = session.user.id
          const { data, error: refreshError } = await auth.auth.refreshSession()
          if (abortController.signal.aborted || sessionEpoch.current !== epoch) return
          if (!refreshError && data.session) {
            setSession(data.session)
            return
          }
        }
        setBootstrap({
          status: 'error',
          message: error instanceof Error ? error.message : 'เริ่ม session ไม่สำเร็จ',
        })
      })
      .catch(() => {
        if (!abortController.signal.aborted && sessionEpoch.current === epoch) {
          setBootstrap({ status: 'error', message: 'ต่ออายุ session ไม่สำเร็จ กรุณาเข้าสู่ระบบใหม่' })
        }
      })
    return () => abortController.abort()
  }, [auth, config.apiBaseUrl, session])

  const signIn = async () => {
    setLoginBusy(true)
    setLoginError(null)
    const { error } = await auth.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) {
      setLoginError(error.message)
      setLoginBusy(false)
    }
  }

  const signOut = async () => {
    const { error } = await auth.auth.signOut()
    if (error) {
      setBootstrap({ status: 'error', message: error.message })
      return
    }
    setSession(null)
  }

  if (session === undefined || (session && bootstrap.status === 'loading')) {
    return <AuthStatus title="กำลังตรวจสอบบัญชี" message="กำลังเตรียมพื้นที่ทำงานของคุณ…" />
  }
  if (!session) {
    return (
      <Login
        onLogin={() => void signIn()}
        busy={loginBusy}
        error={loginError}
        finePrint="บัญชี Google ผ่าน Supabase Auth · session ถูกตรวจโดย server"
      />
    )
  }
  if (bootstrap.status === 'error') {
    return (
      <AuthStatus
        title="เปิดพื้นที่ทำงานไม่ได้"
        message={bootstrap.message}
        actionLabel="ออกจากระบบ"
        onAction={() => void signOut()}
      />
    )
  }
  if (bootstrap.status !== 'ready') {
    return <AuthStatus title="กำลังตรวจสอบบัญชี" message="กำลังเตรียมพื้นที่ทำงานของคุณ…" />
  }

  const appUserId = bootstrap.data.user.id
  return (
    <CloudWorkspace
      key={appUserId}
      onLogout={signOut}
      apiBaseUrl={config.apiBaseUrl}
      accessToken={session.access_token}
      appUserId={appUserId}
      workspaceId={bootstrap.data.personalWorkspace.id}
    />
  )
}

function AuthStatus({
  title,
  message,
  actionLabel,
  onAction,
}: {
  title: string
  message: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="login-screen">
      <div className="login-card">
        <h1 className="login-title">{title}</h1>
        <p className="login-sub">{message}</p>
        {actionLabel && onAction && (
          <button className="google-btn" onClick={onAction}>{actionLabel}</button>
        )}
      </div>
    </div>
  )
}
