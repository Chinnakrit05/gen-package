import { useCallback, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import type { CreateQuoteRequestDraftInput, QuoteRequestCursor, QuoteRequestDraft, QuoteRequestPublication } from '../../../shared/contracts/quoteRequests'
import { useCloudSession, type CloudSessionValue } from '../../app/cloudSession'
import { ApiClientError } from '../../services/api/client'
import { getProject } from '../../services/api/projects'
import { createQuoteRequestDraft, getQuoteRequestDraft, getQuoteRequestPublication, listQuoteRequestDrafts } from '../../services/api/quoteRequests'
import { MarketplaceError, MarketplaceShell } from '../suppliers/MarketplaceShell'
import { QuoteRequestSpec, formatQuoteDate, quoteAccessUnavailable, quoteQuantity, quoteRequestId } from './QuoteRequestFacts'
import { QuoteRequestPublicationReceipt, QuoteRequestPublishPanel } from './QuoteRequestPublishPanel'
import './quoteRequests.css'

const TITLE_LIMIT = 100
const QUANTITY_LIMIT = 1_000_000
const NOTES_LIMIT = 1000

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

function RequestPage({ title, children, showListLink = false }: {
  title: string
  children: ReactNode
  showListLink?: boolean
}) {
  const session = useCloudSession()
  return (
    <MarketplaceShell title={title}>
      {showListLink && <div><Link to="/app/requests">กลับไปที่คำขอราคา</Link></div>}
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
    <RequestPage title="คำขอราคา">
      {workspace ? <OwnedDraftList key={workspace.id} workspaceId={workspace.id} workspaceName={workspace.name} /> : (
        <section className="marketplace-card">
          <MarketplaceError message="เลือกพื้นที่งานที่คุณเป็นเจ้าของเพื่อเปิดคำขอราคา" />
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
        {(list.isPending || list.isFetching) && <p role="status">กำลังโหลดคำขอราคา…</p>}
        {list.isError && <MarketplaceError
          message={quoteAccessUnavailable(list.error) ? 'บัญชีนี้เปิดคำขอราคาของพื้นที่งานนี้ไม่ได้' : 'โหลดคำขอราคาไม่สำเร็จ'}
          retry={quoteAccessUnavailable(list.error) ? undefined : () => void list.refetch()}
        />}
        {data && (data.items.length === 0 ? <p className="marketplace-muted">ยังไม่มีคำขอราคาในหน้านี้</p> : (
          <ul className="marketplace-list">
            {data.items.map((draft) => (
              <li className="quote-request-row" key={draft.id}>
                <div className="marketplace-description">
                  <Link to={`/app/requests/${draft.id}`}>{draft.title}</Link>
                  <p>{draft.projectName} · {quoteQuantity.format(draft.quantity)} ชิ้น</p>
                </div>
                <time className="marketplace-muted" dateTime={draft.createdAt}>{formatQuoteDate(draft.createdAt)}</time>
              </li>
            ))}
          </ul>
        ))}
        {data && (after || next) && (
          <div className="marketplace-meta" role="group" aria-label="หน้าคำขอราคา">
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
      {quoteRequestId.test(projectId) ? <ProjectDraftSource key={projectId} projectId={projectId} /> : (
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
  const denied = quoteAccessUnavailable(source.error) || source.data === null || Boolean(source.data && !owned)
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
  if (quoteAccessUnavailable(create.error)) return <MarketplaceError message="บัญชีนี้บันทึกฉบับร่างจากงานนี้ไม่ได้" />
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
    <RequestPage title="คำขอราคา" showListLink>
      {id && quoteRequestId.test(id) ? <OwnedDraftDetail key={id} id={id} /> : <MarketplaceError message="ลิงก์คำขอราคาไม่ถูกต้อง" />}
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
      {detail.isPending && <p role="status">กำลังโหลดคำขอราคา…</p>}
      {detail.isSuccess && !draft && <MarketplaceError message="ไม่พบคำขอราคาหรือบัญชีนี้เปิดไม่ได้" />}
      {detail.isError && <MarketplaceError
        message={quoteAccessUnavailable(detail.error) ? 'ไม่พบคำขอราคาหรือบัญชีนี้เปิดไม่ได้' : 'โหลดคำขอราคาไม่สำเร็จ'}
        retry={quoteAccessUnavailable(detail.error) ? undefined : () => void detail.refetch()}
      />}
      {draft && <OwnedQuoteRequest draft={draft} />}
    </>
  )
}

function OwnedQuoteRequest({ draft }: { draft: QuoteRequestDraft }) {
  const session = useCloudSession()
  const queryClient = useQueryClient()
  const key = ['cloud', session.appUserId, draft.workspaceId, 'quote-request-publication', draft.id] as const
  const publication = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => getQuoteRequestPublication(session.apiBaseUrl, session.getAccessToken(), draft.id, signal),
    gcTime: 0,
    refetchOnWindowFocus: true,
  })
  const { refetch } = publication
  const reloadPublication = useCallback(async () => {
    const current = await refetch()
    return current.isSuccess && current.data.publication === null
  }, [refetch])
  const published = async (receipt: QuoteRequestPublication) => {
    await queryClient.cancelQueries({ queryKey: key, exact: true })
    if (queryClient.getQueryState(key)) queryClient.setQueryData(key, { publication: receipt })
  }
  if (quoteAccessUnavailable(publication.error)) return <MarketplaceError message="บัญชีนี้เปิดคำขอราคาไม่ได้" />
  const receipt = publication.isSuccess ? publication.data.publication : undefined

  return (
    <>
      <section className="marketplace-card">
        <div className="marketplace-meta">
          <h2>{draft.title}</h2>
          {receipt !== undefined && <span className="marketplace-badge">{receipt ? 'ส่งแล้ว' : 'ฉบับร่าง'}</span>}
        </div>
        <p>จำนวนที่ต้องการผลิต {quoteQuantity.format(draft.quantity)} ชิ้น</p>
        {draft.notes && <p className="marketplace-description">{draft.notes}</p>}
        <time className="marketplace-muted" dateTime={draft.createdAt}>บันทึกเมื่อ {formatQuoteDate(draft.createdAt)}</time>
      </section>
      <SourceSpec name={draft.projectName} revision={draft.projectRevision} spec={draft.spec} />
      {publication.isPending && <p role="status">กำลังตรวจสถานะการส่งคำขอ…</p>}
      {publication.isError && <MarketplaceError message="โหลดสถานะการส่งคำขอไม่สำเร็จ" retry={() => void reloadPublication()} />}
      {receipt && <QuoteRequestPublicationReceipt receipt={receipt} />}
      {publication.data?.publication === null && (
        <QuoteRequestPublishPanel requestId={draft.id} workspaceId={draft.workspaceId}
          blocked={!publication.isSuccess || publication.isFetching} onPublished={published} reloadPublication={reloadPublication} />
      )}
    </>
  )
}

function SourceSpec({ name, revision, spec }: { name: string; revision: number; spec: QuoteRequestDraft['spec'] }) {
  return (
    <QuoteRequestSpec spec={spec}>
      <p className="marketplace-description"><strong>{name}</strong> · Revision {revision}</p>
    </QuoteRequestSpec>
  )
}
