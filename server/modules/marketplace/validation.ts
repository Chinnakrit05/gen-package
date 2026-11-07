import { z } from 'zod'
import {
  MARKETPLACE_ROLES,
  SUPPLIER_CAPABILITIES,
  SUPPLIER_KINDS,
  SUPPLIER_REVIEW_ACTIONS,
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
