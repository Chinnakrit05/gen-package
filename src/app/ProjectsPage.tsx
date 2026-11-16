// /app/projects — รายการงานแบบแบ่งหน้า (1-A3) ห้าม import Editor/core engine/three/exporter
// ใช้ summary + ภาพย่อตาม contract b-phase0-r1: หน้าละ 24, cursor opaque, batch ภาพย่อ ≤ 24 จับคู่ด้วย projectId
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router'
import { ArrowUpRight, Box, ChevronRight, Factory, FilePlus2, Files, History, Plus, RefreshCw, Truck, UploadCloud } from 'lucide-react'
import { StudioShell } from './StudioShell'
import type { StudioNavItem } from './studioNavigation'
import { ProjectOptions } from './ProjectOptions'
import { ProjectDeleteDialog } from './ProjectDeleteDialog'
import type { ProjectPage, ProjectSummary, ThumbnailKind } from '../../shared/contracts/projects'
import { marketplaceSuppliersEnabled } from '../config'
import { designLicenseKnowledge } from '../core/designLicense'
import { thumbNeedsFetch } from '../core/thumbnail'
import { hasLegacyMigrationSource } from '../features/projects/legacyStorage'
import { getEntitlements } from '../services/api/billing'
import { ApiClientError } from '../services/api/client'
import { deleteProject, getProjectThumbnails, listProjects } from '../services/api/projects'
import { IndexedDbCreateIntentStore, type CreateIntentRecord } from '../services/drafts/createIntentStore'
import { getCloudDraftClientId, IndexedDbProjectDraftStore } from '../services/drafts/projectDraftStore'
import { IndexedDbProjectMutationStore } from '../services/drafts/projectMutationStore'
import { executeDurableDelete } from '../services/projects/durableProjectMutations'
import { ProjectSyncChannel } from '../services/projects/projectSyncChannel'
import { IndexedDbThumbStore, ThumbnailCache, base64ToBlob, cloudThumbnailScope } from '../services/thumbnails/thumbnailCache'
import { useCloudSession } from './cloudSession'
import { takeFlash } from './flash'
import { PROJECT_PAGE_SIZE, mergeProjectPages } from './projectList'
import './projects.css'

const THUMB_BATCH = 24
const LegacyMigrationFlow = lazy(() => import('../features/projects/LegacyMigrationFlow')
  .then((module) => ({ default: module.LegacyMigrationFlow })))
const projectsKey = (appUserId: string, workspaceId: string) => ['cloud', appUserId, workspaceId, 'projects', { limit: PROJECT_PAGE_SIZE }] as const
type DeleteTarget = { item: ProjectSummary; actorId: string }

