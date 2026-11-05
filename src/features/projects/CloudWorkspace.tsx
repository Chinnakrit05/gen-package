import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Entitlements } from '../../../shared/contracts/billing'
import type { CloudProject, ProjectSummary } from '../../../shared/contracts/projects'
import App, { type CloudProjectBridge, type EntitlementsStatus, type ProjectStoreSnapshot } from '../../App'
import { LoadingStage } from '../../components/LoadingBoundary'
import { freshProject, type Project } from '../../core/project'
import { requestCloudArtwork, requestCloudBoxSpec } from '../../services/api/ai'
import {
  authorizeExport as authorizeRemoteExport,
  createOrder as createRemoteOrder,
  devFulfilOrder as devFulfilRemoteOrder,
  getEntitlements,
} from '../../services/api/billing'
import { ApiClientError } from '../../services/api/client'
import {
  createProject as createRemoteProject,
  deleteProject as deleteRemoteProject,
  getProject,
  getProjectThumbnails,
  listProjects,
  putProjectThumbnail,
  saveProject,
} from '../../services/api/projects'
import { IndexedDbCreateIntentStore } from '../../services/drafts/createIntentStore'
import { IndexedDbProjectMutationStore } from '../../services/drafts/projectMutationStore'
import {
  getCloudDraftClientId,
  IndexedDbProjectDraftStore,
  projectDraftKey,
  type PersistedProjectDraft,
} from '../../services/drafts/projectDraftStore'
import { ProjectAssetSidecar, dehydrateProject } from '../../services/projects/cloudProjectCodec'
import { CloudProjectController } from '../../services/projects/cloudProjectController'
import { createHttpAssetTransfer } from '../../services/projects/httpAssetTransfer'
import type { ProjectSaveState } from '../../services/projects/durableSaveQueue'
import {
  executeDurableCreate,
  executeDurableDelete,
  replayDurableProjectMutations,
  type DurableProjectMutationOptions,
} from '../../services/projects/durableProjectMutations'
import { CreateIntentFailedError, CreateIntentSession } from '../../services/projects/createIntent'
import { rasterizeTrustedPresets } from '../../services/projects/trustedPresetRasterizer'
import { ProjectSyncChannel } from '../../services/projects/projectSyncChannel'
import { LegacyMigrationFlow } from './LegacyMigrationFlow'
import { leaveEditor, type LeaveOutcome } from '../../app/leaveEditor'

export type CloudWorkspaceTarget =
  | { kind: 'project'; projectId: string }
  | { kind: 'new'; intentId: string }

interface CloudWorkspaceProps {
  apiBaseUrl: string
  // ใช้เป็นสัญญาณว่า token ของบัญชีเดิมถูกต่ออายุ — ตัวที่ส่งจริงมาจาก getAccessToken เสมอ
  accessToken: string
  getAccessToken(): string
  appUserId: string
  workspaceId: string
  readOnly?: boolean
  isPersonalWorkspace: boolean
  onProjectAccessRejected(): void
  target: CloudWorkspaceTarget
  onLogout(): void | Promise<void>
  // URL ตามงานที่เปิดอยู่ (ไม่ remount): onOpened = push, onAdopted = /editor/new → /editor/:id แบบ replace
  onOpened(projectId: string): void
  onAdopted(projectId: string): void
  onExit(path: string): void
  onBackToProjects(): void
  onWorkspaceMismatch(workspaceId: string): void
  registerLeave(leave: (() => Promise<LeaveOutcome>) | null): void
}

type WorkspaceState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'not-found' }
  | { status: 'deleted' }
  | { status: 'offline-unavailable' }
  | { status: 'ready'; initialProject: Project }

// รีเฟรชสิทธิ์อัตโนมัติตอนกลับมาที่แท็บ (focus/visibilitychange) ไม่เกินครั้งละ 30 วินาที
const ENTITLEMENTS_AUTO_REFRESH_MS = 30_000
// รายการงานในแกลเลอรีของ Editor: หน้าแรกหน้าเดียว (หน้ารายการเต็มอยู่ /app/projects) — ไม่วนโหลดทุกหน้า
const EDITOR_GALLERY_LIMIT = 100

