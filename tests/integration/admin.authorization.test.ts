import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'

const url = process.env.PACKIT_TEST_DATABASE_URL
if (url) {
  const target = new URL(url)
  if (target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/postgres') throw new Error('Admin audit requires dedicated local phase7 database')
}
const sql = postgres(url ?? 'postgresql://postgres:postgres@127.0.0.1:55432/postgres', { max: 2 })
type Tx = postgres.TransactionSql
const reason = 'Investigate synthetic support case'

async function fixture(tx: Tx) {
  const buyer = randomUUID(), supplierOwner = randomUUID(), support = randomUUID(), supervisor = randomUUID(), other = randomUUID(), ops = randomUUID(), auditor = randomUUID()
  for (const id of [buyer,supplierOwner,support,supervisor,other,ops,auditor]) await tx`insert into app_private.app_users(id,display_name) values (${id},'Synthetic admin audit')`
  const workspace = randomUUID(), supplierWorkspace = randomUUID(), supplier = randomUUID(), project = randomUUID(), request = randomUUID(), revision = randomUUID(), room = randomUUID(), foreignRoom = randomUUID()
  await tx`insert into app_private.workspaces(id,kind,owner_user_id,name) values (${workspace},'team',${buyer},'Audit buyer'),(${supplierWorkspace},'team',${supplierOwner},'Audit supplier')`
  await tx`insert into app_private.workspace_members(workspace_id,user_id,role) values (${workspace},${buyer},'owner'),(${supplierWorkspace},${supplierOwner},'owner')`
  await tx`insert into app_private.workspace_marketplace_members(workspace_id,user_id,role) values (${supplierWorkspace},${supplierOwner},'manager')`
  await tx`insert into app_private.supplier_profiles(id,workspace_id,kind,name,slug,description,contact_email,status) values (${supplier},${supplierWorkspace},'factory','Audit supplier',${`admin-${supplier}`},'','audit@example.test','approved')`
  const spec = { template:'tuck-end',materialId:'carton-300',W:80,D:50,H:120,handle:false }
  await tx`insert into app_private.projects(id,workspace_id,created_by,name,document_schema_version,document) values (${project},${workspace},${buyer},'Audit project',1,${tx.json({live:spec})})`
  for (const [rfq, rev, conversation] of [[request,revision,room],[randomUUID(),randomUUID(),foreignRoom]]) {
    await tx`insert into app_private.quote_request_drafts(id,workspace_id,project_id,created_by,project_name,project_revision,title,quantity,notes,spec) values (${rfq},${workspace},${project},${buyer},'Audit project',1,'Audit request',500,'',${tx.json(spec)})`
    await tx`insert into app_private.quote_request_publications(request_id,revision_id,published_by) values (${rfq},${rev},${buyer})`
    await tx`insert into app_private.quote_request_supplier_access(request_id,supplier_id,supplier_name) values (${rfq},${supplier},'Audit supplier')`
    await tx`insert into app_private.marketplace_conversations(id,request_id,supplier_id,last_sequence) values (${conversation},${rfq},${supplier},1)`
  }
  await tx`insert into app_private.marketplace_admin_grants(user_id,scope) values (${support},'support'),(${other},'support'),(${supervisor},'support_supervisor'),(${ops},'operations'),(${auditor},'auditor')`
  const message = randomUUID(), sharedFile = randomUUID(), unsentFile = randomUUID(), foreignFile = randomUUID()
  for (const [conversation,file] of [[room,sharedFile],[room,unsentFile],[foreignRoom,foreignFile]]) {
    await tx`insert into app_private.marketplace_conversation_files(conversation_id,id,created_by,name,mime_type,content,byte_size) values (${conversation},${file},${buyer},'fixture.pdf','application/pdf',decode('255044462d','hex'),5)`
  }
  await tx`insert into app_private.marketplace_conversation_messages(conversation_id,id,sequence,sender_id,sender_name,body) values (${room},${message},1,${buyer},'Audit buyer','Private audit message')`
  await tx`insert into app_private.marketplace_conversation_file_grants(conversation_id,message_id,file_id) values (${room},${message},${sharedFile})`
  return { buyer,supplierOwner,support,supervisor,other,ops,auditor,request,room,foreignRoom,sharedFile,unsentFile,foreignFile }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
async function asService<T>(tx: Tx, run: (s: Tx) => Promise<T>): Promise<T> {
  return tx.savepoint(async s => {
    await s`set local role service_role`
    const result = await run(s)
    await s`set local role none`
    return result
  }) as Promise<T>
}
async function withFixture(run: (tx: Tx, f: Fixture) => Promise<void>) {
  const rollback = new Error('ROLLBACK_AUDIT_FIXTURE')
  try { await sql.begin(async tx => { const f = await fixture(tx); await run(tx,f); throw rollback }) }
  catch (error) { if (error !== rollback) throw error }
}
async function createCase(tx: Tx, f: Fixture, permissions = ['messages','message_files']) {
  const input = { operationId:randomUUID(),title:'Synthetic support case',reason,assignedTo:f.support,conversationId:f.room,orderId:null,permissions,expiresAt:new Date(Date.now()+3600000).toISOString() }
  const [row] = await asService(tx, s => s`select public.marketplace_support_case_create(${f.supervisor},${s.json(input)}) as result`)
  return row.result
}
async function access(tx: Tx, actor: string, caseId: string, accessReason = reason) {
  return asService(tx, s => s`select public.marketplace_support_access(${actor},${caseId},${s.json({view:'messages',reason:accessReason})}) as result`)
}
async function file(tx: Tx, actor: string, caseId: string, id: string) {
  return asService(tx, s => s`select public.marketplace_support_file(${actor},${caseId},${id},${reason}) as result`)
}

describe.skipIf(!url)('independent scoped admin authorization audit', () => {
  it('orders recent case audit first and paginates tied timestamps stably across inserts', () => withFixture(async (tx,f) => {
    const c=await createCase(tx,f)
    await access(tx,f.support,c.id)
    const stamp=new Date(Date.now()+86400000).toISOString()
    const recent=new Date(Date.now()+86401000).toISOString()
    const ids=Array.from({length:30},()=>randomUUID()).sort().reverse()
    for(const id of ids) await tx`insert into app_private.marketplace_admin_audit(id,actor_id,action,object_type,reason,created_at) values (${id},${f.ops},'tie_fixture','audit',${reason},${stamp})`
    await tx`update app_private.marketplace_admin_audit set created_at=${recent} where actor_id=${f.support} and case_id=${c.id} and action='case_access_messages'`
    const [first]=await asService(tx,s=>s`select public.marketplace_admin_audit(${f.auditor},null) as result`)
    expect(first.result.items).toHaveLength(24)
    expect(first.result.items[0].caseId).toBe(c.id)
    expect(first.result.items.slice(1).map((item:{id:string})=>item.id)).toEqual(ids.slice(0,23))
    expect(first.result.nextCursor).toBe(ids[22])
    await tx`insert into app_private.marketplace_admin_audit(actor_id,action,object_type,reason,created_at) values (${f.ops},'newer_fixture','audit',${reason},${new Date(Date.now()+86402000).toISOString()})`
    const [next]=await asService(tx,s=>s`select public.marketplace_admin_audit(${f.auditor},${first.result.nextCursor}) as result`)
    expect(next.result.items.slice(0,7).map((item:{id:string})=>item.id)).toEqual(ids.slice(23))
    expect(next.result.items.some((item:{action:string})=>item.action==='newer_fixture')).toBe(false)
    expect(next.result.items.some((item:{id:string})=>first.result.items.some((old:{id:string})=>old.id===item.id))).toBe(false)
    await expect(asService(tx,s=>s`select public.marketplace_admin_audit(${f.auditor},${randomUUID()})`)).rejects.toThrow('MARKETPLACE_NOT_FOUND')
    await tx`delete from app_private.marketplace_admin_grants where user_id=${f.auditor}`
    await expect(asService(tx,s=>s`select public.marketplace_admin_audit(${f.auditor},${first.result.nextCursor})`)).rejects.toThrow('MARKETPLACE_FORBIDDEN')
  }))
  it('separates user moderation, redacts user metadata, and protects self and staff', () => withFixture(async (tx,f) => {
    await expect(asService(tx,s=>s`select public.marketplace_admin_users(${f.ops},${f.buyer},null)`)).rejects.toThrow('MARKETPLACE_FORBIDDEN')
    await tx`insert into app_private.marketplace_admin_grants(user_id,scope) values (${f.supervisor},'user_moderator')`
    const [listed] = await asService(tx,s=>s`select public.marketplace_admin_users(${f.supervisor},${f.buyer},null) as result`)
    expect(Object.keys(listed.result.items[0]).sort()).toEqual(['canChangeStatus','createdAt','displayName','id','revision','status'])
    const input={operationId:randomUUID(),expectedRevision:1,status:'suspended',reason}
    for (const target of [f.supervisor,f.support]) await expect(asService(tx,s=>s`select public.marketplace_admin_user_status(${f.supervisor},${target},${s.json(input)})`)).rejects.toThrow('MARKETPLACE_FORBIDDEN')
    const [first] = await asService(tx,s=>s`select public.marketplace_admin_user_status(${f.supervisor},${f.buyer},${s.json(input)}) as result`)
    expect(first.result.status).toBe('suspended')
    expect(first.result.revision).toBe(2)
    const [retry] = await asService(tx,s=>s`select public.marketplace_admin_user_status(${f.supervisor},${f.buyer},${s.json(input)}) as result`)
    expect(retry.result).toEqual(first.result)
    await expect(asService(tx,s=>s`select public.marketplace_admin_user_status(${f.supervisor},${f.buyer},${s.json({...input,status:'active'})})`)).rejects.toThrow('IDEMPOTENCY_KEY_REUSED')
    await expect(asService(tx,s=>s`select public.marketplace_admin_user_status(${f.supervisor},${f.buyer},${s.json({...input,operationId:randomUUID(),status:'active'})})`)).rejects.toThrow('REVISION_CONFLICT')
    const [audit] = await tx`select count(*)::integer as count from app_private.marketplace_admin_audit where actor_id=${f.supervisor} and action='user_suspended' and object_id=${f.buyer}`
    expect(audit.count).toBe(1)
    await tx`insert into app_private.platform_staff(user_id,role) values (${f.supplierOwner},'supplier_reviewer')`
    await expect(asService(tx,s=>s`select public.marketplace_admin_user_status(${f.supervisor},${f.supplierOwner},${s.json({...input,operationId:randomUUID()})})`)).rejects.toThrow('MARKETPLACE_FORBIDDEN')
    await tx`update app_private.app_users set status='deleted' where id=${f.buyer}`
    await expect(asService(tx,s=>s`select public.marketplace_admin_user_status(${f.supervisor},${f.buyer},${s.json({...input,operationId:randomUUID(),expectedRevision:2,status:'active'})})`)).rejects.toThrow('MARKETPLACE_FORBIDDEN')
  }))
  it('requires operations scope and reason for bounded idempotent maintenance', () => withFixture(async (tx,f) => {
    const input={operationId:randomUUID(),reason}
    await expect(asService(tx,s=>s`select public.marketplace_admin_maintenance(${f.support},${s.json(input)})`)).rejects.toThrow('MARKETPLACE_FORBIDDEN')
    await expect(asService(tx,s=>s`select public.marketplace_admin_maintenance(${f.ops},${s.json({...input,reason:''})})`)).rejects.toThrow('VALIDATION_ERROR')
    const [first]=await asService(tx,s=>s`select public.marketplace_admin_maintenance(${f.ops},${s.json(input)}) as result`)
    const [retry]=await asService(tx,s=>s`select public.marketplace_admin_maintenance(${f.ops},${s.json(input)}) as result`)
    expect(retry.result).toEqual(first.result)
    for(const key of ['expiredOrders','commerceNotifications','chatNotifications','chatFailures']) expect(first.result[key]).toBeGreaterThanOrEqual(0)
    expect(first.result.expiredOrders).toBeLessThanOrEqual(100)
    const [audit]=await tx`select count(*)::integer as count from app_private.marketplace_admin_audit where actor_id=${f.ops} and action='maintenance'`
    expect(audit.count).toBe(1)
  }))
  it('prevents service-role scope creation and separates supplier/operations/support/auditor', () => withFixture(async (tx,f) => {
    await expect(asService(tx, s => s`insert into app_private.marketplace_admin_grants(user_id,scope) values (${f.buyer},'support')`)).rejects.toThrow('permission denied')
    const [row] = await tx`select has_table_privilege('service_role','app_private.marketplace_admin_grants','UPDATE') as update, has_table_privilege('service_role','app_private.marketplace_admin_grants','DELETE') as delete,
      has_function_privilege('authenticated','app_private.marketplace_admin_assert(uuid,text[])','EXECUTE') as browser_execute`
    expect(row).toEqual({update:false,delete:false,browser_execute:false})
    for (const actor of [f.buyer,f.supplierOwner,f.support,f.supervisor,f.auditor]) await expect(asService(tx, s => s`select public.marketplace_admin_dashboard(${actor})`)).rejects.toThrow('MARKETPLACE_FORBIDDEN')
    await asService(tx, s => s`select public.marketplace_admin_dashboard(${f.ops})`)
    await expect(asService(tx, s => s`select public.marketplace_admin_audit(${f.ops},null)`)).rejects.toThrow('MARKETPLACE_FORBIDDEN')
    await asService(tx, s => s`select public.marketplace_admin_audit(${f.auditor},null)`)
  }))
  it('requires assigned support scope and records reasoned successful access', () => withFixture(async (tx,f) => {
    const c = await createCase(tx,f)
    for (const actor of [f.other,f.supervisor,f.ops,f.buyer]) await expect(access(tx,actor,c.id)).rejects.toThrow()
    await expect(access(tx,f.support,c.id,'')).rejects.toThrow('VALIDATION_ERROR')
    const [row] = await access(tx,f.support,c.id)
    expect(row.result.messages[0].body).toBe('Private audit message')
    const [audit] = await tx`select count(*)::integer as count from app_private.marketplace_admin_audit where actor_id=${f.support} and case_id=${c.id} and action='case_access_messages' and reason=${reason}`
    expect(audit.count).toBe(1)
  }))
  it('restricts files to case permissions and sent grants, excluding unsent and foreign uploads', () => withFixture(async (tx,f) => {
    const c = await createCase(tx,f)
    expect((await file(tx,f.support,c.id,f.sharedFile))[0].result.dataBase64).toBe('JVBERi0=')
    for (const id of [f.unsentFile,f.foreignFile,randomUUID()]) await expect(file(tx,f.support,c.id,id)).rejects.toThrow('MARKETPLACE_NOT_FOUND')
    const messagesOnly = await createCase(tx,f,['messages'])
    expect((await access(tx,f.support,messagesOnly.id))[0].result.messages[0].files).toEqual([])
    await expect(file(tx,f.support,messagesOnly.id,f.sharedFile)).rejects.toThrow('MARKETPLACE_NOT_FOUND')
  }))
  it('enforces expiry, closure, scope revocation and suspended staff immediately', () => withFixture(async (tx,f) => {
    const c = await createCase(tx,f)
    await tx`update app_private.marketplace_support_cases set expires_at=clock_timestamp()-interval '1 second' where id=${c.id}`
    await expect(access(tx,f.support,c.id)).rejects.toThrow('MARKETPLACE_NOT_FOUND')
    await tx`update app_private.marketplace_support_cases set expires_at=clock_timestamp()+interval '1 hour',status='closed' where id=${c.id}`
    await expect(access(tx,f.support,c.id)).rejects.toThrow('MARKETPLACE_NOT_FOUND')
    await tx`update app_private.marketplace_support_cases set status='open' where id=${c.id}`
    await tx`delete from app_private.marketplace_admin_grants where user_id=${f.support}`
    await expect(access(tx,f.support,c.id)).rejects.toThrow('MARKETPLACE_FORBIDDEN')
    await tx`insert into app_private.marketplace_admin_grants(user_id,scope) values (${f.support},'support')`
    await tx`update app_private.app_users set status='suspended' where id=${f.support}`
    await expect(file(tx,f.support,c.id,f.sharedFile)).rejects.toThrow('MARKETPLACE_FORBIDDEN')
  }))
  it('does not allow support staff to self-create cases or supervisors to silently read all content', () => withFixture(async (tx,f) => {
    const input = {operationId:randomUUID(),title:'Unauthorized case',reason,assignedTo:f.support,conversationId:f.room,orderId:null,permissions:['messages'],expiresAt:new Date(Date.now()+3600000).toISOString()}
    await expect(asService(tx,s=>s`select public.marketplace_support_case_create(${f.support},${s.json(input)})`)).rejects.toThrow('MARKETPLACE_FORBIDDEN')
    const c = await createCase(tx,f)
    const [queue] = await asService(tx,s=>s`select public.marketplace_support_cases(${f.supervisor},null) as result`)
    expect(queue.result.items.some((item:{id:string})=>item.id===c.id)).toBe(true)
    await expect(access(tx,f.supervisor,c.id)).rejects.toThrow('MARKETPLACE_FORBIDDEN')
  }))
})
afterAll(async () => { await sql.end({timeout:2}) })
