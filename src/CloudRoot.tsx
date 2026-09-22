import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Login } from './components/Login'
import { LoadingStage } from './components/LoadingBoundary'
import type { ClientConfig } from './config'
import { CloudWorkspace } from './features/projects/CloudWorkspace'
import { bootstrapSession } from './services/api/session'
import { createBrowserSupabaseClient } from './services/auth/supabaseAuth'
import { WorkspaceBootstrapController, type WorkspaceBootstrapState } from './services/auth/workspaceBootstrap'
import type { CloudStartupVariant } from './services/auth/startupLoading'

export function CloudRoot({ config, startupVariant }: { config: ClientConfig; startupVariant: CloudStartupVariant }) {
  if (!config.supabase) throw new Error('CloudRoot ต้องมี Supabase client config')
  const auth = useMemo(() => createBrowserSupabaseClient(config.supabase!), [config.supabase])
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [bootstrap, setBootstrap] = useState<WorkspaceBootstrapState>({ status: 'idle' })
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loginBusy, setLoginBusy] = useState(false)
  const bootstrapController = useMemo(() => new WorkspaceBootstrapController<Session>({
    bootstrap: (accessToken, signal) => bootstrapSession(config.apiBaseUrl, accessToken, signal),
    refreshSession: async () => {
      const { data, error } = await auth.auth.refreshSession()
      if (error) throw new Error('ต่ออายุ session ไม่สำเร็จ กรุณาเข้าสู่ระบบใหม่')
      return data.session
    },
    onSessionRefreshed: setSession,
  }), [auth, config.apiBaseUrl])

  useEffect(() => {
    let active = true
    let authEventReceived = false
    void auth.auth.getSession().then(({ data, error }) => {
      if (!active || authEventReceived) return
      if (error) {
        setLoginError('อ่าน session ไม่สำเร็จ กรุณาเข้าสู่ระบบใหม่')
        setSession(null)
        return
      }
      setSession(data.session)
    })
    const { data: { subscription } } = auth.auth.onAuthStateChange((_event, nextSession) => {
      authEventReceived = true
      if (active) setSession(nextSession)
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [auth])

  useEffect(() => {
    const unsubscribe = bootstrapController.subscribe(setBootstrap)
    return () => {
      unsubscribe()
      bootstrapController.cancel()
    }
  }, [bootstrapController])

  useEffect(() => {
    bootstrapController.acceptSession(session)
  }, [bootstrapController, session])

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
      setBootstrap({ status: 'error', identityUserId: session?.user.id ?? '', message: error.message })
      return
    }
    setSession(null)
  }

  if (session === undefined) {
    return <LoadingStage variant={startupVariant} title="กำลังตรวจสอบบัญชี" message="กำลังเตรียมพื้นที่ทำงานของคุณ…" />
  }
  if (session && bootstrap.status === 'loading') {
    return <LoadingStage title="กำลังตรวจสอบบัญชี" message="กำลังเตรียมพื้นที่ทำงานของคุณ…" />
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
  if (bootstrap.status === 'error' && bootstrap.identityUserId === session.user.id) {
    return (
      <AuthStatus
        title="เปิดพื้นที่ทำงานไม่ได้"
        message={bootstrap.message}
        actionLabel="ออกจากระบบ"
        onAction={() => void signOut()}
      />
    )
  }
  if (bootstrap.status !== 'ready' || bootstrap.identityUserId !== session.user.id) {
    return <LoadingStage title="กำลังตรวจสอบบัญชี" message="กำลังเตรียมพื้นที่ทำงานของคุณ…" />
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
