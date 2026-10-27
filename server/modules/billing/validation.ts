import { z } from 'zod'

// body/query ของ billing routes + schema ตรวจ jsonb ที่ RPC คืน (strict แบบ cloudProjectSchema)
// ราคา/เครดิตมาจาก server เท่านั้น — client ส่งแค่ id กับชนิดแพ็กเกจ

const timestampSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'invalid timestamp')
const creditsSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const orderKindSchema = z.enum(['design', 'pro'])

export const orderIdSchema = z.uuid()

export const entitlementsQuerySchema = z.object({
  workspaceId: z.uuid(),
}).strict()

export const createOrderInputSchema = z.object({
  workspaceId: z.uuid(),
  operationId: z.uuid(),
  kind: orderKindSchema,
  projectId: z.uuid().optional(),
}).strict().superRefine((input, context) => {
  if ((input.kind === 'design') !== (input.projectId !== undefined)) {
    context.addIssue({
      code: 'custom',
      path: ['projectId'],
      message: 'projectId จำเป็นเฉพาะเมื่อ kind เป็น design',
    })
  }
})

// body ของ POST /api/v1/ai/box-spec บน cloud — current/image ตรวจต่อด้วย parseCurrent/parseImage ของ boxSpec.ts
export const aiBoxSpecRequestSchema = z.object({
  workspaceId: z.uuid(),
  operationId: z.uuid(),
  prompt: z.string().min(1).max(2000).refine((value) => value.trim().length > 0, 'prompt ต้องไม่ว่าง'),
  current: z.unknown().optional(),
  image: z.unknown().optional(),
}).strict()

// body ของ POST /api/v1/ai/artwork — ซอง (workspace/operation) ตรวจที่นี่ ส่วน payload งานศิลป์ (prompt/panels/รูป ≤ 4)
// ตรวจต่อด้วย parseArtworkRequest ของ aiArtwork.ts (ชุดเดียวกับ legacy /api/ai-artwork)
export const aiArtworkRequestSchema = z.object({
  workspaceId: z.uuid(),
  operationId: z.uuid(),
}).passthrough()

export const catalogItemResultSchema = z.object({
  kind: orderKindSchema,
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.literal('THB'),
  credits: creditsSchema,
  periodDays: z.number().int().positive().nullable(),
}).strict()

export const entitlementsResultSchema = z.object({
  workspaceId: z.uuid(),
  plan: z.enum(['free', 'pro']),
  proUntil: timestampSchema.nullable(),
  credits: creditsSchema,
  licensedProjectIds: z.array(z.uuid()),
  catalog: z.object({
    design: catalogItemResultSchema,
    pro: catalogItemResultSchema,
  }).strict(),
}).strict()

export const exportAuthorizationResultSchema = z.object({
  projectId: z.uuid(),
  source: z.enum(['purchase', 'pro', 'admin']),
  entitlements: entitlementsResultSchema,
}).strict()

export const aiReservationResultSchema = z.object({
  requestId: z.uuid(),
  credits: creditsSchema,
}).strict()

export const aiSettlementResultSchema = z.object({
  credits: creditsSchema,
}).strict()

// ผลของ RPC check_storage_quota (supabase/migrations/20261027000900_storage_quota.sql) — หน่วยไบต์
const byteCountSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
export const storageQuotaResultSchema = z.object({
  ok: z.boolean(),
  plan: z.enum(['free', 'pro']),
  limitBytes: byteCountSchema.min(1),
  usedBytes: byteCountSchema,
  projectedBytes: byteCountSchema,
}).strict()

export const orderResultSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  kind: orderKindSchema,
  projectId: z.uuid().nullable(),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.literal('THB'),
  credits: creditsSchema,
  status: z.enum(['pending', 'paid', 'canceled']),
  provider: z.string().min(1).max(40),
  providerRef: z.string().min(1).max(200).nullable(),
  createdAt: timestampSchema,
  paidAt: timestampSchema.nullable(),
}).strict()
