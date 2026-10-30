# API contract สำหรับการแยก Editor

รุ่น **b-phase0-r1** วันที่ 31 ตุลาคม 2026 ตรวจจาก base commit **fb55f36897aa47b235afdcf219c995a50a7c64e8** โดย B สถานะ **พร้อมให้ A review** ยังไม่ผ่าน 0-J1/0-J2 ร่วม และยังไม่ได้เปลี่ยน API หรือ DTO ในโค้ด

เอกสารนี้อธิบาย implementation ปัจจุบัน ส่วนข้อเสนอ UI ระบุแยกไว้ท้ายเอกสาร ตัวอย่างพร้อมใช้ใน [fixtures/phase-1.json](fixtures/phase-1.json) เป็นข้อมูลสังเคราะห์ ไม่ใช่ผลเรียก Cloud จริง

## แหล่งอ้างอิง

- [HTTP router](../../server/http/router.ts), [body parser](../../server/http/body.ts), [error types](../../shared/contracts/errors.ts)
- [Auth DTO](../../shared/contracts/auth.ts), [project DTO](../../shared/contracts/projects.ts)
- [Zod validation](../../server/modules/projects/validation.ts), [repository mapping](../../server/adapters/supabase/projectRepository.ts)
- [Session verification](../../server/adapters/supabase/sessionService.ts), [pagination/canonical hash](../../server/modules/projects/canonical.ts)
- [Permissions](PERMISSIONS-PHASE-1.md), [fixture/environment guide](FIXTURES-PHASE-1.md)

## HTTP และ session

Base path คือ /api/v1 ทุก endpoint ธุรกิจใช้ Authorization: Bearer ตาม token ที่ auth SDK คืน และ Accept: application/json การเขียน JSON ใช้ Content-Type: application/json; charset=utf-8 ใช้ได้ตาม parser ไม่รับ media type อื่นมาแทน

ผลสำเร็จเป็น object ที่มี data และ requestId ผลผิดพลาดมี error { code, message, details? } และ requestId Server ส่ง x-request-id และ cache-control: no-store อย่าใช้ข้อความภาษาไทยเป็นเงื่อนไขแยกสถานะ ให้ใช้ code/status และเก็บ requestId เพื่ออ้างอิงปัญหา

Client requestApi คืน payload.data แล้ว ไม่ต้อง unwrap data ซ้ำ ข้อผิดพลาดเป็น ApiClientError ที่มี status/code/details; NETWORK_ERROR เป็น code ฝั่ง client เมื่อ fetch ไม่ถึง server มี status 0 ส่วน AbortError ต้องแยกจากการเรียกล้มเหลว

Auth SDK ฝั่ง browser ใช้ PKCE, persistSession, autoRefreshToken และ detectSessionInUrl อยู่แล้ว Bootstrap ยืนยัน token ผ่าน auth.getUser แล้ว map identity เป็น app user ฝั่ง server อย่าใช้ user ID ใน body หรือ local-demo flag แทน actor

## Endpoint ที่ใช้ต่อ

| Method และ path | Input | Success และข้อมูล |
|---|---|---|
| POST /session/bootstrap | Bearer token; client เดิมส่ง body {} | 200 SessionBootstrapData: user และ personalWorkspace |
| GET /me | Bearer token | 200 MeData: user และ workspaces[] พร้อม role |
| GET /projects | query workspaceId จำเป็น; cursor/limit ไม่จำเป็น | 200 ProjectPage: items และ nextCursor |
| GET /projects/:id | project UUID ใน path | 200 CloudProject พร้อม document/assets |
| POST /projects | workspaceId, operationId, name, documentSchemaVersion: 1, document | 201 CloudProject รวม id ที่ server สร้าง |
| PUT /projects/:id | operationId, expectedRevision, name, documentSchemaVersion: 1, document | 200 SaveReceipt: projectId, revision, updatedAt, operationId |
| DELETE /projects/:id | ไม่มี body; X-Expected-Revision และ Idempotency-Key จำเป็น | 200 DeleteReceipt: projectId, revision, deletedAt, operationId |
| POST /projects/thumbnails | workspaceId และ projectIds[] | 200 data.items เป็นตัวรูปภาพย่อ |
| PUT /projects/:id/thumbnail | mimeType, imageBase64, kind, label | 200 projectId และ version ของภาพ |

