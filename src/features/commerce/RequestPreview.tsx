import { useState } from 'react'
import type { RequestPreview as RequestPreviewData } from '../../../shared/contracts/commerce'
import { useCloudSession } from '../../app/cloudSession'
import { getRequestPreview, type RequestPreviewTarget } from '../../services/api/commerce'
import { formatQuoteDate } from '../requests/QuoteRequestFacts'
import { QueryState, useCommerceQuery } from './commerceUi'

export function referencePreviewNotice(match: NonNullable<RequestPreviewData['preview']>['match']): string {
  return match === 'original_reference'
    ? 'ภาพอ้างอิงจากคำขอฉบับเดิม ไม่ใช่ภาพที่ยืนยันว่าตรงกับสเปกฉบับนี้ โปรดตรวจรายละเอียดสเปกและแบบตรวจที่คู่ค้าตกลงกัน'
    : 'ภาพอ้างอิงที่บันทึกไว้เมื่อเผยแพร่ ยังไม่สามารถยืนยันว่าภาพตรงกับสเปกฉบับนี้ โปรดตรวจรายละเอียดสเปกประกอบ'
}
export function RequestPreview({ target }: { target: RequestPreviewTarget }) {
  const session = useCloudSession()
  const preview = useCommerceQuery(['request-preview', target], signal => getRequestPreview(session.apiBaseUrl, session.getAccessToken(), target, signal))
  return <section className="commerce-card commerce-preview"><h2>ภาพอ้างอิงที่บันทึกไว้</h2><QueryState query={preview} />{preview.isSuccess && !preview.isFetching && (preview.data.preview ? <PreviewImage key={preview.data.preview.capturedAt + preview.data.preview.sourceRequestRevisionId} preview={preview.data.preview} /> : <div className="commerce-preview-empty"><p>ไม่มีภาพอ้างอิงที่บันทึกไว้สำหรับคำขอฉบับนี้</p><p className="marketplace-muted">ใช้รายละเอียดสเปกและแบบตรวจจากคู่ค้าเป็นหลัก ระบบไม่แทนภาพเก่าด้วยภาพงานปัจจุบัน</p></div>)}</section>
}
function PreviewImage({ preview }: { preview: NonNullable<RequestPreviewData['preview']> }) {
  const [failed, setFailed] = useState(false)
  return <><p className="marketplace-notice">{referencePreviewNotice(preview.match)}</p>{failed ? <p role="status">เปิดภาพอ้างอิงไม่ได้ กรุณาอ้างอิงสเปกและแบบตรวจ</p> : <figure><img src={`data:${preview.mimeType};base64,${preview.dataBase64}`} alt="ภาพอ้างอิงของบรรจุภัณฑ์ที่บันทึกไว้ ไม่ได้ยืนยันว่าตรงกับสเปก" onError={() => setFailed(true)} /><figcaption>ภาพอ้างอิง ไม่ใช่แบบอนุมัติผลิต</figcaption></figure>}<dl className="commerce-facts"><div><dt>ฉบับงานต้นทางที่คำขออ้างอิง</dt><dd>{preview.frozenRequestProjectRevision}</dd></div><div><dt>ฉบับงานล่าสุด ณ เวลาที่บันทึกภาพ</dt><dd>{preview.projectRevisionAtCapture}</dd></div><div><dt>ภาพย่ออัปเดตเมื่อ</dt><dd>{formatQuoteDate(preview.thumbnailUpdatedAt)}</dd></div><div><dt>บันทึกภาพอ้างอิงเมื่อ</dt><dd>{formatQuoteDate(preview.capturedAt)}</dd></div></dl><p className="commerce-stamp">ฉบับคำขอที่เก็บภาพต้นทาง: {preview.sourceRequestRevisionId}</p><p className="marketplace-muted">ไม่มีข้อมูลยืนยันฉบับงานที่ใช้สร้างภาพย่อนี้ จึงไม่รับรองความตรงกันแม้เลขฉบับงานจะเท่ากัน</p></>
}
