import type { MarketplaceAdminScope } from '../../shared/contracts/admin'
import type { MarketplaceContextData, SupplierAccess } from '../../shared/contracts/marketplace'

export type StudioRole = 'buyer' | 'supplier' | 'staff' | 'shared'
export type StudioIconName = 'projects' | 'requests' | 'factory' | 'team' | 'review' | 'profile' | 'bell' | 'chat' | 'orders'
export interface StudioNavItem { to: string; label: string; icon: StudioIconName; exact?: boolean }

export function studioRoleForPath(path: string): StudioRole {
  if (path === '/admin' || path.startsWith('/admin/')) return 'staff'
  if (path.startsWith('/factory/')) return 'supplier'
  return 'buyer'
}

export function studioSupplierForPath(path: string, suppliers: SupplierAccess[]): SupplierAccess | undefined {
  const id = /^\/factory\/([^/]+)\//.exec(path)?.[1]
  // Never replace an inaccessible shop in a deep link with another shop's links.
  return id ? suppliers.find((supplier) => supplier.profile.id === id) : undefined
}

export function studioNavigation(role: StudioRole, supplier: SupplierAccess | undefined, canRequest: boolean, enabled: boolean, scopes: MarketplaceAdminScope[] = [], canReview = true): StudioNavItem[] {
  if (role === 'shared') return [{ to: '/chat', label: 'ข้อความ', icon: 'chat' }, { to: '/app/projects', label: 'กลับพื้นที่งาน', icon: 'projects' }]
  if (role === 'staff') return [
    ...(scopes.includes('operations') ? [{ to: '/admin', label: 'ภาพรวมระบบ', icon: 'review' as const, exact: true }, { to: '/admin/search', label: 'ค้นหารายการ', icon: 'requests' as const }, { to: '/admin/requests', label: 'คำขอราคา', icon: 'requests' as const }, { to: '/admin/orders', label: 'คำสั่งผลิต', icon: 'orders' as const }] : []),
    ...(scopes.some(s => s === 'support' || s === 'support_supervisor') ? [{ to: '/admin/support', label: 'เคสช่วยเหลือ', icon: 'chat' as const }] : []),
    ...(scopes.includes('user_moderator') ? [{ to: '/admin/users', label: 'บัญชีผู้ใช้', icon: 'team' as const }] : []),
    ...(scopes.includes('auditor') ? [{ to: '/admin/audit-log', label: 'ประวัติการตรวจสอบ', icon: 'review' as const }] : []),
    ...(canReview ? [{ to: '/admin/suppliers', label: 'ตรวจสอบผู้รับผลิต', icon: 'review' as const }] : []),
  ]
  if (role === 'supplier') return [
    { to: '/factory/onboarding', label: 'ภาพรวมผู้รับผลิต', icon: 'factory', exact: true },
    ...(supplier ? [
      { to: `/factory/${supplier.profile.id}/profile`, label: 'ข้อมูลกิจการ', icon: 'profile' as const },
      ...(supplier.profile.status === 'approved' ? [{ to: `/factory/${supplier.profile.id}/jobs`, label: 'คำขอราคาที่ได้รับ', icon: 'requests' as const }, { to: `/factory/${supplier.profile.id}/quotes`, label: 'ใบเสนอราคา', icon: 'requests' as const }] : []),
      { to: `/factory/${supplier.profile.id}/orders`, label: 'คำสั่งผลิต', icon: 'orders' as const },
      ...(supplier.role === 'manager' ? [{ to: `/factory/${supplier.profile.id}/team`, label: 'สมาชิกในทีม', icon: 'team' as const }] : []),
    ] : []),
    ...(enabled ? [{ to: '/chat', label: 'ข้อความ', icon: 'chat' as const }, { to: '/app/notifications', label: 'การแจ้งเตือน', icon: 'bell' as const }] : []),
  ]
  return [
    { to: '/app/projects', label: 'งานออกแบบของฉัน', icon: 'projects' },
    ...(enabled ? [{ to: '/app/orders', label: 'คำสั่งผลิต', icon: 'orders' as const }, { to: '/chat', label: 'ข้อความ', icon: 'chat' as const }, { to: '/app/notifications', label: 'การแจ้งเตือน', icon: 'bell' as const }] : []),
    ...(enabled && canRequest ? [{ to: '/app/requests', label: 'คำขอราคาของฉัน', icon: 'requests' as const }] : []),
  ]
}

export function studioHasStaffAccess(context: MarketplaceContextData | undefined): boolean {
  return context?.staff.canReviewSuppliers === true
}
