import { Suspense, createContext, lazy, useCallback, useContext, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import type { Session } from '@supabase/supabase-js'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { Navigate, Outlet, RouterProvider, createBrowserRouter, useLocation, useNavigate, useSearchParams } from 'react-router'
import { Login } from './components/Login'
import { LoadingStage } from './components/LoadingBoundary'
import type { ClientConfig } from './config'
import { LangCtx, loadLang } from './i18n'
import { bootstrapSession, getMe } from './services/api/session'
import { createBrowserSupabaseClient } from './services/auth/supabaseAuth'
import { WorkspaceBootstrapController, type WorkspaceBootstrapState } from './services/auth/workspaceBootstrap'
import type { CloudStartupVariant } from './services/auth/startupLoading'
import {
  CloudSessionContext,
  SessionChangedError,
  activeWorkspaceStorageKey,
  boundTokenProvider,
  resolveActiveWorkspace,
  type CloudSessionValue,
} from './app/cloudSession'
import { clearReturnTo, peekReturnTo, sanitizeReturnTo, storeReturnTo } from './app/returnTo'

// หน้าแพ็กเกจของผู้เยี่ยมชมโหลดเมื่อกดเท่านั้น
const PricingPage = lazy(() => import('./components/PricingPage').then((m) => ({ default: m.PricingPage })))
// โหลด chunk ของหน้าเมื่อ element ถูก render หลังผ่าน RequireSession — ไม่ใช้ route `lazy` ของ router
// เพราะ router โหลด lazy ของทุก route ที่ match ก่อน guard (ลิงก์ /editor/:id ตอนยังไม่ login ดึง Editor 2 MB มาเปล่า ๆ)
const ProjectsPage = lazy(() => import('./app/ProjectsPage').then((m) => ({ default: m.ProjectsPage })))
const EditorRoute = lazy(() => import('./app/EditorRoute').then((m) => ({ default: m.EditorRoute })))

// สถานะ auth (ก่อน/หลัง bootstrap) ที่ route ทุกตัวอ่าน — อยู่เหนือ RouterProvider
interface CloudAuthValue {
  config: ClientConfig
  startupVariant: CloudStartupVariant
  session: Session | null | undefined
  sessionRef: MutableRefObject<Session | null | undefined>
  bootstrap: WorkspaceBootstrapState
  explicitLogout: boolean
  loginBusy: boolean
  loginError: string | null
  signIn(): Promise<void>
  signOut(): Promise<void>
}

const CloudAuthContext = createContext<CloudAuthValue | null>(null)

function useCloudAuth(): CloudAuthValue {
  const value = useContext(CloudAuthContext)
  if (!value) throw new Error('ต้องอยู่ใต้ CloudRoot')
  return value
}

const LOADING_ACCOUNT = { title: 'กำลังตรวจสอบบัญชี', message: 'กำลังเตรียมพื้นที่ทำงานของคุณ…' }

// routes ของ Phase 1 (ROUTES-PHASE-1.md §2.1) — หน้ารายการกับ Editor เป็นคนละ chunk; หน้ารายการไม่ import Editor
const router = createBrowserRouter([
  {
    element: <AuthLayout />,
    HydrateFallback: StartupLoading,
    children: [
      { path: '/', element: <HomeRedirect /> },
      { path: '/login', element: <LoginRoute /> },
      { path: '/app', element: <Navigate to="/app/projects" replace /> },
      {
        element: <RequireSession />,
        children: [
          {
            path: '/app/projects',
            element: (
              <Suspense fallback={<LoadingStage title="กำลังเปิดงานของฉัน" message="กำลังโหลดรายการงาน…" />}>
                <ProjectsPage />
              </Suspense>
            ),
          },
          {
            path: '/editor',
            element: (
              <Suspense fallback={<LoadingStage title="กำลังเปิดงาน" message="กำลังโหลดเครื่องมือออกแบบ…" />}>
                <EditorRoute />
              </Suspense>
            ),
            // เนื้อหาทั้งหมดอยู่ใน EditorRoute (อ่าน params เอง) — ลูกมีไว้ให้ match path เท่านั้น
            children: [{ path: 'new', Component: EmptyOutlet }, { path: ':projectId', Component: EmptyOutlet }],
          },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])

export function CloudRoot({ config, startupVariant }: { config: ClientConfig; startupVariant: CloudStartupVariant }) {
  if (!config.supabase) throw new Error('CloudRoot ต้องมี Supabase client config')
  const auth = useMemo(() => createBrowserSupabaseClient(config.supabase!), [config.supabase])
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const sessionRef = useRef<Session | null | undefined>(undefined)
  sessionRef.current = session
  const [bootstrap, setBootstrap] = useState<WorkspaceBootstrapState>({ status: 'idle' })
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loginBusy, setLoginBusy] = useState(false)
  const [explicitLogout, setExplicitLogout] = useState(false)
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

  // OAuth กลับ origin เดิม (redirectTo = origin + PKCE ของ SDK); ปลายทางในแอปเก็บใน sessionStorage ก่อนออกไป
  const signIn = useCallback(async () => {
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
  }, [auth])

  const signOut = useCallback(async () => {
    setExplicitLogout(true)
    clearReturnTo()
    const { error } = await auth.auth.signOut()
    if (error) {
      setExplicitLogout(false)
      setBootstrap({ status: 'error', identityUserId: sessionRef.current?.user.id ?? '', message: error.message })
      return
    }
    setSession(null)
  }, [auth])

  useEffect(() => {
    if (session) setExplicitLogout(false)
  }, [session])

  const value = useMemo<CloudAuthValue>(() => ({
    config,
    startupVariant,
    session,
    sessionRef,
    bootstrap,
    explicitLogout,
    loginBusy,
    loginError,
    signIn,
    signOut,
  }), [bootstrap, config, explicitLogout, loginBusy, loginError, session, signIn, signOut, startupVariant])

  return (
    <CloudAuthContext.Provider value={value}>
      <RouterProvider router={router} />
    </CloudAuthContext.Provider>
  )
}

function EmptyOutlet() {
  return null
}

function StartupLoading() {
  const auth = useContext(CloudAuthContext)
  return <LoadingStage variant={auth?.startupVariant} {...LOADING_ACCOUNT} />
}

// session === undefined = ยังอ่าน session/แลก code ของ PKCE ไม่เสร็จ
function AuthLayout() {
  const auth = useCloudAuth()
  if (auth.session === undefined) return <LoadingStage variant={auth.startupVariant} {...LOADING_ACCOUNT} />
  return <Outlet />
}

function isBootstrapped(auth: CloudAuthValue): boolean {
  return Boolean(auth.session && auth.bootstrap.status === 'ready' && auth.bootstrap.identityUserId === auth.session.user.id)
}

// `/` = ปลายทางของ OAuth callback: มี session แล้วไปปลายทางที่เก็บไว้ (ตรวจซ้ำ) ไม่มีก็ไป login
function HomeRedirect() {
  const auth = useCloudAuth()
  if (!auth.session) return <Navigate to="/login" replace />
  if (!isBootstrapped(auth)) return <BootstrapGate />
  return <Navigate to={peekReturnTo()} replace />
}

function LoginRoute() {
  const auth = useCloudAuth()
  const [search] = useSearchParams()
  const [pricingOpen, setPricingOpen] = useState(false)
  const requested = search.get('returnTo')
  if (auth.session) {
    if (!isBootstrapped(auth)) return <BootstrapGate />
    return <Navigate to={sanitizeReturnTo(requested, window.location.origin) ?? peekReturnTo()} replace />
  }
  const startLogin = () => {
    storeReturnTo(requested)
    void auth.signIn()
  }
  if (pricingOpen) {
    // หน้าเข้าสู่ระบบอยู่นอก App (ไม่มี LangCtx ของ App) — ใช้ภาษาที่ผู้ใช้เลือกไว้ล่าสุด
    // ผู้เยี่ยมชมไม่รู้ purchasesEnabled (ต้อง login) → ถือว่ายังไม่เปิดขาย
    return (
      <LangCtx.Provider value={loadLang()}>
        <Suspense fallback={<LoadingStage title="กำลังเปิดหน้าแพ็กเกจ" message="กำลังโหลด…" />}>
          <PricingPage
            viewer={{ kind: 'guest' }}
            catalog={null}
            purchasesEnabled={false}
            onClose={() => setPricingOpen(false)}
            onChoose={() => {
              setPricingOpen(false)
              startLogin()
            }}
          />
        </Suspense>
      </LangCtx.Provider>
    )
  }
  return (
    <Login
      onLogin={startLogin}
      busy={auth.loginBusy}
      error={auth.loginError}
      finePrint="บัญชี Google ผ่าน Supabase Auth · session ถูกตรวจโดย server"
      onShowPricing={() => setPricingOpen(true)}
    />
  )
}

function BootstrapGate() {
  const auth = useCloudAuth()
  if (auth.session && auth.bootstrap.status === 'error' && auth.bootstrap.identityUserId === auth.session.user.id) {
    return (
      <AuthStatus
        title="เปิดพื้นที่ทำงานไม่ได้"
        message={auth.bootstrap.message}
        actionLabel="ออกจากระบบ"
        onAction={() => void auth.signOut()}
      />
    )
  }
  return <LoadingStage {...LOADING_ACCOUNT} />
}

// หน้าที่ต้อง login: ไม่มี session → /login พร้อมปลายทางเดิม (เว้นแต่ผู้ใช้กดออกเอง)
function RequireSession() {
  const auth = useCloudAuth()
  const location = useLocation()
  if (!auth.session) {
    if (auth.explicitLogout) return <Navigate to="/login" replace />
    const returnTo = sanitizeReturnTo(`${location.pathname}${location.search}`, window.location.origin)
    return <Navigate to={returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : '/login'} replace />
  }
  if (!isBootstrapped(auth) || auth.bootstrap.status !== 'ready') return <BootstrapGate />
  const data = auth.bootstrap.data
  // key = appUserId: เปลี่ยนบัญชีแล้ว query cache/state ทั้งชุดถูกทิ้ง ไม่มีข้อมูลบัญชีเก่าค้างระหว่างโหลด
  return (
    <SessionProvider
      key={data.user.id}
      apiBaseUrl={auth.config.apiBaseUrl}
      appUserId={data.user.id}
      identityUserId={auth.bootstrap.identityUserId}
      personalWorkspaceId={data.personalWorkspace.id}
      sessionRef={auth.sessionRef}
      accessToken={auth.session.access_token}
      signOut={auth.signOut}
    />
  )
}

function SessionProvider(props: {
  apiBaseUrl: string
  appUserId: string
  identityUserId: string
  personalWorkspaceId: string
  sessionRef: MutableRefObject<Session | null | undefined>
  accessToken: string
  signOut(): Promise<void>
}) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: (failures, error) => failures < 2 && !isClientError(error),
      },
    },
  }))
  useEffect(() => () => queryClient.clear(), [queryClient])
  // ปลายทาง login ใช้แล้ว — ล้างเมื่อเข้าหน้าที่ต้อง login สำเร็จ
  useEffect(() => clearReturnTo(), [])
  return (
    <QueryClientProvider client={queryClient}>
      <SessionValue {...props} />
    </QueryClientProvider>
  )
}

