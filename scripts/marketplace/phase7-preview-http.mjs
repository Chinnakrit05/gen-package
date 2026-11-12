// Real local preview capture only. Never prints/exports auth sessions.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import postgres from 'postgres'
import sharp from 'sharp'
const dir=resolve(process.argv[2]??'tmp/marketplace-phase7-local')
assert.match(readFileSync(resolve(dir,'supabase/config.toml'),'utf8'),/^project_id = "packit-marketplace-phase7-local"$/m)
const f=JSON.parse(readFileSync(resolve(dir,'browser-fixture.json'),'utf8'))
assert.equal(new URL(f.origin).hostname,'127.0.0.1');assert.equal(new URL(f.apiUrl).port,'55431')
const sql=postgres('postgresql://postgres:postgres@127.0.0.1:55432/postgres',{max:1})
async function call(path,actor='buyer',method='GET',body,status=200){
 const res=await fetch(f.origin+'/api/v1'+path,{method,headers:{authorization:'Bearer '+f.actors[actor].session.access_token,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)})
 const json=await res.json();assert.equal(res.status,status,`${method} ${path}: ${json.error?.code??'success'}`);return json.data
}
try {
 const project=randomUUID(),spec={template:'tuck-end',materialId:'carton-300',W:80,D:50,H:120,handle:false}
 await sql`insert into app_private.projects(id,workspace_id,created_by,name,document_schema_version,document) values(${project},${f.actors.buyer.workspaceId},${f.actors.buyer.id},'Isolated preview fixture',1,${sql.json({live:spec})})`
 const bytes=await sharp({create:{width:160,height:100,channels:3,background:{r:43,g:107,b:86}}}).jpeg().toBuffer()
 await call(`/projects/${project}/thumbnail`,'buyer','PUT',{mimeType:'image/jpeg',imageBase64:bytes.toString('base64'),kind:'box',label:'Synthetic saved preview'})
 const draft=await call('/marketplace/requests','buyer','POST',{workspaceId:f.actors.buyer.workspaceId,projectId:project,expectedProjectRevision:1,operationId:randomUUID(),title:'Immutable preview acceptance',quantity:50,notes:'Synthetic only'},201)
 const publication=await call(`/marketplace/requests/${draft.id}/publication`,'buyer','POST',{supplierIds:[f.supplier.id]})
 const path=`/marketplace/requests/${draft.id}/revisions/${publication.revisionId}/preview`
 const captured=await call(path)
 assert.equal(captured.preview.dataBase64,bytes.toString('base64'));assert.equal(captured.preview.sourceProjectRevision,null);assert.equal(captured.preview.match,'unverified_reference')
 await call(path,'outsider','GET',undefined,404)
 const supplierPath=`/suppliers/${f.supplier.id}/quote-requests/${draft.id}/revisions/${publication.revisionId}/preview`
 assert.deepEqual(await call(supplierPath,'supplier'),captured)
 const changed=await sharp({create:{width:160,height:100,channels:3,background:{r:160,g:80,b:40}}}).jpeg().toBuffer()
 await call(`/projects/${project}/thumbnail`,'buyer','PUT',{mimeType:'image/jpeg',imageBase64:changed.toString('base64'),kind:'box',label:'Changed later'})
 await sql`delete from app_private.project_thumbnails where project_id=${project}`
 assert.deepEqual(await call(path),captured)
 const revised=await call(`/marketplace/requests/${draft.id}/revisions`,'buyer','POST',{operationId:randomUUID(),expectedRevisionId:publication.revisionId,title:'Revised preview reference',quantity:100,notes:'Dimensions changed after capture',spec:{...spec,W:100},acceptingUntil:new Date(Date.now()+86400000).toISOString()})
 const currentRevisionId=revised.currentRevision.id
 const reference=await call(`/marketplace/requests/${draft.id}/revisions/${currentRevisionId}/preview`)
 assert.equal(reference.preview.match,'original_reference');assert.equal(reference.preview.dataBase64,captured.preview.dataBase64)
 const qp=`/suppliers/${f.supplier.id}/quote-requests/${draft.id}/quotation`
 let quote=await call(qp,'supplier','PUT',{operationId:randomUUID(),expectedRevision:0,requestRevisionId:currentRevisionId,totalMinor:10000,depositMinor:0,currency:'THB',leadDays:3,requiresProof:false,notes:'Synthetic',validUntil:new Date(Date.now()+86400000).toISOString()})
 quote=await call(qp+'/send','supplier','POST',{operationId:randomUUID(),expectedRevision:quote.revision})
 const order=await call(`/marketplace/requests/${draft.id}/select-quotation`,'buyer','POST',{operationId:randomUUID(),quoteRevisionId:quote.current.id})
 assert.deepEqual(await call(`/marketplace/production-orders/${order.id}/preview`),reference)
 await call(`/marketplace/production-orders/${order.id}/preview`,'outsider','GET',undefined,404)
 // IDs only, no credentials: browser may exercise these dedicated fixture objects.
 writeFileSync(resolve(dir,'preview-fixture-ids.json'),JSON.stringify({requestId:draft.id,originalRevisionId:publication.revisionId,currentRevisionId,orderId:order.id,supplierId:f.supplier.id}),{mode:0o600})
 console.log('PASS real HTTP/Auth:actual saved JPEG captured,private buyer/supplier access,source unknown explicitly labeled,bytes survive overwrite/deletion,revised-spec original reference,accepted-order exact revision preview and outsider denial')
} finally {await sql.end()}
