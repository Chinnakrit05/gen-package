// static server สำหรับวัด cold load ของ build (SPA fallback → index.html) — ไม่มี API
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
const [root, port] = [process.argv[2], Number(process.argv[3])]
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' }
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname.startsWith('/api/')) { res.writeHead(503, { 'content-type': 'application/json' }); return res.end('{"error":{"code":"NO_API_IN_STATIC_SERVER"}}') }
  let file = path.resolve(root, '.' + decodeURIComponent(url.pathname))
  if (!file.startsWith(path.resolve(root)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html')
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
}).listen(port, () => console.log('serving', root, port))
