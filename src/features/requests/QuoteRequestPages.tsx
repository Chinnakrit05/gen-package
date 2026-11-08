import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import type { CreateQuoteRequestDraftInput, QuoteRequestCursor, QuoteRequestDraft } from '../../../shared/contracts/quoteRequests'
import { useCloudSession, type CloudSessionValue } from '../../app/cloudSession'
import { ApiClientError } from '../../services/api/client'
import { getProject } from '../../services/api/projects'
import { createQuoteRequestDraft, getQuoteRequestDraft, listQuoteRequestDrafts } from '../../services/api/quoteRequests'
import { MarketplaceError, MarketplaceShell } from '../suppliers/MarketplaceShell'
import './quoteRequests.css'

const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i
const TITLE_LIMIT = 100
const QUANTITY_LIMIT = 1_000_000
const NOTES_LIMIT = 1000
const quantityFormat = new Intl.NumberFormat('th-TH')
const dateFormat = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' })

type Source = {
  id: string
  workspaceId: string
  name: string
  revision: number
  quantity: number
  spec: QuoteRequestDraft['spec']
}

const ownWorkspace = (session: CloudSessionValue, id: string) =>
  session.me?.workspaces.find((workspace) => workspace.id === id && workspace.role === 'owner')

function unavailable(error: unknown): boolean {
  return error instanceof ApiClientError && [401, 403, 404].includes(error.status)
}

function formattedDate(value: string): string {
  return dateFormat.format(new Date(value.replace(/(\.\d{3})\d+Z$/, '$1Z')))
}

function RequestPage({ title, children, showListLink = false }: {
  title: string
  children: ReactNode
  showListLink?: boolean
}) {
  const session = useCloudSession()
  return (
    <MarketplaceShell title={title}>
      {showListLink && <div><Link to="/app/requests">กลับไปที่ฉบับร่างคำขอราคา</Link></div>}
      {session.meStatus === 'loading' && <p role="status">กำลังตรวจสิทธิ์พื้นที่งาน…</p>}
      {session.meStatus === 'error' && <MarketplaceError message="ตรวจสิทธิ์พื้นที่งานไม่สำเร็จ" retry={session.refreshMembership} />}
      {session.meStatus === 'ready' && children}
    </MarketplaceShell>
  )
}

export function QuoteRequestListPage() {
  const session = useCloudSession()
  const workspace = ownWorkspace(session, session.workspaceId)
  return (
    <RequestPage title="ฉบับร่างคำขอราคา">
      {workspace ? <OwnedDraftList key={workspace.id} workspaceId={workspace.id} workspaceName={workspace.name} /> : (
        <section className="marketplace-card">
          <MarketplaceError message="เลือกพื้นที่งานที่คุณเป็นเจ้าของเพื่อเปิดฉบับร่างคำขอราคา" />
          <Link to="/app/projects">กลับไปเลือกพื้นที่งาน</Link>
        </section>
      )}
    </RequestPage>
  )
}

function OwnedDraftList({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }) {
  const session = useCloudSession()
  const [cursors, setCursors] = useState<QuoteRequestCursor[]>([])
  const after = cursors.at(-1) ?? null
  const list = useQuery({
    queryKey: ['cloud', session.appUserId, workspaceId, 'quote-request-drafts', after],
    queryFn: ({ signal }) => listQuoteRequestDrafts(session.apiBaseUrl, session.getAccessToken(), workspaceId, after, signal),
    gcTime: 0,
  })
  const data = list.isSuccess && !list.isFetching ? list.data : undefined
  const next = data?.nextCursor
  const refresh = () => {
    if (after) setCursors([])
    else void list.refetch()
  }
  return (
    <>
      <section className="marketplace-card">
        <h2>{workspaceName}</h2>
        <p>เลือกงาน Cloud ที่บันทึกไว้เพื่อเริ่มฉบับร่างคำขอราคา</p>
        <div className="marketplace-meta">
          <Link to="/app/projects">เลือกงานที่บันทึกไว้</Link>
          <button type="button" disabled={list.isFetching} onClick={refresh}>โหลดรายการล่าสุด</button>
        </div>
      </section>
      <section className="marketplace-card">
        {(list.isPending || list.isFetching) && <p role="status">กำลังโหลดฉบับร่าง…</p>}
        {list.isError && <MarketplaceError
          message={unavailable(list.error) ? 'บัญชีนี้เปิดฉบับร่างของพื้นที่งานนี้ไม่ได้' : 'โหลดฉบับร่างไม่สำเร็จ'}
          retry={unavailable(list.error) ? undefined : () => void list.refetch()}
        />}
        {data && (data.items.length === 0 ? <p className="marketplace-muted">ยังไม่มีฉบับร่างในหน้านี้</p> : (
          <ul className="marketplace-list">
            {data.items.map((draft) => (
              <li className="quote-request-row" key={draft.id}>
                <div className="marketplace-description">
                  <Link to={`/app/requests/${draft.id}`}>{draft.title}</Link>
                  <p>{draft.projectName} · {quantityFormat.format(draft.quantity)} ชิ้น</p>
                </div>
                <time className="marketplace-muted" dateTime={draft.createdAt}>{formattedDate(draft.createdAt)}</time>
              </li>
            ))}
          </ul>
        ))}
        {data && (after || next) && (
          <div className="marketplace-meta" role="group" aria-label="หน้าฉบับร่าง">
            <button type="button" disabled={!after} onClick={() => setCursors((previous) => previous.slice(0, -1))}>ใหม่กว่า</button>
            <button type="button" disabled={!next} onClick={() => {
              if (next) setCursors((previous) => [...previous, next])
            }}>เก่ากว่า</button>
          </div>
        )}
      </section>
    </>
  )
}