function SessionValue(props: {
  apiBaseUrl: string
  appUserId: string
  identityUserId: string
  personalWorkspaceId: string
  sessionRef: MutableRefObject<Session | null | undefined>
  accessToken: string
  signOut(): Promise<void>
}) {
  const { sessionRef, identityUserId } = props
  // token provider ผูกเจ้าของ: เทียบ identity ของ Supabase ที่ bootstrap ยืนยันแล้ว (ไม่เทียบกับ appUserId ภายใน)
  const getAccessToken = useMemo(() => boundTokenProvider(sessionRef, identityUserId), [identityUserId, sessionRef])
  const meQuery = useQuery({
    queryKey: ['cloud', props.appUserId, 'me'],
    queryFn: ({ signal }) => getMe(props.apiBaseUrl, getAccessToken(), signal),
    staleTime: 60_000,
  })
  const me = meQuery.data ?? null
  const [stored, setStored] = useState<string | null>(() => {
    try {
      return localStorage.getItem(activeWorkspaceStorageKey(props.appUserId))
    } catch {
      return null
    }
  })
  const workspaceId = resolveActiveWorkspace(stored, me, props.personalWorkspaceId)
  const setWorkspaceId = useCallback((next: string) => {
    setStored(next)
    try {
      localStorage.setItem(activeWorkspaceStorageKey(props.appUserId), next)
    } catch {
      // จำไม่ได้ก็ใช้ได้ในแท็บนี้
    }
  }, [props.appUserId])
  const role = me?.workspaces.find((workspace) => workspace.id === workspaceId)?.role
    ?? (workspaceId === props.personalWorkspaceId ? 'owner' : null)
  const value = useMemo<CloudSessionValue>(() => ({
    apiBaseUrl: props.apiBaseUrl,
    appUserId: props.appUserId,
    personalWorkspaceId: props.personalWorkspaceId,
    getAccessToken,
    accessToken: props.accessToken,
    me,
    meStatus: meQuery.isPending ? 'loading' : meQuery.isError ? 'error' : 'ready',
    workspaceId,
    role,
    setWorkspaceId,
    signOut: props.signOut,
  }), [getAccessToken, me, meQuery.isError, meQuery.isPending, props.accessToken, props.apiBaseUrl, props.appUserId, props.personalWorkspaceId, props.signOut, role, setWorkspaceId, workspaceId])
  return (
    <CloudSessionContext.Provider value={value}>
      <Outlet />
    </CloudSessionContext.Provider>
  )
}

function isClientError(error: unknown): boolean {
  const status = typeof error === 'object' && error !== null && 'status' in error ? Number((error as { status: unknown }).status) : 0
  return error instanceof SessionChangedError || (status >= 400 && status < 500)
}

export function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <AuthStatus
      title="ไม่พบหน้านี้"
      message="ลิงก์อาจพิมพ์ผิดหรือหน้านี้ถูกย้ายแล้ว"
      actionLabel="ไปที่งานของฉัน"
      onAction={() => navigate('/app/projects')}
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
