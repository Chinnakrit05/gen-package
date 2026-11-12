import { z } from 'zod'
export const uuid = z.string().uuid()
export const termsSchema = z.object({ requestRevisionId: uuid, totalMinor: z.number().int().min(1).max(100_000_000_000), currency: z.literal('THB'), leadDays: z.number().int().min(1).max(365), validUntil: z.string().datetime({ offset: true }), depositMinor: z.number().int().min(0).max(100_000_000_000), requiresProof: z.boolean(), notes: z.string().max(4000) }).strict()
export const saveQuotationSchema = termsSchema.extend({ operationId: uuid, expectedRevision: z.number().int().min(0) }).refine(v => v.depositMinor <= v.totalMinor)
export const quoteActionSchema = z.object({ operationId: uuid, expectedRevision: z.number().int().min(1) }).strict()
export const quotationRevisionSchema = termsSchema.extend({ id: uuid, quotationId: uuid, revision: z.number().int().positive(), sentAt: z.string() })
export const quotationSchema = z.object({ id: uuid, requestId: uuid, supplierId: uuid, supplierName: z.string(), requestTitle: z.string(), revision: z.number().int().positive(), status: z.enum(['draft','sent','withdrawn']), draft: termsSchema.nullable(), current: quotationRevisionSchema.nullable(), createdAt: z.string(), updatedAt: z.string() })
export const quotationPageSchema = z.object({ items: z.array(quotationSchema), nextCursor: uuid.nullable() })
export const commerceQuery = z.object({ cursor: uuid.optional() }).strict()
export const orderActionSchema = z.object({ operationId: uuid, expectedRevision: z.number().int().positive(), reason: z.string().trim().min(1).max(1000).optional(), fileId: uuid.nullable().optional(), notes: z.string().max(2000).optional(), proofId: uuid.optional(), amountMinor: z.number().int().positive().max(100_000_000_000).optional(), reference: z.string().trim().min(1).max(200).optional(), paymentReportId: uuid.optional() }).strict()
export const selectQuotationSchema = z.object({operationId:uuid,quoteRevisionId:uuid}).strict()
export const productionOrderSchema = z.object({
 id:uuid,requestId:uuid,supplierId:uuid,supplierName:z.string(),requestTitle:z.string(),acceptedQuoteRevisionId:uuid,
 terms:quotationRevisionSchema,status:z.enum(['pending_supplier_confirmation','confirmed','declined','expired','cancelled','in_production','shipped','completed']),revision:z.number().int().positive(),createdAt:z.string(),confirmationDeadline:z.string(),
 requestSnapshot:z.object({title:z.string(),quantity:z.number(),notes:z.string(),spec:z.record(z.string(),z.unknown())}),
 permissions:z.object({side:z.enum(['buyer','supplier']),canConfirm:z.boolean(),canApproveProof:z.boolean(),canReportPayment:z.boolean(),canConfirmPayment:z.boolean(),canUploadProof:z.boolean(),canUpdateStatus:z.boolean(),canCancel:z.boolean()}),
 proofs:z.array(z.object({id:uuid,version:z.number().int().positive(),fileId:uuid,notes:z.string(),createdAt:z.string(),approvedAt:z.string().nullable()})),
 payments:z.array(z.object({id:uuid,amountMinor:z.number().int().positive(),reference:z.string(),fileId:uuid.nullable(),reportedAt:z.string(),confirmedAt:z.string().nullable()})),
})
export const productionOrderPageSchema=z.object({items:z.array(productionOrderSchema),nextCursor:uuid.nullable()})
export const requestSpecSchema=z.object({template:z.string().min(1).max(120),materialId:z.string().min(1).max(120),W:z.number().min(10).max(250),D:z.number().min(20).max(150),H:z.number().min(10).max(300),handle:z.boolean()}).strict()
export const requestRevisionSchema=z.object({id:uuid,revision:z.number().int().positive(),title:z.string(),quantity:z.number().int().positive(),notes:z.string(),spec:requestSpecSchema,createdAt:z.string()})
export const requestTradingSchema=z.object({status:z.enum(['open','closed','selection_pending','awarded']),acceptingUntil:z.string(),currentRevision:requestRevisionSchema,revisions:z.array(requestRevisionSchema),revisionsNextCursor:z.number().int().nullable().default(null)})
export const reviseRequestSchema=z.object({operationId:uuid,expectedRevisionId:uuid,title:z.string().trim().min(1).max(100),quantity:z.number().int().min(1).max(1_000_000),notes:z.string().max(1000),spec:requestSpecSchema,acceptingUntil:z.string().datetime({offset:true})}).strict()
export const requestPreviewSchema=z.object({preview:z.object({mimeType:z.enum(['image/webp','image/jpeg']),dataBase64:z.string().max(87384),byteSize:z.number().int().min(1).max(65536),sourceProjectRevision:z.null(),sourceRequestRevisionId:uuid,frozenRequestProjectRevision:z.number().int().positive(),projectRevisionAtCapture:z.number().int().positive(),thumbnailUpdatedAt:z.string(),capturedAt:z.string(),match:z.enum(['unverified_reference','original_reference'])}).nullable()})
