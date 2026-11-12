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

describe.skipIf(!enabled)('independent Marketplace quotation concurrency and authorization audit', () => {
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

  it('serializes eight same-key retries into one quote, receipt and event', async () => {
    const { id, terms } = await fixture()
    const input = { ...terms, operationId: randomUUID(), expectedRevision: 0 }
    const results = await Promise.all(Array.from({ length: 8 }, () => write(manager, id, 'save', input)))
    expect(new Set(results.map(result => result.id)).size).toBe(1)
    expect(results.every(result => JSON.stringify(result) === JSON.stringify(results[0]))).toBe(true)
    const [counts] = await sql`select
      (select count(*)::integer from app_private.marketplace_quotations where request_id=${id}) as quotes,
      (select count(*)::integer from app_private.marketplace_commerce_operations where actor_id=${manager} and operation_id=${input.operationId}) as receipts,
      (select count(*)::integer from app_private.marketplace_commerce_events where request_id=${id}) as events`
    expect(counts).toEqual({ quotes: 1, receipts: 1, events: 1 })
    await expect(write(manager, id, 'save', { ...input, totalMinor: 200000 })).rejects.toThrow('IDEMPOTENCY_KEY_REUSED')
  })

  it('allows exactly one concurrent CAS writer and rejects the stale rival', async () => {
    const { id, terms } = await fixture()
    await write(manager, id, 'save', { ...terms, operationId: randomUUID(), expectedRevision: 0 })
    const outcomes = await Promise.allSettled([110000, 120000].map(totalMinor => write(manager, id, 'save', {
      ...terms, totalMinor, operationId: randomUUID(), expectedRevision: 1,
    })))
    expect(outcomes.filter(value => value.status === 'fulfilled')).toHaveLength(1)
    const rejected = outcomes.find(value => value.status === 'rejected')
    expect(rejected?.status === 'rejected' && String(rejected.reason.message)).toContain('REVISION_CONFLICT')
  })

  it('keeps sent terms immutable after a newer draft and hides unsent drafts from buyer', async () => {
    const { id, terms } = await fixture()
    await write(manager, id, 'save', { ...terms, operationId: randomUUID(), expectedRevision: 0 })
    const sent = await write(manager, id, 'send', { operationId: randomUUID(), expectedRevision: 1 })
    await write(manager, id, 'save', { ...terms, totalMinor: 900000, operationId: randomUUID(), expectedRevision: 2 })
    const [row] = await sql`select public.marketplace_quotation_list(${buyer},null,${id},null) as result`
    expect(row.result.items[0].draft).toBeNull()
    expect(row.result.items[0].current).toEqual(sent.current)
    expect(row.result.items[0].current.totalMinor).toBe(100000)
    await expect(write(outsider, id, 'withdraw', { operationId: randomUUID(), expectedRevision: 3 })).rejects.toThrow('MARKETPLACE_NOT_FOUND')
  })

  it('checks current actor status even when replaying a successful operation', async () => {
    const { id, terms } = await fixture()
    const input = { ...terms, operationId: randomUUID(), expectedRevision: 0 }
    await write(manager, id, 'save', input)
    await sql`update app_private.app_users set status='suspended' where id=${manager}`
    try { await expect(write(manager, id, 'save', input)).rejects.toThrow() }
    finally { await sql`update app_private.app_users set status='active' where id=${manager}` }
  })

  it('rejects a JSON-null expiry in the SQL entry point', async () => {
    const { id, terms } = await fixture()
    await expect(write(manager, id, 'save', { ...terms, validUntil: null, operationId: randomUUID(), expectedRevision: 0 }))
      .rejects.toThrow('VALIDATION_ERROR')
  })

  it('lets staff prepare nonbinding drafts but never send binding terms', async () => {
    const { id, terms } = await fixture()
    await write(staff, id, 'save', { ...terms, operationId: randomUUID(), expectedRevision: 0 })
    await expect(write(staff, id, 'send', { operationId: randomUUID(), expectedRevision: 1 })).rejects.toThrow('MARKETPLACE_FORBIDDEN')
  })

  it('serializes distinct concurrent selection operations into exactly one live order', async () => {
    const { id, terms, quotation } = await sentFixture()
    await sql`insert into app_private.quote_request_supplier_access(request_id,supplier_id,supplier_name) values (${id},${rivalSupplier},'Audit rival')`
    await write(outsider, id, 'save', { ...terms, totalMinor: 180000, operationId: randomUUID(), expectedRevision: 0 }, rivalSupplier)
    const rival = await write(outsider, id, 'send', { operationId: randomUUID(), expectedRevision: 1 }, rivalSupplier)
    const inputs = Array.from({ length: 8 }, (_, index) => ({ operationId: randomUUID(), quoteRevisionId: index % 2 ? rival.current.id : quotation.current.id }))
    const outcomes = await Promise.allSettled(inputs.map(input => selectOrder(id, input)))
    expect(outcomes.filter(value => value.status === 'fulfilled')).toHaveLength(1)
    const winner = outcomes.findIndex(value => value.status === 'fulfilled')
    const winning = outcomes[winner]
    if (winning.status !== 'fulfilled') throw new Error('Missing selection winner')
    expect((await selectOrder(id, inputs[winner])).id).toBe(winning.value.id)
    const [row] = await sql`select count(*)::integer as count from app_private.marketplace_production_orders where request_id=${id}`
    expect(row.count).toBe(1)
    await expect(write(manager, id, 'withdraw', { operationId: randomUUID(), expectedRevision: 2 })).rejects.toThrow('MARKETPLACE_CONFLICT')
  })

  it('serializes competing confirm and decline with one CAS winner', async () => {
    const { id, quotation } = await sentFixture()
    const order = await selectOrder(id, { operationId: randomUUID(), quoteRevisionId: quotation.current.id })
    const outcomes = await Promise.allSettled(['confirm', 'decline'].map(action => actOrder(manager, order.id, action, {
      operationId: randomUUID(), expectedRevision: 1, reason: 'Independent race fixture',
    })))
    expect(outcomes.filter(value => value.status === 'fulfilled')).toHaveLength(1)
    const rejected = outcomes.find(value => value.status === 'rejected')
    expect(rejected?.status === 'rejected' && String(rejected.reason.message)).toContain('REVISION_CONFLICT')
  })

  it('rejects a quote pinned to an earlier request revision', async () => {
    const { id, terms, quotation } = await sentFixture()
    const input = { operationId: randomUUID(), expectedRevisionId: terms.requestRevisionId,
      acceptingUntil: new Date(Date.now() + 86400000).toISOString(), title: 'Revised audit RFQ', quantity: 750, notes: '', spec }
    await sql.begin(async tx => {
      await tx`set local role service_role`
      await tx`select public.marketplace_request_revise(${buyer},${id},${tx.json(input)})`
    })
    await expect(selectOrder(id, { operationId: randomUUID(), quoteRevisionId: quotation.current.id })).rejects.toThrow('REVISION_CONFLICT')
  })

  it('rejects supplier confirmation after the selecting buyer is suspended', async () => {
    const { id, quotation } = await sentFixture()
    const order = await selectOrder(id, { operationId: randomUUID(), quoteRevisionId: quotation.current.id })
    await sql`update app_private.app_users set status='suspended' where id=${buyer}`
    try { await expect(actOrder(manager, order.id, 'confirm', { operationId: randomUUID(), expectedRevision: 1 })).rejects.toThrow() }
    finally { await sql`update app_private.app_users set status='active' where id=${buyer}` }
    const [row] = await sql`select status from app_private.marketplace_production_orders where id=${order.id}`
    expect(row.status).toBe('pending_supplier_confirmation')
  })

  it('blocks production without required proof and denies staff payment confirmation', async () => {
    const { id, quotation } = await sentFixture()
    const order = await selectOrder(id, { operationId: randomUUID(), quoteRevisionId: quotation.current.id })
    const confirmed = await actOrder(manager, order.id, 'confirm', { operationId: randomUUID(), expectedRevision: 1 })
    await expect(actOrder(manager, order.id, 'start-production', { operationId: randomUUID(), expectedRevision: confirmed.revision })).rejects.toThrow('MARKETPLACE_CONFLICT')
    const reported = await actOrder(buyer, order.id, 'payment', {
      operationId: randomUUID(), expectedRevision: confirmed.revision, amountMinor: 20000, reference: 'Synthetic external transfer',
    })
    expect(reported.payments[0].confirmedAt).toBeNull()
    await expect(actOrder(manager, order.id, 'start-production', { operationId: randomUUID(), expectedRevision: reported.revision })).rejects.toThrow('MARKETPLACE_CONFLICT')
    await expect(actOrder(staff, order.id, 'confirm-payment', {
      operationId: randomUUID(), expectedRevision: reported.revision, paymentReportId: reported.payments[0].id,
    })).rejects.toThrow('MARKETPLACE_FORBIDDEN')
  })
})

afterAll(async () => {
  if (enabled) await sql.begin(async tx => {
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
