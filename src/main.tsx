import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// ฟอนต์ไทย self-host (เลิกพึ่ง Google CDN) — โหลดพร้อม bundle ใช้งานได้แม้ออฟไลน์
// และไฟล์ที่ rasterize (PDF/ใบสเปก) ได้เมตริก/รูปตัวอักษรตรงกับที่เห็นบนจอเสมอ
import '@fontsource/noto-sans-thai/400.css'
import '@fontsource/noto-sans-thai/500.css'
import '@fontsource/noto-sans-thai/600.css'
import '@fontsource/noto-sans-thai/700.css'
import App from './App'
import './app.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
