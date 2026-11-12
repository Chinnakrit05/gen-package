// Real full database backup/restore for ONLY the isolated synthetic phase7 stack.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postgres from 'postgres'
const root=resolve(import.meta.dirname,'../..'), workdir=resolve(root,'tmp/marketplace-phase7-local')
assert.match(readFileSync(resolve(workdir,'supabase/config.toml'),'utf8'),/^project_id = "packit-marketplace-phase7-local"$/m)
const status=spawnSync(process.execPath,[resolve(root,'node_modules/supabase/dist/supabase.js'),'status','-o','json','--workdir',workdir],{encoding:'utf8'})
assert.equal(status.status,0)
const local=JSON.parse(status.stdout), url=new URL(local.DB_URL)
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55432')
const sql=postgres(local.DB_URL,{max:2}), container='supabase_db_packit-marketplace-phase7-local'
function docker(args){const r=spawnSync('docker',['exec',container,...args],{encoding:'utf8'});assert.equal(r.status,0,`Local restore command ${args[0]} failed: ${r.stderr}`);return r.stdout}
async function fingerprints(db){const tables=await db`select tablename from pg_tables where schemaname='app_private' order by tablename`;const rows=[];for(const {tablename} of tables){const [row]=await db.unsafe(`select count(*)::int as count, md5(coalesce(string_agg(h,'' order by h),'')) as checksum from (select md5(row_to_json(t)::text) h from app_private."${tablename}" t) x`);rows.push({table:tablename,...row})}return rows}
let before
try {
 await sql.begin('isolation level repeatable read read only',async tx=>{
   const [{snapshot}]=await tx`select pg_export_snapshot() snapshot`
   before=await fingerprints(tx)
   docker(['pg_dump','-U','supabase_admin','-Fc','-d','postgres','--snapshot',snapshot,'-f','/tmp/phase7-restore.dump'])
 })
 const present=docker(['psql','-U','supabase_admin','-d','postgres','-Atc',"select datname from pg_database where datname='phase7_restore'"]).trim()
 if(present)docker(['dropdb','-U','supabase_admin','phase7_restore'])
 docker(['createdb','-U','supabase_admin','phase7_restore'])
 docker(['pg_restore','-U','supabase_admin','-d','phase7_restore','--exit-on-error','/tmp/phase7-restore.dump'])
 url.pathname='/phase7_restore';const restored=postgres(url.toString(),{max:1})
 try {const after=await fingerprints(restored);assert.deepEqual(after,before)
 const commerce=after.filter(r=>/quotation|conversation|production|proof|payment|commerce|quote_request/.test(r.table))
 assert(commerce.some(r=>r.table==='marketplace_production_orders'&&r.count>0),'Restore must include actual order fixtures')
 writeFileSync(resolve(workdir,'restore-evidence.json'),JSON.stringify({at:new Date().toISOString(),result:'PASS',tableCount:after.length,commerce},null,2)+'\n')
 console.log(`PASS full pg_dump/restore: ${after.length} app_private table row counts and content hashes identical, including synthetic commerce/orders/messages/files/proofs/payments. No source data changed.`)
 } finally {await restored.end()}
} finally {await sql.end()}
