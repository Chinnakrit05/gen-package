import { describe, expect, it } from 'vitest'
import type { CloudProject, CreateProjectInput } from '../../../shared/contracts/projects'
import { freshProject, type Project } from '../../core/project'
import { MemoryCreateIntentStore, createIntentKey } from '../drafts/createIntentStore'
import { CreateIntentFailedError, CreateIntentSession, type CreateIntentSendDeps } from './createIntent'

const scope = { appUserId: '10000000-0000-4000-8000-000000000001', workspaceId: '20000000-0000-4000-8000-000000000001' }
const otherScope = { appUserId: '10000000-0000-4000-8000-000000000002', workspaceId: scope.workspaceId }
const SERVER_ID = '30000000-0000-4000-8000-000000000001'

// server จำลองที่ idempotent ตาม operationId (ตาม contract b-phase0-r1) — นับจำนวนงานที่สร้างจริง
function fakeServer() {
  const byOperation = new Map<string, { input: CreateProjectInput; project: CloudProject }>()
  let loseResponses = 0
  const deps: CreateIntentSendDeps = {
    prepare: async (project) => ({ name: project.name, documentSchemaVersion: 1, document: documentOf(project) }),
    create: async (input) => {
      const seen = byOperation.get(input.operationId)
      if (seen && JSON.stringify(seen.input) !== JSON.stringify(input)) {
        throw Object.assign(new Error('reused'), { code: 'IDEMPOTENCY_KEY_REUSED' })
      }
      const project = seen?.project ?? cloudOf(input, byOperation.size === 0 ? SERVER_ID : crypto.randomUUID())
      byOperation.set(input.operationId, { input, project })
      if (loseResponses > 0) {
        loseResponses -= 1
        throw Object.assign(new Error('network'), { code: 'NETWORK_ERROR' })
      }
      return project
    },
  }
  return {
    deps,
    created: () => byOperation.size,
    loseNextResponse: () => { loseResponses += 1 },
    operations: byOperation,
  }
}

function documentOf(project: Project): CreateProjectInput['document'] {
  return {
    live: project.live,
    qty: project.qty,
    fillColor: project.fillColor,
    decos: project.decos,
    history: project.history,
    histIdx: project.histIdx,
  } as unknown as CreateProjectInput['document']
}

function cloudOf(input: CreateProjectInput, id: string): CloudProject {
  const now = new Date().toISOString()
  return {
    id,
    workspaceId: input.workspaceId,
    name: input.name,
    documentSchemaVersion: 1,
    document: input.document,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    assets: [],
  }
}

const edited = (project: Project, qty: number): Project => ({ ...project, qty, updatedAt: project.updatedAt + qty })