Bootstrap รับ token เป็นแหล่ง identity; body ไม่ใช่จุดตั้ง actor/profile/workspace การเรียกซ้ำใช้ personal workspace เดิม /me เป็นแหล่ง membership ที่หน้าเลือก workspace ใช้ได้จริง Bootstrap ยังไม่ได้คืนรายการสมาชิกโรงงานหรือสิทธิ์ Admin

GET detail, save และ delete ไม่รับ workspaceId เพื่อกำหนดเจ้าของงานใหม่ server ใช้ workspace ของ project ที่อ่านจากฐานข้อมูล แล้วตรวจ actor อีกครั้ง ไม่มี API สร้างทีม/สมัครโรงงานในขอบเขตนี้

## Pagination

- HTTP limit เป็นจำนวนเต็ม 1–100 ค่าเริ่มต้น 50 ไม่ต้องเปลี่ยนค่า server เพื่อใช้หน้าละ 24 รายการ
- workspaceId เป็น UUID; cursor เป็น string ไม่เกิน 1,000 ตัวอักษร ปฏิบัติต่อ cursor เป็นค่า opaque และส่งค่าที่ server คืนตามเดิม
- ไม่รับ query อื่นนอกจาก workspaceId/cursor/limit และไม่รับ query key ซ้ำ
- เรียง updatedAt DESC แล้ว id DESC; nextCursor อาจมีแม้จำนวน items เท่ากับ limit และเป็น null เมื่อไม่มีหน้าถัดไป
- เปลี่ยน workspace, บัญชี หรือขนาดหน้า ให้เริ่ม pagination ใหม่ แยก query key ตามบริบท
- รายการที่แก้ไขระหว่างเปิดหลายหน้าอาจเปลี่ยนลำดับได้ นี่ไม่ใช่ snapshot ของทั้งรายการ ให้รวม/อัปเดตด้วย project id และ refresh ตามการใช้งาน
- ProjectSummary มี id, workspaceId, name, revision, updatedAt และ thumbnail? เท่านั้น ไม่มี document/history/assets
- Repository ขอ limit+1 เพื่อตัดสินหน้าถัดไป แล้วตัด response กลับมาไม่เกิน limit อย่าอ่านทุกหน้าตั้งแต่เปิด gallery

## Thumbnail

- Summary อาจไม่มี thumbnail หรือมีค่า null ให้ใช้ placeholder; meta มี version, kind, label
- หากอ่าน meta ไม่สำเร็จ service คืนรายการงานต่อได้โดยไม่มี meta รายการยังใช้งานได้
- POST batch รับ projectIds ไม่ซ้ำ 1–24 UUID; แบ่ง batch เองเมื่อจำเป็น
- ผล items มี projectId, version, mimeType, imageBase64 ไม่มี data URL prefix
- งานไม่มีภาพ, ถูกลบ หรือ ID ไม่อยู่ใน workspace ที่ขอ จะไม่อยู่ในผล items อย่าถือว่าลำดับ/จำนวนผลตรงกับ input
- หากไม่มีสิทธิ์ใน workspace ของ batch ให้ใช้ error ตาม contract ไม่ใช่ fallback ไปดึง workspace อื่น
- MIME ของ thumbnail เป็น image/webp หรือ image/jpeg; version แปลงเป็น ISO timestamp โดย repository ใช้ version เพื่อเทียบ cache แยกจาก project revision
- PUT รับ base64 เปล่า สูงสุด 65,536 decoded bytes มีการตรวจ MIME/magic bytes, kind เป็น box/vessel/pouch/card และ label trim แล้ว 1–60 ตัวอักษร
- ภาพย่อเป็น preview ไม่ใช่หลักฐานอนุมัติแบบหรือไฟล์ผลิต

