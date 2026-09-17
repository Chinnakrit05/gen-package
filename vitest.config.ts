import { defineConfig } from 'vitest/config'

// config แยกจาก vite.config.ts โดยเจตนา — ไฟล์นั้นลงทะเบียน middleware /api/box-spec
// ซึ่งไม่เกี่ยวกับเทสต์ และไม่ควรถูกโหลดตอนรันเทสต์
export default defineConfig({
  test: {
    environment: 'node',
  },
})