export function QuoteRequestNewPage() {
  const [search] = useSearchParams()
  const projectIds = search.getAll('projectId')
  const projectId = projectIds.length === 1 ? projectIds[0] : ''
  return (
    <RequestPage title="สร้างฉบับร่างคำขอราคา" showListLink>
      {uuid.test(projectId) ? <ProjectDraftSource key={projectId} projectId={projectId} /> : (
        <section className="marketplace-card">
          <MarketplaceError message="เลือกงาน Cloud ที่บันทึกไว้เพื่อเริ่มฉบับร่าง" />
          <Link to="/app/projects">เลือกงานที่บันทึกไว้</Link>
        </section>
      )}
    </RequestPage>
  )
}

function ProjectDraftSource({ projectId }: { projectId: string }) {
  const session = useCloudSession()
  const source = useQuery({
    queryKey: ['cloud', session.appUserId, 'quote-request-source', projectId],
    queryFn: async ({ signal }): Promise<Source | null> => {
      const project = await getProject(session.apiBaseUrl, session.getAccessToken(), projectId, signal)
      if (!ownWorkspace(session, project.workspaceId)) return null
      return {
        id: project.id,
        workspaceId: project.workspaceId,
        name: project.name,
        revision: project.revision,
        quantity: project.document.qty,
        spec: project.document.live,
      }
    },
    gcTime: 0,
  })
  const owned = source.data && ownWorkspace(session, source.data.workspaceId)
  const denied = unavailable(source.error) || source.data === null || Boolean(source.data && !owned)
  const reload = () => void source.refetch()
  return (
    <>
      {(source.isPending || source.isFetching) && <p role="status">กำลังโหลดงานต้นทางที่บันทึกไว้…</p>}
      {denied && <MarketplaceError message="เปิดงานต้นทางไม่ได้ ต้องใช้งาน Cloud ในพื้นที่ที่คุณเป็นเจ้าของ" />}
      {source.isError && !denied && <MarketplaceError message="โหลดงานต้นทางไม่สำเร็จ" retry={reload} />}
      {source.data && !denied && <CreateDraftForm source={source.data} reloadSource={reload} sourceBusy={!source.isSuccess || source.isFetching} />}
    </>
  )
}

function CreateDraftForm({ source, reloadSource, sourceBusy }: {
  source: Source
  reloadSource(): void
  sourceBusy: boolean
}) {
  const session = useCloudSession()
  const navigate = useNavigate()
  const [title, setTitle] = useState(source.name)
  const [quantity, setQuantity] = useState(() => String(source.quantity))
  const [notes, setNotes] = useState('')
  const attempt = useRef<{ key: string; operationId: string } | null>(null)
  const create = useMutation({
    mutationFn: (input: Omit<CreateQuoteRequestDraftInput, 'operationId'>) => {
      const key = JSON.stringify(input)
      if (attempt.current?.key !== key) attempt.current = { key, operationId: crypto.randomUUID() }
      return createQuoteRequestDraft(session.apiBaseUrl, session.getAccessToken(), { ...input, operationId: attempt.current.operationId })
    },
  })
  const previousConflict = create.error instanceof ApiClientError && create.error.code === 'REVISION_CONFLICT' ? create.error : null
  const requestedRevision = create.variables?.expectedProjectRevision
  const currentRevision = previousConflict?.details?.currentRevision
  const conflict = previousConflict && (typeof currentRevision === 'number'
    ? source.revision < currentRevision
    : source.revision === requestedRevision)
  const count = Number(quantity)
  const valid = title.trim().length > 0 && title.trim().length <= TITLE_LIMIT
    && Number.isInteger(count) && count >= 1 && count <= QUANTITY_LIMIT && notes.trim().length <= NOTES_LIMIT
  const disabled = sourceBusy || create.isPending
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (disabled || conflict || !valid) return
    create.mutate({
      workspaceId: source.workspaceId,
      projectId: source.id,
      expectedProjectRevision: source.revision,
      title: title.trim(),
      quantity: count,
      notes: notes.trim(),
    }, {
      onSuccess: (draft) => void navigate(`/app/requests/${draft.id}`, { replace: true }),
    })
  }
  if (unavailable(create.error)) return <MarketplaceError message="บัญชีนี้บันทึกฉบับร่างจากงานนี้ไม่ได้" />
  return (
    <>
      <SourceSpec name={source.name} revision={source.revision} spec={source.spec} />
      <section className="marketplace-card">
        <h2>รายละเอียดคำขอราคา</h2>
        <p>ฉบับร่างจะเก็บสเปกจาก revision ที่แสดงไว้และรายละเอียดคำขอในพื้นที่งานนี้</p>
        {conflict && <MarketplaceError message="งานต้นทางมี revision ใหม่ โหลดสเปกล่าสุดแล้วตรวจข้อมูลก่อนบันทึกอีกครั้ง" />}
        {conflict && <button type="button" disabled={disabled} onClick={reloadSource}>โหลดสเปกล่าสุด</button>}
        {previousConflict && !conflict && <p className="marketplace-notice" role="status">โหลดสเปกล่าสุดแล้ว ตรวจข้อมูลก่อนบันทึกอีกครั้ง</p>}
        {create.isError && !previousConflict && <MarketplaceError message="บันทึกฉบับร่างไม่สำเร็จ ลองบันทึกอีกครั้ง" />}
        <form className="marketplace-form" onSubmit={submit}>
          <fieldset className="marketplace-form-fields" disabled={disabled}>
            <label>
              ชื่อคำขอราคา
              <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={TITLE_LIMIT} required />
            </label>
            <label>
              จำนวนที่ต้องการผลิต
              <input type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)}
                min={1} max={QUANTITY_LIMIT} step={1} required />
            </label>
            <label>
              รายละเอียดเพิ่มเติม
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={NOTES_LIMIT} rows={4} />
            </label>
            <button type="submit" className="primary" disabled={Boolean(conflict) || !valid}>
              {create.isPending ? 'กำลังบันทึก…' : 'บันทึกฉบับร่าง'}
            </button>
          </fieldset>
        </form>
      </section>
    </>
  )
}

