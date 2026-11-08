import { z } from 'zod'
import {
  MARKETPLACE_ROLES,
  SUPPLIER_CAPABILITIES,
  SUPPLIER_KINDS,
  SUPPLIER_REVIEW_ACTIONS,
  SUPPLIER_REVIEW_DOCUMENT_LIMIT,
  SUPPLIER_REVIEW_DOCUMENT_MAX_BYTES,
  SUPPLIER_REVIEW_DOCUMENT_MIME_TYPES,
  SUPPLIER_STATUSES,
} from '../../../shared/contracts/marketplace'

export const supplierIdSchema = z.uuid()
export const supplierSlugSchema = z.string().min(3).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const capabilityList = z.array(z.enum(SUPPLIER_CAPABILITIES)).max(SUPPLIER_CAPABILITIES.length)
  .refine((items) => new Set(items).size === items.length, 'ความสามารถในการผลิตต้องไม่ซ้ำกัน')
const publicFields = {
  kind: z.enum(SUPPLIER_KINDS),
  name: z.string().trim().min(1).max(100),
  slug: supplierSlugSchema,
  description: z.string().trim().max(1000),
  capabilities: capabilityList,
}
const privateFields = { ...publicFields, contactEmail: z.string().trim().max(254).pipe(z.email()) }
const editableFields = {
  ...privateFields,
  capabilities: capabilityList.transform((items) => SUPPLIER_CAPABILITIES.filter((item) => items.includes(item))),
}
export const expectedSupplierRevision = z.object({ expectedRevision: z.int().min(1).max(2147483647) }).strict()
export const createSupplierInput = z.object({ ...editableFields, operationId: z.uuid() }).strict()
export const updateSupplierInput = expectedSupplierRevision.extend(editableFields).strict()
export const reviewSupplierInput = expectedSupplierRevision.extend({
  action: z.enum(SUPPLIER_REVIEW_ACTIONS),
  reason: z.string().trim().min(1).max(500),
}).strict()
export const supplierAdminQuery = z.object({
  status: z.enum(SUPPLIER_STATUSES).default('pending'),
  after: z.uuid().optional(),
}).strict()

export const supplierProfile = z.object({
  ...privateFields,
  id: z.uuid(),
  workspaceId: z.uuid(),
  status: z.enum(SUPPLIER_STATUSES),
  revision: z.int().min(1),
  reviewNote: z.string().max(500).nullable(),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict()
export const supplierAccess = z.object({ profile: supplierProfile, role: z.enum(MARKETPLACE_ROLES) }).strict()
export const marketplaceContext = z.object({ suppliers: z.array(supplierAccess), isSupplierReviewer: z.boolean() }).strict()
export const supplierPublicProfile = z.object({ ...publicFields, id: z.uuid() }).strict()
export const supplierAdminPage = z.object({ items: z.array(supplierProfile).max(24), nextCursor: z.uuid().nullable() }).strict()

const inviteEmail = z.string().trim().toLowerCase().max(254).pipe(z.email())
const marketplaceRole = z.enum(MARKETPLACE_ROLES)
export const createSupplierInviteInput = z.object({ email: inviteEmail, role: marketplaceRole }).strict()
export const acceptSupplierInviteInput = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict()
export const changeSupplierMemberInput = z.object({ role: marketplaceRole }).strict()
export const supplierTeamMember = z.object({
  userId: z.uuid(),
  displayName: z.string().min(1),
  role: marketplaceRole,
  isWorkspaceOwner: z.boolean(),
}).strict()
export const supplierInvite = z.object({
  id: z.uuid(),
  email: inviteEmail,
  role: marketplaceRole,
  createdAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
}).strict()
export const supplierTeam = z.object({ members: z.array(supplierTeamMember), invites: z.array(supplierInvite) }).strict()
export const removedSupplierMember = z.object({ userId: z.uuid() }).strict()
export const revokedSupplierInvite = z.object({ id: z.uuid() }).strict()

const maxDocumentBase64Length = 4 * Math.ceil(SUPPLIER_REVIEW_DOCUMENT_MAX_BYTES / 3)
export const supplierReviewDocumentBodyLimit = maxDocumentBase64Length + 4096
const reviewDocumentMime = z.enum(SUPPLIER_REVIEW_DOCUMENT_MIME_TYPES)
const reviewDocumentName = z.string().trim().min(1).max(240)
  .refine((name) => Array.from(name).length <= 120 && !/[\u0000-\u001f\u007f/\\]/.test(name))
const reviewDocumentBase64 = z.string().min(4).max(maxDocumentBase64Length).regex(/^[A-Za-z0-9+/]+={0,2}$/)
const reviewDocumentFormats = {
  'application/pdf': { extension: /\.pdf$/i, signature: Buffer.from('%PDF-') },
  'image/png': { extension: /\.png$/i, signature: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) },
  'image/jpeg': { extension: /\.jpe?g$/i, signature: Buffer.from([255, 216, 255]) },
}

export const addSupplierReviewDocumentInput = z.object({
  operationId: z.uuid(),
  name: reviewDocumentName,
  mimeType: reviewDocumentMime,
  dataBase64: reviewDocumentBase64,
}).strict().superRefine(({ name, mimeType, dataBase64 }, context) => {
  const format = reviewDocumentFormats[mimeType]
  if (!format.extension.test(name)) context.addIssue({ code: 'custom', path: ['name'], message: 'นามสกุลไม่ตรงกับชนิดไฟล์' })
  const bytes = Buffer.from(dataBase64, 'base64')
  if (bytes.length > SUPPLIER_REVIEW_DOCUMENT_MAX_BYTES || bytes.toString('base64') !== dataBase64
    || !bytes.subarray(0, format.signature.length).equals(format.signature)) {
    context.addIssue({ code: 'custom', path: ['dataBase64'], message: 'ขนาดหรือชนิดไฟล์ไม่ถูกต้อง' })
  }
})
export const supplierReviewDocument = z.object({
  id: z.uuid(),
  name: reviewDocumentName,
  mimeType: reviewDocumentMime,
  byteSize: z.int().min(1).max(SUPPLIER_REVIEW_DOCUMENT_MAX_BYTES),
  createdAt: z.iso.datetime({ offset: true }),
}).strict()
export const supplierReviewDocuments = z.object({ documents: z.array(supplierReviewDocument).max(SUPPLIER_REVIEW_DOCUMENT_LIMIT) }).strict()
export const supplierReviewDocumentDownload = z.object({ document: supplierReviewDocument, dataBase64: reviewDocumentBase64 }).strict()
export const removedSupplierReviewDocument = z.object({ id: z.uuid() }).strict()
