import { useContext, useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { MessageCircle } from 'lucide-react'
import type { Conversation, ConversationFile, UploadConversationFileInput } from '../../../shared/contracts/conversations'
import { useCloudSession } from '../../app/cloudSession'
import { MarketplaceRealtimeContext } from '../../app/realtime'
import { downloadConversationFile, ensureConversation, getConversation, getConversationMessages, listConversations, readConversation, sendConversationMessage, uploadConversationFile } from '../../services/api/conversations'
import { MarketplaceError, MarketplaceShell } from '../suppliers/MarketplaceShell'
import { SupplierIntro } from '../suppliers/SupplierStudio'
import { formatQuoteDate, quoteRequestId } from '../requests/QuoteRequestFacts'
import { commerceError, CursorPager, deniedCommerce, QueryState, useCommerceQuery, useOperationId } from './commerceUi'
import { createConversationAccessGate, type ConversationGateState } from './conversationAccessGate'
import { readFileBase64, savePrivateFile, validPrivateFile } from './files'

export function ConversationsPage() {
  const session = useCloudSession()
  const [search] = useSearchParams()
  const requestId = search.get('requestId'), supplierId = search.get('supplierId')
  return <MarketplaceShell title="ข้อความ"><SupplierIntro eyebrow="KEEP THE CONVERSATION GOING" title="ทุกข้อตกลง เริ่มจากการคุยกัน" description="สนทนากับคู่ค้าในบริบทคำขอราคาเดียวกัน ห้องเดิมจะใช้ต่อเมื่อยืนยันคำสั่งผลิต" />{requestId && supplierId && quoteRequestId.test(requestId) && quoteRequestId.test(supplierId) && <OpenConversation requestId={requestId} supplierId={supplierId} />}<ConversationInbox key={`${session.appUserId}:${session.workspaceId}`} /></MarketplaceShell>
}
function OpenConversation({ requestId, supplierId }: { requestId: string; supplierId: string }) {
  const session = useCloudSession(), navigate = useNavigate()
  const open = useMutation({ mutationFn: () => ensureConversation(session.apiBaseUrl, session.getAccessToken(), { requestId, supplierId }), onSuccess: room => { void navigate(`/chat/${room.id}`) } })
  return <section className="commerce-card"><h2>เริ่มหรือเปิดห้องของคำขอนี้</h2><p>ข้อความและไฟล์ที่ส่งจะเห็นได้เฉพาะคู่ค้าและสมาชิกที่มีสิทธิ์ในงานนี้</p><button disabled={open.isPending} onClick={() => open.mutate()}>{open.isPending ? 'กำลังเปิด…' : 'เปิดห้องสนทนา'}</button>{open.isError && <MarketplaceError message={commerceError(open.error)} />}</section>
}
function ConversationInbox() {
  const session = useCloudSession()
  const [cursors, setCursors] = useState<string[]>([])
  const rooms = useCommerceQuery(['conversations', cursors.at(-1)], signal => listConversations(session.apiBaseUrl, session.getAccessToken(), cursors.at(-1) ?? null, signal))
  return <><QueryState query={rooms} />{rooms.isSuccess && <><div className="commerce-stack">{rooms.data.items.map(room => <article className="commerce-card commerce-heading" key={room.id}><div><h2><Link to={`/chat/${room.id}`}>{room.requestTitle}</Link></h2><p>{room.supplierName}</p><small>อัปเดต {formatQuoteDate(room.updatedAt)}{!room.canWrite ? ' · ดูอย่างเดียว' : ''}</small></div><span className="commerce-status">{room.unreadCount ? `${room.unreadCount} ข้อความที่ยังไม่อ่าน` : 'อ่านแล้ว'}</span></article>)}</div>{!rooms.data.items.length && <section className="commerce-card commerce-empty"><MessageCircle size={30} /><h2>ยังไม่มีห้องสนทนา</h2><p>เปิดห้องจากคำขอราคาหรือใบเสนอราคา เพื่อเริ่มคุยกับคู่ค้า</p></section>}<CursorPager cursors={cursors} next={rooms.data.nextCursor} setCursors={setCursors} /></>}<button disabled={rooms.isFetching} onClick={() => void rooms.refetch()}>โหลดห้องล่าสุด</button></>
}
export function ConversationPage() {
  const { conversationId = '' } = useParams()
  const session = useCloudSession()
  return quoteRequestId.test(conversationId) ? <ConversationThread key={`${session.appUserId}:${session.workspaceId}:${conversationId}`} id={conversationId} /> : <MarketplaceShell title="ห้องสนทนา" navigationContext={{ role: 'shared' }}><Link to="/chat">กลับไปที่ข้อความทั้งหมด</Link><MarketplaceError message="ลิงก์ห้องสนทนาไม่ถูกต้อง" /></MarketplaceShell>
}
function ConversationThread({ id }: { id: string }) {
  const session = useCloudSession(), realtime = useContext(MarketplaceRealtimeContext), client = useQueryClient()
  const [cursors, setCursors] = useState<number[]>([])
  const [accessLost, setAccessLost] = useState(false)
  const [gateState, setGateState] = useState<ConversationGateState>('checking')
  const content = useRef<HTMLDivElement>(null)
  const stopSubscription = useRef<(() => void) | null>(null)
  const resumeAccess = useRef<(() => void) | null>(null)
  const gateReady = gateState === 'ready'
  const [connection, setConnection] = useState('กำลังเชื่อมต่อข้อความสด')
  const room = useCommerceQuery(['conversation', id], signal => getConversation(session.apiBaseUrl, session.getAccessToken(), id, signal), !accessLost)
  const messages = useCommerceQuery(['messages', id, cursors.at(-1)], signal => getConversationMessages(session.apiBaseUrl, session.getAccessToken(), id, cursors.at(-1) ?? null, signal), !accessLost && gateReady && room.isSuccess)
  const unread = useMutation({ mutationFn: (sequence: number) => readConversation(session.apiBaseUrl, session.getAccessToken(), id, sequence) })
  const unavailable = accessLost || deniedCommerce(room.error) || deniedCommerce(messages.error) || deniedCommerce(unread.error)
  const refresh = () => { void room.refetch(); void messages.refetch() }
  const topic = room.isSuccess ? room.data.realtimeTopic : undefined
  useEffect(() => {
    if (unavailable) { stopSubscription.current?.(); return }
    const prefix = ['cloud', session.appUserId, session.workspaceId, 'commerce']
    const gate = createConversationAccessGate({
      verify: signal => getConversation(session.apiBaseUrl, session.getAccessToken(), id, signal),
      isDenied: deniedCommerce,
      onState: state => {
        // Hide synchronously on lifecycle events, before React paints cached content.
        if (content.current) content.current.hidden = state !== 'ready'
        if (state !== 'ready') stopSubscription.current?.()
        setGateState(state)
      },
      onVerified: value => {
        session.getAccessToken()
        client.setQueryData([...prefix, 'conversation', id], value)
        void client.invalidateQueries({ queryKey: [...prefix, 'messages', id] })
      },
      onDenied: () => { setAccessLost(true); void client.cancelQueries({ queryKey: prefix }); client.removeQueries({ queryKey: prefix }) },
    })
    const update = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) gate.pause()
      else void gate.resume()
    }
    resumeAccess.current = update
    const pause = () => gate.pause()
    document.addEventListener('visibilitychange', update)
    window.addEventListener('focus', update)
    window.addEventListener('online', update)
    window.addEventListener('offline', pause)
    update()
    return () => {
      gate.dispose(); resumeAccess.current = null; stopSubscription.current?.()
      document.removeEventListener('visibilitychange', update)
      window.removeEventListener('focus', update)
      window.removeEventListener('online', update)
      window.removeEventListener('offline', pause)
    }
  }, [unavailable, id, client, session.apiBaseUrl, session.appUserId, session.workspaceId, session.accessToken, session.getAccessToken])
  useEffect(() => {
    if (unavailable) { setAccessLost(true); client.removeQueries({ queryKey: ['cloud', session.appUserId, session.workspaceId, 'commerce'], type: 'inactive' }); return }
    if (!realtime || !topic || !gateReady) return
    let active = true
    let subscribedOnce = false
    const channel = realtime.channel(topic, { config: { private: true } }).on('broadcast', { event: 'changed' }, () => {
      if (active) void client.invalidateQueries({ queryKey: ['cloud', session.appUserId, session.workspaceId, 'commerce'] })
    })
    void realtime.realtime.setAuth(session.getAccessToken()).then(() => { if (active) channel.subscribe(status => { if (active) setConnection(status === 'SUBSCRIBED' ? 'เชื่อมต่อข้อความสดแล้ว' : 'การเชื่อมต่อสดขัดข้อง ระบบจะโหลดข้อมูลเป็นระยะ'); if (active && status === 'SUBSCRIBED') { if (subscribedOnce) resumeAccess.current?.(); else { subscribedOnce = true; void client.invalidateQueries({ queryKey: ['cloud', session.appUserId, session.workspaceId, 'commerce'] }) } } }) }).catch(() => { if (active) setConnection('การเชื่อมต่อสดขัดข้อง ระบบจะโหลดข้อมูลเป็นระยะ') })
    const timer = setInterval(() => { if (active && document.visibilityState === 'visible') void client.invalidateQueries({ queryKey: ['cloud', session.appUserId, session.workspaceId, 'commerce'] }) }, 15_000)
    const stop = () => { if (!active) return; active = false; clearInterval(timer); void realtime.removeChannel(channel) }
    stopSubscription.current = stop
    return () => { stop(); if (stopSubscription.current === stop) stopSubscription.current = null }
  }, [realtime, topic, gateReady, unavailable, client, session.appUserId, session.workspaceId, session.accessToken, session.getAccessToken])
  useEffect(() => {
    if (gateReady && !unavailable && !cursors.length && messages.isSuccess && room.isSuccess && !unread.isPending) {
      const sequence = messages.data.items.at(-1)?.sequence
      if (sequence && sequence > Math.max(room.data.lastReadSequence, unread.data?.lastReadSequence ?? 0)) unread.mutate(sequence)
    }
  }, [messages.data, room.data, gateReady, unavailable, cursors.length])
  if (unavailable) return <MarketplaceShell title="ห้องสนทนา" navigationContext={{ role: 'shared' }}><Link to="/chat">กลับไปที่ข้อความทั้งหมด</Link><MarketplaceError message="สิทธิ์ในห้องนี้เปลี่ยนไป ข้อความและไฟล์ถูกปิดแล้ว" /></MarketplaceShell>
  return <MarketplaceShell title="ห้องสนทนา" navigationContext={{ role: room.isSuccess ? room.data.side ?? 'shared' : 'shared', supplierId: room.isSuccess && room.data.side === 'supplier' ? room.data.supplierId : undefined, activeTo: '/chat' }}><Link to="/chat">กลับไปที่ข้อความทั้งหมด</Link>{!gateReady && <section className="commerce-card"><p role="status">{gateState === 'paused' ? 'พักการแสดงข้อความขณะออฟไลน์หรือแท็บไม่ทำงาน' : gateState === 'failed' ? 'ตรวจสิทธิ์ห้องไม่สำเร็จ ข้อความถูกซ่อนไว้' : 'กำลังตรวจสิทธิ์ห้องก่อนแสดงข้อความ…'}</p><button onClick={() => resumeAccess.current?.()}>ตรวจสิทธิ์อีกครั้ง</button></section>}<div ref={content} hidden={!gateReady}><QueryState query={room} />{room.data && <><section className="commerce-card"><div className="commerce-heading"><div><h2>{room.data.requestTitle}</h2><p>{room.data.supplierName}</p></div><span className="commerce-status">{room.data.canWrite ? 'ห้องคู่ค้า' : 'ดูอย่างเดียว'}</span></div><p className="marketplace-muted" role="status">{connection}</p><button onClick={refresh} disabled={room.isFetching || messages.isFetching}>โหลดข้อความล่าสุด</button></section><QueryState query={messages} />{messages.isSuccess && <section className="commerce-card"><div className="commerce-actions"><button disabled={!messages.data.nextCursor} onClick={() => { if (messages.data.nextCursor) setCursors([...cursors, messages.data.nextCursor]) }}>ข้อความเก่ากว่า</button>{cursors.length > 0 && <button onClick={() => setCursors(cursors.slice(0, -1))}>ข้อความใหม่กว่า</button>}{cursors.length > 0 && <button onClick={() => setCursors([])}>กลับข้อความล่าสุด</button>}</div><ol className="commerce-message-list" aria-label="ข้อความสนทนา">{[...new Map(messages.data.items.map(m => [m.id, m])).values()].map(message => <li key={message.id} className={`commerce-message${message.senderId === session.appUserId ? ' is-own' : ''}`}><strong>{message.senderName}</strong>{message.body && <p>{message.body}</p>}<ul className="commerce-file-list">{message.attachments.map(file => <li key={file.id}><ChatFileButton roomId={id} file={file} onDenied={() => setAccessLost(true)} /></li>)}</ul><small>{formatQuoteDate(message.createdAt)}</small></li>)}</ol>{!messages.data.items.length && <p className="marketplace-muted">ยังไม่มีข้อความ เริ่มคุยรายละเอียดงานได้ที่นี่</p>}</section>}{unread.isError && <MarketplaceError message="บันทึกสถานะอ่านไม่สำเร็จ" retry={() => { const last = messages.data?.items.at(-1)?.sequence; if (last) unread.mutate(last) }} />}{room.data.canWrite && <MessageComposer enabled={gateReady} room={room.data} onDenied={() => setAccessLost(true)} onSent={() => { setCursors([]); refresh() }} />}</>}</div></MarketplaceShell>
}
function ChatFileButton({ roomId, file, onDenied }: { roomId: string; file: ConversationFile; onDenied(): void }) {
  const session = useCloudSession()
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const download = useMutation({ mutationFn: async () => { const result = await downloadConversationFile(session.apiBaseUrl, session.getAccessToken(), roomId, file.id); session.getAccessToken(); if (mounted.current) savePrivateFile(result.file, result.dataBase64) }, onError: error => { if (deniedCommerce(error)) onDenied() } })
  return <><button disabled={download.isPending} onClick={() => download.mutate()}>ดาวน์โหลด {file.name}</button>{download.isError && <span role="alert">{commerceError(download.error)}</span>}</>
}
function MessageComposer({ room, enabled, onSent, onDenied }: { enabled: boolean; room: Conversation; onSent(): void; onDenied(): void }) {
  const session = useCloudSession()
  const [body, setBody] = useState(''), [attachments, setAttachments] = useState<ConversationFile[]>([]), [file, setFile] = useState<File | null>(null), [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null), alive = useRef(true), canAct = useRef(enabled)
  canAct.current = enabled
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const operation = useOperationId(), uploadOperation = useOperationId()
  const send = useMutation({ mutationFn: () => { if (!canAct.current) throw new Error('ตรวจสิทธิ์ห้องก่อนส่ง'); const payload = { body: body.trim(), attachmentIds: attachments.map(a => a.id) }; return sendConversationMessage(session.apiBaseUrl, session.getAccessToken(), room.id, { ...payload, operationId: operation(payload) }) }, onSuccess: () => { if (alive.current) { operation.reset(); setBody(''); setAttachments([]); onSent() } }, onError: e => { if (deniedCommerce(e)) onDenied() } })
  const upload = useMutation({ mutationFn: async () => { if (!file || !validPrivateFile(file)) throw new Error('เลือก PDF, PNG หรือ JPEG ขนาดไม่เกิน 2 MiB และชื่อไม่เกิน 120 ตัวอักษร'); const dataBase64 = await readFileBase64(file); if (!alive.current || !canAct.current) throw new Error('ตรวจสิทธิ์ห้องก่อนแนบไฟล์'); const payload = { name: file.name, mimeType: file.type as UploadConversationFileInput['mimeType'], dataBase64 }; return uploadConversationFile(session.apiBaseUrl, session.getAccessToken(), room.id, { ...payload, operationId: uploadOperation(payload) }) }, onSuccess: result => { if (alive.current) { uploadOperation.reset(); setAttachments(old => [...new Map([...old, result].map(a => [a.id, a])).values()]); setFile(null); if (input.current) input.current.value = '' } }, onError: e => { if (deniedCommerce(e)) onDenied() } })
  const busy = !enabled || send.isPending || upload.isPending
  const submit = (e: FormEvent) => { e.preventDefault(); if (!body.trim() && !attachments.length) { setError('พิมพ์ข้อความหรือแนบไฟล์ก่อนส่ง'); return } setError(''); send.mutate() }
  return <section className="commerce-card"><form className="commerce-form" onSubmit={submit}><label>ข้อความถึงคู่ค้า<textarea disabled={busy} rows={4} maxLength={4000} value={body} onChange={e => setBody(e.target.value)} /></label><div className="commerce-actions"><button className="commerce-primary" disabled={busy || (!body.trim() && !attachments.length)}>{send.isPending ? 'กำลังส่ง…' : send.isError ? 'ลองส่งข้อความเดิมอีกครั้ง' : 'ส่งข้อความ'}</button></div></form>{(send.isError || upload.isError || error) && <MarketplaceError message={error || commerceError(send.error ?? upload.error)} />}<div className="commerce-form"><label>แนบไฟล์ PDF, PNG หรือ JPEG (2 MiB ต่อไฟล์ สูงสุด 3 ไฟล์)<input ref={input} type="file" accept="application/pdf,image/png,image/jpeg" disabled={busy || attachments.length >= 3} onChange={e => setFile(e.target.files?.[0] ?? null)} /></label><button disabled={busy || !file || attachments.length >= 3} onClick={() => upload.mutate()}>{upload.isPending ? 'กำลังแนบ…' : 'แนบไฟล์ที่เลือก'}</button><ul className="commerce-file-list">{attachments.map(a => <li key={a.id}>{a.name} <button disabled={busy} onClick={() => setAttachments(attachments.filter(f => f.id !== a.id))}>นำออกจากข้อความ</button></li>)}</ul><p className="marketplace-muted">ไฟล์จะแนบกับข้อความเมื่อกดส่ง ไม่เผยแพร่ต่อสาธารณะ</p></div></section>
}