## Document และการสร้างงาน

Cloud documentSchemaVersion เป็น 1 ส่วนเลข schema ในไฟล์ .genpkg.json เป็นคนละระบบ ห้ามใช้เลข 25 แทน 1 ใน request Cloud

name trim แล้ว 1–60 ตัวอักษร document เป็น strict schema ปัจจุบัน: live, qty, fillColor, decos, history, histIdx และ optional fields ตาม validator ตัวอย่างกล่องขั้นต่ำที่ผ่าน schema อยู่ใน fixture ไม่สร้าง document โดยเติมค่าเองใน gallery

โค้ดสร้างแบบจริงอยู่ในขอบเขต Editor เมื่อเข้าทาง /editor/new จึงโหลดเครื่องมือ สร้าง document เรียก POST และเปลี่ยน URL เป็น id ที่ได้ A ต้องไม่ส่ง GET /projects/new หรือสร้าง project ทดแทนเมื่อ GET id เดิมล้มเหลว

Asset metadata ของ detail เป็นข้อมูลอ้างอิง ไม่ใช่ไฟล์ภาพ base64 ต้องใช้ flow download tickets เดิมเมื่อต้องแสดงไฟล์จริง ดู API assets ใน client/service เดิมและ permission guide การย้าย routes ไม่เปลี่ยน export/billing authorization

## Retry และ revision

- สร้าง operationId เป็น UUID ต่อหนึ่งความตั้งใจสร้าง/บันทึก/ลบ เก็บ intent กับ payload ไว้จนรู้ผล
- Network timeout หรือ response หาย: ลองใหม่ด้วย operationId และ payload เดิม Server คืนผล operation เดิมได้ ไม่สร้างเพิ่มหรือบันทึกเพิ่ม
- เปลี่ยน payload ภายใต้ operationId เดิมตอบ 409 IDEMPOTENCY_KEY_REUSED ให้จัดการเป็นข้อผิดพลาดของ intent อย่าวน retry ด้วย key เดิม
- การแก้ไขครั้งใหม่หลังทราบผลแล้วใช้ operationId ใหม่กับ expectedRevision ล่าสุด
- Save ไม่ส่ง projectId ใน body เพราะมาจาก path; ถ้าใส่เพิ่ม strict validation อาจปฏิเสธ
- Delete ใช้ Idempotency-Key header สำหรับ operationId, X-Expected-Revision header สำหรับ revision ไม่ใช้ If-Match และไม่ใส่ JSON body
- 409 REVISION_CONFLICT อาจมี details.currentRevision ให้รักษาร่างและแจ้งผู้ใช้ ไม่เพิ่ม revision หรือเขียนทับเอกสารใหม่เอง
- Save receipt ไม่คืน document ทั้งก้อน ให้ปรับ revision/updatedAt ของข้อมูลที่บันทึกจริง โดยไม่อ้างว่าร่างรุ่นที่แก้ต่อหลังส่ง request ถูกซิงก์แล้ว

Operation ถูก scope ด้วย workspace + actor + operationId ไม่ใช่กุญแจสิทธิ์แบบ global ถ้าเปลี่ยนไปอีกบัญชีที่มีสิทธิ์เขียนใน workspace เดียวกัน server อาจรับเป็น operation ของอีก actor ได้ หน้าเว็บจึงต้องไม่ replay intent เก่าด้วย token บัญชีใหม่ และต้องผูก draft/queue กับเจ้าของเดิม

## Errors ที่หน้าใหม่ต้องรองรับ

