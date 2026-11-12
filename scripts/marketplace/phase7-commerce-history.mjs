// Uses synthetic local actors without printing tokens, and creates its own RFQ.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
const dir=resolve(process.argv[2]??'tmp/marketplace-phase7-local')
assert.match(readFileSync(resolve(dir,'supabase/config.toml'),'utf8'),/^project_id = "packit-marketplace-phase7-local"$/m)
const f=JSON.parse(readFileSync(resolve(dir,'browser-fixture.json'),'utf8'))
assert.equal(new URL(f.origin).hostname,'127.0.0.1')
assert.equal(new URL(f.apiUrl).port,'55431')
async function call(path,actor='buyer',method='GET',body,status=200){
 const res=await fetch(f.origin+'/api/v1'+path,{method,headers:{authorization:'Bearer '+f.actors[actor].session.access_token,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)})
 const json=await res.json();assert.equal(res.status,status,`${method} ${path}: ${json.error?.code??'success'}`);return json.data
}
const draft=await call('/marketplace/requests','buyer','POST',{workspaceId:f.actors.buyer.workspaceId,projectId:f.request.projectId,expectedProjectRevision:f.request.projectRevision,operationId:randomUUID(),title:'Isolated history acceptance',quantity:50,notes:'Synthetic only'},201)
const base='/marketplace/requests/'+draft.id
const publication=await call(base+'/publication','buyer','POST',{supplierIds:[f.supplier.id]})
let trading=await call(base+'/trading')
assert.equal(trading.currentRevision.id,publication.revisionId)
const original=structuredClone(trading.currentRevision)
const quotePath=`/suppliers/${f.supplier.id}/quote-requests/${draft.id}/quotation`
const terms={operationId:randomUUID(),expectedRevision:0,requestRevisionId:publication.revisionId,totalMinor:10000,depositMinor:0,currency:'THB',leadDays:3,requiresProof:false,notes:'Original immutable terms',validUntil:new Date(Date.now()+86400000).toISOString()}
let quote=await call(quotePath,'supplier','PUT',terms)
quote=await call(quotePath+'/send','supplier','POST',{operationId:randomUUID(),expectedRevision:quote.revision})
const sent=structuredClone(quote.current)
for(let i=2;i<=26;i++){
 const input={operationId:randomUUID(),expectedRevisionId:trading.currentRevision.id,title:'History spec '+i,quantity:50+i,notes:'Revision '+i,spec:{...original.spec,W:80+i},acceptingUntil:new Date(Date.now()+7*86400000).toISOString()}
 const revised=await call(base+'/revisions','buyer','POST',input)
 if(i===2){assert.deepEqual(await call(base+'/revisions','buyer','POST',input),revised);await call(base+'/revisions','buyer','POST',{...input,quantity:999},409)}
 trading=revised
}
assert.equal(trading.currentRevision.revision,26)
assert.equal(trading.revisions.length,24)
assert.equal(trading.revisionsNextCursor,3)
const older=await call(base+'/revisions?cursor=3')
assert.deepEqual(older.items.map(x=>x.revision),[2,1])
assert.deepEqual(older.items[1],original)
const supplierView=await call(`/suppliers/${f.supplier.id}/quote-requests/${draft.id}`,'supplier')
assert.equal(supplierView.revisionId,trading.currentRevision.id)
assert.equal(supplierView.spec.W,106)
const oldHistory=await call(`/marketplace/quotations/${quote.id}/history`)
assert.deepEqual(oldHistory.items[0],sent)
await call(base+'/select-quotation','buyer','POST',{operationId:randomUUID(),quoteRevisionId:sent.id},409)
await call(base+'/revisions','outsider','GET',undefined,404)
await call(`/marketplace/quotations/${quote.id}/history`,'outsider','GET',undefined,404)
let notifications=await call('/marketplace/commerce-notifications','supplier')
assert.equal(notifications.items.length,24)
assert(notifications.nextCursor)
const page2=await call('/marketplace/commerce-notifications?cursor='+notifications.nextCursor,'supplier')
assert(!page2.items.some(x=>notifications.items.some(y=>x.id===y.id)))
const first=notifications.items[0]
const read=await call(`/marketplace/commerce-notifications/${first.id}/read`,'supplier','POST',{})
assert.deepEqual(await call(`/marketplace/commerce-notifications/${first.id}/read`,'supplier','POST',{}),read)
await call(`/marketplace/commerce-notifications/${first.id}/read`,'outsider','POST',{},404)
console.log('PASS real HTTP/Auth:26 immutable specs,24+2 history pagination,current supplier snapshot,revision replay/payload binding,immutable quote history,stale quote refusal,private histories,24+next notification pagination and idempotent private read receipts')
console.log('Synthetic acceptance RFQ retained in isolated stack; no browser fixture was modified')
