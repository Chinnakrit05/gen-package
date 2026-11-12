import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// This independent suite deliberately refuses the legacy/default or remote database.
const databaseUrl = process.env.PACKIT_TEST_DATABASE_URL
const enabled = Boolean(databaseUrl)
if (databaseUrl) {
  const target = new URL(databaseUrl)
  if (target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/postgres') {
    throw new Error('Commerce audit requires the dedicated loopback phase7 database on port 55432')
  }
}
const sql = postgres(databaseUrl ?? 'postgresql://postgres:postgres@127.0.0.1:55432/postgres', { max: 12, idle_timeout: 2 })
const buyer = randomUUID(), manager = randomUUID(), staff = randomUUID(), outsider = randomUUID()
const buyerSpace = randomUUID(), supplierSpace = randomUUID(), supplier = randomUUID(), project = randomUUID()
const rivalSpace = randomUUID(), rivalSupplier = randomUUID()
const users = [buyer, manager, staff, outsider]
const requests: string[] = []
const spec = { template: 'tuck-end', materialId: 'carton-300', W: 80, D: 50, H: 120, handle: false }

async function fixture() {
  const id = randomUUID(), revision = randomUUID()
  requests.push(id)
  await sql`insert into app_private.quote_request_drafts
    (id,workspace_id,project_id,created_by,project_name,project_revision,title,quantity,notes,spec)
    values (${id},${buyerSpace},${project},${buyer},'Audit project',1,'Audit RFQ',500,'',${sql.json(spec)})`
  await sql`insert into app_private.quote_request_publications(request_id,revision_id,published_by)
    values (${id},${revision},${buyer})`
  await sql`insert into app_private.quote_request_supplier_access(request_id,supplier_id,supplier_name)
    values (${id},${supplier},'Audit supplier')`
  const terms = { requestRevisionId: revision, totalMinor: 100000, currency: 'THB', leadDays: 7,
    validUntil: new Date(Date.now() + 86400000).toISOString(), depositMinor: 20000, requiresProof: true, notes: 'Audit terms' }
  return { id, terms }
}

async function write(actor: string, request: string, action: string, input: Record<string, unknown>, targetSupplier = supplier) {
  // All mutations execute with the actual production RPC role, not postgres privileges.
  return sql.begin(async tx => {
    await tx`set local role service_role`
    const [row] = await tx`select public.marketplace_quotation_write(${actor},${targetSupplier},${request},${action},${tx.json(input as postgres.JSONValue)}) as result`
    return row.result
  })
}

async function selectOrder(request: string, input: Record<string, unknown>) {
  return sql.begin(async tx => {
    await tx`set local role service_role`
    const [row] = await tx`select public.marketplace_order_select(${buyer},${request},${tx.json(input as postgres.JSONValue)}) as result`
    return row.result
  })
}

async function actOrder(actor: string, order: string, action: string, input: Record<string, unknown>) {
  return sql.begin(async tx => {
    await tx`set local role service_role`
    const [row] = await tx`select public.marketplace_order_action(${actor},${order},${action},${tx.json(input as postgres.JSONValue)}) as result`
    return row.result
  })
}

async function sentFixture() {
  const fixtureData = await fixture()
  await write(manager, fixtureData.id, 'save', { ...fixtureData.terms, operationId: randomUUID(), expectedRevision: 0 })
  const quotation = await write(manager, fixtureData.id, 'send', { operationId: randomUUID(), expectedRevision: 1 })
  return { ...fixtureData, quotation }
}

