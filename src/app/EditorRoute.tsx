// /editor/new และ /editor/:projectId (1-A4/1-A5) — chunk นี้ดึง Editor ทั้งก้อน (CloudWorkspace → App)
// URL ตามงานที่เปิดอยู่โดยไม่ remount: เปลี่ยน id จากในแอป (สร้าง/สำเนา/นำเข้า) แค่ตามด้วย navigate;
// เปลี่ยนจากภายนอก (back/forward/ลิงก์) = mount งานตาม URL ใหม่ หลังผ่าน leaveEditor
import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useBlocker, useLocation, useMatch, useNavigate, useParams } from 'react-router'
import { CloudWorkspace } from '../features/projects/CloudWorkspace'
import { LoadingStage } from '../components/LoadingBoundary'
import { useCloudSession } from './cloudSession'
import { setFlash } from './flash'
import type { LeaveOutcome } from './leaveEditor'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface NewIntentState {
  packitNewIntent?: unknown
}

export function EditorRoute() {
  const session = useCloudSession()
  const readOnly = session.role !== 'owner' && session.role !== 'editor'
  const navigate = useNavigate()
  const location = useLocation()
  const { projectId } = useParams()
  const isNew = useMatch('/editor/new') !== null
  const stateIntent = (location.state as NewIntentState | null)?.packitNewIntent
  const intentId = typeof stateIntent === 'string' && UUID.test(stateIntent) ? stateIntent : null

  // /editor/new ที่ยังไม่มี intent ของ history entry นี้ → สร้าง id แล้วเขียนลง state (refresh/back ได้ intent เดิม)
  useEffect(() => {
    if (isNew && !intentId && !readOnly && session.meStatus !== 'loading') {
      navigate('/editor/new', { replace: true, state: { packitNewIntent: crypto.randomUUID() } })
    }
  }, [intentId, isNew, navigate, readOnly, session.meStatus])

  const routeId = isNew ? (intentId ? `new:${intentId}` : null) : projectId ?? null
  // currentRef = งานที่ workspace ที่ mount อยู่เป็นตัวแทน (เปลี่ยนตาม follow โดยไม่ remount)
  // URL ไม่ตรง currentRef = การนำทางจากภายนอก → key ใหม่ = mount งานตาม URL
  const currentRef = useRef<string | null>(null)
  const keyRef = useRef('')
  const mounts = useRef(0)
  if (routeId && routeId !== currentRef.current) {
    currentRef.current = routeId
    mounts.current += 1
    keyRef.current = `${routeId}#${mounts.current}`
  }

  // navigate ที่ Editor สั่งเอง (ตาม id ที่เปิดแล้ว/ออกหลังลบ) ไม่ต้องผ่าน guard
  const allowPathRef = useRef<string | null>(null)
  const leaveRef = useRef<(() => Promise<LeaveOutcome>) | null>(null)
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (readOnly) return false
    if (currentLocation.pathname === nextLocation.pathname) return false
    if (allowPathRef.current === nextLocation.pathname) return false
    return true
  })
  const [leaving, setLeaving] = useState<null | 'saving' | Extract<LeaveOutcome, { kind: 'conflict' | 'capture-failed' }>>(null)

  useEffect(() => {
    if (blocker.state !== 'blocked') return
    let cancelled = false
    setLeaving('saving')
    void (async () => {
      const outcome = leaveRef.current ? await leaveRef.current() : { kind: 'synced' as const }
      if (cancelled) return
      if (outcome.kind === 'synced' || outcome.kind === 'local') {
        if (outcome.kind === 'local') setFlash('บันทึกงานล่าสุดไว้ในเครื่องแล้ว จะส่งขึ้น Cloud เมื่อเปิดงานนั้นอีกครั้ง')
        setLeaving(null)
        blocker.proceed()
        return
      }
      setLeaving(outcome)
    })()
    return () => { cancelled = true }
  }, [blocker])

  useEffect(() => {
    allowPathRef.current = null
  }, [location.pathname])

  const follow = useCallback((id: string, replace: boolean) => {
    currentRef.current = id
    const path = `/editor/${id}`
    if (window.location.pathname === path) return
    allowPathRef.current = path
    navigate(path, { replace })
  }, [navigate])

  const exit = useCallback((path: string) => {
    allowPathRef.current = path
    navigate(path)
  }, [navigate])

  const registerLeave = useCallback((fn: (() => Promise<LeaveOutcome>) | null) => {
    leaveRef.current = fn
  }, [])

  const onWorkspaceMismatch = useCallback((workspaceId: string) => {
    if (session.me?.workspaces.some((workspace) => workspace.id === workspaceId)) session.setWorkspaceId(workspaceId)
  }, [session])

  if (!isNew && !projectId) return <Navigate to="/app/projects" replace />
  if (projectId && !UUID.test(projectId)) return <EditorMessage title="ไม่พบงานนี้" message="ลิงก์ของงานไม่ถูกต้อง" />
  if (session.meStatus === 'loading') return <LoadingStage title="กำลังเปิดงาน" message="กำลังโหลดเครื่องมือออกแบบ…" />
  if (isNew && readOnly) {
    return <EditorMessage title="สร้างงานไม่ได้" message="บทบาทดูอย่างเดียวในพื้นที่งานนี้สร้างงานใหม่ไม่ได้" />
  }
  if (!routeId) return <LoadingStage title="กำลังเปิดงาน" message="กำลังโหลดเครื่องมือออกแบบ…" />

  const target = isNew
    ? { kind: 'new' as const, intentId: intentId! }
    : { kind: 'project' as const, projectId: projectId! }

  return (
    <>
      <CloudWorkspace
        key={`${session.workspaceId}:${readOnly}:${keyRef.current}`}
        apiBaseUrl={session.apiBaseUrl}
        accessToken={session.accessToken}
        getAccessToken={session.getAccessToken}
        appUserId={session.appUserId}
        workspaceId={session.workspaceId}
        readOnly={readOnly}
        isPersonalWorkspace={session.workspaceId === session.personalWorkspaceId}
        onProjectAccessRejected={session.refreshMembership}
        target={target}
        onLogout={session.signOut}
        onOpened={(id) => follow(id, false)}
        onAdopted={(id) => follow(id, true)}
        onExit={exit}
        onBackToProjects={() => navigate('/app/projects')}
        onWorkspaceMismatch={onWorkspaceMismatch}
        registerLeave={registerLeave}
      />
      {leaving && (
        <div className="modal-overlay">
          <div className="modal" role="dialog" aria-label="ออกจากงาน">
            {leaving === 'saving' ? (
              <>
                <h3>กำลังบันทึกงาน…</h3>
                <p>รอให้การแก้ล่าสุดเก็บลงเครื่องและส่งขึ้น Cloud ก่อนออก</p>
              </>
            ) : leaving.kind === 'conflict' ? (
              <>
                <h3>งานนี้มีเวอร์ชันใหม่กว่าบน Cloud</h3>
                <p>การแก้ของคุณยังเก็บไว้ในเครื่อง อยู่ต่อเพื่อเลือกโหลดเวอร์ชันล่าสุดหรือบันทึกเป็นงานใหม่ หรือออกโดยเก็บร่างไว้</p>
                <div className="modal-actions">
                  <button onClick={() => { setLeaving(null); blocker.reset?.() }}>อยู่ต่อ</button>
                  <button className="primary" onClick={() => { setLeaving(null); blocker.proceed?.() }}>ออกโดยเก็บร่างไว้</button>
                </div>
              </>
            ) : (
              <>
                <h3>เก็บงานในเครื่องไม่สำเร็จ</h3>
                <p>การแก้ล่าสุดยังไม่ได้เก็บ ({leaving.error.message}) — อยู่ต่อเพื่อลองอีกครั้งหรือส่งออกไฟล์ .genpkg.json สำรองไว้ก่อน</p>
                <div className="modal-actions">
                  <button className="primary" onClick={() => { setLeaving(null); blocker.reset?.() }}>อยู่ต่อ</button>
                  <button
                    className="danger"
                    onClick={() => {
                      if (!window.confirm('ออกโดยทิ้งการแก้ที่ยังไม่ได้เก็บ? กู้คืนไม่ได้')) return
                      setLeaving(null)
                      blocker.proceed?.()
                    }}
                  >
                    ออกและทิ้งการแก้ล่าสุด
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function EditorMessage({ title, message }: { title: string; message: string }) {
  const navigate = useNavigate()
  return (
    <div className="login-screen">
      <div className="login-card">
        <h1 className="login-title">{title}</h1>
        <p className="login-sub">{message}</p>
        <button className="google-btn" onClick={() => navigate('/app/projects')}>กลับไปที่งานของฉัน</button>
      </div>
    </div>
  )
}
