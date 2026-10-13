// Run npm run dev:local, open /tests/browser/paywall.html — visual check of the Freemium/Pro gating
// (watermark on blueprint/3D/sticker sheet, 149 ฿ lock badges, paywall modal, plan chip, AI credits)
// with a fake CloudProjectBridge kept in memory. No Supabase, backend, credentials or extra dependency.
import { StrictMode, useCallback, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { BillingCatalog, Entitlements, Order, OrderKind } from '../../shared/contracts/billing'
import type { ProjectSummary } from '../../shared/contracts/projects'
import App, { type CloudProjectBridge, type ProjectStoreSnapshot } from '../../src/App'
import { PricingPage } from '../../src/components/PricingPage'
import type { AiBoxSpec } from '../../src/core/ai'
import { freshProject, type Project } from '../../src/core/project'
import { ApiClientError } from '../../src/services/api/client'
import '@fontsource/noto-sans-thai/400.css'
import '@fontsource/noto-sans-thai/700.css'
import '@fontsource/prompt/400.css'
import '../../src/app.css'

type Scenario = 'free' | 'free+licensed' | 'free+credits' | 'pro' | 'pro-no-credits'
const SCENARIOS: Scenario[] = ['free', 'free+licensed', 'free+credits', 'pro', 'pro-no-credits']
const WORKSPACE = 'fixture-workspace'
const DAY_MS = 86_400_000
const CATALOG: BillingCatalog = {
  design: { kind: 'design', amountMinor: 14900, currency: 'THB', credits: 10, periodDays: null },
  pro: { kind: 'pro', amountMinor: 39900, currency: 'THB', credits: 100, periodDays: 30 },
}

interface FakeState {
  projects: Project[]
  entitlements: Entitlements
  orders: Map<string, Order>
}

function makeState(scenario: Scenario): FakeState {
  const first = freshProject(1)
  first.name = 'กล่องชา (fixture)'
  const second = freshProject(2)
  second.name = 'ฉลากน้ำผึ้ง'
  second.live = { ...second.live, materialId: 'pet-bottle' }
  const pro = scenario.startsWith('pro')
  return {
    projects: [first, second],
    orders: new Map(),
    entitlements: {
      workspaceId: WORKSPACE,
      plan: pro ? 'pro' : 'free',
      proUntil: pro ? new Date(Date.now() + 30 * DAY_MS).toISOString() : null,
      credits: scenario === 'free+credits' ? 5 : scenario === 'pro' ? 100 : 0,
      licensedProjectIds: scenario === 'free+licensed' ? [first.id] : [],
      catalog: CATALOG,
      devFulfilAvailable: true,
    },
  }
}

const summaries = (state: FakeState): ProjectSummary[] => state.projects.map((project) => ({
  id: project.id,
  workspaceId: WORKSPACE,
  name: project.name,
  revision: 1,
  updatedAt: new Date(project.updatedAt).toISOString(),
}))

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const snapshot = (state: FakeState): Entitlements => ({
  ...state.entitlements,
  licensedProjectIds: [...state.entitlements.licensedProjectIds],
})

// bridge ใหม่ทุกครั้งที่ state เปลี่ยน (bump) เพื่อให้ App เห็น entitlements ล่าสุดผ่าน prop
function buildBridge(state: FakeState, bump: () => void): CloudProjectBridge {
  const ent = state.entitlements
  const isPro = () => ent.plan === 'pro' && !!ent.proUntil && Date.parse(ent.proUntil) > Date.now()
  const licensed = (projectId: string) => ent.licensedProjectIds.includes(projectId)
  const grant = (projectId: string) => {
    if (!licensed(projectId)) ent.licensedProjectIds.push(projectId)
  }
  return {
    items: summaries(state),
    online: true,
    saveState: 'clean',
    entitlements: snapshot(state),
    onProjectChange: async (project) => {
      state.projects = state.projects.map((item) => (item.id === project.id ? structuredClone(project) : item))
    },
    switchProject: async (_current, targetId) => {
      const target = state.projects.find((project) => project.id === targetId)
      if (!target) throw new Error('ไม่พบงาน')
      return structuredClone(target)
    },
    createProject: async (_current, name) => {
      const project = freshProject(state.projects.length + 1)
      project.name = name.slice(0, 60) || project.name
      state.projects.push(project)
      bump()
      return structuredClone(project)
    },
    deleteProject: async (current, targetId) => {
      state.projects = state.projects.filter((project) => project.id !== targetId)
      if (state.projects.length === 0) state.projects.push(freshProject(1))
      bump()
      return targetId === current.id ? structuredClone(state.projects[0]) : current
    },
    importProject: async (_current, imported) => {
      const project = { ...imported, id: crypto.randomUUID(), updatedAt: Date.now() }
      state.projects.push(project)
      bump()
      return structuredClone(project)
    },
    beforeLogout: async () => {},
    resolveConflict: async (current) => current,
    retrySave: async () => {},
    subscribeRemoteProject: () => () => {},
    requestAiSpec: async (_prompt, current) => {
      await delay(350)
      if (ent.credits <= 0) {
        throw new ApiClientError(402, 'AI_CREDITS_EXHAUSTED', 'เครดิต AI หมด — ซื้อแบบนี้หรือสมัคร Pro', { credits: 0, plan: ent.plan })
      }
      ent.credits -= 1
      bump()
      const spec: AiBoxSpec = {
        template: current?.template ?? 'tuck-end',
        materialId: current?.materialId ?? 'carton-300',
        W: (current?.W ?? 80) + 10,
        D: current?.D ?? 50,
        H: current?.H ?? 120,
        handle: current?.handle ?? false,
        assumptions: ['fixture: ขยายกว้างอีก 10 มม.'],
        layoutNote: '-',
        reasoning: 'สเปกจำลองจาก fixture (หัก 1 เครดิต)',
        mock: true,
      }
      return spec
    },
    refreshEntitlements: async () => snapshot(state),
    authorizeExport: async (projectId) => {
      await delay(200)
      if (licensed(projectId)) return { projectId, source: 'purchase', entitlements: snapshot(state) }
      if (isPro()) {
        grant(projectId)
        bump()
        return { projectId, source: 'pro', entitlements: snapshot(state) }
      }
      throw new ApiClientError(402, 'PAYMENT_REQUIRED', 'ต้องซื้อแบบนี้ (149 บาท) หรือสมัคร Pro ก่อนดาวน์โหลด', {
        projectId,
        price: CATALOG.design,
      })
    },
    createOrder: async (kind: OrderKind, projectId?: string) => {
      await delay(200)
      if (kind === 'design') {
        if (!projectId) throw new ApiClientError(400, 'VALIDATION_ERROR', 'design ต้องระบุ projectId')
        if (licensed(projectId)) throw new ApiClientError(409, 'ALREADY_LICENSED', 'แบบนี้ซื้อแล้ว')
      }
      const item = CATALOG[kind]
      const order: Order = {
        id: crypto.randomUUID(),
        workspaceId: WORKSPACE,
        kind,
        projectId: kind === 'design' ? projectId! : null,
        amountMinor: item.amountMinor,
        currency: 'THB',
        credits: item.credits,
        status: 'pending',
        provider: 'none',
        providerRef: null,
        checkoutUrl: null,
        createdAt: new Date().toISOString(),
        paidAt: null,
      }
      state.orders.set(order.id, order)
      return order
    },
    devFulfilOrder: async (orderId) => {
      await delay(300)
      const order = state.orders.get(orderId)
      if (!order) throw new ApiClientError(404, 'ORDER_NOT_FOUND', 'ไม่พบคำสั่งซื้อ')
      if (order.status === 'paid') return order
      if (order.status === 'canceled') throw new ApiClientError(409, 'ORDER_NOT_PAYABLE', 'คำสั่งซื้อถูกยกเลิกแล้ว')
      order.status = 'paid'
      order.provider = 'dev'
      order.providerRef = 'fixture'
      order.paidAt = new Date().toISOString()
      if (order.kind === 'design' && order.projectId) grant(order.projectId)
      if (order.kind === 'pro') {
        const base = Math.max(Date.now(), ent.proUntil ? Date.parse(ent.proUntil) : 0)
        ent.plan = 'pro'
        ent.proUntil = new Date(base + 30 * DAY_MS).toISOString()
      }
      ent.credits += order.credits
      bump()
      return order
    },
  }
}

function Fixture() {
  const [scenario, setScenario] = useState<Scenario>('free')
  // หน้าแพ็กเกจแบบผู้เยี่ยมชม (ที่หน้าเข้าสู่ระบบ) — ในแอปเปิดจากชิปแพ็กเกจบน header
  const [guestPricing, setGuestPricing] = useState(false)
  const [version, setVersion] = useState(0)
  const bump = useCallback(() => setVersion((v) => v + 1), [])
  const state = useMemo(() => makeState(scenario), [scenario])
  // version อยู่ใน deps โดยเจตนา: bridge สร้างใหม่หลัง state ภายในเปลี่ยน (ชำระ/หักเครดิต) ให้ App รีเรนเดอร์
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const bridge = useMemo(() => buildBridge(state, bump), [state, bump, version])
  const initialStore = useMemo<ProjectStoreSnapshot>(() => ({
    projects: state.projects.map((project) => structuredClone(project)),
    activeId: state.projects[0].id,
    showDims: true,
  }), [state])
  const ent = bridge.entitlements!
  return (
    <>
      <App key={scenario} cloud={bridge} initialStore={initialStore} migrateLegacy={false} onLogout={() => {}} />
      {guestPricing && (
        <PricingPage
          viewer={{ kind: 'guest' }}
          catalog={null}
          onClose={() => setGuestPricing(false)}
          onChoose={() => setGuestPricing(false)}
        />
      )}
      <div className="fixture-bar" role="toolbar" aria-label="สลับสถานะแพ็กเกจ (fixture)">
        {SCENARIOS.map((item) => (
          <button key={item} type="button" aria-pressed={item === scenario} onClick={() => setScenario(item)}>
            {item}
          </button>
        ))}
        <button type="button" aria-pressed={guestPricing} onClick={() => setGuestPricing((v) => !v)}>
          pricing (guest)
        </button>
        <span className="fixture-state">
          <b>{ent.plan}</b>{ent.proUntil ? ` ถึง ${new Date(ent.proUntil).toLocaleDateString('th-TH')}` : ''} · เครดิต {ent.credits} ·
          ซื้อแล้ว {ent.licensedProjectIds.length} แบบ · orders {state.orders.size} — ลายน้ำ/ป้าย 149 ฿/paywall ต้องตามสถานะนี้
        </span>
      </div>
    </>
  )
}

const root = createRoot(document.getElementById('root')!)
root.render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
)
if (import.meta.hot) {
  import.meta.hot.dispose(() => root.unmount())
}
