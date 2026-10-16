import type {
  CreateOrderInput,
  Entitlements,
  ExportAuthorization,
  ExportFormat,
  Order,
} from '../../../shared/contracts/billing'
import { requestApi } from './client'

// client ของ billing/entitlement (cloud mode) — ดู docs/billing-freemium-pro.md §3
// server เป็นผู้ตัดสินสิทธิ์ทุกครั้ง client แค่ถาม/แสดงผล

export function getEntitlements(
  apiBaseUrl: string,
  accessToken: string,
  workspaceId: string,
  signal?: AbortSignal,
): Promise<Entitlements> {
  const search = new URLSearchParams({ workspaceId })
  return requestApi<Entitlements>(`${apiBaseUrl}/billing/entitlements?${search}`, accessToken, {
    method: 'GET',
    signal,
  })
}

// ขอสิทธิ์ดาวน์โหลดไฟล์ผลิตของแบบนี้ — 402 PAYMENT_REQUIRED เมื่อยังไม่ซื้อ/ไม่ใช่ Pro;
// 402 PRO_REQUIRED เมื่อขอรูปแบบที่เฉพาะ Pro (SVG/AI) แต่ไม่ใช่ Pro (ApiClientError.code)
export function authorizeExport(
  apiBaseUrl: string,
  accessToken: string,
  projectId: string,
  format?: ExportFormat,
  signal?: AbortSignal,
): Promise<ExportAuthorization> {
  return requestApi<ExportAuthorization>(
    `${apiBaseUrl}/projects/${encodeURIComponent(projectId)}/export-authorizations`,
    accessToken,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(format ? { format } : {}),
      signal,
    },
  )
}

export function createOrder(
  apiBaseUrl: string,
  accessToken: string,
  input: CreateOrderInput,
  signal?: AbortSignal,
): Promise<Order> {
  return requestApi<Order>(`${apiBaseUrl}/billing/orders`, accessToken, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
}

// จำลองการชำระ (เฉพาะ server ใน development/test — ที่อื่นตอบ 404 เหมือนไม่มีเส้นทางนี้)
export function devFulfilOrder(
  apiBaseUrl: string,
  accessToken: string,
  orderId: string,
  signal?: AbortSignal,
): Promise<Order> {
  return requestApi<Order>(
    `${apiBaseUrl}/billing/orders/${encodeURIComponent(orderId)}/dev-fulfil`,
    accessToken,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal,
    },
  )
}
