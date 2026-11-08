import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  SUPPLIER_REVIEW_DOCUMENT_LIMIT,
  SUPPLIER_REVIEW_DOCUMENT_MAX_BYTES,
  SUPPLIER_REVIEW_DOCUMENT_MIME_TYPES,
  type SupplierReviewDocument,
  type SupplierReviewDocumentUpload,
} from '../../../shared/contracts/marketplace'
import { SessionChangedError, useCloudSession } from '../../app/cloudSession'
import { ApiClientError } from '../../services/api/client'
import {
  addSupplierReviewDocument,
  getSupplierReviewDocument,
  listSupplierReviewDocuments,
  removeSupplierReviewDocument,
} from '../../services/api/marketplace'
import { MarketplaceError } from './MarketplaceShell'
import { supplierError } from './supplierUi'

const extensionMimes = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
} as const
const accept = [...SUPPLIER_REVIEW_DOCUMENT_MIME_TYPES, '.pdf', '.png', '.jpg', '.jpeg'].join(',')
const sizeLimit = SUPPLIER_REVIEW_DOCUMENT_MAX_BYTES / (1024 * 1024)
const filenameLimit = 120

type DocumentMime = SupplierReviewDocumentUpload['mimeType']
type UploadSelection = { file: File; name: string; mimeType: DocumentMime; operationId: string }
type DocumentAction = 'upload' | 'remove' | 'download'

function fileMime(name: string, type: string): DocumentMime | undefined {
  const extension = /\.([a-z]+)$/i.exec(name)?.[1].toLowerCase()
  const inferred = Object.entries(extensionMimes).find(([name]) => name === extension)?.[1]
  return inferred && (!type || type === inferred) ? inferred : undefined
}

function readBase64(file: File, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const reader = new FileReader()
    const abort = () => reader.abort()
    reader.onloadend = () => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) {
        reject(signal.reason)
        return
      }
      const prefix = ';base64,'
      const separator = typeof reader.result === 'string' ? reader.result.indexOf(prefix) : -1
      if (typeof reader.result !== 'string' || separator < 0) {
        reject(new Error('อ่านไฟล์ไม่สำเร็จ'))
        return
      }
      resolve(reader.result.slice(separator + prefix.length))
    }
    signal.addEventListener('abort', abort, { once: true })
    reader.readAsDataURL(file)
  })
}

function saveDownload(file: SupplierReviewDocument, dataBase64: string): void {
  const bytes = Uint8Array.from(atob(dataBase64), (character) => character.charCodeAt(0))
  if (bytes.length !== file.byteSize) throw new Error('ขนาดไฟล์ไม่ตรงกับเอกสาร')
  const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }))
  const link = document.createElement('a')
  link.href = blobUrl
  link.download = file.name
  link.hidden = true
  document.body.append(link)
  try {
    link.click()
  } finally {
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
  }
}

function unavailable(error: unknown): boolean {
  return error instanceof ApiClientError && [401, 403, 404].includes(error.status)
}

