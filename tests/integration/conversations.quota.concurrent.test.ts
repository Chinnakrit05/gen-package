import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
const databaseUrl = process.env.PACKIT_TEST_DATABASE_URL
if (databaseUrl) {
  const url = new URL(databaseUrl)
  if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/postgres') throw new Error('Chat tests require the isolated local phase7 database on 55432')
}
const sql = postgres(databaseUrl ?? 'postgresql://postgres:postgres@127.0.0.1:55432/postgres', { max: 16, idle_timeout: 2, connection: { application_name: "phase7-quota-audit" } })
const buyer = randomUUID(), manager = randomUUID(), outsider = randomUUID(), buyerSpace = randomUUID(), supplierSpace = randomUUID(), supplier = randomUUID(), project = randomUUID(), request = randomUUID()
const request2 = randomUUID()
let room2 = ""
let room = ''
async function ensure(actor = buyer) {
  return sql.begin(async tx => { await tx`set local role service_role`; const [r] = await tx`select public.marketplace_ensure_conversation(${actor},${request},${supplier}) as data`; return r.data })
}
const MiB = 1024 * 1024
const payload = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(MiB - 5, 65)]).toString("base64")
async function upload(target: string, op: string, name = "quota.pdf") {
  return sql.begin(async tx => {
    await tx`set local role service_role`
    const [r] = await tx`select public.marketplace_upload_conversation_file(${buyer},${target},${op},${name},${"application/pdf"},${payload}) as data`
    return r.data
  })
}
async function usage() {
  const [r] = await sql`select count(*)::int as files, sum(byte_size)::int as bytes, sum(octet_length(content))::int as actual_bytes from app_private.marketplace_conversation_files where conversation_id in (${room},${room2})`
  return r
}
describe.skipIf(!databaseUrl)('cross-room workspace attachment quota on actual PostgreSQL', () => {
  beforeAll(async () => {
    await sql.begin(async tx => {
      await tx`insert into app_private.app_users(id,display_name) values (${buyer},'Chat test buyer'),(${manager},'Chat test manager'),(${outsider},'Chat test outsider')`
      await tx`insert into app_private.workspaces(id,kind,owner_user_id,name) values (${buyerSpace},'personal',${buyer},'Chat buyer'),(${supplierSpace},'team',${manager},'Chat supplier')`
      await tx`insert into app_private.workspace_members(workspace_id,user_id,role) values (${buyerSpace},${buyer},'owner'),(${supplierSpace},${manager},'owner')`
      await tx`insert into app_private.workspace_marketplace_members(workspace_id,user_id,role) values (${supplierSpace},${manager},'manager')`
      await tx`insert into app_private.supplier_profiles(id,workspace_id,kind,name,slug,description,contact_email,status) values (${supplier},${supplierSpace},'factory','Chat factory',${`chat-${supplier}`},'','chat@example.test','approved')`
      await tx`insert into app_private.projects(id,workspace_id,created_by,name,document_schema_version,document) values (${project},${buyerSpace},${buyer},'Chat test',1,'{}')`
      const fixtureRequests = [request, request2]
      for (const requestId of fixtureRequests) {
      await tx`insert into app_private.quote_request_drafts(id,workspace_id,project_id,created_by,project_name,project_revision,title,quantity,notes,spec) values (${requestId},${buyerSpace},${project},${buyer},'Chat test',1,'Chat RFQ',100,'','{"template":"tuck-end","materialId":"carton-300","W":80,"D":50,"H":120,"handle":false}')`
      await tx`insert into app_private.quote_request_publications(request_id,published_by) values (${requestId},${buyer})`
      await tx`insert into app_private.quote_request_supplier_access(request_id,supplier_id,supplier_name) values (${requestId},${supplier},'Chat factory')`
      }
    })
  })
  it("serializes two rooms at 99 MiB, admits exactly one MiB, and replays without consuming capacity", async () => {
    room = (await ensure()).id
    const [other] = await sql.begin(async tx => { await tx`set local role service_role`; return tx`select public.marketplace_ensure_conversation(${buyer},${request2},${supplier}) as data` })
    room2 = other.data.id
    // Real bytea + matching size constraints; repetitive PDF-signature fixture compresses in TOAST.
    // 49 * 2 MiB plus 1 MiB across two rooms, both below their 50-file limit.
    await sql`insert into app_private.marketplace_conversation_files(conversation_id,id,created_by,name,mime_type,content,byte_size)
      select case when n<=25 then ${room}::uuid else ${room2}::uuid end, gen_random_uuid(), ${buyer}::uuid, ${"seed.pdf"}, ${"application/pdf"},
      convert_to(${"%PDF-"} || repeat(${"A"},case when n=50 then ${MiB}::int else ${2*MiB}::int end -5),${"UTF8"}),case when n=50 then ${MiB}::int else ${2*MiB}::int end
      from generate_series(1,50) n`
    expect(await usage()).toEqual({files:50,bytes:99*MiB,actual_bytes:99*MiB})
    const ops = [randomUUID(),randomUUID()]
    const rooms = [room,room2]
    let locked!: () => void, release!: () => void
    const ready = new Promise<void>(resolve => { locked = resolve })
    const hold = new Promise<void>(resolve => { release = resolve })
    const blocker = sql.begin(async tx => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`conversation-storage:${buyerSpace}`},0))`
      locked()
      await hold
    })
    await Promise.race([ready, blocker])
    const racing = Promise.allSettled(rooms.map((r,i)=>upload(r,ops[i])))
    try {
      let waiting = 0
      for (let attempt=0; attempt<100; attempt++) {
        const [state] = await sql`select count(*)::int as n from pg_stat_activity where application_name=${"phase7-quota-audit"} and wait_event=${"advisory"}`
        waiting = state.n
        if (waiting === 2) break
        await new Promise(resolve=>setTimeout(resolve,20))
      }
      expect(waiting).toBe(2) // prove both real RPCs overlap at the workspace lock
    } finally { release(); await blocker }
    const results = await racing
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1)
    const winner = results.findIndex(r=>r.status==="fulfilled"), loser=1-winner
    expect((results[loser] as PromiseRejectedResult).reason.message).toContain("CONVERSATION_FILE_LIMIT")
    expect(await usage()).toEqual({files:51,bytes:100*MiB,actual_bytes:100*MiB})
    const replay = await Promise.all(Array.from({length:6},()=>upload(rooms[winner],ops[winner])))
    expect(replay.every(r=>JSON.stringify(r)===JSON.stringify((results[winner] as PromiseFulfilledResult<unknown>).value))).toBe(true)
    await expect(upload(rooms[winner],ops[winner],"changed.pdf")).rejects.toThrow("IDEMPOTENCY_KEY_REUSED")
    await expect(upload(rooms[loser],ops[loser])).rejects.toThrow("CONVERSATION_FILE_LIMIT")
    expect(await usage()).toEqual({files:51,bytes:100*MiB,actual_bytes:100*MiB})
    // Synthetic cleanup releases a real persisted MiB, not a fabricated reservation counter.
    await sql`delete from app_private.marketplace_conversation_files where conversation_id=${rooms[winner]} and id=${ops[winner]}`
    const abortOp=randomUUID()
    await expect(sql.begin(async tx=>{await tx`set local role service_role`; await tx`select public.marketplace_upload_conversation_file(${buyer},${rooms[loser]},${abortOp},${"quota.pdf"},${"application/pdf"},${payload})`; throw new Error("intentional rollback") })).rejects.toThrow("intentional rollback")
    expect(await usage()).toEqual({files:50,bytes:99*MiB,actual_bytes:99*MiB})
    await upload(rooms[loser],ops[loser])
    expect(await usage()).toEqual({files:51,bytes:100*MiB,actual_bytes:100*MiB})
    const [orphans] = await sql`select count(*)::int as n from app_private.marketplace_conversation_file_grants where conversation_id in (${room},${room2})`
    expect(orphans.n).toBe(0) // all unsent files still count; sending is not needed to consume quota
  }, 30000)

})
afterAll(async () => {
  if (databaseUrl) await sql.begin(async tx => {
    await tx`delete from app_private.marketplace_conversation_outbox where conversation_id in (select id from app_private.marketplace_conversations where request_id in (${request},${request2}))`
    await tx`delete from app_private.marketplace_conversation_file_grants where conversation_id in (select id from app_private.marketplace_conversations where request_id in (${request},${request2}))`
    await tx`delete from app_private.marketplace_conversation_files where conversation_id in (select id from app_private.marketplace_conversations where request_id in (${request},${request2}))`
    await tx`delete from app_private.marketplace_conversation_reads where conversation_id in (select id from app_private.marketplace_conversations where request_id in (${request},${request2}))`
    await tx`delete from app_private.marketplace_conversation_messages where conversation_id in (select id from app_private.marketplace_conversations where request_id in (${request},${request2}))`
    await tx`delete from app_private.marketplace_conversations where request_id in (${request},${request2})`
    await tx`delete from app_private.quote_request_supplier_access where request_id in (${request},${request2})`
    await tx`delete from app_private.marketplace_request_trading where request_id in (${request},${request2})`
    await tx`delete from app_private.marketplace_request_revisions where request_id in (${request},${request2})`
    await tx`delete from app_private.quote_request_publications where request_id in (${request},${request2})`
    await tx`delete from app_private.quote_request_drafts where id in (${request},${request2})`
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
