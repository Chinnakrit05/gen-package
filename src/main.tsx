import { StrictMode, Suspense, lazy, useState } from 'react'
import { createRoot } from 'react-dom/client'
// ฟอนต์ไทย self-host (เลิกพึ่ง Google CDN) — โหลดพร้อม bundle ใช้งานได้แม้ออฟไลน์
// และไฟล์ที่ rasterize (PDF/ใบสเปก) ได้เมตริก/รูปตัวอักษรตรงกับที่เห็นบนจอเสมอ
import '@fontsource/noto-sans-thai/400.css'
import '@fontsource/noto-sans-thai/500.css'
import '@fontsource/noto-sans-thai/600.css'
import '@fontsource/noto-sans-thai/700.css'
// Prompt = ฟอนต์หัวข้อของ UI (หน้า login/รายการงานใช้ด้วย) — ฟอนต์ออกแบบอื่นอยู่ editorFonts.ts (chunk ของ Editor)
import '@fontsource/prompt/400.css'
import '@fontsource/prompt/700.css'
import { Login } from './components/Login'
import { LoadingBoundary, LoadingStage } from './components/LoadingBoundary'
import { ClientConfigError, loadClientConfig } from './config'
import { getCloudStartupVariant } from './services/auth/startupLoading'
import './shell.css'

const AUTH_KEY = 'packit-auth'
const CloudRoot = lazy(() => import('./CloudRoot').then((module) => ({ default: module.CloudRoot })))
// ตัวแอป (App + blueprint + template ทั้งหมด + โค้ดส่งออก) โหลดแยกเมื่อเข้าใช้งานจริงเท่านั้น
// ไม่ preload จากหน้า login — การโหลดล่วงหน้าทำให้ lazy boundary ไม่มีผล (ROUTES-PHASE-1.md 1-A2)
const App = lazy(() => import('./App'))
const clientConfig = (() => {
  try {
    return { value: loadClientConfig(), error: null }
  } catch (error) {
    return { value: null, error }
  }
})()

// ใช้ธีมที่บันทึกไว้ตั้งแต่ก่อนเรนเดอร์ (ครอบทั้งหน้า login และแอป ไม่ให้กะพริบสลับธีม)
if (localStorage.getItem('packit-theme') === 'dark') {
  document.documentElement.dataset.theme = 'dark'
}

// local demo เก็บ gate จำลองไว้; cloud mode ใช้ Supabase session จริงใน CloudRoot
function Root() {
  // Capture once, before lazy auth can consume the OAuth callback or refresh storage.
  const [startupVariant] = useState(() => clientConfig.value?.mode === 'cloud' && clientConfig.value.supabase
    ? getCloudStartupVariant(clientConfig.value.supabase.url)
    : 'login')
  if (clientConfig.error) {
    const message = clientConfig.error instanceof ClientConfigError
      ? clientConfig.error.message
      : 'อ่านค่าตั้งต้นของแอปไม่ได้'
    return <StartupMessage title="ตั้งค่าแอปไม่ครบ" message={message} />
  }
  if (clientConfig.value?.mode === 'cloud') {
    return (
      <LoadingBoundary>
        <Suspense fallback={<LoadingStage variant={startupVariant} title="กำลังตรวจสอบบัญชี" message="กำลังเตรียมพื้นที่ทำงานของคุณ…" />}>
          <CloudRoot config={clientConfig.value} startupVariant={startupVariant} />
        </Suspense>
      </LoadingBoundary>
    )
  }

  return <LocalDemoRoot />
}

function LocalDemoRoot() {
  const [authed, setAuthed] = useState(() => localStorage.getItem(AUTH_KEY) === '1')
  const login = () => {
    localStorage.setItem(AUTH_KEY, '1')
    setAuthed(true)
  }
  const logout = () => {
    // local demo เก็บงานไว้ใน browser ต่อไป; logout ไม่ใช่คำสั่งลบข้อมูล
    localStorage.removeItem(AUTH_KEY)
    setAuthed(false)
  }
  return authed ? (
    <LoadingBoundary>
      <Suspense fallback={<LoadingStage title="กำลังเปิดพื้นที่ทำงาน" message="กำลังโหลดเครื่องมือออกแบบ…" />}>
        <App onLogout={logout} />
      </Suspense>
    </LoadingBoundary>
  ) : (
    <Login mode="local" onLogin={login} />
  )
}

function StartupMessage({ title, message }: { title: string; message: string }) {
  return (
    <div className="login-screen">
      <div className="login-card">
        <h1 className="login-title">{title}</h1>
        <p className="login-sub">{message}</p>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
