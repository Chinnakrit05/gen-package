import { StrictMode, Suspense, lazy, useState } from 'react'
import { createRoot } from 'react-dom/client'
// ฟอนต์ไทย self-host (เลิกพึ่ง Google CDN) — โหลดพร้อม bundle ใช้งานได้แม้ออฟไลน์
// และไฟล์ที่ rasterize (PDF/ใบสเปก) ได้เมตริก/รูปตัวอักษรตรงกับที่เห็นบนจอเสมอ
import '@fontsource/noto-sans-thai/400.css'
import '@fontsource/noto-sans-thai/500.css'
import '@fontsource/noto-sans-thai/600.css'
import '@fontsource/noto-sans-thai/700.css'
// ฟอนต์ไทยเสริมให้เลือก (แต่ละแบบ 400/700) — ต้องขึ้นทะเบียนใน FONTS ของ artwork.ts ด้วย
import '@fontsource/sarabun/400.css'
import '@fontsource/sarabun/700.css'
import '@fontsource/prompt/400.css'
import '@fontsource/prompt/700.css'
import '@fontsource/kanit/400.css'
import '@fontsource/kanit/700.css'
import App from './App'
import { Login } from './components/Login'
import { LoadingBoundary, LoadingStage } from './components/LoadingBoundary'
import { ClientConfigError, loadClientConfig } from './config'
import './app.css'

const AUTH_KEY = 'packit-auth'
const CloudRoot = lazy(() => import('./CloudRoot').then((module) => ({ default: module.CloudRoot })))
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
  if (clientConfig.error) {
    const message = clientConfig.error instanceof ClientConfigError
      ? clientConfig.error.message
      : 'อ่านค่าตั้งต้นของแอปไม่ได้'
    return <StartupMessage title="ตั้งค่าแอปไม่ครบ" message={message} />
  }
  if (clientConfig.value?.mode === 'cloud') {
    return (
      <LoadingBoundary>
        <Suspense fallback={<LoadingStage title="กำลังเปิดระบบบัญชี" message="กำลังเชื่อมต่อพื้นที่ทำงานของคุณ…" />}>
          <CloudRoot config={clientConfig.value} />
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
  return authed ? <App onLogout={logout} /> : <Login onLogin={login} />
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
