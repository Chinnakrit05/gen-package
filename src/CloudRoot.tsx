import { Suspense, createContext, lazy, useCallback, useContext, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { isAuthApiError, isAuthSessionMissingError, type Session } from '@supabase/supabase-js'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { Navigate, Outlet, RouterProvider, createBrowserRouter, useLocation, useNavigate, useSearchParams } from 'react-router'
import { Login } from './components/Login'
import { LoadingStage } from './components/LoadingBoundary'
import { marketplaceSuppliersEnabled, type ClientConfig } from './config'
import { LangCtx, loadLang } from './i18n'
import { bootstrapSession, getMe } from './services/api/session'
import { registerApiSessionRecovery } from './services/api/client'
import { createBrowserSupabaseClient } from './services/auth/supabaseAuth'
import { WorkspaceBootstrapController, type WorkspaceBootstrapState } from './services/auth/workspaceBootstrap'
import type { CloudStartupVariant } from './services/auth/startupLoading'
import type { ReviewerMfaClient } from './features/admin/ReviewerMfa'
import {
  CloudSessionContext,
  SessionChangedError,
  activeWorkspaceStorageKey,
  boundTokenProvider,
  resolveActiveWorkspace,
  type CloudSessionValue,
} from './app/cloudSession'
import { clearReturnTo, peekReturnTo, sanitizeReturnTo, storeReturnTo } from './app/returnTo'
import { SUPPLIER_INVITE_PATH, isSupplierInvitePath, readSupplierInviteFragment, storeSupplierInvite } from './app/supplierInviteRoute'

// หน้าแพ็กเกจของผู้เยี่ยมชมโหลดเมื่อกดเท่านั้น
const PricingPage = lazy(() => import('./components/PricingPage').then((m) => ({ default: m.PricingPage })))
// โหลด chunk ของหน้าเมื่อ element ถูก render หลังผ่าน RequireSession — ไม่ใช้ route `lazy` ของ router
// เพราะ router โหลด lazy ของทุก route ที่ match ก่อน guard (ลิงก์ /editor/:id ตอนยังไม่ login ดึง Editor 2 MB มาเปล่า ๆ)
const ProjectsPage = lazy(() => import('./app/ProjectsPage').then((m) => ({ default: m.ProjectsPage })))
const EditorRoute = lazy(() => import('./app/EditorRoute').then((m) => ({ default: m.EditorRoute })))
const QuoteRequestListPage = lazy(() => import('./features/requests/QuoteRequestPages').then((m) => ({ default: m.QuoteRequestListPage })))
const QuoteRequestNewPage = lazy(() => import('./features/requests/QuoteRequestPages').then((m) => ({ default: m.QuoteRequestNewPage })))
const QuoteRequestDetailPage = lazy(() => import('./features/requests/QuoteRequestPages').then((m) => ({ default: m.QuoteRequestDetailPage })))
const SupplierQuoteRequestsPage = lazy(() => import('./features/requests/SupplierQuoteRequestPages').then((m) => ({ default: m.SupplierQuoteRequestsPage })))
const SupplierQuoteRequestDetailPage = lazy(() => import('./features/requests/SupplierQuoteRequestPages').then((m) => ({ default: m.SupplierQuoteRequestDetailPage })))
const SupplierOnboarding = lazy(() => import('./features/suppliers/SupplierOnboarding').then((m) => ({ default: m.SupplierOnboarding })))
const SupplierProfilePage = lazy(() => import('./features/suppliers/SupplierProfilePage').then((m) => ({ default: m.SupplierProfilePage })))
const SupplierTeamPage = lazy(() => import('./features/suppliers/SupplierTeamPage').then((m) => ({ default: m.SupplierTeamPage })))
const SupplierInviteAccept = lazy(() => import('./features/suppliers/SupplierInviteAccept').then((m) => ({ default: m.SupplierInviteAccept })))
const PublicSupplierPage = lazy(() => import('./features/suppliers/PublicSupplierPage').then((m) => ({ default: m.PublicSupplierPage })))
const AdminSupplierReview = lazy(() => import('./features/admin/AdminSupplierReview').then((m) => ({ default: m.AdminSupplierReview })))

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
  reviewerMfa: ReviewerMfaClient
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

function isExpiredAuthSession(error: unknown): boolean {
  return isAuthSessionMissingError(error) || (isAuthApiError(error) && (
    error.status === 401 || error.status === 403
    || error.code === 'refresh_token_not_found' || error.code === 'refresh_token_already_used'
    || error.code === 'session_not_found' || error.code === 'session_expired'
  ))
}

// routes ของ Phase 1 (ROUTES-PHASE-1.md §2.1) — หน้ารายการกับ Editor เป็นคนละ chunk; หน้ารายการไม่ import Editor
const router = createBrowserRouter([
  ...(marketplaceSuppliersEnabled ? [{ path: '/suppliers/:slug', element: <PublicSupplierRoute /> }] : []),
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
          ...(marketplaceSuppliersEnabled ? [
            {
              path: '/app/requests',
              element: <Suspense fallback={<QuoteRequestLoading />}><QuoteRequestListPage /></Suspense>,
            },
            {
              path: '/app/requests/new',
              element: <Suspense fallback={<QuoteRequestLoading />}><QuoteRequestNewPage /></Suspense>,
            },
            {
              path: '/app/requests/:id',
              element: <Suspense fallback={<QuoteRequestLoading />}><QuoteRequestDetailPage /></Suspense>,
            },
            {
              path: '/factory/onboarding',
              element: <Suspense fallback={<MarketplaceLoading />}><SupplierOnboarding /></Suspense>,
            },
            {
              path: '/factory/:supplierId/profile',
              element: <Suspense fallback={<MarketplaceLoading />}><SupplierProfilePage /></Suspense>,
            },
            {
              path: '/factory/:supplierId/team',
              element: <Suspense fallback={<MarketplaceLoading />}><SupplierTeamPage /></Suspense>,
            },
            {
              path: '/factory/:supplierId/jobs',
              element: <Suspense fallback={<QuoteRequestLoading />}><SupplierQuoteRequestsPage /></Suspense>,
            },
            {
              path: '/factory/:supplierId/jobs/:requestId',
              element: <Suspense fallback={<QuoteRequestLoading />}><SupplierQuoteRequestDetailPage /></Suspense>,
            },
            {
              path: SUPPLIER_INVITE_PATH,
              element: <Suspense fallback={<MarketplaceLoading />}><SupplierInviteAccept /></Suspense>,
            },
            { path: '/admin/suppliers', element: <AdminSupplierRoute /> },
          ] : []),
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])

function QuoteRequestLoading() {
  return <LoadingStage title="กำลังเปิดคำขอราคา" message="กำลังโหลดข้อมูลคำขอราคา…" />
}

function MarketplaceLoading() {
  return <LoadingStage title="กำลังเปิด Marketplace" message="กำลังโหลดข้อมูลผู้รับผลิต…" />
}

function PublicSupplierRoute() {
  const { config } = useCloudAuth()
  return <Suspense fallback={<MarketplaceLoading />}><PublicSupplierPage apiBaseUrl={config.apiBaseUrl} /></Suspense>
}

function AdminSupplierRoute() {
  const { reviewerMfa } = useCloudAuth()
  return <Suspense fallback={<MarketplaceLoading />}><AdminSupplierReview mfa={reviewerMfa} /></Suspense>
}

export function CloudRoot({ config, startupVariant }: { config: ClientConfig; startupVariant: CloudStartupVariant }) {
  if (!config.supabase) throw new Error('CloudRoot ต้องมี Supabase client config')
  const auth = useMemo(() => createBrowserSupabaseClient(config.supabase!), [config.supabase])
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const sessionRef = useRef<Session | null | undefined>(undefined)
  const sessionEpoch = useRef(0)
  const acceptSession = useCallback((next: Session | null) => {
    if (sessionRef.current?.user.id !== next?.user.id) sessionEpoch.current += 1
    // Auth event updates the identity before React commits, so old queues cannot pick up a new token.
    sessionRef.current = next
    setSession(next)
  }, [])
  const [bootstrap, setBootstrap] = useState<WorkspaceBootstrapState>({ status: 'idle' })
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loginBusy, setLoginBusy] = useState(false)
  const [explicitLogout, setExplicitLogout] = useState(false)
  const expireSession = useCallback((accessToken: string) => {
    if (sessionRef.current?.access_token !== accessToken) return
    setLoginError('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่')
    setLoginBusy(true)
    // Clear this browser session, preserving sessions on other devices and the route return target.
    const signOutExpired = auth.auth.signOut({ scope: 'local' })
    acceptSession(null)
    void signOutExpired.catch(() => undefined).finally(() => setLoginBusy(false))
  }, [acceptSession, auth])

  const refreshSession = useCallback(async () => {
    const { data, error } = await auth.auth.refreshSession()
    if (error && !isExpiredAuthSession(error)) throw new Error('ต่ออายุเซสชันไม่สำเร็จ กรุณาลองใหม่')
    return data.session
  }, [auth])

  const bootstrapController = useMemo(() => new WorkspaceBootstrapController<Session>({
    bootstrap: (accessToken, signal) => bootstrapSession(config.apiBaseUrl, accessToken, signal),
    refreshSession,
    onSessionRefreshed: acceptSession,
    onSessionExpired: (expired) => expireSession(expired.access_token),
  }), [acceptSession, config.apiBaseUrl, expireSession, refreshSession])

  useEffect(() => {
    let active = true
    let pending: { epoch: number; token: string; request: Promise<string | null> } | null = null
    const dispose = registerApiSessionRecovery((url, accessToken) => {
      // Bootstrap already performs its own single bounded refresh. Recover only current PackIt requests.
      if (!url.startsWith(`${config.apiBaseUrl}/`) || url === `${config.apiBaseUrl}/session/bootstrap`
        || sessionRef.current?.access_token !== accessToken) return null
      const epoch = sessionEpoch.current
      const current = () => active && sessionEpoch.current === epoch ? sessionRef.current : null
      return {
        isCurrent: (token) => current()?.access_token === token,
        expire: (token) => { if (current()?.access_token === token) expireSession(token) },
        refresh: () => {
          const before = current()
          if (!before || before.access_token !== accessToken) return Promise.resolve(before?.access_token ?? null)
          if (pending?.epoch === epoch && pending.token === accessToken) return pending.request
          const request = refreshSession().then((refreshed) => {
            const latest = current()
            if (!latest) return null
            if (latest.access_token !== accessToken) return latest.access_token
            if (!refreshed) {
              expireSession(accessToken)
              return null
            }
            if (refreshed.user.id !== latest.user.id) return null
            acceptSession(refreshed)
            return refreshed.access_token
          }).catch(() => null)
          pending = { epoch, token: accessToken, request }
          void request.then(() => { if (pending?.request === request) pending = null })
          return request
        },
      }
    })
    return () => { active = false; dispose() }
  }, [acceptSession, config.apiBaseUrl, expireSession, refreshSession])

  useEffect(() => {
    let active = true
    let authEventReceived = false
    void auth.auth.getSession().then(({ data, error }) => {
      if (!active || authEventReceived) return
      if (error) {
        setLoginError('อ่าน session ไม่สำเร็จ กรุณาเข้าสู่ระบบใหม่')
        acceptSession(null)
        return
      }
      acceptSession(data.session)
    })
    const { data: { subscription } } = auth.auth.onAuthStateChange((_event, nextSession) => {
      authEventReceived = true
      if (active) acceptSession(nextSession)
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [acceptSession, auth])

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
    storeSupplierInvite(null)
    const { error } = await auth.auth.signOut()
    if (error) {
      setExplicitLogout(false)
      setBootstrap({ status: 'error', identityUserId: sessionRef.current?.user.id ?? '', message: error.message })
      return
    }
    acceptSession(null)
  }, [acceptSession, auth])

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
    reviewerMfa: auth.auth.mfa,
    signIn,
    signOut,
  }), [auth, bootstrap, config, explicitLogout, loginBusy, loginError, session, signIn, signOut, startupVariant])

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
    storeReturnTo(requested ?? peekReturnTo())
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
  const invitationRoute = marketplaceSuppliersEnabled && isSupplierInvitePath(location.pathname)
  useEffect(() => {
    if (marketplaceSuppliersEnabled && !invitationRoute) storeSupplierInvite(null)
  }, [invitationRoute])
  if (invitationRoute && (location.search || location.hash)) {
    return <CaptureSupplierInvite
      token={location.search ? null : readSupplierInviteFragment(location.hash)}
      signedIn={Boolean(auth.session)}
    />
  }
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

function CaptureSupplierInvite({ token, signedIn }: { token: string | null; signedIn: boolean }) {
  const navigate = useNavigate()
  useEffect(() => {
    // Keep the invite separate from OAuth returnTo and replace the original history entry.
    storeSupplierInvite(token)
    const path = signedIn ? SUPPLIER_INVITE_PATH : `/login?returnTo=${encodeURIComponent(SUPPLIER_INVITE_PATH)}`
    void navigate(path, { replace: true })
  }, [navigate, signedIn, token])
  return <MarketplaceLoading />
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
    refetchOnWindowFocus: true,
  })
  const { refetch: refetchMembership } = meQuery
  const refreshMembership = useCallback(() => {
    void refetchMembership({ cancelRefetch: false })
  }, [refetchMembership])
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
    refreshMembership,
    signOut: props.signOut,
  }), [getAccessToken, me, meQuery.isError, meQuery.isPending, props.accessToken, props.apiBaseUrl, props.appUserId, props.personalWorkspaceId, props.signOut, refreshMembership, role, setWorkspaceId, workspaceId])
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
