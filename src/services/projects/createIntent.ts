// /editor/new: งานที่ยังไม่มี server ID (ROUTES-PHASE-1.md §7 R2–R3)
// ลำดับ: เก็บร่างลง intent → (ออนไลน์) ตรึง payload + operationId แล้ว put ก่อนยิง POST → ได้ผลแล้ว put result
// ก่อนให้ผู้เรียกย้ายร่างเข้า save queue ของ id จริง → ลบ intent; refresh ช่วงไหนก็ได้งานเดียว
import type { CloudProject, CreateProjectInput } from '../../../shared/contracts/projects'
import type { Project } from '../../core/project'
import {
  createIntentKey,
  createIntentScopeKey,
  type CreateIntentRecord,
  type CreateIntentScope,
  type CreateIntentStore,
} from '../drafts/createIntentStore'

export type CreatePayload = Pick<CreateProjectInput, 'name' | 'documentSchemaVersion' | 'document'>

export interface CreateIntentSendDeps {
  // แปลงร่างเป็น payload (อัปโหลดรูปตาม flow เดิม) — เรียกครั้งเดียวต่อ intent ตอนตรึง
  prepare(project: Project): Promise<CreatePayload>
  create(input: CreateProjectInput): Promise<CloudProject>
}

// operationId เดิมถูกใช้กับ payload อื่น — ไม่ retry และไม่สร้าง key ใหม่หลบ (ต้องให้ผู้ใช้ตัดสิน)
export class CreateIntentFailedError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'CreateIntentFailedError'
  }
}

export class CreateIntentSession {
  private chain: Promise<unknown> = Promise.resolve()
  private sending: Promise<CloudProject> | null = null

  private constructor(
    private readonly store: CreateIntentStore,
    private record: CreateIntentRecord,
  ) {}

  // เปิด intent เดิมของ history entry นี้ หรือสร้างใหม่ (await put ก่อนคืน — ร่างแรกอยู่ในเครื่องก่อนให้แก้)
  static async open(
    store: CreateIntentStore,
    scope: CreateIntentScope,
    intentId: string,
    fresh: () => Project,
  ): Promise<CreateIntentSession> {
    const key = createIntentKey(scope, intentId)
    const stored = await store.get(key)
    if (stored) {
      if (stored.scopeKey !== createIntentScopeKey(scope)) throw new Error('งานใหม่นี้เป็นของบัญชีหรือ workspace อื่น')
      return new CreateIntentSession(store, stored)
    }
    const now = Date.now()
    const record: CreateIntentRecord = {
      version: 1,
      key,
      scopeKey: createIntentScopeKey(scope),
      scope: { ...scope },
      intentId,
      status: 'local',
      latest: { generation: 1, project: fresh() },
      frozen: null,
      result: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    }
    await store.put(record)
    return new CreateIntentSession(store, record)
  }

  get current(): CreateIntentRecord {
    return structuredClone(this.record)
  }

  // คืน generation ใหม่; put ล้ม = throw (ผู้เรียกห้ามบอกว่าเก็บแล้ว)
  capture(project: Project): Promise<number> {
    return this.exclusive(async () => {
      if (JSON.stringify(this.record.latest.project) === JSON.stringify(project)) return this.record.latest.generation
      const next: CreateIntentRecord = {
        ...this.record,
        latest: { generation: this.record.latest.generation + 1, project: structuredClone(project) },
        updatedAt: Date.now(),
      }
      await this.store.put(next)
      this.record = next
      return next.latest.generation
    })
  }

  // ส่งซ้ำได้ทุกเมื่อ: created แล้วไม่ยิงใหม่, sending ใช้ operationId+payload เดิม, failed ไม่ส่ง
  send(deps: CreateIntentSendDeps): Promise<CloudProject> {
    if (this.sending) return this.sending
    const run = this.runSend(deps).finally(() => {
      this.sending = null
    })
    this.sending = run
    return run
  }

  // ร่างที่ต้องย้ายเข้า save queue ของ id จริง (null = ไม่มีการแก้หลังตรึง payload)
  pendingAfterCreate(): Project | null {
    const { result, frozen, latest } = this.record
    if (!result || !frozen || latest.generation <= frozen.generation) return null
    return { ...structuredClone(latest.project), id: result.id }
  }

  discard(): Promise<void> {
    return this.exclusive(() => this.store.delete(this.record.key))
  }

  private async runSend(deps: CreateIntentSendDeps): Promise<CloudProject> {
    if (this.record.status === 'created' && this.record.result) return structuredClone(this.record.result)
    if (this.record.status === 'failed') {
      throw new CreateIntentFailedError(this.record.error?.code ?? 'FAILED', this.record.error?.message ?? 'สร้างงานไม่สำเร็จ')
    }
    if (!this.record.frozen) {
      const snapshot = this.record.latest
      const payload = await deps.prepare(structuredClone(snapshot.project))
      await this.exclusive(async () => {
        if (this.record.frozen) return
        const operationId = crypto.randomUUID()
        const next: CreateIntentRecord = {
          ...this.record,
          status: 'sending',
          frozen: {
            generation: snapshot.generation,
            operationId,
            payload: { workspaceId: this.record.scope.workspaceId, operationId, ...payload },
          },
          updatedAt: Date.now(),
        }
        await this.store.put(next)
        this.record = next
      })
    }
    const frozen = this.record.frozen!
    let cloud: CloudProject
    try {
      cloud = await deps.create(structuredClone(frozen.payload))
    } catch (error) {
      const code = errorCode(error)
      if (code === 'IDEMPOTENCY_KEY_REUSED') {
        await this.exclusive(async () => {
          const next: CreateIntentRecord = {
            ...this.record,
            status: 'failed',
            error: { code, message: error instanceof Error ? error.message : 'สร้างงานไม่สำเร็จ' },
            updatedAt: Date.now(),
          }
          await this.store.put(next)
          this.record = next
        })
        throw new CreateIntentFailedError(code, 'สร้างงานไม่สำเร็จ: รหัสคำขอเดิมถูกใช้กับข้อมูลอื่น')
      }
      throw error
    }
    if (cloud.workspaceId !== this.record.scope.workspaceId) throw new Error('งานที่สร้างอยู่คนละ workspace')
    await this.exclusive(async () => {
      const next: CreateIntentRecord = { ...this.record, status: 'created', result: cloud, updatedAt: Date.now() }
      await this.store.put(next)
      this.record = next
    })
    return structuredClone(cloud)
  }

  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const next = this.chain.then(run, run)
    this.chain = next.catch(() => undefined)
    return next
  }
}

function errorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof (error as { code: unknown }).code === 'string') {
    return (error as { code: string }).code
  }
  return null
}