| HTTP / code | ความหมายและการจัดการ |
|---|---|
| 401 AUTH_REQUIRED | ไม่มี Authorization header แบบ string เมื่อ server config พร้อม |
| 401 SESSION_INVALID | Bearer header รูปแบบผิด, token ใช้ไม่ได้/หมดอายุ หรือ identity ยังไม่ bootstrap; ให้ auth flow จัดการ ไม่ล้างงานร่าง |
| 403 USER_NOT_ACTIVE | บัญชีถูกระงับ/ลบตามสถานะ server |
| 404 NOT_FOUND | ไม่พบงาน/ไม่มีสิทธิ์ workspace รวม viewer ที่พยายามเขียน หรือ endpoint ไม่มีอยู่ |
| 409 REVISION_CONFLICT | เก็บร่างและแสดง conflict; อาจมี details.currentRevision |
| 409 IDEMPOTENCY_KEY_REUSED | key เดิมกับคนละ payload/operation |
| 422 VALIDATION_ERROR | UUID/query/body/thumbnail ผิด schema |
| 422 ASSET_NOT_READY | ภาพอ้างอิงยังไม่พร้อมหรือใช้ไม่ได้ใน document |
| 400 INVALID_REQUEST | JSON ผิดรูปแบบ หรือ DELETE มี body ตามเงื่อนไข parser |
| 413 BODY_TOO_LARGE | JSON เกิน 1 MiB |
| 415 UNSUPPORTED_MEDIA_TYPE | write ไม่ใช้ application/json ตาม parser |
| 405 METHOD_NOT_ALLOWED | method ไม่รองรับ; server มี Allow header |
| 503 CONFIGURATION_ERROR | server ยังไม่มีบริการ/config ที่ต้องใช้ |
| 503 DEPENDENCY_UNAVAILABLE | auth/database หรือข้อมูลจาก provider ไม่พร้อม ให้ retry แบบรักษา intent |

ลำดับ validation/auth แตกต่างกันตาม endpoint ไม่สัญญาว่า request ที่ผิดหลายอย่างจะได้ error ตัวใดก่อน และเมื่อ config ขาดอาจได้ 503 ก่อนตรวจ token

NETWORK_ERROR และ INVALID_RESPONSE เป็น code ฝั่ง client ไม่ใช่ค่าที่อยู่ใน server error union ห้ามสรุปว่าการกดสร้าง/บันทึกไม่สำเร็จฝั่งฐานข้อมูลเพียงเพราะ client ไม่ได้รับ response

## ข้อเสนอจาก B ที่รอ A review ใน 0-J1

1. หน้า gallery เริ่ม limit=24 และโหลดเพิ่มเมื่อผู้ใช้ขอ สอดคล้อง thumbnail batch สูงสุด 24 โดยไม่เปลี่ยน API เดิม
2. ค่าเริ่มต้นหลัง login ใช้ personal workspace; workspace อื่นเลือกได้เฉพาะรายการใน /me
3. ใช้ /editor/new และ /editor/:projectId ตามแผน; A ยืนยัน route map และ return path ที่ต้องการจริง
4. Query/cache ผูก mode/account/workspace/project; abort/ignore response เก่าก่อนเปลี่ยนบริบท การ refresh token ของบัญชีเดิมไม่ควรล้างร่าง
5. ขณะออก Editor ต้องรักษาร่างอย่างต่อเนื่องใน IndexedDB และแยก local-saved กับ cloud-synced; A ระบุ UX กรณี offline/conflict/logout
6. Callback ใช้ PKCE ของ SDK เดิม รับ return path ภายในแอปที่ผ่านการตรวจ และไม่เพิ่ม token ลง returnTo เอง

นี่เป็นข้อเสนอของ B ไม่ใช่ผลตกลงแทน A ไม่ต้องเพิ่ม endpoint ใน Phase 1 จากผล audit ปัจจุบัน หาก A พบข้อมูลที่ขาด ให้ review ช่องว่างก่อนเปลี่ยน shared contract
