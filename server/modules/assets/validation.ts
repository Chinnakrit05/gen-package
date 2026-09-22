import { z } from 'zod'

export const assetIdSchema = z.uuid()
export const assetOperationIdSchema = z.uuid()
export const assetPurposeSchema = z.enum(['project-decoration', 'project-fill'])
export const assetMimeSchema = z.enum(['image/png', 'image/jpeg'])

export const createAssetUploadIntentSchema = z.object({
  workspaceId: z.uuid(),
  purpose: assetPurposeSchema,
  declaredMime: assetMimeSchema,
  declaredSize: z.number().int().min(1).max(10 * 1024 * 1024),
  operationId: z.uuid(),
}).strict()

export const assetOperationSchema = z.object({
  operationId: z.uuid(),
}).strict()

export const assetDownloadRequestSchema = z.object({
  assetIds: z.array(z.uuid()).min(1).max(50).superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'assetIds ต้องไม่ซ้ำกัน' })
    }
  }),
}).strict()
