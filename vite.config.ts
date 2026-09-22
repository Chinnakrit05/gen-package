import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { handleBoxSpec } from './server/boxSpec'
import { createViteApiMiddleware } from './server/entrypoints/vite'

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
  // Explicit opt-in sandbox: ignore both .env files and inherited public keys.
  // Normal dev/build continue using the team's existing cloud configuration.
  const localDemo = mode === 'local-demo'
  const env = localDemo
    ? { APP_ENV: 'development', VITE_APP_MODE: 'local', BOX_SPEC_BACKEND: 'mock' }
    : loadEnv(mode, process.cwd(), '')
  return {
    ...(localDemo ? {
      envDir: false as const,
      envPrefix: [],
      define: {
        'import.meta.env.VITE_APP_MODE': JSON.stringify('local'),
        'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api/v1'),
      },
    } : {}),
    plugins: [
      react(),
      {
        name: 'packit-api-v1',
        configureServer(server) {
          server.middlewares.use(createViteApiMiddleware(env))
        },
        configurePreviewServer(server) {
          server.middlewares.use(createViteApiMiddleware(env))
        },
      },
      boxSpecApi(env),
    ],
    server: { port: 5173, strictPort: true },
  }
})
