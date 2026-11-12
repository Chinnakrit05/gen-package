import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'

const url = process.env.PACKIT_TEST_DATABASE_URL
if (url) {
  const target = new URL(url)
  if (target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/postgres') throw new Error('Only isolated phase7 loopback database is allowed')
}
const sql = postgres(url ?? 'postgresql://postgres:postgres@127.0.0.1:55432/postgres', { max: 2 })
const spec = { template:'tuck-end', materialId:'carton-300', W:80, D:50, H:120, handle:false }
const rollback = Symbol('rollback synthetic fixture')
async function scenario(run: (tx: postgres.TransactionSql, f: Awaited<ReturnType<typeof fixture>>) => Promise<void>, withPreview = false) {
  try { await sql.begin(async tx => { await run(tx, await fixture(tx, withPreview)); throw rollback }) }
  catch (error) { if (error !== rollback) throw error }
}
async function fixture(tx: postgres.TransactionSql, withPreview = false) {
  const buyer=randomUUID(), manager=randomUUID(), invitee=randomUUID(), stranger=randomUUID(), rival=randomUUID()
  const workspace=randomUUID(), supplierWorkspace=randomUUID(), rivalWorkspace=randomUUID(), supplier=randomUUID(), rivalSupplier=randomUUID(), project=randomUUID(), request=randomUUID(), revision=randomUUID()
  await tx`insert into app_private.app_users(id,display_name) values(${buyer},'Lifecycle buyer'),(${manager},'Lifecycle manager'),(${invitee},'Marketplace-only invitee'),(${stranger},'Unrelated actor'),(${rival},'Rival manager')`
  await tx`insert into app_private.workspaces(id,kind,owner_user_id,name) values(${workspace},'team',${buyer},'Buyer'),(${supplierWorkspace},'team',${manager},'Supplier'),(${rivalWorkspace},'team',${rival},'Rival')`
  await tx`insert into app_private.workspace_members(workspace_id,user_id,role) values(${workspace},${buyer},'owner'),(${supplierWorkspace},${manager},'owner'),(${rivalWorkspace},${rival},'owner')`
  await tx`insert into app_private.workspace_marketplace_members(workspace_id,user_id,role,requires_workspace_membership) values(${supplierWorkspace},${manager},'manager',false),(${supplierWorkspace},${invitee},'staff',false),(${rivalWorkspace},${rival},'manager',false)`
  await tx`insert into app_private.supplier_profiles(id,workspace_id,kind,name,slug,description,contact_email,status) values(${supplier},${supplierWorkspace},'factory','Lifecycle supplier',${'life-'+supplier},'','life@example.test','approved'),(${rivalSupplier},${rivalWorkspace},'factory','Rival supplier',${'life-'+rivalSupplier},'','rival@example.test','approved')`
  await tx`insert into app_private.projects(id,workspace_id,created_by,name,document_schema_version,document) values(${project},${workspace},${buyer},'Lifecycle',1,${tx.json({live:spec})})`
  await tx`insert into app_private.quote_request_drafts(id,workspace_id,project_id,created_by,project_name,project_revision,title,quantity,notes,spec) values(${request},${workspace},${project},${buyer},'Lifecycle',1,'Lifecycle RFQ',100,'',${tx.json(spec)})`
  if (withPreview) {
    await tx`update app_private.projects set revision=2 where id=${project}`
    await tx`insert into app_private.project_thumbnails(project_id,workspace_id,mime_type,image,kind,label) values(${project},${workspace},'image/jpeg',decode('ffd8ff010203','hex'),'box','Synthetic preview')`
  }
  await tx`insert into app_private.quote_request_publications(request_id,revision_id,published_by) values(${request},${revision},${buyer})`
  await tx`insert into app_private.quote_request_supplier_access(request_id,supplier_id,supplier_name) values(${request},${supplier},'Lifecycle supplier'),(${request},${rivalSupplier},'Rival supplier')`
  const terms={requestRevisionId:revision,totalMinor:10000,depositMinor:0,currency:'THB',leadDays:5,requiresProof:true,validUntil:new Date(Date.now()+86400000).toISOString(),notes:''}
  await tx`set local role service_role`
  await tx`select public.marketplace_quotation_write(${manager},${supplier},${request},'save',${tx.json({...terms,operationId:randomUUID(),expectedRevision:0})})`
  const [sent]=await tx`select public.marketplace_quotation_write(${manager},${supplier},${request},'send',${tx.json({operationId:randomUUID(),expectedRevision:1})}) result`
  async function select() { const [r]=await tx`select public.marketplace_order_select(${buyer},${request},${tx.json({operationId:randomUUID(),quoteRevisionId:sent.result.current.id})}) result`; return r.result }
  async function action(actor:string,order:string,name:string,revision:number,extra:Record<string,unknown>={}) {
    const input={operationId:randomUUID(),expectedRevision:revision,...extra}
    const [r]=await tx`select public.marketplace_order_action(${actor},${order},${name},${tx.json(input as postgres.JSONValue)}) result`; return r.result
  }
  return {buyer,manager,invitee,stranger,rival,supplier,rivalSupplier,request,revision,project,workspace,select,action}
}
afterAll(async()=>{await sql.end()})
describe.skipIf(!url)('real Marketplace lifecycle and notification regressions',()=>{
 it('reopens after decline within deadline and stays closed after deadline',async()=>scenario(async(tx,f)=>{
  let order=await f.select()
  await f.action(f.manager,order.id,'decline',order.revision,{reason:'Synthetic decline'})
  let [state]=await tx`select public.marketplace_request_trading_get(${f.buyer},${f.request},null) result`
  expect(state.result.status).toBe('open')
  order=await f.select()
  await tx`reset role`
  await tx`update app_private.marketplace_request_trading set accepting_until=clock_timestamp()-interval '1 second' where request_id=${f.request}`
  await tx`set local role service_role`
  await f.action(f.manager,order.id,'decline',order.revision,{reason:'Synthetic expired bidding'})
  ;[state]=await tx`select public.marketplace_request_trading_get(${f.buyer},${f.request},null) result`
  expect(state.result.status).toBe('closed')
  await expect(tx.savepoint(()=>f.select())).rejects.toThrow('MARKETPLACE_CONFLICT')
 }))
 it('expires stale pending selection before making exactly one replacement',async()=>scenario(async(tx,f)=>{
  const first=await f.select()
  await tx`reset role`
  await tx`update app_private.marketplace_production_orders set confirmation_deadline=clock_timestamp()-interval '1 second' where id=${first.id}`
  await tx`set local role service_role`
  await expect(tx.savepoint(()=>f.action(f.manager,first.id,'confirm',first.revision))).rejects.toThrow('MARKETPLACE_CONFLICT')
  const second=await f.select()
  expect(second.id).not.toBe(first.id)
  const [old]=await tx`select status from app_private.marketplace_production_orders where id=${first.id}`
  expect(old.status).toBe('expired')
 }))
 it('requires explicit latest proof approval and keeps older approvals immutable',async()=>scenario(async(tx,f)=>{
  let order=await f.select(); order=await f.action(f.manager,order.id,'confirm',order.revision)
  const [room]=await tx`select public.marketplace_ensure_conversation(${f.manager},${f.request},${f.supplier}) result`
  const content=Buffer.from('%PDF-1.4\nsynthetic proof\n%%EOF').toString('base64')
  const [file]=await tx`select public.marketplace_upload_conversation_file(${f.manager},${room.result.id},${randomUUID()},'proof.pdf','application/pdf',${content}) result`
  order=await f.action(f.manager,order.id,'proof',order.revision,{fileId:file.result.id,notes:'First'})
  await expect(tx.savepoint(()=>f.action(f.buyer,order.id,'approve-proof',order.revision))).rejects.toThrow('REVISION_CONFLICT')
  const firstProof=order.proofs[0].id
  order=await f.action(f.buyer,order.id,'approve-proof',order.revision,{proofId:firstProof})
  order=await f.action(f.manager,order.id,'proof',order.revision,{fileId:file.result.id,notes:'Second immutable version'})
  await expect(tx.savepoint(()=>f.action(f.buyer,order.id,'approve-proof',order.revision,{proofId:firstProof}))).rejects.toThrow('REVISION_CONFLICT')
  await expect(tx.savepoint(()=>f.action(f.manager,order.id,'start-production',order.revision))).rejects.toThrow('MARKETPLACE_CONFLICT')
  expect(order.proofs[0].approvedAt).not.toBeNull()
  expect(order.proofs[1].approvedAt).toBeNull()
  order=await f.action(f.buyer,order.id,'approve-proof',order.revision,{proofId:order.proofs[1].id})
  order=await f.action(f.manager,order.id,'start-production',order.revision)
  expect(order.status).toBe('in_production')
  const [download]=await tx`select public.marketplace_order_download_file(${f.buyer},${order.id},${file.result.id}) result`
  expect(download.result.dataBase64).toBe(content)
  await expect(tx.savepoint(()=>tx`select public.marketplace_order_download_file(${f.rival},${order.id},${file.result.id})`)).rejects.toThrow()
 }))
 it('delivers invitee notifications without design membership and hides competing order identity',async()=>scenario(async(tx,f)=>{
  const order=await f.select(); await f.action(f.manager,order.id,'confirm',order.revision)
  const [own]=await tx`select public.marketplace_commerce_notifications(${f.invitee},null) result`
  expect(own.result.items.some((x:{kind:string})=>x.kind==='order_confirm')).toBe(true)
  const [rival]=await tx`select public.marketplace_commerce_notifications(${f.rival},null) result`
  const notices=rival.result.items.filter((x:{requestId:string})=>x.requestId===f.request)
  expect(notices).toHaveLength(1)
  expect(notices[0].kind).toBe('request_awarded')
  expect(notices[0].entityId).toBe(f.request)
  expect(JSON.stringify(notices)).not.toContain(order.id)
  const [stranger]=await tx`select public.marketplace_commerce_notifications(${f.stranger},null) result`
  expect(stranger.result.items).toHaveLength(0)
  await tx`reset role`
  await tx`delete from app_private.workspace_marketplace_members where user_id=${f.invitee}`
  await tx`set local role service_role`
  const [revoked]=await tx`select public.marketplace_commerce_notifications(${f.invitee},null) result`
  expect(revoked.result.items).toHaveLength(0)
 }))
 it('freezes actual preview bytes with honest provenance across source changes and revised specs',async()=>scenario(async(tx,f)=>{
  const [captured]=await tx`select public.marketplace_request_preview(${f.buyer},${f.request},${f.revision},null) result`
  const initial=captured.result.preview
  expect(initial.dataBase64).toBe(Buffer.from('ffd8ff010203','hex').toString('base64'))
  expect(initial.sourceProjectRevision).toBeNull()
  expect(initial.frozenRequestProjectRevision).toBe(1)
  expect(initial.projectRevisionAtCapture).toBe(2)
  expect(initial.match).toBe('unverified_reference')
  await tx`reset role`
  await tx`update app_private.project_thumbnails set image=decode('ffd8ff9999','hex') where project_id=${f.project}`
  await tx`delete from app_private.project_thumbnails where project_id=${f.project}`
  await tx`set local role service_role`
  const [supplierView]=await tx`select public.marketplace_request_preview(${f.manager},${f.request},${f.revision},${f.supplier}) result`
  expect(supplierView.result.preview).toEqual(initial)
  await expect(tx.savepoint(()=>tx`select public.marketplace_request_preview(${f.stranger},${f.request},${f.revision},null)`)).rejects.toThrow()
  await expect(tx.savepoint(()=>tx`select public.marketplace_request_preview(${f.manager},${f.request},${randomUUID()},${f.supplier})`)).rejects.toThrow('MARKETPLACE_NOT_FOUND')
  const [revised]=await tx`select public.marketplace_request_revise(${f.buyer},${f.request},${tx.json({operationId:randomUUID(),expectedRevisionId:f.revision,title:'Different dimensions',quantity:100,notes:'',spec:{...spec,W:110},acceptingUntil:new Date(Date.now()+86400000).toISOString()})}) result`
  const [reference]=await tx`select public.marketplace_request_preview(${f.buyer},${f.request},${revised.result.currentRevision.id},null) result`
  expect(reference.result.preview.match).toBe('original_reference')
  expect(reference.result.preview.dataBase64).toBe(initial.dataBase64)
  expect(reference.result.preview.sourceRequestRevisionId).toBe(f.revision)
  const [{canUpdate}]=await tx`select has_table_privilege('service_role','app_private.marketplace_request_previews','UPDATE') as "canUpdate"`
  expect(canUpdate).toBe(false)
 },true))
 it('uses accepted immutable preview for orders and never retroactively captures a missing image',async()=>scenario(async(tx,f)=>{
  const order=await f.select()
  const [preview]=await tx`select public.marketplace_order_preview(${f.buyer},${order.id}) result`
  expect(preview.result.preview).toBeNull()
  await tx`reset role`
  await tx`insert into app_private.project_thumbnails(project_id,workspace_id,mime_type,image,kind,label) values(${f.project},${f.workspace},'image/jpeg',decode('ffd8ff0405','hex'),'box','Later image')`
  await tx`set local role service_role`
  const [later]=await tx`select public.marketplace_order_preview(${f.manager},${order.id}) result`
  expect(later.result.preview).toBeNull()
  await expect(tx.savepoint(()=>tx`select public.marketplace_order_preview(${f.rival},${order.id})`)).rejects.toThrow()
 }))

 it('skips corrupt legacy thumbnails and enforces the immutable snapshot byte cap',async()=>scenario(async(tx,f)=>{
  await tx`insert into app_private.project_thumbnails(project_id,workspace_id,mime_type,image,kind,label) values(${f.project},${f.workspace},'image/jpeg',decode('010203','hex'),'box','Invalid legacy bytes')`
  const request=randomUUID(), revision=randomUUID()
  await tx`insert into app_private.quote_request_drafts(id,workspace_id,project_id,created_by,project_name,project_revision,title,quantity,notes,spec)
    select ${request},workspace_id,project_id,created_by,project_name,project_revision,'Corrupt legacy image',quantity,notes,spec from app_private.quote_request_drafts where id=${f.request}`
  await tx`insert into app_private.quote_request_publications(request_id,revision_id,published_by) values(${request},${revision},${f.buyer})`
  const [missing]=await tx`select public.marketplace_request_preview(${f.buyer},${request},${revision},null) result`
  expect(missing.result.preview).toBeNull()
  await expect(tx.savepoint(()=>tx`insert into app_private.marketplace_request_previews(request_id,source_request_revision_id,mime_type,image,frozen_request_project_revision,project_revision_at_capture,thumbnail_updated_at)
    values(${request},${revision},'image/jpeg',repeat('x',65537)::bytea,1,1,clock_timestamp())`)).rejects.toThrow('check constraint')
 }))

 it('returns authoritative conversation side for buyer, supplier, viewer and dual-role actors',async()=>scenario(async(tx,f)=>{
  const [room]=await tx`select public.marketplace_ensure_conversation(${f.buyer},${f.request},${f.supplier}) result`
  expect(room.result.side).toBe('buyer')
  for (const actor of [f.manager,f.invitee]) {
    const [view]=await tx`select public.marketplace_get_conversation(${actor},${room.result.id}) result`
    expect(view.result.side).toBe('supplier')
  }
  await tx`reset role`
  await tx`insert into app_private.workspace_marketplace_members(workspace_id,user_id,role,requires_workspace_membership)
    select workspace_id,${f.stranger},'viewer',false from app_private.supplier_profiles where id=${f.supplier}`
  await tx`insert into app_private.workspace_marketplace_members(workspace_id,user_id,role,requires_workspace_membership)
    select workspace_id,${f.buyer},'manager',false from app_private.supplier_profiles where id=${f.supplier}`
  await tx`set local role service_role`
  const [viewer]=await tx`select public.marketplace_get_conversation(${f.stranger},${room.result.id}) result`
  expect(viewer.result.side).toBe('supplier'); expect(viewer.result.canWrite).toBe(false)
  const [dual]=await tx`select public.marketplace_get_conversation(${f.buyer},${room.result.id}) result`
  expect(dual.result.side).toBe('buyer')
 }))

})
