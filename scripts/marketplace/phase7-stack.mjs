// Dedicated local-only stack. Never use this helper against another Supabase workdir.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync, cpSync, existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
const root=resolve(import.meta.dirname,'../..')
const workdir=resolve(root,'tmp/marketplace-phase7-local')
const dir=resolve(workdir,'supabase')
const action=process.argv[2]??'prepare'
assert(['prepare','start','reset','test'].includes(action),'Use prepare, start, reset or test')
mkdirSync(dir,{recursive:true})
const file=resolve(dir,'config.toml')
if(existsSync(file))assert.match(readFileSync(file,'utf8'),/^project_id = "packit-marketplace-phase7-local"$/m)
if(action==='prepare') {
  let config=readFileSync(resolve(root,'supabase/config.toml'),'utf8').replace('project_id = "gen-package"','project_id = "packit-marketplace-phase7-local"')
  for(const [from,to] of [[54320,55430],[54321,55431],[54322,55432],[54323,55433],[54324,55434],[54325,55435],[54326,55436],[54327,55437],[54329,55439],[8083,55438]])config=config.replaceAll(String(from),String(to))
  config=config.replace('[auth.mfa.totp]\nenroll_enabled = false\nverify_enabled = false','[auth.mfa.totp]\nenroll_enabled = true\nverify_enabled = true').replace('sign_in_sign_ups = 30','sign_in_sign_ups = 300').replace('token_verifications = 30','token_verifications = 300').replace('sql_paths = ["./seed.sql"]','sql_paths = []')
  writeFileSync(file,config)
  cpSync(resolve(root,'supabase/migrations'),resolve(dir,'migrations'),{recursive:true})
  cpSync(resolve(root,'supabase/tests'),resolve(dir,'tests'),{recursive:true})
  const hashes=readdirSync(resolve(dir,'migrations')).filter(n=>n.endsWith('.sql')).sort().map(name=>({name,sha256:createHash('sha256').update(readFileSync(resolve(dir,'migrations',name))).digest('hex')}))
  writeFileSync(resolve(workdir,'migration-manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),hashes},null,2)+'\n')
  console.log('Prepared isolated phase7 stack and migration manifest. Copying files does not apply them.')
} else {
  assert(existsSync(file),'Prepare first')
  const commands={start:['start'],reset:['db','reset','--local'],test:['test','db']}
  const run=spawnSync(process.execPath,[resolve(root,'node_modules/supabase/dist/supabase.js'),...commands[action],'--workdir',workdir],{encoding:'utf8',cwd:root})
  // Supabase start/status output may contain generated local secrets. Keep output out of console.
  const log=resolve(workdir,`${action}.log`)
  writeFileSync(log,run.stdout+'\n'+run.stderr,{mode:0o600})
  console.log(`${action}: ${run.status===0?'PASS':'FAIL'} (local evidence saved)`)
  process.exitCode=run.status??1
}