export function SupplierReviewDocuments({
  supplierId,
  asReviewer = false,
  canWrite = false,
  blocked = false,
  onWriteBusyChange,
}: {
  supplierId: string
  asReviewer?: boolean
  canWrite?: boolean
  blocked?: boolean
  onWriteBusyChange?(busy: boolean): void
}) {
  const session = useCloudSession()
  const list = useQuery({
    queryKey: ['cloud', session.appUserId, 'marketplace', 'supplier-review-documents', supplierId, asReviewer ? 'reviewer' : 'manager'],
    queryFn: ({ signal }) => listSupplierReviewDocuments(session.apiBaseUrl, session.getAccessToken(), supplierId, asReviewer, signal),
    gcTime: 0,
  })
  const [selection, setSelection] = useState<UploadSelection | null>(null)
  const [attemptedUpload, setAttemptedUpload] = useState(false)
  const [busy, setBusy] = useState<DocumentAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const running = useRef<{ controller: AbortController; action: DocumentAction } | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  useEffect(() => () => {
    const request = running.current
    running.current = null
    request?.controller.abort()
    if (request && request.action !== 'download') onWriteBusyChange?.(false)
  }, [onWriteBusyChange])

  const documents = list.isSuccess ? list.data.documents : []
  const atLimit = documents.length >= SUPPLIER_REVIEW_DOCUMENT_LIMIT
  const disabled = blocked || Boolean(busy) || !list.isSuccess || list.isFetching
  const reload = () => void list.refetch()

  const perform = async (
    action: DocumentAction,
    request: (signal: AbortSignal) => Promise<void>,
    fallback: string,
  ) => {
    if (disabled || running.current) return
    const controller = new AbortController()
    running.current = { controller, action }
    const write = action !== 'download'
    setBusy(action)
    setNotice(null)
    setError(null)
    if (write) onWriteBusyChange?.(true)
    try {
      await request(controller.signal)
    } catch (failure) {
      if (controller.signal.aborted || failure instanceof SessionChangedError) return
      setError(supplierError(failure, fallback))
      if (!write && unavailable(failure)) reload()
    } finally {
      if (running.current?.controller === controller) {
        running.current = null
        setBusy(null)
        if (write) {
          onWriteBusyChange?.(false)
          // The server may have committed the write before the browser received a response.
          reload()
        }
      }
    }
  }

  const selectFile = (file?: File) => {
    setSelection(null)
    setAttemptedUpload(false)
    setNotice(null)
    setError(null)
    if (!file) return
    const name = file.name.trim()
    const mimeType = fileMime(name, file.type)
    const invalidName = Array.from(name).length > filenameLimit || /[\/\\\p{Cc}]/u.test(name)
    if (invalidName || !mimeType || !file.size || file.size > SUPPLIER_REVIEW_DOCUMENT_MAX_BYTES) {
      if (picker.current) picker.current.value = ''
      setError(invalidName ? `ใช้ชื่อไฟล์ไม่เกิน ${filenameLimit} ตัวอักษรและนำเครื่องหมายทับออก`
        : `เลือกไฟล์ PDF, PNG หรือ JPEG ที่มีขนาดไม่เกิน ${sizeLimit} MiB ต่อไฟล์`)
      return
    }
    setSelection({ file, name, mimeType, operationId: crypto.randomUUID() })
  }

  const upload = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canWrite || !selection || (atLimit && !attemptedUpload)) return
    void perform('upload', async (signal) => {
      setAttemptedUpload(true)
      const dataBase64 = await readBase64(selection.file, signal)
      signal.throwIfAborted()
      await addSupplierReviewDocument(session.apiBaseUrl, session.getAccessToken(), supplierId, {
        operationId: selection.operationId,
        name: selection.name,
        mimeType: selection.mimeType,
        dataBase64,
      }, signal)
      signal.throwIfAborted()
      session.getAccessToken()
      setSelection(null)
      setAttemptedUpload(false)
      if (picker.current) picker.current.value = ''
      setNotice('แนบเอกสารแล้ว')
    }, 'แนบเอกสารไม่สำเร็จ ลองอัปโหลดไฟล์ที่เลือกอีกครั้ง')
  }

  const download = (file: SupplierReviewDocument) => void perform('download', async (signal) => {
    const result = await getSupplierReviewDocument(session.apiBaseUrl, session.getAccessToken(), supplierId, file.id, asReviewer, signal)
    signal.throwIfAborted()
    session.getAccessToken()
    saveDownload(result.document, result.dataBase64)
  }, 'ดาวน์โหลดเอกสารไม่สำเร็จ')

  const remove = (file: SupplierReviewDocument) => {
    if (!canWrite || !window.confirm(`นำไฟล์ ${file.name} ออกจากเอกสารประกอบใช่ไหม?`)) return
    void perform('remove', async (signal) => {
      await removeSupplierReviewDocument(session.apiBaseUrl, session.getAccessToken(), supplierId, file.id, signal)
      signal.throwIfAborted()
      session.getAccessToken()
      setNotice('นำเอกสารออกแล้ว')
    }, 'นำเอกสารออกไม่สำเร็จ')
  }

  return (
    <div className="marketplace-documents" aria-busy={Boolean(busy)}>
      {list.isPending && <p role="status">กำลังโหลดรายการเอกสาร…</p>}
      {list.isError && <MarketplaceError
        message={unavailable(list.error) ? 'บัญชีนี้เปิดเอกสารประกอบไม่ได้' : 'โหลดรายการเอกสารไม่สำเร็จ'}
        retry={unavailable(list.error) ? undefined : reload}
      />}
      {error && <MarketplaceError message={error} />}
      {notice && <p className="marketplace-notice" role="status">{notice}</p>}
      {list.isSuccess && (
        <>
          {documents.length === 0 ? <p className="marketplace-muted">ยังไม่มีเอกสารประกอบ</p> : (
            <ul className="marketplace-list">
              {documents.map((file) => (
                <li className="marketplace-document-row" key={file.id}>
                  <div className="marketplace-description">
                    <strong>{file.name}</strong>
                    <p className="marketplace-muted">{(file.byteSize / 1024).toLocaleString('th-TH', { maximumFractionDigits: 1 })} KiB</p>
                  </div>
                  <div className="marketplace-meta">
                    <button type="button" aria-label={`ดาวน์โหลด ${file.name}`} disabled={disabled} onClick={() => download(file)}>ดาวน์โหลด</button>
                    {canWrite && <button type="button" aria-label={`นำไฟล์ ${file.name} ออก`} disabled={disabled} onClick={() => remove(file)}>นำออก</button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {canWrite && (
            <form className="marketplace-form" onSubmit={upload}>
              <p>แนบได้สูงสุด {SUPPLIER_REVIEW_DOCUMENT_LIMIT} ไฟล์ รองรับ PDF, PNG และ JPEG ขนาดไม่เกิน {sizeLimit} MiB ต่อไฟล์</p>
              <p className="marketplace-muted">แนบแล้ว {documents.length} จาก {SUPPLIER_REVIEW_DOCUMENT_LIMIT} ไฟล์</p>
              <label>
                เลือกเอกสารประกอบ
                <input ref={picker} type="file" accept={accept} disabled={disabled || atLimit}
                  onChange={(event) => selectFile(event.currentTarget.files?.[0])} />
              </label>
              <button type="submit" className="primary" disabled={disabled || !selection || (atLimit && !attemptedUpload)}>
                {busy === 'upload' ? 'กำลังแนบเอกสาร…' : attemptedUpload ? 'ลองแนบเอกสารอีกครั้ง' : 'แนบเอกสาร'}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  )
}