export function QuoteRequestDetailPage() {
  const { id } = useParams()
  return (
    <RequestPage title="ฉบับร่างคำขอราคา" showListLink>
      {id && uuid.test(id) ? <OwnedDraftDetail key={id} id={id} /> : <MarketplaceError message="ลิงก์ฉบับร่างไม่ถูกต้อง" />}
    </RequestPage>
  )
}

function OwnedDraftDetail({ id }: { id: string }) {
  const session = useCloudSession()
  const detail = useQuery({
    queryKey: ['cloud', session.appUserId, 'quote-request-draft', id],
    queryFn: ({ signal }) => getQuoteRequestDraft(session.apiBaseUrl, session.getAccessToken(), id, signal),
    gcTime: 0,
  })
  const draft = detail.isSuccess && ownWorkspace(session, detail.data.workspaceId) ? detail.data : undefined
  return (
    <>
      {detail.isPending && <p role="status">กำลังโหลดฉบับร่าง…</p>}
      {detail.isSuccess && !draft && <MarketplaceError message="ไม่พบฉบับร่างหรือบัญชีนี้เปิดไม่ได้" />}
      {detail.isError && <MarketplaceError
        message={unavailable(detail.error) ? 'ไม่พบฉบับร่างหรือบัญชีนี้เปิดไม่ได้' : 'โหลดฉบับร่างไม่สำเร็จ'}
        retry={unavailable(detail.error) ? undefined : () => void detail.refetch()}
      />}
      {draft && (
        <>
          <section className="marketplace-card">
            <div className="marketplace-meta">
              <h2>{draft.title}</h2>
              <span className="marketplace-badge">ฉบับร่าง</span>
            </div>
            <p>จำนวนที่ต้องการผลิต {quantityFormat.format(draft.quantity)} ชิ้น</p>
            {draft.notes && <p className="marketplace-description">{draft.notes}</p>}
            <time className="marketplace-muted" dateTime={draft.createdAt}>บันทึกเมื่อ {formattedDate(draft.createdAt)}</time>
          </section>
          <SourceSpec name={draft.projectName} revision={draft.projectRevision} spec={draft.spec} />
        </>
      )}
    </>
  )
}

function SourceSpec({ name, revision, spec }: { name: string; revision: number; spec: QuoteRequestDraft['spec'] }) {
  return (
    <section className="marketplace-card">
      <h2>สเปกงานต้นทาง</h2>
      <p className="marketplace-description"><strong>{name}</strong> · Revision {revision}</p>
      <dl className="quote-request-spec">
        <div><dt>รหัสแบบ</dt><dd>{spec.template}</dd></div>
        <div><dt>รหัสวัสดุ</dt><dd>{spec.materialId}</dd></div>
        <div><dt>กว้าง × ลึก × สูง</dt><dd>{spec.W} × {spec.D} × {spec.H} มม.</dd></div>
        <div><dt>หูหิ้ว</dt><dd>{spec.handle ? 'มี' : 'ไม่มี'}</dd></div>
      </dl>
    </section>
  )
}
