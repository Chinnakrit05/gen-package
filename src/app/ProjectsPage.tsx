// /app/projects — รายการงานแบบแบ่งหน้า (1-A3) ห้าม import Editor/core engine/three/exporter
// ใช้ summary + ภาพย่อตาม contract b-phase0-r1: หน้าละ 24, cursor opaque, batch ภาพย่อ ≤ 24 จับคู่ด้วย projectId
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router'
import { ArrowRight, ArrowUpRight, Box, Check, FileText, Layers3, Plus, RefreshCw, ShieldCheck } from 'lucide-react'
import { StudioShell } from './StudioShell'
import type { ProjectSummary, ThumbnailKind } from '../../shared/contracts/projects'
import { marketplaceSuppliersEnabled } from '../config'
import { thumbNeedsFetch } from '../core/thumbnail'
import { hasLegacyMigrationSource } from '../features/projects/legacyStorage'
import { getProjectThumbnails, listProjects } from '../services/api/projects'
import { IndexedDbCreateIntentStore, type CreateIntentRecord } from '../services/drafts/createIntentStore'
import { getCloudDraftClientId, IndexedDbProjectDraftStore } from '../services/drafts/projectDraftStore'
import { IndexedDbThumbStore, ThumbnailCache, base64ToBlob, cloudThumbnailScope } from '../services/thumbnails/thumbnailCache'
import { useCloudSession } from './cloudSession'
import { takeFlash } from './flash'
import { PROJECT_PAGE_SIZE, mergeProjectPages } from './projectList'
import './projects.css'

