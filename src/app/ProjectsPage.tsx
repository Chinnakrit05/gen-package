// /app/projects — รายการงานแบบแบ่งหน้า (1-A3) ห้าม import Editor/core engine/three/exporter
// ใช้ summary + ภาพย่อตาม contract b-phase0-r1: หน้าละ 24, cursor opaque, batch ภาพย่อ ≤ 24 จับคู่ด้วย projectId
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import type { ProjectSummary, ThumbnailKind } from '../../shared/contracts/projects'
import { PackItMark } from '../components/Login'
import { thumbNeedsFetch } from '../core/thumbnail'
import { getProjectThumbnails, listProjects } from '../services/api/projects'
import { IndexedDbCreateIntentStore, type CreateIntentRecord } from '../services/drafts/createIntentStore'
import { IndexedDbProjectDraftStore } from '../services/drafts/projectDraftStore'
import { IndexedDbThumbStore, ThumbnailCache, base64ToBlob } from '../services/thumbnails/thumbnailCache'
import { useCloudSession } from './cloudSession'
import { takeFlash } from './flash'
import { PROJECT_PAGE_SIZE, mergeProjectPages } from './projectList'
import './projects.css'

const THUMB_BATCH = 24

export function ProjectsPage() {
  const session = useCloudSession()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { appUserId, workspaceId } = session
  const [notice] = useState(() => takeFlash())
  const [online, setOnline] = useState(() => navigator.onLine)
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

  const thumbs = useThumbnails(workspaceId, items, session)
  const pending = useLocalPending(session.appUserId, workspaceId)

  const changeWorkspace = (next: string) => {
    if (next === workspaceId) return
    // คำขอของ workspace เดิมที่ค้างอยู่ถูกยกเลิก; ผลที่มาช้าลง key เดิม ไม่ปนกับรายการใหม่
    void queryClient.cancelQueries({ queryKey: ['cloud', appUserId, workspaceId] })
    session.setWorkspaceId(next)
  }

  const canCreate = session.role === 'owner' || session.role === 'editor'
  const teamWorkspaces = session.me?.workspaces ?? []

  return (
    <div className="projects-page">
      <header className="projects-top">
        <div className="projects-brand">
          <span className="login-mark"><PackItMark /></span>
          <span className="projects-title">งานของฉัน</span>
        </div>
        {teamWorkspaces.length > 1 && (
          <label className="projects-workspace">
            <span>พื้นที่งาน</span>
            <select value={workspaceId} onChange={(event) => changeWorkspace(event.target.value)}>
              {teamWorkspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.kind === 'personal' ? 'ส่วนตัว' : workspace.name}
                  {workspace.role === 'viewer' ? ' (ดูอย่างเดียว)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="projects-actions">
          <button className="projects-refresh" onClick={refresh} disabled={!online || projects.isFetching}>รีเฟรช</button>
          <button
            className="primary projects-new"
            disabled={!canCreate}
            title={canCreate ? undefined : 'บทบาทดูอย่างเดียวสร้างงานไม่ได้'}
            onClick={() => navigate('/editor/new')}
          >
            สร้างงานใหม่
          </button>
          <button className="projects-logout" onClick={() => void session.signOut()}>ออกจากระบบ</button>
        </div>
      </header>

      {!online && <div className="projects-banner is-offline">ออฟไลน์ — แสดงเฉพาะงานที่โหลดไว้และงานที่รอส่งในเครื่องนี้</div>}
      {notice && <div className="projects-banner">{notice}</div>}
      {session.role === 'viewer' && <div className="projects-banner">พื้นที่งานนี้คุณดูได้อย่างเดียว</div>}

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

      <section className="projects-section">
        {projects.isPending ? (
          <div className="projects-grid" aria-busy="true">
            {Array.from({ length: 8 }, (_, index) => <div className="project-card is-skeleton" key={index} />)}
          </div>
        ) : projects.isError && items.length === 0 ? (
          <div className="projects-empty">
            <p>{online ? 'โหลดรายการงานไม่สำเร็จ' : 'ออฟไลน์ — ยังโหลดรายการงานไม่ได้'}</p>
            <button onClick={refresh} disabled={!online}>ลองใหม่</button>
          </div>
        ) : items.length === 0 ? (
          <div className="projects-empty">
            <p>ยังไม่มีงานในพื้นที่นี้</p>
            {canCreate && <button className="primary" onClick={() => navigate('/editor/new')}>สร้างงานแรก</button>}
          </div>
        ) : (
          <>
            <div className="projects-grid">
              {items.map((item) => (
                <button key={item.id} className="project-card" onClick={() => navigate(`/editor/${item.id}`)}>
                  <div className="project-thumb">
                    {thumbs.url(item.id) ? <img src={thumbs.url(item.id)} alt="" /> : <KindIcon kind={item.thumbnail?.kind} />}
                  </div>
                  <div className="project-meta">
                    <span className="project-name">{item.name}</span>
                    <span className="project-sub">
                      {item.thumbnail?.label ? `${item.thumbnail.label} · ` : ''}{formatUpdated(item.updatedAt)}
                    </span>
                  </div>
                  {pending.projectIds.has(item.id) && <span className="project-badge">รอส่ง</span>}
                </button>
              ))}
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
  )
}

// ภาพย่อ: อ่านแคช IndexedDB ก่อน แล้วขอ server เฉพาะ version ไม่ตรง ทีละ ≤ 24 id ไม่ซ้ำ — ไม่ mount 3D
function useThumbnails(
  workspaceId: string,
  items: readonly ProjectSummary[],
  session: { apiBaseUrl: string; getAccessToken(): string },
) {
  const cache = useMemo(() => new ThumbnailCache(workspaceId, new IndexedDbThumbStore()), [workspaceId])
  useEffect(() => () => cache.dispose(), [cache])
  useSyncExternalStore(cache.subscribe, cache.version)
  const requested = useRef(new Map<string, string>())
  useEffect(() => {
    const controller = new AbortController()
    const withMeta = items.filter((item) => item.thumbnail)
    void (async () => {
      await cache.load(withMeta.map((item) => item.id))
      if (controller.signal.aborted) return
      const due = withMeta.filter((item) => {
        const version = item.thumbnail!.version
        if (requested.current.get(item.id) === version) return false
        return thumbNeedsFetch(version, cache.record(item.id))
      })
      for (let index = 0; index < due.length; index += THUMB_BATCH) {
        const batch = due.slice(index, index + THUMB_BATCH)
        batch.forEach((item) => requested.current.set(item.id, item.thumbnail!.version))
        try {
          const result = await getProjectThumbnails(session.apiBaseUrl, session.getAccessToken(), {
            workspaceId,
            projectIds: batch.map((item) => item.id),
          }, controller.signal)
          if (controller.signal.aborted) return
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
          batch.forEach((item) => requested.current.delete(item.id))
          return
        }
      }
    })()
    return () => controller.abort()
  }, [cache, items, session, workspaceId])
  return cache
}

// งานที่ยังรอส่งในเครื่องนี้ (draft ค้าง + งานใหม่ที่ยังไม่มี server ID) ของบัญชี/workspace นี้เท่านั้น — ไม่ส่งเบื้องหลัง
function useLocalPending(appUserId: string, workspaceId: string) {
  const [state, setState] = useState<{ projectIds: Set<string>; intents: CreateIntentRecord[] }>({
    projectIds: new Set(),
    intents: [],
  })
  useEffect(() => {
    let active = true
    const scope = { appUserId, workspaceId }
    void Promise.all([
      new IndexedDbProjectDraftStore().list(scope).catch(() => []),
      new IndexedDbCreateIntentStore().list(scope).catch(() => []),
    ]).then(([drafts, intents]) => {
      if (!active) return
      setState({
        projectIds: new Set(drafts
          .filter((draft) => draft.inFlight !== null || draft.savedGeneration < draft.latestDraft.generation)
          .map((draft) => draft.projectId)),
        intents: intents.filter((intent) => intent.status !== 'created'),
      })
    })
    return () => { active = false }
  }, [appUserId, workspaceId])
  return state
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