export function ProjectsPage() {
  const session = useCloudSession()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { appUserId, workspaceId } = session
  const [notice] = useState(() => takeFlash())
  const [online, setOnline] = useState(() => navigator.onLine)
  const [migrationOpen, setMigrationOpen] = useState(false)
  const [hasLegacySource] = useState(hasLegacyMigrationSource)
  const migrationScope = useMemo(() => ({ appUserId, workspaceId }), [appUserId, workspaceId])
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  const queryKey = useMemo(() => projectsKey(appUserId, workspaceId), [appUserId, workspaceId])
  // gcTime 0: กลับมาหน้านี้ (เช่นออกจาก Editor) เริ่มหน้าแรกใหม่ ไม่ refetch ทุกหน้าที่เคยโหลด (R1)
  const projects = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam, signal }) => listProjects(session.apiBaseUrl, session.getAccessToken(), {
      workspaceId,
      cursor: pageParam ?? undefined,
      limit: PROJECT_PAGE_SIZE,
    }, signal),
    initialPageParam: null as string | null,
    // หน้าเปล่าถือว่าจบ แม้ server ยังคืน nextCursor
    getNextPageParam: (last) => (last.items.length > 0 ? last.nextCursor : null),
    gcTime: 0,
    enabled: session.meStatus !== 'loading',
  })
  const items = useMemo(() => mergeProjectPages(projects.data?.pages ?? []), [projects.data])
  const refresh = useCallback(() => {
    void queryClient.resetQueries({ queryKey })
  }, [queryClient, queryKey])

  const canCreate = session.role === 'owner' || session.role === 'editor'
  const showQuoteRequests = marketplaceSuppliersEnabled && session.meStatus === 'ready' && session.role === 'owner'
  const canMigrate = hasLegacySource && workspaceId === session.personalWorkspaceId && canCreate
  const thumbs = useThumbnails(appUserId, workspaceId, items, session)
  const pending = useLocalPending(appUserId, workspaceId, canCreate)
  const offlineDrafts = online ? [] : pending.localDrafts.filter((draft) => !items.some((item) => item.id === draft.id))
  const mutationStore = useMemo(() => new IndexedDbProjectMutationStore(), [])
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const confirmation = canCreate && deleteTarget?.actorId === appUserId && deleteTarget.item.workspaceId === workspaceId ? deleteTarget : null
  const deleteEntitlements = useQuery({
    queryKey: ['cloud', appUserId, workspaceId, 'project-delete-entitlements'],
    queryFn: ({ signal }) => getEntitlements(session.apiBaseUrl, session.getAccessToken(), workspaceId, signal),
    enabled: confirmation !== null && online,
    retry: false,
  })
  const deleteContext = useRef({ appUserId, workspaceId, canCreate, pending, mounted: false })
  Object.assign(deleteContext.current, { appUserId, workspaceId, canCreate, pending })
  useEffect(() => {
    const context = deleteContext.current
    context.mounted = true
    return () => { context.mounted = false }
  }, [])

  const deletion = useMutation({
    mutationFn: async ({ item, actorId }: DeleteTarget) => {
      const current = deleteContext.current
      if (!current.mounted || current.appUserId !== actorId || current.workspaceId !== item.workspaceId
        || !current.canCreate || current.pending.projectIds.has(item.id) || !navigator.onLine) return false
      const { apiBaseUrl, getAccessToken } = session

      const scope = { appUserId: actorId, workspaceId: item.workspaceId }
      const receipt = await executeDurableDelete({
        scope,
        store: mutationStore,
        remove: (input) => deleteProject(apiBaseUrl, getAccessToken(), input),
      }, { projectId: item.id, operationId: crypto.randomUUID(), expectedRevision: item.revision })

      const sync = new ProjectSyncChannel(scope, crypto.randomUUID())
      sync.publish({ kind: 'deleted', projectId: receipt.projectId, revision: receipt.revision })
      sync.close()
      return true
    },
    onSuccess: async (deleted, { item, actorId }) => {
      if (!deleted) return
      const key = projectsKey(actorId, item.workspaceId)
      await queryClient.cancelQueries({ queryKey: key })
      queryClient.setQueryData<InfiniteData<ProjectPage>>(key, (data) => data && ({
        ...data,
        pages: data.pages.map((page) => ({ ...page, items: page.items.filter(({ id }) => id !== item.id) })),
      }))
      void queryClient.invalidateQueries({ queryKey: key })
    },
    onError: async (error, { item, actorId }) => {
      if (error instanceof ApiClientError && (error.code === 'REVISION_CONFLICT' || error.status === 404)) {
        await queryClient.invalidateQueries({ queryKey: projectsKey(actorId, item.workspaceId) })
      }
    },
  })
  const deletionItem = deletion.variables?.actorId === appUserId && deletion.variables.item.workspaceId === workspaceId
    ? deletion.variables.item : undefined

  const changeWorkspace = (next: string) => {
    if (next === workspaceId) return
    setMigrationOpen(false)
    setDeleteTarget(null)
    // คำขอของ workspace เดิมที่ค้างอยู่ถูกยกเลิก; ผลที่มาช้าลง key เดิม ไม่ปนกับรายการใหม่
    void queryClient.cancelQueries({ queryKey: ['cloud', appUserId, workspaceId] })
    session.setWorkspaceId(next)
  }

  const latestProject = items[0]
  const quickLinks = [
    ...(showQuoteRequests ? [{ to: '/app/requests', label: 'คำขอราคา', icon: 'requests' as const, Icon: Files }] : []),
    ...(marketplaceSuppliersEnabled ? [
      { to: '/app/orders', label: 'คำสั่งผลิต', icon: 'orders' as const, Icon: Truck },
      { to: '/factory/onboarding', label: 'ผู้รับผลิต', icon: 'factory' as const, Icon: Factory },
    ] : []),
  ]
  const compactNavigation: StudioNavItem[] = [
    { to: '/app/projects', label: 'งานออกแบบของฉัน', icon: 'projects', exact: true },
    ...quickLinks,
  ]
  const create = () => navigate('/editor/new')

  function renderProject(item: ProjectSummary, featured = false) {
    const awaitingSave = pending.projectIds.has(item.id)
    const deleting = deletion.isPending && deletionItem?.id === item.id
    const deleteDisabledReason = !online ? 'เชื่อมต่ออินเทอร์เน็ตเพื่อลบงาน'
      : awaitingSave ? 'เปิดงานและบันทึกการแก้ไขที่ค้างไว้ก่อนลบ'
      : deletion.isPending ? 'กำลังจัดการงานอื่นอยู่' : undefined
    const metadata = [item.thumbnail?.label, formatUpdated(item.updatedAt)].filter(Boolean).join(' · ')
    const imageUrl = thumbs.url(item.id)
    const open = () => navigate(`/editor/${item.id}`)
    const options = canCreate && <ProjectOptions name={item.name} disabled={Boolean(deleteDisabledReason)} disabledReason={deleteDisabledReason}
      onDelete={() => setDeleteTarget({ item, actorId: appUserId })} />
    const quoteLabel = `สร้างฉบับร่างขอราคางาน ${item.name}`
    const quote = showQuoteRequests && (
      <button className="projects-icon-action project-quote-action" type="button"
        aria-label={quoteLabel}
        title={awaitingSave ? 'รอให้งานบันทึกขึ้น Cloud ก่อน' : quoteLabel}
        disabled={!online || awaitingSave || deleting}
        onClick={() => void navigate(`/app/requests/new?projectId=${encodeURIComponent(item.id)}`)}>
        <FilePlus2 size={17} aria-hidden="true" />
      </button>
    )
    const preview = imageUrl ? <img src={imageUrl} alt="" decoding="async" loading={featured ? 'eager' : 'lazy'} />
      : <KindIcon kind={item.thumbnail?.kind} />

    if (featured) return (
      <section key={item.id} className="projects-hero" role="group" aria-label={item.name}>
        <div className="projects-hero-copy">
          <span className="projects-hero-label"><History size={15} aria-hidden="true" /> แก้ไขล่าสุด</span>
          <h2>{item.name}</h2>
          {metadata && <p className="project-sub">{metadata}</p>}
          {awaitingSave && <span className="project-badge">รอส่ง</span>}
          <div className="projects-hero-actions">
            <button type="button" className="projects-icon-action projects-accent-action" aria-label={`เปิดงาน ${item.name}`}
              title="เปิดงาน" onClick={open} disabled={deleting}>
              <ArrowUpRight size={18} aria-hidden="true" />
            </button>
            {quote}
            {options}
          </div>
        </div>
        <button type="button" className="projects-hero-art" aria-label={`เปิดงาน ${item.name} จากภาพย่อ`} onClick={open} disabled={deleting}>
          {preview}
        </button>
      </section>
    )

    return (
      <div key={item.id} className="project-card-with-action" role="group" aria-label={item.name}>
        <button type="button" className="project-card" aria-label={`เปิดงาน ${item.name}`}
          title={[item.name, metadata].filter(Boolean).join(' · ')} disabled={deleting} onClick={open}>
          <span className="project-thumb">{preview}</span>
          <span className="project-meta">
            <KindIcon kind={item.thumbnail?.kind} />
            <span className="project-name">{item.name}</span>
          </span>
          {awaitingSave && <span className="project-badge">รอส่ง</span>}
        </button>
        {options}
        {quote}
      </div>
    )
  }

  return (
    <StudioShell title="งานออกแบบของฉัน" className="projects-page"
      compactNavigation={compactNavigation} onWorkspaceChange={changeWorkspace}
      actions={<>
        {canMigrate && (
          <button type="button" className="projects-icon-action" aria-label="ย้ายงานเดิมขึ้น Cloud"
            title="ย้ายงานเดิมขึ้น Cloud" disabled={!online} onClick={() => setMigrationOpen(true)}>
            <UploadCloud size={18} aria-hidden="true" />
          </button>
        )}
        <button type="button" className="projects-icon-action projects-refresh" aria-label="รีเฟรช" title="รีเฟรช"
          onClick={refresh} disabled={!online || projects.isFetching}>
          <RefreshCw size={17} aria-hidden="true" />
        </button>
        {canCreate && (
          <button type="button" className="projects-icon-action projects-accent-action" aria-label="สร้างงานใหม่"
            title="สร้างงานใหม่" onClick={create}>
            <Plus size={20} aria-hidden="true" />
          </button>
        )}
      </>}
    >
      {!online && <div className="projects-banner is-offline">ออฟไลน์ · แสดงงานที่โหลดไว้และงานที่รอส่งในเครื่องนี้</div>}
      {notice && <div className="projects-banner" role="status">{notice}</div>}
      {session.role === 'viewer' && <div className="projects-banner">พื้นที่งานนี้คุณดูได้อย่างเดียว</div>}
      {deletionItem && deletion.isPending && <div className="projects-banner" role="status">กำลังจัดการงาน «{deletionItem.name}»…</div>}
      {deletionItem && deletion.isSuccess && deletion.data && <div className="projects-banner" role="status">ลบงาน «{deletionItem.name}» แล้ว</div>}
      {deletionItem && deletion.isError && <div className="projects-banner is-error" role="alert">
        ลบงาน «{deletionItem.name}» ไม่สำเร็จ {deletion.error instanceof ApiClientError ? deletion.error.message : 'กรุณาลองอีกครั้ง'}
      </div>}

      <div className={quickLinks.length > 0 ? 'projects-overview has-quick-links' : 'projects-overview'}>
        {!online && !projects.data ? (
          <div className="projects-empty" role="status">เชื่อมต่ออินเทอร์เน็ตเพื่อโหลดรายการงาน</div>
        ) : projects.isPending ? (
          <div className="projects-hero is-skeleton" role="status" aria-busy="true"><span className="sr-only">กำลังโหลดรายการงาน</span></div>
        ) : latestProject ? renderProject(latestProject, true) : projects.isError ? (
          <div className="projects-empty" role="alert">
            <p>โหลดรายการงานไม่สำเร็จ</p>
            <button type="button" onClick={refresh} disabled={!online}>ลองใหม่</button>
          </div>
        ) : (
          <div className="projects-empty">
            <span className="projects-empty-icon"><Box size={28} aria-hidden="true" /></span>
            <h2>ยังไม่มีงานในพื้นที่นี้</h2>
            {canCreate && <button type="button" className="projects-accent-action" onClick={create}>สร้างงานแรก</button>}
          </div>
        )}
        {quickLinks.length > 0 && (
          <nav className="projects-quick-links" aria-label="การผลิต">
            {quickLinks.map(({ to, label, Icon }) => (
              <Link key={to} to={to}>
                <span className="projects-quick-icon"><Icon size={17} aria-hidden="true" /></span>
                <strong>{label}</strong>
                <ChevronRight size={15} aria-hidden="true" />
              </Link>
            ))}
          </nav>
        )}
      </div>

      {items.length > 1 && (
        <section className="projects-section" aria-label="งานออกแบบอื่น">
          <div className="projects-grid">{items.slice(1).map((item) => renderProject(item))}</div>
        </section>
      )}
      {items.length > 0 && projects.isError && <div className="projects-banner is-error" role="alert">โหลดรายการเพิ่มเติมไม่สำเร็จ</div>}
      {projects.hasNextPage && (
        <div className="projects-more">
          <button type="button" onClick={() => void projects.fetchNextPage()} disabled={projects.isFetchingNextPage || !online}>
            {projects.isFetchingNextPage ? 'กำลังโหลด…' : 'โหลดเพิ่ม'}
          </button>
        </div>
      )}

      {pending.intents.length > 0 && (
        <section className="projects-section projects-local">
          <h2>งานใหม่ที่ยังไม่ได้ส่งขึ้น Cloud</h2>
          <div className="projects-grid">
            {pending.intents.map((intent) => (
              <button key={intent.key} type="button" className="project-card is-pending"
                onClick={() => navigate('/editor/new', { state: { packitNewIntent: intent.intentId } })}>
                <span className="project-thumb"><KindIcon /></span>
                <span className="project-meta">
                  <span className="project-name">{intent.latest.project.name}</span>
                  <span className="project-sub">{intent.status === 'failed' ? 'สร้างไม่สำเร็จ · เปิดเพื่อจัดการ' : 'สร้างไว้ในเครื่อง รอส่ง'}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
      {offlineDrafts.length > 0 && (
        <section className="projects-section projects-local">
          <h2>งานที่เก็บร่างไว้ในแท็บนี้</h2>
          <div className="projects-grid">
            {offlineDrafts.map((draft) => (
              <button key={draft.id} type="button" className="project-card is-pending" onClick={() => navigate(`/editor/${draft.id}`)}>
                <span className="project-thumb"><KindIcon /></span>
                <span className="project-meta">
                  <span className="project-name">{draft.name}</span>
                  <span className="project-sub">บันทึกไว้ในเครื่อง รอส่งขึ้น Cloud</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
      {confirmation && (
        <ProjectDeleteDialog
          name={confirmation.item.name}
          license={designLicenseKnowledge(confirmation.item.id, new Set(deleteEntitlements.data?.licensedProjectIds), true, deleteEntitlements.isSuccess)}
          disabled={!online || deleteEntitlements.isFetching || pending.projectIds.has(confirmation.item.id)}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            setDeleteTarget(null)
            deletion.mutate(confirmation)
          }}
        />
      )}
      {canMigrate && migrationOpen && (
        <Suspense fallback={<div className="projects-banner" role="status">กำลังเปิดเครื่องมือย้ายงาน…</div>}>
          <LegacyMigrationFlow
            scope={migrationScope}
            apiBaseUrl={session.apiBaseUrl}
            getAccessToken={session.getAccessToken}
            onMigrated={refresh}
            onClose={() => setMigrationOpen(false)}
          />
        </Suspense>
      )}
    </StudioShell>
  )
}

// ภาพย่อ: อ่านแคช IndexedDB ก่อน แล้วขอ server เฉพาะ version ไม่ตรง ทีละ ≤ 24 id ไม่ซ้ำ — ไม่ mount 3D
function useThumbnails(
  appUserId: string,
  workspaceId: string,
  items: readonly ProjectSummary[],
  session: { apiBaseUrl: string; getAccessToken(): string },
) {
  const cache = useMemo(() => new ThumbnailCache(cloudThumbnailScope(appUserId, workspaceId), new IndexedDbThumbStore()), [appUserId, workspaceId])
  useEffect(() => () => cache.dispose(), [cache])
  useSyncExternalStore(cache.subscribe, cache.version)
  const requested = useMemo(() => new Map<string, string>(), [cache])
  useEffect(() => {
    const controller = new AbortController()
    const withMeta = items.filter((item) => item.thumbnail)
    void (async () => {
      await cache.load(withMeta.map((item) => item.id))
      if (controller.signal.aborted) return
      const due = withMeta.filter((item) => {
        const version = item.thumbnail!.version
        if (requested.get(item.id) === version) return false
        return thumbNeedsFetch(version, cache.record(item.id))
      })
      for (let index = 0; index < due.length; index += THUMB_BATCH) {
        const batch = due.slice(index, index + THUMB_BATCH)
        try {
          const result = await getProjectThumbnails(session.apiBaseUrl, session.getAccessToken(), {
            workspaceId,
            projectIds: batch.map((item) => item.id),
          }, controller.signal)
          if (controller.signal.aborted) return
          batch.forEach((item) => requested.set(item.id, item.thumbnail!.version))
          const meta = new Map(batch.map((item) => [item.id, item.thumbnail!]))
          for (const image of result.items) {
            const info = meta.get(image.projectId)
            if (!info) continue // ผลที่ไม่ได้ขอ — ไม่อิงลำดับ/จำนวนของผล
            await cache.save({
              projectId: image.projectId,
              version: image.version,
              blob: base64ToBlob(image.imageBase64, image.mimeType),
              kind: info.kind,
              label: info.label,
            })
          }
        } catch {
          // ไม่มีภาพ = ไอคอนตามชนิดงาน
          return
        }
      }
    })()
    return () => controller.abort()
  }, [cache, items, requested, session, workspaceId])
  return cache
}

// งานที่ยังรอส่งในเครื่องนี้ (draft ค้าง + งานใหม่ที่ยังไม่มี server ID) ของบัญชี/workspace นี้เท่านั้น — ไม่ส่งเบื้องหลัง
const EMPTY_PENDING = {
  projectIds: new Set<string>(),
  localDrafts: [] as Array<{ id: string; name: string }>,
  intents: [] as CreateIntentRecord[],
}

function useLocalPending(appUserId: string, workspaceId: string, canWrite: boolean) {
  const [clientId] = useState(getCloudDraftClientId)
  const scopeKey = `${appUserId}:${workspaceId}`
  const [state, setState] = useState<(typeof EMPTY_PENDING & { scopeKey: string }) | null>(null)
  useEffect(() => {
    if (!canWrite) return
    let active = true
    const scope = { appUserId, workspaceId }
    void Promise.all([
      new IndexedDbProjectDraftStore().list(scope).catch(() => []),
      new IndexedDbCreateIntentStore().list(scope).catch(() => []),
    ]).then(([drafts, intents]) => {
      if (!active) return
      const dirty = drafts.filter((draft) => draft.inFlight !== null || draft.savedGeneration < draft.latestDraft.generation)
      setState({
        scopeKey,
        projectIds: new Set(dirty.map((draft) => draft.projectId)),
        localDrafts: dirty.filter((draft) => draft.clientId === clientId)
          .map((draft) => ({ id: draft.projectId, name: draft.latestDraft.project.name })),
        intents: intents.filter((intent) => intent.status !== 'created'),
      })
    })
    return () => { active = false }
  }, [appUserId, canWrite, clientId, scopeKey, workspaceId])
  return canWrite && state?.scopeKey === scopeKey ? state : EMPTY_PENDING
}

function formatUpdated(value: string): string {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return ''
  return new Date(time).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })
}

function KindIcon({ kind }: { kind?: ThumbnailKind }) {
  const common = { width: 44, height: 44, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true } as const
  switch (kind) {
    case 'vessel':
      return <svg {...common}><path d="M10 2h4v3l2 3v12a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V8l2-3z" /></svg>
    case 'pouch':
      return <svg {...common}><path d="M6 3h12l-1 4 2 13H5L7 7z" /><path d="M7 7h10" /></svg>
    case 'card':
      return <svg {...common}><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 10h6M7 14h4" /></svg>
    case 'box':
      return <svg {...common}><path d="M12 3 3 7.5v9L12 21l9-4.5v-9z" /><path d="M3 7.5 12 12l9-4.5M12 12v9" /></svg>
    default:
      return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m4 17 5-4 4 3 3-2 4 3" /></svg>
  }
}