describe('CreateIntentSession', () => {
  it('เปิด intent ใหม่แล้วร่างแรกอยู่ใน store ก่อนให้แก้', async () => {
    const store = new MemoryCreateIntentStore()
    const session = await CreateIntentSession.open(store, scope, 'intent-a', () => freshProject(1))
    expect(session.current.status).toBe('local')
    expect(await store.get(createIntentKey(scope, 'intent-a'))).not.toBeNull()
  })

  it('refresh หลัง server สร้างแล้วแต่ response หาย → ส่งซ้ำด้วย operationId+payload เดิม ได้งานเดียว', async () => {
    const store = new MemoryCreateIntentStore()
    const server = fakeServer()
    const first = await CreateIntentSession.open(store, scope, 'intent-b', () => freshProject(1))
    server.loseNextResponse()
    await expect(first.send(server.deps)).rejects.toThrow('network')
    expect(server.created()).toBe(1)
    // "refresh": เปิด session ใหม่จาก store เดิม
    const reopened = await CreateIntentSession.open(store, scope, 'intent-b', () => { throw new Error('ห้ามสร้างร่างใหม่') })
    expect(reopened.current.status).toBe('sending')
    const cloud = await reopened.send(server.deps)
    expect(cloud.id).toBe(SERVER_ID)
    expect(server.created()).toBe(1)
  })

  it('refresh หลังได้ response แล้วแต่ก่อน replace URL → ไม่ยิง POST ใหม่', async () => {
    const store = new MemoryCreateIntentStore()
    const server = fakeServer()
    const first = await CreateIntentSession.open(store, scope, 'intent-c', () => freshProject(1))
    await first.send(server.deps)
    let calls = 0
    const counting: CreateIntentSendDeps = { ...server.deps, create: async (input) => { calls += 1; return server.deps.create(input) } }
    const reopened = await CreateIntentSession.open(store, scope, 'intent-c', () => freshProject(9))
    expect(reopened.current.status).toBe('created')
    expect((await reopened.send(counting)).id).toBe(SERVER_ID)
    expect(calls).toBe(0)
  })

  it('แก้ต่อหลังตรึง payload → payload เดิมไม่เปลี่ยน และได้ร่างล่าสุดพร้อม id จริงให้ย้ายเข้า save queue', async () => {
    const store = new MemoryCreateIntentStore()
    const server = fakeServer()
    const session = await CreateIntentSession.open(store, scope, 'intent-d', () => freshProject(1))
    const base = session.current.latest.project
    await session.capture(edited(base, 5))
    server.loseNextResponse()
    await expect(session.send(server.deps)).rejects.toThrow()
    const frozenQty = (session.current.frozen!.payload.document as { qty: number }).qty
    await session.capture(edited(base, 7))
    await session.send(server.deps)
    expect(frozenQty).toBe(5)
    expect(server.created()).toBe(1)
    const pending = session.pendingAfterCreate()
    expect(pending?.id).toBe(SERVER_ID)
    expect(pending?.qty).toBe(7)
  })

  it('ไม่มีการแก้หลังตรึง → ไม่มีร่างค้างให้ย้าย', async () => {
    const store = new MemoryCreateIntentStore()
    const session = await CreateIntentSession.open(store, scope, 'intent-e', () => freshProject(1))
    await session.send(fakeServer().deps)
    expect(session.pendingAfterCreate()).toBeNull()
  })

  it('operationId ถูกใช้กับ payload อื่น (409) → failed ไม่ส่งซ้ำและไม่สร้าง key ใหม่', async () => {
    const store = new MemoryCreateIntentStore()
    const server = fakeServer()
    const session = await CreateIntentSession.open(store, scope, 'intent-f', () => freshProject(1))
    server.loseNextResponse()
    await expect(session.send(server.deps)).rejects.toThrow()
    const operationId = session.current.frozen!.operationId
    // payload ฝั่ง server ถูกแทนด้วยข้อมูลอื่นภายใต้ key เดิม (จำลอง)
    const seen = server.operations.get(operationId)!
    server.operations.set(operationId, { ...seen, input: { ...seen.input, name: 'อื่น' } })
    await expect(session.send(server.deps)).rejects.toBeInstanceOf(CreateIntentFailedError)
    expect(session.current.status).toBe('failed')
    expect(session.current.frozen!.operationId).toBe(operationId)
    await expect(session.send(server.deps)).rejects.toBeInstanceOf(CreateIntentFailedError)
  })

  it('บัญชีอื่นเปิด intent id เดียวกันไม่เห็นร่างของเจ้าของเดิม', async () => {
    const store = new MemoryCreateIntentStore()
    const owner = await CreateIntentSession.open(store, scope, 'intent-g', () => freshProject(1))
    await owner.capture(edited(owner.current.latest.project, 3))
    const other = await CreateIntentSession.open(store, otherScope, 'intent-g', () => freshProject(2))
    expect(other.current.latest.project.qty).not.toBe(3)
    expect(await store.list(scope)).toHaveLength(1)
    expect(await store.list(otherScope)).toHaveLength(1)
  })

  it('เก็บร่างไม่สำเร็จ → capture throw และร่างใน store ยังเป็นรุ่นเดิม', async () => {
    const store = new MemoryCreateIntentStore()
    const session = await CreateIntentSession.open(store, scope, 'intent-h', () => freshProject(1))
    store.failPut = new Error('QuotaExceededError')
    await expect(session.capture(edited(session.current.latest.project, 4))).rejects.toThrow('Quota')
    store.failPut = null
    expect((await store.get(createIntentKey(scope, 'intent-h')))!.latest.generation).toBe(1)
  })
})