const THUMB_BATCH = 24
const LegacyMigrationFlow = lazy(() => import('../features/projects/LegacyMigrationFlow')
  .then((module) => ({ default: module.LegacyMigrationFlow })))

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

  const queryKey = useMemo(() => ['cloud', appUserId, workspaceId, 'projects', { limit: PROJECT_PAGE_SIZE }] as const, [appUserId, workspaceId])
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

  const changeWorkspace = (next: string) => {
    if (next === workspaceId) return
    setMigrationOpen(false)
    // คำขอของ workspace เดิมที่ค้างอยู่ถูกยกเลิก; ผลที่มาช้าลง key เดิม ไม่ปนกับรายการใหม่
    void queryClient.cancelQueries({ queryKey: ['cloud', appUserId, workspaceId] })
    session.setWorkspaceId(next)
  }

  const latestProject = items[0]
  const roleLabel = session.role === 'owner' ? 'เจ้าของพื้นที่' : session.role === 'editor' ? 'แก้ไขงานได้' : 'ดูอย่างเดียว'

  return (
    <StudioShell
      title="งานออกแบบของฉัน"
      description="ทุกไอเดียเริ่มต้นได้ที่นี่ จัดการงานออกแบบและเตรียมพร้อมสำหรับการผลิต"
      className="projects-page"
      onWorkspaceChange={changeWorkspace}
      actions={<button className="primary projects-new" disabled={!canCreate} title={canCreate ? undefined : 'บทบาทดูอย่างเดียวสร้างงานไม่ได้'} onClick={() => navigate('/editor/new')}><Plus size={16} aria-hidden="true" />สร้างงานใหม่</button>}
    >
      <div className="projects-stats" aria-label="ภาพรวมพื้นที่งาน">
        <div className="projects-stat"><span>งานที่โหลดในพื้นที่นี้</span><strong>{projects.isPending ? '—' : items.length}<i><Layers3 size={20} /></i></strong><small>{projects.hasNextPage ? 'ยังมีงานเพิ่มเติมในหน้าถัดไป' : 'รายการงานออกแบบของพื้นที่นี้'}</small></div>
        <div className="projects-stat"><span>รอส่งจากเครื่องนี้</span><strong>{pending.intents.length + pending.projectIds.size}<i><RefreshCw size={20} /></i></strong><small>งานใหม่และการแก้ไขที่ยังไม่ส่งขึ้น Cloud</small></div>
        <div className="projects-stat"><span>สิทธิ์ของคุณในพื้นที่</span><strong className="projects-stat-role">{roleLabel}<i><ShieldCheck size={20} /></i></strong><small>{online ? 'เชื่อมต่ออินเทอร์เน็ตอยู่' : 'กำลังใช้งานแบบออฟไลน์'}</small></div>
      </div>

      {!online && <div className="projects-banner is-offline">ออฟไลน์ — แสดงเฉพาะงานที่โหลดไว้และงานที่รอส่งในเครื่องนี้</div>}
      {notice && <div className="projects-banner">{notice}</div>}
      {session.role === 'viewer' && <div className="projects-banner">พื้นที่งานนี้คุณดูได้อย่างเดียว</div>}

      <div className="projects-dashboard">
      <div className="projects-primary-column">
      <section className="projects-hero" aria-label="เริ่มต้นงานออกแบบ">
        <div className="projects-hero-copy"><span className="studio-eyebrow"><span className="projects-live-dot" />YOUR NEXT GREAT PACKAGE</span><h2>{latestProject ? 'ไอเดียของคุณ' : 'เริ่มจากไอเดีย'}<br />พร้อมเป็นจริงแล้ว</h2><p>{latestProject ? 'กลับไปแต่งรายละเอียดให้ลงตัว แล้วเตรียมสเปกสำหรับผู้รับผลิตที่ใช่' : 'กำหนดรูปทรงและขนาด ออกแบบลวดลาย แล้วพรีวิวบรรจุภัณฑ์ในมุมมอง 3D'}</p>{latestProject ? <button onClick={() => navigate(`/editor/${latestProject.id}`)}>กลับไปออกแบบต่อ <ArrowRight size={16} /></button> : canCreate && <button onClick={() => navigate('/editor/new')}>เริ่มออกแบบบรรจุภัณฑ์ <ArrowRight size={16} /></button>}<span className="projects-hero-caption"><Box size={16} />{latestProject?.name || 'สร้างงานในแบบของคุณ'}</span></div>
        <div className="projects-hero-art" aria-hidden="true">{latestProject && thumbs.url(latestProject.id) ? <img src={thumbs.url(latestProject.id)} alt="" /> : <div className="studio-package-composition"><div className="studio-package-box"><span>PACKIT</span><Box size={42} strokeWidth={1} /><strong>Made<br />to inspire.</strong><small>YOUR IDEAS, IN FORM.</small></div><div className="studio-package-small"><span>studio.</span><Box size={27} strokeWidth={1} /></div></div>}<small>PACKAGING / DESIGN STUDIO</small></div>
      </section>
      {pending.intents.length > 0 && (
        <section className="projects-section">
          <h2>งานใหม่ที่ยังไม่ได้ส่งขึ้น Cloud</h2>
          <div className="projects-grid">
            {pending.intents.map((intent) => (
              <button
                key={intent.key}
                className="project-card is-pending"
                onClick={() => navigate('/editor/new', { state: { packitNewIntent: intent.intentId } })}
              >
                <div className="project-thumb"><KindIcon /></div>
                <div className="project-meta">
                  <span className="project-name">{intent.latest.project.name}</span>
                  <span className="project-sub">
                    {intent.status === 'failed' ? 'สร้างไม่สำเร็จ — เปิดเพื่อจัดการ' : 'สร้างไว้ในเครื่อง รอส่ง'}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {offlineDrafts.length > 0 && (
        <section className="projects-section">
          <h2>งานที่เก็บร่างไว้ในแท็บนี้</h2>
          <div className="projects-grid">
            {offlineDrafts.map((draft) => (
              <button key={draft.id} className="project-card is-pending" onClick={() => navigate(`/editor/${draft.id}`)}>
                <div className="project-thumb"><KindIcon /></div>
                <div className="project-meta">
                  <span className="project-name">{draft.name}</span>
                  <span className="project-sub">บันทึกไว้ในเครื่อง รอส่งขึ้น Cloud</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="projects-section">
        <div className="projects-section-heading"><div><h2>งานออกแบบทั้งหมด</h2><p>เปิดงานเพื่อออกแบบต่อ หรือเตรียมฉบับร่างขอราคา</p></div><div className="projects-list-actions"><button className="projects-refresh" onClick={refresh} disabled={!online || projects.isFetching}><RefreshCw size={14} aria-hidden="true" />รีเฟรช</button>{canMigrate && <button disabled={!online} onClick={() => setMigrationOpen(true)}>ย้ายงานเดิมขึ้น Cloud</button>}</div></div>
        {!online && !projects.data ? (
          <div className="projects-empty" role="status">
            <p>ออฟไลน์ — ยังโหลดรายการงานไม่ได้</p>
            <p>เชื่อมต่ออินเทอร์เน็ตเพื่อโหลดรายการของพื้นที่นี้</p>
          </div>
        ) : projects.isPending ? (
          <div className="projects-grid" aria-busy="true">
            {Array.from({ length: 8 }, (_, index) => <div className="project-card is-skeleton" key={index} />)}
          </div>
        ) : projects.isError && items.length === 0 ? (
          <div className="projects-empty">
            <p>{online ? 'โหลดรายการงานไม่สำเร็จ' : 'ออฟไลน์ — ยังโหลดรายการงานไม่ได้'}</p>
            <button onClick={refresh} disabled={!online}>ลองใหม่</button>
          </div>
        ) : items.length === 0 ? (
          <div className="projects-empty"><span className="projects-empty-icon"><Box size={28} /></span>
            <h3>เริ่มต้นงานชิ้นแรกของคุณ</h3><p>ยังไม่มีงานในพื้นที่นี้</p>
            {canCreate && <button className="primary" onClick={() => navigate('/editor/new')}>สร้างงานแรก</button>}
          </div>
        ) : (
          <>
            <div className="projects-grid">
              {items.map((item) => {
                const awaitingSave = pending.projectIds.has(item.id)
                const card = (
                  <button key={item.id} className="project-card" onClick={() => navigate(`/editor/${item.id}`)}>
                    <div className="project-thumb"><span className="project-card-arrow"><ArrowUpRight size={15} /></span>
                      {thumbs.url(item.id) ? <img src={thumbs.url(item.id)} alt="" /> : <KindIcon kind={item.thumbnail?.kind} />}
                    </div>
                    <div className="project-meta">
                      <span className="project-name">{item.name}</span>
                      <span className="project-sub">
                        {item.thumbnail?.label ? `${item.thumbnail.label} · ` : ''}{formatUpdated(item.updatedAt)}
                      </span>
                    </div>
                    {awaitingSave && <span className="project-badge">รอส่ง</span>}
                  </button>
                )
                if (!showQuoteRequests) return card
                return (
                  <div key={item.id} className="project-card-with-action" role="group" aria-label={item.name}>
                    {card}
                    <button
                      type="button"
                      disabled={!online || awaitingSave}
                      title={awaitingSave ? 'รอให้งานบันทึกขึ้น Cloud ก่อน' : undefined}
                      onClick={() => void navigate(`/app/requests/new?projectId=${encodeURIComponent(item.id)}`)}
                    >
                      <FileText size={14} aria-hidden="true" />สร้างฉบับร่างขอราคา <ArrowRight size={14} aria-hidden="true" />
                    </button>
                  </div>
                )
              })}
            </div>
            {projects.isError && <div className="projects-banner is-error">โหลดเพิ่มไม่สำเร็จ ลองอีกครั้ง</div>}
            {projects.hasNextPage && (
              <div className="projects-more">
                <button onClick={() => void projects.fetchNextPage()} disabled={projects.isFetchingNextPage || !online}>
                  {projects.isFetchingNextPage ? 'กำลังโหลด…' : 'โหลดเพิ่ม'}
                </button>
              </div>
            )}
          </>
        )}
      </section>
      </div>
      <aside className="projects-side">
        <div className="projects-side-heading"><h2>ขั้นตอนถัดไป</h2><span>WORKFLOW</span></div>
        <div className="projects-quick-links">{showQuoteRequests && <Link to="/app/requests"><span className="projects-quick-icon"><FileText size={18} /></span><span><strong>คำขอราคาของฉัน</strong><small>ติดตามร่างและคำขอที่เผยแพร่</small></span><ArrowRight size={15} /></Link>}{marketplaceSuppliersEnabled && <Link to="/factory/onboarding"><span className="projects-quick-icon"><Box size={18} /></span><span><strong>พื้นที่ผู้รับผลิต</strong><small>จัดการกิจการและคำขอที่ได้รับ</small></span><ArrowRight size={15} /></Link>}<div className="projects-workspace-note"><ShieldCheck size={18} /><span><strong>ข้อมูลแยกตามพื้นที่งาน</strong><small>แสดงเฉพาะงานที่คุณมีสิทธิ์เข้าถึง</small></span></div></div>
        <section className="projects-process"><span className="studio-eyebrow">FROM IDEA TO PRODUCTION</span><h3>ทุกขั้นตอน เชื่อมถึงกัน</h3><ol><li><span><Check size={12} /></span><div><strong>ออกแบบบรรจุภัณฑ์</strong><small>กำหนดรูปทรง ขนาด และลวดลาย</small></div></li><li><span>2</span><div><strong>เตรียมคำขอราคา</strong><small>สร้างฉบับสเปกจากงานที่บันทึกแล้ว</small></div></li><li><span>3</span><div><strong>เลือกผู้รับผลิต</strong><small>ส่งสเปกให้กิจการที่ผ่านการอนุมัติ</small></div></li></ol><p>ฉบับสเปกที่ส่งแล้วเก็บข้อมูล ณ เวลานั้น เพื่อให้ทุกฝ่ายอ้างอิงตรงกัน</p></section>
      </aside>
      </div>
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
