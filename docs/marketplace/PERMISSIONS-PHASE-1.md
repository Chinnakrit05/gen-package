# สิทธิ์ปัจจุบันสำหรับรายการงานและ Editor

รุ่น **b-phase0-r1** สำหรับ 0-B2 ตรวจจาก source/RPC และชุดทดสอบเดิมบน base fb55f36 ส่วน SQL runtime integration ยังไม่ได้รันในรอบนี้ สถานะพร้อมให้ A review ไม่ใช่การเปิดสิทธิ์ Marketplace/Admin

## Actor และขอบเขต

Browser ส่ง bearer token API ยืนยันผ่าน Supabase Auth แล้ว resolve เป็น app user ที่ active ข้อมูล user/workspace/role ที่ client ตั้งเองไม่ทำให้ได้สิทธิ์เพิ่ม ตาราง app_private ไม่เปิดให้ anon/authenticated อ่านเขียนโดยตรง API ใช้ service role จึงต้องตรวจ actor/membership ใน RPC ตามที่มีอยู่

- bootstrap ได้ user และ personalWorkspace; /me ได้เฉพาะ workspaces ที่ actor เป็นสมาชิก
- Project detail ผูก workspace ตาม project จริง ไม่ใช้ activeWorkspaceId ใน browser เป็นหลักฐานสิทธิ์
- owner_user_id แสดงเจ้าของ workspace ส่วนการตรวจการเข้าถึงใช้ workspace_members.role
- สิทธิ์เป็นระดับ workspace สมาชิกที่อ่านได้เห็นงานใน workspace นั้น ไม่ได้จำกัดเฉพาะ created_by ของตน
- ไม่มี API จัดการสมาชิก/เพิ่มตัวเองเป็น owner หรือเปิดสิทธิ์โรงงานใน Phase 1

## Matrix จาก implementation

ตารางนี้สมมติ token ถูกต้อง บัญชี active และ resource อยู่ใน workspace ที่ระบุ

| การทำงาน | owner | editor | viewer | คนนอก workspace |
|---|---|---|---|---|
| /me ของตน | ได้ | ได้ | ได้ | ได้เฉพาะข้อมูลตน |
| List projects | ได้ | ได้ | ได้ | ไม่ได้ |
| Read project/document | ได้ | ได้ | ได้ | ไม่ได้ |
| Create project | ได้ | ได้ | ไม่ได้ | ไม่ได้ |
| Save project | ได้ | ได้ | ไม่ได้ | ไม่ได้ |
| Delete project | ได้ | ได้ | ไม่ได้ | ไม่ได้ |
| Read thumbnail meta/body | ได้ | ได้ | ได้ | ไม่ได้ |
| Put thumbnail | ได้ | ได้ | ไม่ได้ | ไม่ได้ |
| Read asset status / ready download tickets | ได้ตาม asset workspace | ได้ตาม asset workspace | ได้ตาม asset workspace | ไม่ได้ |
| Create/renew/complete asset upload | ได้ตามกติกา asset เดิม | ได้ตามกติกา asset เดิม | ไม่ได้ | ไม่ได้ |
| ให้ตนเป็น Marketplace manager / Platform Admin | ไม่มี flow นี้ | ไม่มี flow นี้ | ไม่มี flow นี้ | ไม่มี flow นี้ |

การลบปัจจุบัน owner และ editor ทำได้ ไม่ใช่ owner อย่างเดียว หากต้องการเปลี่ยนเป็นนโยบายอื่นต้อง review แยก ห้ามเปลี่ยนสิทธิ์เดิมเพียงเพราะย้ายหน้า

กรณีไม่มีสิทธิ์ workspace หรือ viewer เขียน RPC ใช้ PROJECT_NOT_FOUND ซึ่ง API map เป็น 404 NOT_FOUND ไม่คืน 403 FORBIDDEN แยกให้เดา resource ได้ A ควรแสดงปุ่ม read-only จาก membership จริงและรองรับ 404 จากคำสั่งที่เคยอนุญาตแต่สิทธิ์เพิ่งถูกถอน

## เงื่อนไขการคืนข้อมูล

- List ตรวจ workspace ก่อนคืนรายการ และไม่รวมงาน soft-deleted
- Detail ไม่พบ/ถูกลบ/ไม่มีสิทธิ์ ไม่คืน project อื่นแทน
- Thumbnail batch ตรวจสิทธิ์ workspace แต่ project ID ที่ไม่อยู่ใน workspace นั้นหรือไม่มีภาพจะถูกละจากผลลัพธ์ ไม่มี bytes ของอีก workspace หลุดออกมา
- Batch ที่ขอ workspace ของตนพร้อม ID ต่าง workspace อาจตอบ 200 กับ items ว่าง นี่ไม่ใช่การอนุญาตอ่าน project ต่าง workspace
- Metadata thumbnail เป็น optional; เมื่อ meta service ล้มรายการยังกลับมาได้ การไม่มีภาพไม่ใช่การไม่มีสิทธิ์แก้งาน
- Download assets ใช้ flow signed tickets เดิม ตรวจสิทธิ์ไฟล์และสถานะ ready แยกจากการมี URL รูปใน cache
- สิทธิ์ export ใช้ billing/entitlements/export-authorizations เดิม ไม่ให้สิทธิ์ผลิตจากการเห็น preview และไม่เปลี่ยนนโยบายในรอบแยก routes

