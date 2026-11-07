import type {
  MarketplaceRole,
  SupplierCapability,
  SupplierKind,
  SupplierProfileInput,
  SupplierStatus,
} from '../../../shared/contracts/marketplace'
import { ApiClientError } from '../../services/api/client'

export const supplierKindNames: Record<SupplierKind, string> = {
  factory: 'โรงงาน',
  print_shop: 'ร้านปริ้น',
}

export const supplierStatusNames: Record<SupplierStatus, string> = {
  draft: 'ฉบับร่าง',
  pending: 'รอตรวจสอบ',
  approved: 'อนุมัติแล้ว',
  suspended: 'พักรับงาน',
}

export const supplierCapabilityNames: Record<SupplierCapability, string> = {
  offset_printing: 'พิมพ์ออฟเซต',
  digital_printing: 'พิมพ์ดิจิทัล',
  flexographic_printing: 'พิมพ์เฟล็กโซ',
  die_cutting: 'ไดคัท',
  lamination: 'เคลือบฟิล์ม',
  foil_stamping: 'ปั๊มฟอยล์',
}

export const supplierRoleNames: Record<MarketplaceRole, string> = {
  manager: 'ผู้จัดการ',
  staff: 'พนักงาน',
  viewer: 'ดูอย่างเดียว',
}

export const SUPPLIER_SLUG_PATTERN = '[a-z0-9]+(?:-[a-z0-9]+)*'
export const SUPPLIER_SLUG = new RegExp(`^${SUPPLIER_SLUG_PATTERN}$`)
export const SUPPLIER_ID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i

export function supplierInput(profile: SupplierProfileInput): SupplierProfileInput {
  return {
    kind: profile.kind,
    name: profile.name.trim(),
    slug: profile.slug.trim(),
    description: profile.description.trim(),
    contactEmail: profile.contactEmail.trim(),
    capabilities: [...profile.capabilities],
  }
}

export function supplierError(error: unknown, fallback: string): string {
  if (!(error instanceof ApiClientError)) return fallback
  if (error.code === 'REVISION_CONFLICT') return 'โปรไฟล์เปลี่ยนไปแล้ว โหลดฉบับล่าสุดก่อนลองอีกครั้ง'
  if (error.code === 'MARKETPLACE_MFA_REQUIRED') return 'ยืนยันตัวตนสองขั้นตอนก่อนทำรายการ'
  if (error.code === 'MARKETPLACE_FORBIDDEN' || error.status === 403) return 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้'
  if (error.status === 409 || error.status === 422 || error.code === 'NETWORK_ERROR') return error.message
  return fallback
}