export function CloudWorkspace(props: CloudWorkspaceProps) {
  const readOnly = props.readOnly === true
  const getTokenRef = useRef(props.getAccessToken)
  getTokenRef.current = props.getAccessToken
  const token = useCallback(() => getTokenRef.current(), [])
  const propsRef = useRef(props)
  propsRef.current = props
  const assertWritable = useCallback(() => {
    if (propsRef.current.readOnly) throw new Error('พื้นที่งานนี้ดูได้อย่างเดียว')
  }, [])
  const recheckOnNotFound = useCallback(async <T,>(request: Promise<T>): Promise<T> => {
    try {
      return await request
    } catch (error) {
      // The API uses 404 for both missing projects and revoked write access.
      if (error instanceof ApiClientError && error.status === 404) propsRef.current.onProjectAccessRejected()
      throw error
    }
  }, [])
  const [workspace, setWorkspace] = useState<WorkspaceState>({ status: 'loading' })
  const [items, setItems] = useState<ProjectSummary[]>([])
  const [saveState, setSaveState] = useState<ProjectSaveState>('loading')
  const [saveError, setSaveError] = useState<Error | null>(null)
  const [online, setOnline] = useState(() => navigator.onLine)
  // สิทธิ์แพ็กเกจ/เครดิต AI ของ workspace — null = โหลดไม่ได้ (App ปฏิบัติเหมือน Freemium แต่ยังเปิดงานได้)
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null)
  // 'loading' = กำลังโหลดครั้งแรก/โหลดใหม่หลังล้มเหลว, 'ready' = มีข้อมูลจาก server (รีเฟรชล้มเหลวคงข้อมูลเดิมไว้),
  // 'error' = ยังไม่เคยโหลดได้ (รวมเปิดแบบออฟไลน์) — App ไม่บล็อก AI ฝั่ง client เมื่อไม่ใช่ 'ready' (server ตัดสินเอง)
  const [entitlementsStatus, setEntitlementsStatusState] = useState<EntitlementsStatus>('loading')
  const entitlementsStatusRef = useRef<EntitlementsStatus>('loading')
  const setEntitlementsStatus = useCallback((next: EntitlementsStatus) => {
    entitlementsStatusRef.current = next
    setEntitlementsStatusState(next)
  }, [])
  const entitlementsRequest = useRef<Promise<Entitlements | null> | null>(null)
  const lastEntitlementsLoad = useRef(0)
  const scope = useMemo(() => ({ appUserId: props.appUserId, workspaceId: props.workspaceId }), [props.appUserId, props.workspaceId])
  const clientId = useMemo(() => getCloudDraftClientId(), [])
  const store = useMemo(() => new IndexedDbProjectDraftStore(), [])
  const mutationStore = useMemo(() => new IndexedDbProjectMutationStore(), [])
  const intentStore = useMemo(() => new IndexedDbCreateIntentStore(), [])
  const sync = useMemo(() => new ProjectSyncChannel(scope, clientId), [clientId, scope])
  const syncMounts = useRef(0)
  const remoteProjectListeners = useRef(new Set<(project: Project) => void>())
  // /editor/new ที่ยังไม่มี server ID: การแก้เข้า intent แทน save queue (R3)
  const intentRef = useRef<CreateIntentSession | null>(null)
  // id ชั่วคราวของงานใหม่ → id จริง (App อาจยังส่งงานด้วย id เดิมในช่วง debounce หลังได้ id จริง)
  const aliasRef = useRef<{ from: string; to: string } | null>(null)
  // สถานะงานล่าสุดของ App (ไม่รอ debounce) + งานที่ส่งเข้า capture ล่าสุด — ใช้ตัดสินว่ามีการแก้ที่ยังไม่เก็บ
  const flushRef = useRef<(() => Project | null) | null>(null)
  const lastCapturedRef = useRef<Project | null>(null)
  const capturing = useRef(0)
  const mountEpoch = useRef(0)

  const transfer = useMemo(() => createHttpAssetTransfer({
    apiBaseUrl: props.apiBaseUrl,
    getAccessToken: token,
  }), [props.apiBaseUrl, token])

  const controller = useMemo(() => new CloudProjectController({
    scope,
    readOnly,
    clientId,
    store,
    transfer,
    isOnline: () => navigator.onLine,
    save: (input, signal) => recheckOnNotFound(saveProject(props.apiBaseUrl, token(), input, signal)),
    onSaved: (receipt) => sync.publish({
      kind: 'saved',
      projectId: receipt.projectId,
      revision: receipt.revision,
    }),
  }), [clientId, props.apiBaseUrl, readOnly, recheckOnNotFound, scope, store, sync, token, transfer])

  const mutations = useMemo<DurableProjectMutationOptions>(() => ({
    scope,
    store: mutationStore,
    create: async (input) => {
      const project = await recheckOnNotFound(createRemoteProject(props.apiBaseUrl, token(), input))
      sync.publish({ kind: 'created', projectId: project.id, revision: project.revision })
      return project
    },
    remove: async (input) => {
      const receipt = await recheckOnNotFound(deleteRemoteProject(props.apiBaseUrl, token(), input))
      sync.publish({ kind: 'deleted', projectId: receipt.projectId, revision: receipt.revision })
      return receipt
    },
  }), [mutationStore, props.apiBaseUrl, recheckOnNotFound, scope, sync, token])

  const refreshItems = useCallback(async (signal?: AbortSignal) => {
    const page = await listProjects(props.apiBaseUrl, token(), {
      workspaceId: props.workspaceId,
      limit: EDITOR_GALLERY_LIMIT,
    }, signal)
    setItems(page.items)
    return page.items
  }, [props.apiBaseUrl, props.workspaceId, token])

  const dehydrateForCreate = useCallback(async (project: Project, signal?: AbortSignal) => {
    const sidecar = new ProjectAssetSidecar(scope)
    const prepared = await rasterizeTrustedPresets(project)
    const dehydrated = await dehydrateProject({
      project: prepared.project,
      workspaceId: props.workspaceId,
      sidecar,
      transfer,
      signal,
    })
    return { name: dehydrated.name, documentSchemaVersion: 1 as const, document: dehydrated.document }
  }, [props.workspaceId, scope, transfer])

  const createFromEditor = useCallback(async (
    project: Project,
    operationId = crypto.randomUUID(),
    signal?: AbortSignal,
  ) => {
    const payload = await dehydrateForCreate(project, signal)
    return executeDurableCreate(mutations, { workspaceId: props.workspaceId, operationId, ...payload })
  }, [dehydrateForCreate, mutations, props.workspaceId])

  const subscribeRemoteProject = useCallback((listener: (project: Project) => void) => {
    remoteProjectListeners.current.add(listener)
    return () => remoteProjectListeners.current.delete(listener)
  }, [])

  const notifyApp = useCallback((project: Project) => {
    for (const listener of remoteProjectListeners.current) listener(structuredClone(project))
  }, [])

  const openCloudAndNotify = useCallback(async (cloud: CloudProject) => {
    const project = await controller.open(cloud)
    notifyApp(project)
    return project
  }, [controller, notifyApp])

  // เก็บงานปัจจุบัน: งานใหม่ที่ยังไม่มี id จริงเข้า intent, งานที่มี id เข้า save queue — throw เมื่อเก็บไม่สำเร็จ
  const captureCurrent = useCallback(async (input: Project) => {
    assertWritable()
    const alias = aliasRef.current
    const project = alias && input.id === alias.from ? { ...input, id: alias.to } : input
    capturing.current += 1
    try {
      const intent = intentRef.current
      if (intent) await intent.capture(project)
      else await controller.capture(project)
      lastCapturedRef.current = input
    } finally {
      capturing.current -= 1
    }
  }, [assertWritable, controller])

  // ได้ id จริงของ /editor/new แล้ว: เปิดงานจริง ย้ายการแก้หลังตรึง payload เข้า save queue แล้วค่อยลบ intent
  const adoptIntent = useCallback(async (intent: CreateIntentSession, cloud: CloudProject) => {
    const latest = flushRef.current?.()
    if (latest) await intent.capture(latest).catch(() => undefined)
    const localId = intent.current.latest.project.id
    const opened = await controller.open(cloud)
    const pending = intent.pendingAfterCreate()
    let shown = opened
    if (pending) {
      await controller.capture(pending)
      shown = pending
    }
    aliasRef.current = { from: localId, to: cloud.id }
    intentRef.current = null
    const state = controller.getState()
    if (state.status === 'ready') {
      setSaveState(state.save.state)
      setSaveError(state.save.error)
    }
    notifyApp(shown)
    lastCapturedRef.current = null
    propsRef.current.onAdopted(cloud.id)
    await intent.discard().catch(() => undefined)
    void refreshItems().catch(() => undefined)
  }, [controller, notifyApp, refreshItems])

  const sendIntent = useCallback(async () => {
    const intent = intentRef.current
    if (!intent || !navigator.onLine) return
    setSaveState('saving')
    try {
      const cloud = await intent.send({
        prepare: (project) => dehydrateForCreate(project),
        // ผูก operationId ของ intent นี้เท่านั้น — งานใหม่สองงานที่เนื้อหาเหมือนกันต้องไม่รวมเป็นงานเดียว
        create: (input) => executeDurableCreate(mutations, input, { matchPendingPayload: false }),
      })
      if (intentRef.current === intent) await adoptIntent(intent, cloud)
    } catch (error) {
      if (intentRef.current !== intent) return
      if (error instanceof CreateIntentFailedError) {
        setSaveState('error')
        setSaveError(error)
      } else {
        // เครือข่าย/บริการไม่พร้อม — ลองใหม่เมื่อกลับมาออนไลน์ด้วย operationId + payload เดิม
        setSaveState(navigator.onLine ? 'error' : 'offline')
        setSaveError(error instanceof Error ? error : null)
      }
    }
  }, [adoptIntent, dehydrateForCreate, mutations])

  useEffect(() => {
    let active = true
    let work = Promise.resolve()
    const unsubscribe = sync.subscribe((event) => {
      work = work.then(async () => {
        if (!active) return
        await refreshItems().catch(() => undefined)
        const state = controller.getState()
        if (state.status !== 'ready' || state.project.id !== event.projectId) return
        if (state.save.state !== 'clean') {
          controller.markRemoteConflict(event.kind === 'deleted'
            ? 'งานนี้ถูกลบจากอีกแท็บ กรุณาสร้างสำเนาหรือเลือกงานอื่น'
            : 'งานนี้ถูกแก้ไขจากอีกแท็บ กรุณาโหลดเวอร์ชันล่าสุดหรือสร้างสำเนา')
          return
        }
        // ถูกลบจากอีกแท็บ: บอกผู้ใช้ ไม่แอบเปิดงานอื่นแทน
        if (event.kind === 'deleted') {
          if (active) setWorkspace({ status: 'deleted' })
          return
        }
        if (event.revision <= state.save.baseRevision) return
        const nextCloud = await getProject(props.apiBaseUrl, token(), event.projectId)
        if (active) await openCloudAndNotify(nextCloud)
      }).catch(() => {
        // A later sync event or ordinary project action retries from server state.
      })
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [controller, openCloudAndNotify, props.apiBaseUrl, refreshItems, sync, token])

  useEffect(() => {
    syncMounts.current += 1
    return () => {
      syncMounts.current -= 1
      queueMicrotask(() => {
        if (syncMounts.current === 0) sync.close()
      })
    }
  }, [sync])

  const loadEntitlements = useCallback(async (signal: AbortSignal) => {
    // สิทธิ์แพ็กเกจ/เครดิตก่อนตั้ง ready — โหลดไม่ได้ (ApiClientError/เครือข่าย) = null + 'error' แต่เปิดงานได้
    lastEntitlementsLoad.current = Date.now()
    const loaded = await getEntitlements(props.apiBaseUrl, token(), props.workspaceId, signal).catch(() => null)
    setEntitlements(loaded)
    setEntitlementsStatus(loaded ? 'ready' : 'error')
  }, [props.apiBaseUrl, props.workspaceId, setEntitlementsStatus, token])

  // เปิดงานตาม route: /editor/:id เปิด id นั้นเท่านั้น (ไม่พบ/ไม่มีสิทธิ์ = หน้าแจ้ง ไม่สร้าง/เปิดงานอื่นแทน)
  // /editor/new เปิด intent ของ history entry นี้
  useEffect(() => {
    const abortController = new AbortController()
    const { signal } = abortController
    let active = true
    const epoch = ++mountEpoch.current
    const target = propsRef.current.target
    const unsubscribe = controller.subscribe((state) => {
      if (!active || state.status !== 'ready' || intentRef.current) return
      setSaveState(state.save.state)
      setSaveError(state.save.error)
      setItems((current) => current.map((item) => item.id === state.project.id
        ? { ...item, name: state.project.name, revision: state.save.baseRevision }
        : item))
    })
    void (async () => {
      try {
        if (!readOnly && navigator.onLine) await replayDurableProjectMutations(mutations).catch(() => undefined)
        const listed = navigator.onLine ? refreshItems(signal).catch(() => [] as ProjectSummary[]) : Promise.resolve([] as ProjectSummary[])
        if (target.kind === 'new') {
          assertWritable()
          const count = (await listed).length
          const intent = await CreateIntentSession.open(intentStore, scope, target.intentId, () => freshProject(count + 1))
          if (!active) return
          intentRef.current = intent
          const record = intent.current
          if (record.status === 'created' && record.result) {
            // ได้ id จริงแล้วแต่ refresh ก่อน replace URL — ทำขั้นที่เหลือ ไม่ยิง POST ใหม่
            await adoptIntent(intent, record.result)
            await loadEntitlements(signal)
            const adopted = controller.getState()
            if (active) setWorkspace({ status: 'ready', initialProject: adopted.status === 'ready' ? adopted.project : record.latest.project })
            return
          }
          await loadEntitlements(signal)
          if (!active) return
          setSaveState(record.status === 'failed' ? 'error' : navigator.onLine ? 'saving' : 'offline')
          setWorkspace({ status: 'ready', initialProject: record.latest.project })
          lastCapturedRef.current = null
          void sendIntent()
          return
        }
        let cloud: CloudProject
        try {
          cloud = await getProject(props.apiBaseUrl, token(), target.projectId, signal)
        } catch (error) {
          if (signal.aborted || !active) return
          if (error instanceof ApiClientError && error.status === 404) {
            setWorkspace({ status: 'not-found' })
            return
          }
          if (!navigator.onLine || (error instanceof ApiClientError && error.code === 'NETWORK_ERROR')) {
            // ออฟไลน์: เปิดได้เฉพาะ draft ของ id นี้ในเครื่องนี้ ของบัญชี/workspace นี้
            if (readOnly) {
              setWorkspace({ status: 'offline-unavailable' })
              return
            }
            const draft = await store.get(projectDraftKey(scope, target.projectId, clientId))
            if (!active) return
            if (!draft) {
              setWorkspace({ status: 'offline-unavailable' })
              return
            }
            const project = await controller.open(cloudShellFromDraft(draft))
            if (!active) return
            // เปิดแบบออฟไลน์: ยังไม่มีสิทธิ์จาก server — โหลดเมื่อกลับมาออนไลน์ (event online)
            setEntitlementsStatus('error')
            setWorkspace({ status: 'ready', initialProject: project })
            propsRef.current.onOpened(project.id)
            return
          }
          throw error
        }
        // URL ของงานอ้าง id อย่างเดียว — workspace มาจากข้อมูลที่ server อนุญาต ไม่ย้ายงานตาม workspace ที่เลือกไว้
        if (cloud.workspaceId !== props.workspaceId) {
          propsRef.current.onWorkspaceMismatch(cloud.workspaceId)
          if (active) setWorkspace({ status: 'not-found' })
          return
        }
        const project = await controller.open(cloud)
        await loadEntitlements(signal)
        if (active) {
          setWorkspace({ status: 'ready', initialProject: project })
          propsRef.current.onOpened(project.id)
        }
      } catch (error) {
        if (active && !signal.aborted) {
          setWorkspace({ status: 'error', message: error instanceof Error ? error.message : 'เปิดพื้นที่งานไม่สำเร็จ' })
        }
      }
    })()
    return () => {
      active = false
      abortController.abort()
      unsubscribe()
      // ออกโดยไม่ผ่าน guard (session หลุด/บัญชีเปลี่ยน): เก็บการแก้ที่ยังรอ debounce ก่อนปิดคิว
      const latest = flushRef.current?.()
      if (latest && latest !== lastCapturedRef.current) {
        // ปิดคิวหลังเก็บเสร็จ — เว้นแต่มีการเปิดรอบใหม่แล้ว (StrictMode/remount) ซึ่ง open() จัดการคิวเดิมเอง
        void captureCurrent(latest).catch(() => undefined).finally(() => {
          if (mountEpoch.current === epoch) controller.dispose()
        })
      } else {
        controller.dispose()
      }
      intentRef.current = null
    }
  }, [adoptIntent, assertWritable, captureCurrent, clientId, controller, intentStore, loadEntitlements, mutations, props.apiBaseUrl, props.workspaceId, readOnly, refreshItems, scope, sendIntent, setEntitlementsStatus, store, token])

  useEffect(() => {
    const update = () => {
      const next = navigator.onLine
      setOnline(next)
      controller.setOnline(next)
      if (next) {
        void (async () => {
          if (!readOnly) await replayDurableProjectMutations(mutations)
          await refreshItems()
          if (intentRef.current) await sendIntent()
        })().catch(() => {
          // Journal remains durable and is replayed on the next reconnect/reload.
        })
      } else if (intentRef.current) {
        setSaveState('offline')
      }
    }
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [controller, mutations, readOnly, refreshItems, sendIntent])

  useEffect(() => {
    controller.setOnline(navigator.onLine)
  }, [controller, props.accessToken])

  // ทุกทางออกของ Editor ใช้ลำดับเดียว (R4) — route เรียกผ่าน registerLeave
  useEffect(() => {
    if (readOnly) return
    const leave = async (): Promise<LeaveOutcome> => {
      // ยังไม่ได้เปิดงาน (กำลังโหลด/ไม่พบ/ออฟไลน์เปิดไม่ได้) — ไม่มีอะไรต้องเก็บ
      if (!flushRef.current && !intentRef.current && controller.getState().status !== 'ready') return { kind: 'synced' }
      return leaveEditor<Project>({
      latest: () => flushRef.current?.() ?? null,
      capture: captureCurrent,
      status: () => {
        if (intentRef.current) return null
        const state = controller.getState()
        return state.status === 'ready' ? state.save : null
      },
      flush: () => controller.flush(),
      })
    }
    propsRef.current.registerLeave(leave)
    return () => propsRef.current.registerLeave(null)
  }, [captureCurrent, controller, readOnly])

  // refresh/ปิดแท็บ (R5): เตือนเฉพาะตอนมีการแก้ที่ยังไม่เก็บลงเครื่อง/กำลังเขียน และเริ่มเก็บทันที;
  // ซ่อนแท็บ/pagehide เริ่มเก็บแบบ best-effort — ร่างที่ capture แล้วอยู่ใน IndexedDB ไม่ต้องเตือน
  useEffect(() => {
    if (readOnly) return
    const uncaptured = () => {
      const latest = flushRef.current?.()
      return latest && latest !== lastCapturedRef.current ? latest : null
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const latest = uncaptured()
      if (latest) void captureCurrent(latest).catch(() => undefined)
      if (latest || capturing.current > 0) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    const onHide = () => {
      const latest = uncaptured()
      if (latest) void captureCurrent(latest).catch(() => undefined)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onHide()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [captureCurrent, readOnly])

  // โหลดสิทธิ์ใหม่ (เปิดหน้าแพ็กเกจ/paywall, หลังชำระ, กลับมาออนไลน์/กลับมาที่แท็บ, ปุ่มลองใหม่บนชิป) — คืน null เมื่อล้มเหลว
  // คำขอที่ซ้อนกันใช้ promise เดียว (หลายจุดเรียกพร้อมกันได้โดยไม่ยิงซ้ำ); ล้มเหลวขณะมีข้อมูลเดิม (ready) คงข้อมูลเดิมไว้
  // fresh = ต้องได้ผลหลังการเปลี่ยนแปลงที่เพิ่งทำ (เช่นหลังชำระ) — คำขอที่ค้างอยู่อาจเริ่มก่อนนั้น จึงรอแล้วยิงใหม่
  const refreshEntitlements = useCallback((fresh = false): Promise<Entitlements | null> => {
    const pending = entitlementsRequest.current
    if (pending) return fresh ? pending.then(() => refreshEntitlements()) : pending
    lastEntitlementsLoad.current = Date.now()
    if (entitlementsStatusRef.current !== 'ready') setEntitlementsStatus('loading')
    const request = getEntitlements(props.apiBaseUrl, token(), props.workspaceId).then(
      (next) => {
        setEntitlements(next)
        setEntitlementsStatus('ready')
        return next
      },
      () => {
        if (entitlementsStatusRef.current !== 'ready') setEntitlementsStatus('error')
        return null
      },
    ).finally(() => {
      entitlementsRequest.current = null
    })
    entitlementsRequest.current = request
    return request
  }, [props.apiBaseUrl, props.workspaceId, setEntitlementsStatus, token])

  // รีเฟรชสิทธิ์อัตโนมัติหลังเปิดพื้นที่งานแล้ว: กลับมาออนไลน์ (ทุกครั้ง — รวมเปิดแบบออฟไลน์ที่ยังไม่เคยโหลด),
  // กลับมาที่แท็บ/หน้าต่าง (throttle 30 วิ — focus กับ visibilitychange มักมาคู่กัน)
  const workspaceReady = workspace.status === 'ready'
  useEffect(() => {
    if (!workspaceReady) return
    const refreshIfStale = () => {
      if (!navigator.onLine) return
      if (Date.now() - lastEntitlementsLoad.current < ENTITLEMENTS_AUTO_REFRESH_MS) return
      void refreshEntitlements()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refreshIfStale()
    }
    const onOnline = () => {
      void refreshEntitlements()
    }
    // ออนไลน์อยู่แล้วตอนพื้นที่งานพร้อมแต่ยังไม่มีสิทธิ์ (เช่น event online มาก่อนเปิดจาก draft เสร็จ) — ลองทันที
    if (entitlementsStatusRef.current === 'error') refreshIfStale()
    window.addEventListener('online', onOnline)
    window.addEventListener('focus', refreshIfStale)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('focus', refreshIfStale)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refreshEntitlements, workspaceReady])

  // ออกจาก Editor ตามคำสั่งในแอป (สลับงาน/ลบงานที่เปิดอยู่) — App รอ promise นี้ไม่จบเพราะถูก unmount
  const leaveTo = useCallback((path: string): Promise<never> => {
    propsRef.current.onExit(path)
    return new Promise<never>(() => undefined)
  }, [])

  const followOpened = useCallback((project: Project) => {
    intentRef.current = null
    // App เก็บ object ที่คืนนี้เป็นงานปัจจุบัน — ถือว่าเก็บแล้ว (controller.open บันทึกร่างแรกไว้)
    lastCapturedRef.current = project
    propsRef.current.onOpened(project.id)
    return project
  }, [])

  const bridge = useMemo<CloudProjectBridge>(() => ({
    items,
    appUserId: props.appUserId,
    workspaceId: props.workspaceId,
    readOnly,
    putThumbnail: async (projectId, input) => {
      assertWritable()
      if (intentRef.current) throw new Error('งานใหม่ยังไม่มี id บน Cloud — ถ่ายภาพย่อหลังสร้างงานแล้ว')
      const receipt = await putProjectThumbnail(props.apiBaseUrl, token(), projectId, input)
      setItems((current) => current.map((item) => item.id === projectId
        ? { ...item, thumbnail: { version: receipt.version, kind: input.kind, label: input.label } }
        : item))
      return receipt
    },
    fetchThumbnails: async (projectIds) => (await getProjectThumbnails(props.apiBaseUrl, token(), {
      workspaceId: props.workspaceId,
      projectIds,
    })).items,
    online,
    saveState,
    saveError,
    entitlements,
    entitlementsStatus,
    refreshEntitlements: () => refreshEntitlements(),
    authorizeExport: async (projectId, format) => {
      const authorization = await authorizeRemoteExport(props.apiBaseUrl, token(), projectId, format)
      setEntitlements(authorization.entitlements)
      setEntitlementsStatus('ready')
      return authorization
    },
    createOrder: async (kind, projectId) => {
      assertWritable()
      return createRemoteOrder(props.apiBaseUrl, token(), {
        workspaceId: props.workspaceId,
        operationId: crypto.randomUUID(),
        kind,
        projectId,
      })
    },
    devFulfilOrder: async (orderId) => {
      assertWritable()
      const order = await devFulfilRemoteOrder(props.apiBaseUrl, token(), orderId)
      await refreshEntitlements(true)
      return order
    },
    onProjectChange: async (project) => {
      assertWritable()
      if (!intentRef.current) {
        setItems((current) => current.map((item) => item.id === project.id
          ? { ...item, name: project.name, updatedAt: new Date(project.updatedAt).toISOString() }
          : item))
      }
      try {
        await captureCurrent(project)
      } catch (error) {
        if (intentRef.current) {
          setSaveState('error')
          setSaveError(error instanceof Error ? error : null)
        }
        throw error
      }
    },
    registerFlush: (flush) => {
      flushRef.current = flush
      return () => {
        if (flushRef.current === flush) flushRef.current = null
      }
    },
    // สลับงาน = นำทางไป /editor/:id (เปิดตาม URL เท่านั้น) หลังเก็บงานนี้ลงเครื่องแล้ว
    switchProject: async (current, targetId) => {
      if (!readOnly) {
        await captureCurrent(current)
        lastCapturedRef.current = flushRef.current?.() ?? current
      }
      return leaveTo(`/editor/${targetId}`)
    },
    createProject: async (current, name, seed) => {
      await captureCurrent(current)
      const fresh = seed ? { ...seed } : freshProject(items.length + 1)
      fresh.name = name.slice(0, 60) || fresh.name
      const cloud = await createFromEditor(fresh)
      const opened = await controller.open(cloud)
      await refreshItems()
      return followOpened(opened)
    },
    deleteProject: async (current, targetId) => {
      assertWritable()
      const target = items.find((item) => item.id === targetId)
      if (!target) throw new Error('ไม่พบงานที่จะลบ')
      if (targetId === current.id) {
        await controller.capture(current)
        await controller.flush()
        const state = controller.getState()
        if (state.status !== 'ready' || !['clean', 'offline'].includes(state.save.state)) {
          throw new Error('ยังลบงานไม่ได้จนกว่าจะจัดการ draft/conflict ที่ค้างอยู่')
        }
        if (state.save.state === 'offline') throw new Error('ต้องออนไลน์ก่อนลบงาน')
        await executeDurableDelete(mutations, {
          projectId: targetId,
          operationId: crypto.randomUUID(),
          expectedRevision: state.save.baseRevision,
        })
        await controller.discardDraft()
        lastCapturedRef.current = flushRef.current?.() ?? current
        // ลบงานที่เปิดอยู่แล้วกลับหน้ารายการ — ไม่เปิดงานอื่น/สร้างงานใหม่แทน
        return leaveTo('/app/projects')
      }
      await executeDurableDelete(mutations, {
        projectId: targetId,
        operationId: crypto.randomUUID(),
        expectedRevision: target.revision,
      })
      await refreshItems()
      return current
    },
    importProject: async (current, imported) => {
      await captureCurrent(current)
      const cloud = await createFromEditor(imported)
      const opened = await controller.open(cloud)
      await refreshItems()
      return followOpened(opened)
    },
    beforeLogout: async () => {
      if (readOnly) return
      const outcome = await leaveEditor<Project>({
        latest: () => flushRef.current?.() ?? null,
        capture: captureCurrent,
        status: () => {
          if (intentRef.current) return null
          const state = controller.getState()
          return state.status === 'ready' ? state.save : null
        },
        flush: () => controller.flush(),
      })
      if (outcome.kind === 'capture-failed') {
        throw new Error(`เก็บงานในเครื่องไม่สำเร็จ (${outcome.error.message}) — ส่งออกไฟล์ .genpkg.json สำรองไว้ก่อนออกจากระบบ`)
      }
      lastCapturedRef.current = flushRef.current?.() ?? null
    },
    resolveConflict: async (current, action) => {
      assertWritable()
      if (action === 'copy') {
        const copy = { ...current, id: crypto.randomUUID(), name: `${current.name} (สำเนา)`, updatedAt: Date.now() }
        const cloud = await createFromEditor(copy)
        const opened = await controller.open(cloud)
        await refreshItems()
        return followOpened(opened)
      }
      await controller.discardDraft()
      const cloud = await getProject(props.apiBaseUrl, token(), current.id)
      const opened = await controller.open(cloud)
      await refreshItems()
      return followOpened(opened)
    },
    retrySave: () => (intentRef.current ? sendIntent() : controller.retry()),
    subscribeRemoteProject,
    // AI บน cloud: คีย์ของระบบฝั่ง server, หัก 1 เครดิต/คำขอ (operationId ใหม่ทุกครั้ง) — อัปเดตเครดิตจาก response
    requestAiSpec: async (prompt, current, imageBase64) => {
      assertWritable()
      try {
        const { credits, ...spec } = await requestCloudBoxSpec(props.apiBaseUrl, token(), {
          workspaceId: props.workspaceId,
          operationId: crypto.randomUUID(),
          prompt,
          current,
          imageBase64,
        })
        setEntitlements((current) => (current ? { ...current, credits } : current))
        return spec
      } catch (error) {
        // เครดิตหมด: server แนบเครดิตคงเหลือมาใน details → ให้ UI ตรงกับ server ทันที
        if (error instanceof ApiClientError && typeof error.details?.credits === 'number') {
          const credits = error.details.credits
          setEntitlements((current) => (current ? { ...current, credits } : current))
        }
        throw error
      }
    },
    // AI ออกแบบหน้าตาบน cloud: สิทธิ์/เครดิตชุดเดียวกับ box-spec (1 เครดิต/แบบ) — คีย์ผู้ใช้ (อาร์กิวเมนต์ที่ 2) ไม่ใช้บน cloud
    requestAiArtwork: async (input, _anthropicApiKey, signal) => {
      assertWritable()
      try {
        const { credits, ...result } = await requestCloudArtwork(
          props.apiBaseUrl,
          token(),
          { ...input, workspaceId: props.workspaceId, operationId: crypto.randomUUID() },
          signal,
        )
        setEntitlements((current) => (current ? { ...current, credits } : current))
        return result
      } catch (error) {
        if (error instanceof ApiClientError && typeof error.details?.credits === 'number') {
          const credits = error.details.credits
          setEntitlements((current) => (current ? { ...current, credits } : current))
        }
        throw error
      }
    },
  }), [assertWritable, captureCurrent, controller, createFromEditor, entitlements, entitlementsStatus, followOpened, items, leaveTo, mutations, online, props.apiBaseUrl, props.appUserId, props.workspaceId, readOnly, refreshEntitlements, refreshItems, saveError, saveState, sendIntent, setEntitlementsStatus, subscribeRemoteProject, token])

  if (workspace.status === 'loading') {
    return <LoadingStage title="กำลังเปิดงาน" message="กำลังโหลดโปรเจกต์และฉบับร่างล่าสุด…" />
  }
  if (workspace.status === 'not-found') {
    return (
      <WorkspaceStatus
        title="ไม่พบงานนี้ หรือคุณไม่มีสิทธิ์เปิด"
        message="งานอาจถูกลบ ลิงก์ไม่ถูกต้อง หรืออยู่ในพื้นที่งานที่บัญชีนี้ไม่ได้เป็นสมาชิก"
        onBack={() => props.onExit('/app/projects')}
      />
    )
  }
  if (workspace.status === 'deleted') {
    return (
      <WorkspaceStatus
        title="งานนี้ถูกลบแล้ว"
        message="งานถูกลบจากอีกแท็บหรืออุปกรณ์อื่น"
        onBack={() => props.onExit('/app/projects')}
      />
    )
  }
  if (workspace.status === 'offline-unavailable') {
    return (
      <WorkspaceStatus
        title="ออฟไลน์ — ยังเปิดงานนี้ไม่ได้"
        message={readOnly ? 'เชื่อมต่ออินเทอร์เน็ตเพื่อเปิดงานนี้' : 'เครื่องนี้ยังไม่มีร่างของงานนี้ เชื่อมต่ออินเทอร์เน็ตแล้วลองอีกครั้ง'}
        onBack={() => props.onExit('/app/projects')}
      />
    )
  }
  if (workspace.status === 'error') {
    return <WorkspaceStatus title="เปิดงานไม่ได้" message={workspace.message} onBack={() => props.onExit('/app/projects')} />
  }

  const initialStore: ProjectStoreSnapshot = {
    projects: [workspace.initialProject],
    activeId: workspace.initialProject.id,
    showDims: true,
  }
  return (
    <>
      <App
        onLogout={props.onLogout}
        migrateLegacy={false}
        initialStore={initialStore}
        cloud={bridge}
        onBackToProjects={props.onBackToProjects}
      />
      {!readOnly && props.isPersonalWorkspace && (
        <LegacyMigrationFlow
          scope={scope}
          apiBaseUrl={props.apiBaseUrl}
          getAccessToken={token}
          onMigrated={refreshItems}
        />
      )}
    </>
  )
}

function WorkspaceStatus({ title, message, onBack }: { title: string; message: string; onBack?: () => void }) {
  return (
    <div className="login-screen">
      <div className="login-card">
        <h1 className="login-title">{title}</h1>
        <p className="login-sub">{message}</p>
        {onBack && <button className="google-btn" onClick={onBack}>กลับไปที่งานของฉัน</button>}
      </div>
    </div>
  )
}

function cloudShellFromDraft(record: PersistedProjectDraft): CloudProject {
  const project = record.latestDraft.project
  return {
    id: record.projectId,
    workspaceId: record.scope.workspaceId,
    name: project.name,
    documentSchemaVersion: 1,
    document: {
      live: project.live,
      qty: project.qty,
      fillColor: project.fillColor,
      decos: [],
      history: [],
      histIdx: -1,
    },
    revision: record.baseRevision,
    createdAt: new Date(record.updatedAt).toISOString(),
    updatedAt: new Date(record.updatedAt).toISOString(),
    assets: [],
  }
}
