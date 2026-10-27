// สัญญา billing/entitlement ระหว่าง server กับ client — ดู docs/billing-freemium-pro.md
// ราคาและเครดิตมาจาก server (app_private.plan_catalog) เท่านั้น ห้าม client ส่งค่าเหล่านี้กลับมา

export type PlanCode = 'free' | 'pro'

export type OrderKind = 'design' | 'pro'

export interface CatalogItem {
  kind: OrderKind
  amountMinor: number // สตางค์
  currency: 'THB'
  credits: number // เครดิต AI ที่ได้รับเมื่อชำระ
  periodDays: number | null // รอบสมาชิก (null = ซื้อขาด)
}

export interface BillingCatalog {
  design: CatalogItem
  pro: CatalogItem
}

export interface Entitlements {
  workspaceId: string
  plan: PlanCode
  proUntil: string | null // ISO; null เมื่อไม่ใช่ Pro
  credits: number
  licensedProjectIds: string[]
  catalog: BillingCatalog
  devFulfilAvailable: boolean // server อยู่ใน development/test จึงจำลองการชำระได้
  // เปิดให้สั่งซื้อได้หรือไม่ — เจ้าของผลิตภัณฑ์ตัดสินใจ (13 ต.ค. 2026) ให้ซ่อนปุ่มซื้อจนกว่าจะมีผู้ให้บริการชำระเงิน
  // ตอนนี้ server คืน true เฉพาะ development/test (จำลองการชำระได้); false = client ซ่อนปุ่มซื้อ และ POST /billing/orders ตอบ 503
  purchasesEnabled: boolean
  // ช่วงเปิดให้ใช้ฟรี (ตัดสินใจ 15 ต.ค. 2026): ทุก workspace ได้รอบ Pro ฟรีที่ต่อเองทุกรอบ — plan เป็น 'pro' อยู่แล้ว
  // flag นี้มีไว้ให้ client บอกผู้ใช้ว่าเป็น Pro ฟรี และไม่ติดลายน้ำเลย; server เปิดเมื่อยังไม่เปิดขาย (isOpenAccess)
  openAccess: boolean
  // ช่วงพัฒนา: ให้เลือกรุ่น AI (Opus/Sonnet/Haiku) ในหน้าสั่ง AI และโชว์โทเคน/ค่าใช้จ่ายจริงหลังทำเสร็จ —
  // server ใส่ true เฉพาะ development/test/staging (isAiModelChoiceEnabled); production ไม่ส่งและไม่ใช้รุ่นที่ client เลือก
  aiModelChoice?: boolean
}

export type LicenseSource = 'purchase' | 'pro' | 'admin'

// รูปแบบไฟล์ผลิตที่ขอสิทธิ์ดาวน์โหลด — SVG/AI (ไฟล์เวกเตอร์แก้ต่อได้) เปิดเฉพาะ Pro (ซื้อรายแบบได้แค่ spec/dxf/pdf)
export const EXPORT_FORMATS = ['spec', 'dxf', 'pdf', 'svg', 'ai'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]
export const PRO_ONLY_EXPORT_FORMATS: readonly ExportFormat[] = ['svg', 'ai']
export const isProOnlyExport = (format: ExportFormat | undefined) => !!format && PRO_ONLY_EXPORT_FORMATS.includes(format)

export interface ExportAuthorization {
  projectId: string
  source: LicenseSource
  entitlements: Entitlements
}

export interface CreateOrderInput {
  workspaceId: string
  operationId: string
  kind: OrderKind
  projectId?: string // จำเป็นเมื่อ kind = 'design'
}

export type OrderStatus = 'pending' | 'paid' | 'canceled'

export interface Order {
  id: string
  workspaceId: string
  kind: OrderKind
  projectId: string | null
  amountMinor: number
  currency: 'THB'
  credits: number
  status: OrderStatus
  provider: string // 'none' จนกว่าจะเลือกผู้ให้บริการ; 'dev' = จำลอง
  providerRef: string | null
  checkoutUrl: string | null // null จนกว่าจะมีผู้ให้บริการชำระเงิน
  createdAt: string
  paidAt: string | null
}

// response ของ AI route บน cloud = สเปกกล่อง + เครดิตคงเหลือหลังหัก
export interface AiCreditsReceipt {
  credits: number
}
