// Isolated browser-QA server: synthetic public config, no environment files or backend middleware.
import { createServer, build } from 'vite'
import react from '@vitejs/plugin-react'
const config = {configFile:false,envFile:false,envDir:false,envPrefix:[],plugins:[react()],define:{'import.meta.env.VITE_APP_MODE':JSON.stringify('cloud'),'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('http://127.0.0.1:59999'),'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify('fixture-not-a-real-key'),'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api/v1'),'import.meta.env.VITE_MARKETPLACE_SUPPLIERS_ENABLED':JSON.stringify(process.argv.includes('--feature-off')?'false':'true')},server:{host:'127.0.0.1',port:56391,strictPort:true}}
if(process.argv.includes('--build')) await build({...config,build:{outDir:process.argv.includes('--feature-off')?'tmp/studio/build-feature-off':'tmp/studio/build',emptyOutDir:true}})
else {const server=await createServer(config);await server.listen();server.printUrls()}
