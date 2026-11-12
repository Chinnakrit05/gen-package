import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
const databaseUrl = process.env.PACKIT_TEST_DATABASE_URL
if (databaseUrl) {
  const url = new URL(databaseUrl)
  if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/postgres') throw new Error('Chat tests require the isolated local phase7 database on 55432')
}
const sql = postgres(databaseUrl ?? 'postgresql://postgres:postgres@127.0.0.1:55432/postgres', { max: 16, idle_timeout: 2 })
const buyer = randomUUID(), manager = randomUUID(), outsider = randomUUID(), buyerSpace = randomUUID(), supplierSpace = randomUUID(), supplier = randomUUID(), project = randomUUID(), request = randomUUID()
let room = ''
async function ensure(actor = buyer) {
  return sql.begin(async tx => { await tx`set local role service_role`; const [r] = await tx`select public.marketplace_ensure_conversation(${actor},${request},${supplier}) as data`; return r.data })
}
async function send(operationId: string, body: string, actor = manager) {
  return sql.begin(async tx => { await tx`set local role service_role`; const [r] = await tx`select public.marketplace_send_conversation_message(${actor},${room},${operationId},${body},'{}'::uuid[]) as data`; return r.data })
}
describe.skipIf(!databaseUrl)('durable conversation concurrency on actual PostgreSQL', () => {
  beforeAll(async () => {
    await sql.begin(async tx => {
      await tx`insert into app_private.app_users(id,display_name) values (${buyer},'Chat test buyer'),(${manager},'Chat test manager'),(${outsider},'Chat test outsider')`
      await tx`insert into app_private.workspaces(id,kind,owner_user_id,name) values (${buyerSpace},'personal',${buyer},'Chat buyer'),(${supplierSpace},'team',${manager},'Chat supplier')`
      await tx`insert into app_private.workspace_members(workspace_id,user_id,role) values (${buyerSpace},${buyer},'owner'),(${supplierSpace},${manager},'owner')`
      await tx`insert into app_private.workspace_marketplace_members(workspace_id,user_id,role) values (${supplierSpace},${manager},'manager')`
      await tx`insert into app_private.supplier_profiles(id,workspace_id,kind,name,slug,description,contact_email,status) values (${supplier},${supplierSpace},'factory','Chat factory',${`chat-${supplier}`},'','chat@example.test','approved')`
      await tx`insert into app_private.projects(id,workspace_id,created_by,name,document_schema_version,document) values (${project},${buyerSpace},${buyer},'Chat test',1,'{}')`
      await tx`insert into app_private.quote_request_drafts(id,workspace_id,project_id,created_by,project_name,project_revision,title,quantity,notes,spec) values (${request},${buyerSpace},${project},${buyer},'Chat test',1,'Chat RFQ',100,'','{"template":"tuck-end","materialId":"carton-300","W":80,"D":50,"H":120,"handle":false}')`
      await tx`insert into app_private.quote_request_publications(request_id,published_by) values (${request},${buyer})`
      await tx`insert into app_private.quote_request_supplier_access(request_id,supplier_id,supplier_name) values (${request},${supplier},'Chat factory')`
    })
  })
  it('simultaneous pair creation returns exactly one persisted room', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => ensure(i % 2 ? manager : buyer)))
    expect(new Set(results.map(r => r.id)).size).toBe(1)
    room = results[0].id
    const [r] = await sql`select count(*)::int as n from app_private.marketplace_conversations where request_id=${request}`
    expect(r.n).toBe(1)
    await expect(ensure(outsider)).rejects.toThrow('CONVERSATION_NOT_FOUND')
  })
  it('simultaneous same-key sends persist one message and notification', async () => {
    const op = randomUUID()
    const results = await Promise.all(Array.from({ length: 12 }, () => send(op, 'same message')))
    expect(results.every(r => JSON.stringify(r) === JSON.stringify(results[0]))).toBe(true)
    expect(results[0].sequence).toBe(1)
    const [r] = await sql`select (select count(*)::int from app_private.marketplace_conversation_messages where conversation_id=${room}) as messages, (select count(*)::int from app_private.marketplace_conversation_outbox where conversation_id=${room}) as notifications`
    expect(r).toEqual({ messages: 1, notifications: 1 })
    await expect(send(op, 'changed')).rejects.toThrow('IDEMPOTENCY_KEY_REUSED')
  })
  it('independent sends serialize stable monotonic sequences without gaps', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => send(randomUUID(), `message ${i}`)))
    expect(results.map(r => r.sequence).sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i + 2))
    const [r] = await sql.begin(async tx => { await tx`set local role service_role`; return tx`select public.marketplace_list_conversation_messages(${buyer},${room},null) as data` })
    expect(r.data.items).toHaveLength(13)
    expect(r.data.items.map((m: { sequence: number }) => m.sequence)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1))
  })
  it('concurrent late read receipts never regress', async () => {
    await Promise.all([13, 2, 10, 5, 1, 12, 7].map(sequence => sql.begin(async tx => { await tx`set local role service_role`; return tx`select public.marketplace_read_conversation(${buyer},${room},${sequence})` })))
    const [r] = await sql`select last_read_sequence::int as n from app_private.marketplace_conversation_reads where conversation_id=${room} and user_id=${buyer}`
    expect(r.n).toBe(13)
  })
  it('membership revocation denies reads and retries on existing operation IDs', async () => {
    const op = randomUUID()
    await send(op, 'before revocation')
    await sql`delete from app_private.workspace_marketplace_members where workspace_id=${supplierSpace} and user_id=${manager}`
    await expect(send(op, 'before revocation')).rejects.toThrow('CONVERSATION_NOT_FOUND')
    await expect(sql.begin(async tx => { await tx`set local role service_role`; return tx`select public.marketplace_get_conversation(${manager},${room})` })).rejects.toThrow('CONVERSATION_NOT_FOUND')
  })
})
afterAll(async () => {
  if (databaseUrl) await sql.begin(async tx => {
    await tx`delete from app_private.marketplace_conversation_outbox where conversation_id in (select id from app_private.marketplace_conversations where request_id=${request})`
    await tx`delete from app_private.marketplace_conversation_file_grants where conversation_id in (select id from app_private.marketplace_conversations where request_id=${request})`
    await tx`delete from app_private.marketplace_conversation_files where conversation_id in (select id from app_private.marketplace_conversations where request_id=${request})`
    await tx`delete from app_private.marketplace_conversation_reads where conversation_id in (select id from app_private.marketplace_conversations where request_id=${request})`
    await tx`delete from app_private.marketplace_conversation_messages where conversation_id in (select id from app_private.marketplace_conversations where request_id=${request})`
    await tx`delete from app_private.marketplace_conversations where request_id=${request}`
    await tx`delete from app_private.quote_request_supplier_access where request_id=${request}`
    await tx`delete from app_private.marketplace_request_trading where request_id=${request}`
    await tx`delete from app_private.marketplace_request_revisions where request_id=${request}`
    await tx`delete from app_private.quote_request_publications where request_id=${request}`
    await tx`delete from app_private.quote_request_drafts where id=${request}`
    await tx`delete from app_private.projects where id=${project}`
    await tx`delete from app_private.workspace_marketplace_members where workspace_id=${supplierSpace}`
    await tx`delete from app_private.supplier_team_member_removals where supplier_id=${supplier}`
    await tx`delete from app_private.supplier_profiles where id=${supplier}`
    await tx`delete from app_private.workspace_members where workspace_id in (${buyerSpace},${supplierSpace})`
    await tx`delete from app_private.workspaces where id in (${buyerSpace},${supplierSpace})`
    await tx`delete from app_private.app_users where id in (${buyer},${manager},${outsider})`
  })
  await sql.end()
})
