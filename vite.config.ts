import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { handleBoxSpec } from './server/boxSpec'

// endpoint ฝั่ง server สำหรับ AI แปลง prompt → สเปกกล่อง
// อยู่ใน dev server เพื่อเก็บ ANTHROPIC_API_KEY ไว้ฝั่ง server (ห้ามหลุดไป client)
function boxSpecApi(env: Record<string, string | undefined>): Plugin {
  return {
    name: 'box-spec-api',
    configureServer(server) {
      server.middlewares.use('/api/box-spec', (req, res) => {
        void handleBoxSpec(req, res, env)
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/box-spec', (req, res) => {
        void handleBoxSpec(req, res, env)
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), boxSpecApi(env)],
    server: { port: 5173, strictPort: true },
  }
})