describe.skipIf(!enabled)('isolated real expiry versus confirmation races',()=>{
  beforeAll(async () => {
    await sql`insert into app_private.app_users(id,display_name) values
      (${buyer},'Audit buyer'),(${manager},'Audit manager'),(${staff},'Audit staff'),(${outsider},'Audit outsider')`
    await sql`insert into app_private.workspaces(id,kind,owner_user_id,name) values
      (${buyerSpace},'team',${buyer},'Audit buyer workspace'),(${supplierSpace},'team',${manager},'Audit supplier workspace'),(${rivalSpace},'team',${outsider},'Audit rival workspace')`
    await sql`insert into app_private.workspace_members(workspace_id,user_id,role) values
      (${buyerSpace},${buyer},'owner'),(${supplierSpace},${manager},'owner'),(${supplierSpace},${staff},'editor'),(${rivalSpace},${outsider},'owner')`
    await sql`insert into app_private.workspace_marketplace_members(workspace_id,user_id,role) values
      (${supplierSpace},${manager},'manager'),(${supplierSpace},${staff},'staff'),(${rivalSpace},${outsider},'manager')`
    await sql`insert into app_private.supplier_profiles(id,workspace_id,kind,name,slug,description,contact_email,status)
      values (${supplier},${supplierSpace},'factory','Audit supplier',${`audit-${supplier}`},'','audit@example.test','approved'),
      (${rivalSupplier},${rivalSpace},'factory','Audit rival',${`audit-${rivalSupplier}`},'','rival@example.test','approved')`
    await sql`insert into app_private.projects(id,workspace_id,created_by,name,document_schema_version,document)
      values (${project},${buyerSpace},${buyer},'Audit project',1,${sql.json({ live: spec })})`
  })


const rolledBack = Symbol('maintenance rollback')
async function maintenance(run: (tx: postgres.TransactionSql) => Promise<void>) {
  try { await sql.begin(async tx => { await tx`set local role service_role`; await run(tx); throw rolledBack }) }
  catch (e) { if(e!==rolledBack) throw e }
}
function latch() { let release!:()=>void; const promise=new Promise<void>(r=>{release=r}); return {promise,release} }
async function tick(ms:number) { await new Promise(r=>setTimeout(r,ms)) }
async function pending() {
 const {id,quotation}=await sentFixture()
 const order=await selectOrder(id,{operationId:randomUUID(),quoteRevisionId:quotation.current.id})
 return {request:id,order}
}
it('confirmation holding request lock wins before expiry and maintenance skips the busy request', async()=>{
 await sql`insert into app_private.marketplace_admin_grants(user_id,scope) values (${staff},'operations') on conflict do nothing`
 const f=await pending(), locked=latch(), release=latch()
 await sql`update app_private.marketplace_production_orders set confirmation_deadline=clock_timestamp()+interval '2 seconds' where id=${f.order.id}`
 const confirm=sql.begin(async tx=>{
  await tx`set local role service_role`
  const [row]=await tx`select public.marketplace_order_action(${manager},${f.order.id},'confirm',${tx.json({operationId:randomUUID(),expectedRevision:1})}) result`
  locked.release(); await release.promise; return row.result
 })
 try {
  await Promise.race([locked.promise,confirm]); await tick(2100)
  await maintenance(async tx=>{
   await tx`select public.marketplace_admin_maintenance(${staff},${tx.json({operationId:randomUUID(),reason:'Isolated expiry race audit'})})`
   const [row]=await tx`select status,revision from app_private.marketplace_production_orders where id=${f.order.id}`
   expect(row.status).toBe('pending_supplier_confirmation'); expect(row.revision).toBe(1)
  })
 } finally { release.release() }
 expect((await confirm).status).toBe('confirmed')
 const [row]=await sql`select status,revision from app_private.marketplace_production_orders where id=${f.order.id}`
 expect(row).toEqual({status:'confirmed',revision:2})
})
it('expiry holding request lock prevents stale confirmation; operational changes are rolled back',async()=>{
 const f=await pending(), locked=latch(), release=latch()
 await sql`update app_private.marketplace_production_orders set confirmation_deadline=clock_timestamp()-interval '1 second' where id=${f.order.id}`
 const expiry=maintenance(async tx=>{
  await tx`select public.marketplace_admin_maintenance(${staff},${tx.json({operationId:randomUUID(),reason:'Isolated expiry winner audit'})})`
  const [row]=await tx`select status,revision from app_private.marketplace_production_orders where id=${f.order.id}`
  expect(row).toEqual({status:'expired',revision:2}); locked.release(); await release.promise
 })
 await Promise.race([locked.promise,expiry])
 let settled=false
 const confirm=actOrder(manager,f.order.id,'confirm',{operationId:randomUUID(),expectedRevision:1}).then(()=>({ok:true,error:''}),e=>({ok:false,error:String(e.message)})).finally(()=>{settled=true})
 try { await tick(100); expect(settled).toBe(false) } finally { release.release() }
 await expiry
 const result=await confirm
 expect(result.ok).toBe(false); expect(result.error).toContain('MARKETPLACE_CONFLICT')
 const [row]=await sql`select status,revision from app_private.marketplace_production_orders where id=${f.order.id}`
 expect(row).toEqual({status:'pending_supplier_confirmation',revision:1})
})

})
afterAll(async () => {
  if (enabled) await sql.begin(async tx => {
    await tx`delete from app_private.marketplace_admin_grants where user_id=${staff}`
    if (requests.length) {
      const [{ orders }] = await tx`select to_regclass('app_private.marketplace_production_orders') is not null as orders`
      if (orders) {
        await tx`delete from app_private.marketplace_payment_confirmations where report_id in (select p.id from app_private.marketplace_payment_reports p join app_private.marketplace_production_orders o on o.id=p.order_id where o.request_id in ${tx(requests)})`
        await tx`delete from app_private.marketplace_payment_reports where order_id in (select id from app_private.marketplace_production_orders where request_id in ${tx(requests)})`
        await tx`delete from app_private.marketplace_production_orders where request_id in ${tx(requests)}`
      }
      const [{ notifications }] = await tx`select to_regclass('app_private.marketplace_commerce_outbox') is not null as notifications`
      if (notifications) {
        await tx`delete from app_private.marketplace_commerce_notification_reads where event_id in (select id from app_private.marketplace_commerce_events where request_id in ${tx(requests)})`
        await tx`delete from app_private.marketplace_commerce_outbox where event_id in (select id from app_private.marketplace_commerce_events where request_id in ${tx(requests)})`
      }
      await tx`delete from app_private.marketplace_commerce_events where request_id in ${tx(requests)}`
      await tx`delete from app_private.marketplace_commerce_operations where actor_id in ${tx(users)}`
      await tx`update app_private.marketplace_quotations set current_revision_id=null where request_id in ${tx(requests)}`
      await tx`delete from app_private.marketplace_quotation_revisions where quotation_id in (select id from app_private.marketplace_quotations where request_id in ${tx(requests)})`
      await tx`delete from app_private.marketplace_quotations where request_id in ${tx(requests)}`
      const [{ trading }] = await tx`select to_regclass('app_private.marketplace_request_trading') is not null as trading`
      if (trading) {
        await tx`delete from app_private.marketplace_request_trading where request_id in ${tx(requests)}`
        await tx`delete from app_private.marketplace_request_revisions where request_id in ${tx(requests)}`
      }
      await tx`delete from app_private.quote_request_supplier_access where request_id in ${tx(requests)}`
      await tx`delete from app_private.quote_request_publications where request_id in ${tx(requests)}`
      await tx`delete from app_private.quote_request_drafts where id in ${tx(requests)}`
    }
    await tx`delete from app_private.projects where id=${project}`
    await tx`delete from app_private.supplier_profiles where id in ${tx([supplier,rivalSupplier])}`
    await tx`delete from app_private.workspace_marketplace_members where workspace_id in ${tx([supplierSpace,rivalSpace])}`
    await tx`delete from app_private.workspace_members where workspace_id in ${tx([buyerSpace,supplierSpace,rivalSpace])}`
    await tx`delete from app_private.workspaces where id in ${tx([buyerSpace,supplierSpace,rivalSpace])}`
    await tx`delete from app_private.app_users where id in ${tx(users)}`
  })
  await sql.end({ timeout: 2 })
})