## บัญชีและ session ผิดปกติ

| สถานการณ์ | พฤติกรรม API ปัจจุบัน | ข้อกำหนดสำหรับ A |
|---|---|---|
| ไม่มี Authorization header | 401 AUTH_REQUIRED เมื่อ config พร้อม | ให้ login โดยไม่ใช้ local demo gate แทน |
| Bearer ผิดรูปแบบ/Token หมดอายุ/ไม่ถูกต้อง | 401 SESSION_INVALID | auth SDK จัดการ session; รักษาร่างและปลายทางที่ปลอดภัย |
| บัญชี suspended/deleted | 403 USER_NOT_ACTIVE | ไม่แสดงข้อมูล cache ก่อนตรวจสถานะ ไม่วน retry แบบไม่จบ |
| ไม่มีสมาชิก workspace | 404 NOT_FOUND ของ project APIs | อย่า fallback ไปเปิดงานอื่นหรือสร้าง workspace/สมาชิกจำลอง |
| สมาชิกถูกถอดขณะเปิดหน้า | คำขอถัดไปตรวจ membership ใหม่ | ยุติ query/queue ที่ไม่ควรทำต่อและจัดการร่างเดิมอย่างชัดเจน |
| auth/database ไม่พร้อม | 503 ตาม contract | แยกจากการไม่มีสมาชิก ห้ามล้าง draft อัตโนมัติ |

การตรวจฝั่ง API ไม่ลบข้อมูลที่เคยดาวน์โหลดหรือ cache ไปแล้ว การเปลี่ยนหน้า/บัญชีจึงต้องมี lifecycle ฝั่ง frontend ด้วย

## ขอบเขต cache, draft และ operation

- แยก mode local-demo/cloud, appUserId และ workspaceId; รายการและภาพเพิ่ม projectId/version ตามความเหมาะสม
- Request ที่เริ่มในบัญชี/งานหนึ่งต้องไม่เปลี่ยนไปใช้ access token ของอีกบัญชีตอน retry
- operationId scoped ต่อ actor/workspace ไม่ใช่ token สิทธิ์ และอีก actor ที่มีสิทธิ์เขียนในทีมเดียวกันอาจสร้าง operation ใหม่ด้วย UUID เดียวกันได้ ห้ามคาดหวังว่า API จะรู้ว่า intent นี้มาจาก UI บัญชีเก่า
- เมื่อเปลี่ยนบริบท abort หรือ ignore response เก่า รวมถึงการเขียน query cache หลัง unmount
- แสดงข้อมูลเฉพาะเมื่อ session และ workspace ของ response ตรงบริบทที่ผ่านการตรวจ ไม่แสดง cache ของบัญชีเก่าระหว่าง loading
- การ logout ไม่จำเป็นต้องลบร่างที่ยังรอ sync แต่บัญชีถัดไปต้องไม่แสดงหรือส่งร่างของเจ้าของเก่า
- ร่างที่กู้จาก IndexedDB ยังต้องผ่าน schema และ authorization เดิม การมีไฟล์ร่างไม่เพิ่มสิทธิ์ API

## จุดตรวจและระดับหลักฐาน

อ่าน [identity/workspaces SQL](../../supabase/migrations/20260918000200_identity_workspaces.sql), [project authorization/RPC](../../supabase/migrations/20260918000300_projects.sql), [asset/RPC overrides](../../supabase/migrations/20260918000400_assets.sql) และ [thumbnail SQL](../../supabase/migrations/20261024000800_project_thumbnails.sql)

ชุด pgTAP 0002/0003/0004/0008 มีการตรวจ identity, project/asset และ thumbnail authorization ส่วน integration tests มี bootstrap/create/save concurrency และ asset lifecycle แต่ **ยังไม่ได้รัน SQL/real Auth ในรอบนี้เพราะยังไม่มี local stack ของ gen-package และพอร์ต 54322 เป็นของอีกโปรเจกต์ (เปิด Docker ได้แล้ว)** ผล unit tests ที่บันทึกแยกใน evidence ใช้ dependencies จำลอง ไม่ใช่หลักฐานว่า schema/credentials บน Cloud พร้อม

## สิทธิ์ที่จะเพิ่มหลัง Phase 1

Marketplace membership และ Platform Staff เป็นสิทธิ์แยกจาก owner/editor/viewer เดิม ผู้รับผลิตได้สิทธิ์ผ่านคำขอ/ห้อง/คำสั่งผลิต ไม่ถูกเพิ่มเข้า workspace ผู้ซื้อ อำนาจส่งข้อเสนอ ยืนยันงาน อนุมัติแบบ และรับรองเงินต้องมอบหมายตามฝ่าย การอนุมัติ/พักรับงานของโรงงานและ Admin ขั้นต่ำเริ่มในเฟส 2 ตามแผน

ส่วนนี้เป็นขอบเขตระยะถัดไป ไม่มี migration หรือ role ใหม่ถูกเพิ่มจากงาน 0-B2
