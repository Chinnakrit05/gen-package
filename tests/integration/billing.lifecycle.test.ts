// เทสต์ billing กับ Supabase local จริง — รันเฉพาะผ่าน vitest.db.config.ts (`npm run db:test:integration`)
// vitest.config.ts หลัก include แค่ src/server จึงไม่แตะไฟล์นี้; กติกาอยู่ใน docs/billing-freemium-pro.md
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSupabaseBillingRepository } from '../../server/adapters/supabase/billingRepository'
import { createSupabaseProjectRepository } from '../../server/adapters/supabase/projectRepository'
import type { Actor } from '../../server/modules/identity/actor'
import { ProjectService } from '../../server/modules/projects/projectService'
import type { CloudProjectDocumentV1 } from '../../shared/contracts/projects'

interface LocalStatus {
  API_URL: string
  DB_URL: string
  PUBLISHABLE_KEY: string
  SECRET_KEY: string
}

interface BootstrapRow {
  app_user_id: string
  personal_workspace_id: string
}

function readLocalStatus(): LocalStatus {
  const cli = path.resolve('node_modules', 'supabase', 'dist', 'supabase.js')
  const result = spawnSync(process.execPath, [cli, 'status', '-o', 'json'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error('Local Supabase stack is not running')
  return JSON.parse(result.stdout) as LocalStatus
}

const DAY_MS = 24 * 60 * 60 * 1000

const document: CloudProjectDocumentV1 = {
  live: { template: 'tuck-end', materialId: 'carton-300', W: 80, D: 50, H: 120, handle: false },
  qty: 500,
  fillColor: null,
  decos: [],
  history: [],
  histIdx: -1,
}

describe('billing lifecycle: entitlements, orders, licenses and AI credits', () => {
  let status: LocalStatus
  let sql: ReturnType<typeof postgres>
  const userIds: string[] = []
  let billing: ReturnType<typeof createSupabaseBillingRepository>
  let owner: BootstrapRow
  let other: BootstrapRow
  let ownerActor: Actor
  let otherActor: Actor
  let firstProjectId: string
  let secondProjectId: string
  // ค่า placeholder จาก app_private.plan_catalog — อ่านจาก entitlements ไม่ hardcode เพราะเจ้าของผลิตภัณฑ์จะปรับทีหลัง
  let designCredits = 0
  let proCredits = 0
  let proPeriodDays = 0

  beforeAll(async () => {
    status = readLocalStatus()
    sql = postgres(status.DB_URL, { max: 4 })
    const issuer = `https://billing-integration-${randomUUID()}.test/auth/v1`
    const [ownerRow] = await sql<BootstrapRow[]>`
      select * from public.bootstrap_personal_workspace(
        ${issuer}, 'owner', 'Billing owner', 'billing-owner@example.test'
      )
    `
    const [otherRow] = await sql<BootstrapRow[]>`
      select * from public.bootstrap_personal_workspace(
        ${issuer}, 'other', 'Billing other', 'billing-other@example.test'
      )
    `
    owner = ownerRow
    other = otherRow
    userIds.push(owner.app_user_id, other.app_user_id)
    const config = {
      url: status.API_URL,
      secretKey: status.SECRET_KEY,
      issuer: `${status.API_URL}/auth/v1`,
    }
    billing = createSupabaseBillingRepository(config)
    const projects = new ProjectService(createSupabaseProjectRepository(config))
    ownerActor = {
      userId: owner.app_user_id,
      identityIssuer: issuer,
      identitySubject: 'owner',
      requestId: randomUUID(),
    }
    otherActor = {
      userId: other.app_user_id,
      identityIssuer: issuer,
      identitySubject: 'other',
      requestId: randomUUID(),
    }
    // "1 แบบ" = 1 project id — สองแบบเพื่อแยกเส้นทางซื้อรายแบบ (แบบแรก) กับ license จาก Pro (แบบที่สอง)
    const first = await projects.create(ownerActor, {
      workspaceId: owner.personal_workspace_id,
      operationId: randomUUID(),
      name: 'Billing design 1',
      documentSchemaVersion: 1,
      document,
    })
    const second = await projects.create(ownerActor, {
      workspaceId: owner.personal_workspace_id,
      operationId: randomUUID(),
      name: 'Billing design 2',
      documentSchemaVersion: 1,
      document,
    })
    firstProjectId = first.id
    secondProjectId = second.id
  })

  afterAll(async () => {
    for (const userId of userIds) {
      await sql.begin(async (tx) => {
        // billing — ลบก่อน projects: orders/design_licenses อ้าง projects แบบ restrict, subscriptions อ้าง orders
        await tx`delete from app_private.ai_requests where workspace_id in (
          select workspace_id from app_private.workspace_members where user_id = ${userId}
        )`
        await tx`delete from app_private.credit_ledger where workspace_id in (
          select workspace_id from app_private.workspace_members where user_id = ${userId}
        )`
        await tx`delete from app_private.credit_balances where workspace_id in (
          select workspace_id from app_private.workspace_members where user_id = ${userId}
        )`
        await tx`delete from app_private.design_licenses where workspace_id in (
          select workspace_id from app_private.workspace_members where user_id = ${userId}
        )`
        await tx`delete from app_private.subscriptions where workspace_id in (
          select workspace_id from app_private.workspace_members where user_id = ${userId}
        )`
        await tx`delete from app_private.orders where workspace_id in (
          select workspace_id from app_private.workspace_members where user_id = ${userId}
        )`
        await tx`delete from app_private.project_operations where actor_user_id = ${userId}`
        await tx`delete from app_private.projects where created_by = ${userId}`
        await tx`delete from app_private.workspace_members where user_id = ${userId}`
        await tx`delete from app_private.workspaces where owner_user_id = ${userId}`
        await tx`delete from app_private.auth_identities where app_user_id = ${userId}`
        await tx`delete from app_private.app_users where id = ${userId}`
      })
    }
    await sql?.end()
  })

  it('starts a fresh workspace as Freemium with zero credits and the catalog prices', async () => {
    const entitlements = await billing.getEntitlements(ownerActor, owner.personal_workspace_id)
    expect(entitlements).toMatchObject({
      workspaceId: owner.personal_workspace_id,
      plan: 'free',
      proUntil: null,
      credits: 0,
      licensedProjectIds: [],
    })
    expect(entitlements.catalog.design).toMatchObject({
      kind: 'design', amountMinor: 14900, currency: 'THB', periodDays: null,
    })
    expect(entitlements.catalog.pro).toMatchObject({ kind: 'pro', amountMinor: 39900, currency: 'THB' })
    expect(entitlements.catalog.design.credits).toBeGreaterThan(0)
    expect(entitlements.catalog.pro.credits).toBeGreaterThan(0)
    expect(entitlements.catalog.pro.periodDays).toBeGreaterThan(0)
    designCredits = entitlements.catalog.design.credits
    proCredits = entitlements.catalog.pro.credits
    proPeriodDays = entitlements.catalog.pro.periodDays!
  })

  it('refuses to authorize export of an unlicensed design with PAYMENT_REQUIRED', async () => {
    await expect(billing.authorizeExport(ownerActor, firstProjectId)).rejects.toMatchObject({
      status: 402,
      code: 'PAYMENT_REQUIRED',
    })
    // การปฏิเสธต้องไม่ทิ้ง license ไว้
    const [licenses] = await sql<{ count: number }[]>`
      select count(*)::integer as count from app_private.design_licenses where project_id = ${firstProjectId}
    `
    expect(licenses.count).toBe(0)
  })

  it('refuses an AI reservation while the workspace has zero credits', async () => {
    await expect(billing.reserveAiCredit(ownerActor, owner.personal_workspace_id, randomUUID()))
      .rejects.toMatchObject({ status: 402, code: 'AI_CREDITS_EXHAUSTED' })
    const [requests] = await sql<{ count: number }[]>`
      select count(*)::integer as count from app_private.ai_requests
      where workspace_id = ${owner.personal_workspace_id}
    `
    expect(requests.count).toBe(0)
  })

  it('licenses a design and grants credits once a design order is fulfilled, idempotently', async () => {
    const workspaceId = owner.personal_workspace_id
    const operationId = randomUUID()
    const order = await billing.createOrder(ownerActor, {
      workspaceId, operationId, kind: 'design', projectId: firstProjectId,
    })
    expect(order).toMatchObject({
      workspaceId,
      kind: 'design',
      projectId: firstProjectId,
      amountMinor: 14900,
      currency: 'THB',
      credits: designCredits,
      status: 'pending',
      provider: 'none',
      providerRef: null,
      paidAt: null,
    })
    // operationId เดิม + ข้อมูลเดิม → คืน order เดิม; operationId เดิมแต่ kind ต่าง → IDEMPOTENCY_KEY_REUSED
    await expect(billing.createOrder(ownerActor, {
      workspaceId, operationId, kind: 'design', projectId: firstProjectId,
    })).resolves.toMatchObject({ id: order.id, status: 'pending' })
    await expect(billing.createOrder(ownerActor, { workspaceId, operationId, kind: 'pro' }))
      .rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_KEY_REUSED' })
    // ยังไม่จ่าย → ยังดาวน์โหลดไม่ได้ และยังไม่มีเครดิต
    await expect(billing.authorizeExport(ownerActor, firstProjectId))
      .rejects.toMatchObject({ status: 402, code: 'PAYMENT_REQUIRED' })
    expect((await billing.getEntitlements(ownerActor, workspaceId)).credits).toBe(0)

    const paid = await billing.fulfilOrder(ownerActor, order.id, 'dev', 'integration-design')
    expect(paid).toMatchObject({ id: order.id, status: 'paid', provider: 'dev', providerRef: 'integration-design' })
    expect(paid.paidAt).not.toBeNull()

    const entitlements = await billing.getEntitlements(ownerActor, workspaceId)
    expect(entitlements).toMatchObject({
      plan: 'free',
      proUntil: null,
      credits: designCredits,
      licensedProjectIds: [firstProjectId],
    })
    await expect(billing.authorizeExport(ownerActor, firstProjectId))
      .resolves.toMatchObject({ projectId: firstProjectId, source: 'purchase' })

    // fulfil ซ้ำ (เช่น webhook ส่งซ้ำ) → คืน order เดิม ไม่เติมเครดิต/ไม่สร้าง license เพิ่ม
    await expect(billing.fulfilOrder(ownerActor, order.id, 'dev', 'integration-design-again'))
      .resolves.toMatchObject({ id: order.id, status: 'paid', provider: 'dev', providerRef: 'integration-design' })
    const [after] = await sql<{ balance: number; ledger: number; licenses: number }[]>`
      select
        (select balance from app_private.credit_balances where workspace_id = ${workspaceId}) as balance,
        (select count(*)::integer from app_private.credit_ledger
          where ref_id = ${order.id} and reason = 'design_purchase') as ledger,
        (select count(*)::integer from app_private.design_licenses
          where project_id = ${firstProjectId}) as licenses
    `
    expect(after).toEqual({ balance: designCredits, ledger: 1, licenses: 1 })
    const [license] = await sql<{ source: string; order_id: string | null; granted_by: string }[]>`
      select source, order_id, granted_by from app_private.design_licenses where project_id = ${firstProjectId}
    `
    expect(license).toEqual({ source: 'purchase', order_id: order.id, granted_by: owner.app_user_id })

    // แบบที่มีสิทธิ์แล้วสั่งซื้อซ้ำไม่ได้
    await expect(billing.createOrder(ownerActor, {
      workspaceId, operationId: randomUUID(), kind: 'design', projectId: firstProjectId,
    })).rejects.toMatchObject({ status: 409, code: 'ALREADY_LICENSED' })
  })

  it('reserves one credit per AI request and refunds only failed requests', async () => {
    const workspaceId = owner.personal_workspace_id
    const before = (await billing.getEntitlements(ownerActor, workspaceId)).credits
    expect(before).toBeGreaterThan(0)

    // provider ล้ม → settle failed → คืนเครดิต
    const failedOperation = randomUUID()
    const reserved = await billing.reserveAiCredit(ownerActor, workspaceId, failedOperation)
    expect(reserved.credits).toBe(before - 1)
    expect(typeof reserved.requestId).toBe('string')
    await expect(billing.reserveAiCredit(ownerActor, workspaceId, failedOperation))
      .rejects.toMatchObject({ status: 409, code: 'AI_REQUEST_IN_PROGRESS' })
    await expect(billing.settleAiRequest(ownerActor, reserved.requestId, 'failed'))
      .resolves.toEqual({ credits: before })
    // settle ซ้ำหลังปิดแล้ว (AI_REQUEST_NOT_RESERVED) ต้องไม่คืนเครดิตซ้ำ
    await expect(billing.settleAiRequest(ownerActor, reserved.requestId, 'failed')).rejects.toThrow()
    expect((await billing.getEntitlements(ownerActor, workspaceId)).credits).toBe(before)

    // ผลลัพธ์กลับมาแล้ว → settle succeeded → ไม่คืน; operationId ที่ปิดแล้วใช้ซ้ำไม่ได้
    const succeededOperation = randomUUID()
    const reservedAgain = await billing.reserveAiCredit(ownerActor, workspaceId, succeededOperation)
    expect(reservedAgain.credits).toBe(before - 1)
    await expect(billing.settleAiRequest(ownerActor, reservedAgain.requestId, 'succeeded'))
      .resolves.toEqual({ credits: before - 1 })
    await expect(billing.reserveAiCredit(ownerActor, workspaceId, succeededOperation))
      .rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_KEY_REUSED' })
    expect((await billing.getEntitlements(ownerActor, workspaceId)).credits).toBe(before - 1)

    const [evidence] = await sql<{ requests: number; refunds: number; reserved: number; states: string[] }[]>`
      select
        (select count(*)::integer from app_private.credit_ledger
          where workspace_id = ${workspaceId} and reason = 'ai_request' and delta = -1) as requests,
        (select count(*)::integer from app_private.credit_ledger
          where workspace_id = ${workspaceId} and reason = 'ai_refund' and delta = 1) as refunds,
        (select count(*)::integer from app_private.ai_requests
          where workspace_id = ${workspaceId} and state = 'reserved') as reserved,
        (select array_agg(state order by state) from app_private.ai_requests
          where workspace_id = ${workspaceId}) as states
    `
    expect(evidence).toEqual({ requests: 2, refunds: 1, reserved: 0, states: ['failed', 'succeeded'] })
  })

  it('turns the workspace Pro after a pro order and licenses designs on export', async () => {
    const workspaceId = owner.personal_workspace_id
    const before = await billing.getEntitlements(ownerActor, workspaceId)
    const order = await billing.createOrder(ownerActor, { workspaceId, operationId: randomUUID(), kind: 'pro' })
    expect(order).toMatchObject({
      kind: 'pro', projectId: null, amountMinor: 39900, credits: proCredits, status: 'pending',
    })
    // order ค้างจ่ายยังไม่ให้สิทธิ์
    await expect(billing.authorizeExport(ownerActor, secondProjectId))
      .rejects.toMatchObject({ status: 402, code: 'PAYMENT_REQUIRED' })

    const paid = await billing.fulfilOrder(ownerActor, order.id, 'dev', 'integration-pro')
    expect(paid.status).toBe('paid')
    const entitlements = await billing.getEntitlements(ownerActor, workspaceId)
    expect(entitlements.plan).toBe('pro')
    expect(entitlements.proUntil).not.toBeNull()
    const proUntil = Date.parse(entitlements.proUntil!)
    expect(proUntil).toBeGreaterThan(Date.now())
    expect(proUntil).toBeLessThanOrEqual(Date.now() + proPeriodDays * DAY_MS + 60_000)
    expect(entitlements.credits).toBe(before.credits + proCredits)
    // license จาก Pro เกิดตอนขอ export ไม่ใช่ตอนจ่าย
    expect(entitlements.licensedProjectIds).toEqual([firstProjectId])

    await expect(billing.authorizeExport(ownerActor, secondProjectId))
      .resolves.toMatchObject({ projectId: secondProjectId, source: 'pro' })
    const after = await billing.getEntitlements(ownerActor, workspaceId)
    expect([...after.licensedProjectIds].sort()).toEqual([firstProjectId, secondProjectId].sort())
    const [license] = await sql<{ source: string; order_id: string | null; granted_by: string }[]>`
      select source, order_id, granted_by from app_private.design_licenses where project_id = ${secondProjectId}
    `
    expect(license).toEqual({ source: 'pro', order_id: null, granted_by: owner.app_user_id })
    // ขอซ้ำใช้ license เดิม — ไม่สร้างซ้ำ และสิทธิ์ที่ได้ตอน Pro คงอยู่ (ไม่ผูกกับ subscription)
    await expect(billing.authorizeExport(ownerActor, secondProjectId)).resolves.toMatchObject({ source: 'pro' })
    const [licenses] = await sql<{ count: number }[]>`
      select count(*)::integer as count from app_private.design_licenses
      where workspace_id = ${workspaceId}
    `
    expect(licenses.count).toBe(2)

    // ต่ออายุ: รอบใหม่ต่อจากวันหมดเดิม (ไม่ใช่จาก now) และเติมเครดิตอีกรอบ
    const renewal = await billing.createOrder(ownerActor, { workspaceId, operationId: randomUUID(), kind: 'pro' })
    await billing.fulfilOrder(ownerActor, renewal.id, 'dev', 'integration-pro-renewal')
    const renewed = await billing.getEntitlements(ownerActor, workspaceId)
    expect(renewed.plan).toBe('pro')
    expect(Math.abs(Date.parse(renewed.proUntil!) - (proUntil + proPeriodDays * DAY_MS))).toBeLessThan(1000)
    expect(renewed.credits).toBe(entitlements.credits + proCredits)
    const [subscriptions] = await sql<{ count: number }[]>`
      select count(*)::integer as count from app_private.subscriptions
      where workspace_id = ${workspaceId} and status = 'active'
    `
    expect(subscriptions.count).toBe(2)
  })

  it('does not pay a canceled order', async () => {
    const workspaceId = owner.personal_workspace_id
    const creditsBefore = (await billing.getEntitlements(ownerActor, workspaceId)).credits
    const order = await billing.createOrder(ownerActor, { workspaceId, operationId: randomUUID(), kind: 'pro' })
    // ยังไม่มี RPC ยกเลิก (ไม่มี provider) — จำลองสถานะผ่าน SQL โดยตรง
    await sql`update app_private.orders set status = 'canceled' where id = ${order.id}`
    await expect(billing.fulfilOrder(ownerActor, order.id, 'dev', 'integration-canceled'))
      .rejects.toMatchObject({ status: 409, code: 'ORDER_NOT_PAYABLE' })
    const [row] = await sql<{ status: string; paid_at: string | null }[]>`
      select status, paid_at from app_private.orders where id = ${order.id}
    `
    expect(row).toEqual({ status: 'canceled', paid_at: null })
    expect((await billing.getEntitlements(ownerActor, workspaceId)).credits).toBe(creditsBefore)
  })

  it("hides the first user's designs, workspace and orders from another account", async () => {
    // ผู้ใช้อื่นมองไม่เห็นแบบของคนแรก — ตอบ 404 เหมือนไม่มี ไม่ใช่ 402/403
    await expect(billing.authorizeExport(otherActor, firstProjectId))
      .rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' })
    await expect(billing.getEntitlements(otherActor, owner.personal_workspace_id))
      .rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' })
    await expect(billing.createOrder(otherActor, {
      workspaceId: other.personal_workspace_id,
      operationId: randomUUID(),
      kind: 'design',
      projectId: firstProjectId,
    })).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' })
    // order ค้างจ่ายของคนแรก คนอื่น fulfil ไม่ได้ (ต้องเป็น purchaser)
    const pending = await billing.createOrder(ownerActor, {
      workspaceId: owner.personal_workspace_id, operationId: randomUUID(), kind: 'pro',
    })
    await expect(billing.fulfilOrder(otherActor, pending.id, 'dev', 'integration-foreign'))
      .rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' })
    const [row] = await sql<{ status: string }[]>`select status from app_private.orders where id = ${pending.id}`
    expect(row.status).toBe('pending')

    // workspace ของผู้ใช้อื่นเองยังเป็น Freemium ปกติ ไม่ติดสิทธิ์/เครดิตของคนแรก
    await expect(billing.getEntitlements(otherActor, other.personal_workspace_id)).resolves.toMatchObject({
      plan: 'free', credits: 0, licensedProjectIds: [],
    })
    await expect(billing.reserveAiCredit(otherActor, other.personal_workspace_id, randomUUID()))
      .rejects.toMatchObject({ status: 402, code: 'AI_CREDITS_EXHAUSTED' })
  })
})
