# Phase 1 backend acceptance evidence

อัปเดตล่าสุด: 18 กันยายน 2026

สถานะรวม: **ผ่าน local acceptance; ยังไม่อนุมัติ staging/public pilot**

คำจำกัดความ: `PASS` คือรันจริงบน local Supabase/Chrome หรือ test layer ที่ระบุ, `PARTIAL` คือผ่านเฉพาะบาง environment/กรณี, `NOT RUN` คือยังไม่มี staging credentials/deployment access ผล mock ไม่ถูกนับแทน service จริง

## Evidence ที่รันล่าสุด

| คำสั่ง | ผล |
| --- | --- |
| `npm test` | PASS — 38 files, 410 tests |
| `npm run db:test` | PASS — 5 pgTAP files, 133 assertions |
| `npm run db:test:integration` | PASS — 6 files, 9 tests บน local PostgreSQL/Auth/Storage จริง |
| `npm run db:test:restore` | PASS — isolated `app_private` restore + sample Storage object SHA-256 |
| `npm run test:e2e:local` | PASS — local Auth/API/DB/Storage ผ่าน headless Chrome |
| `npm run build` | PASS — API bundles, TypeScript และ Vite production build |

## Auth และ tenant

| Requirement | สถานะ | Evidence / ขอบเขต |
| --- | --- | --- |
| ไม่มี/ปลอม bearer token ถูกปฏิเสธ | PASS local | auth integration และ cloud HTTP smoke คืน 401 JSON |
| expired/wrong remote-project token | PARTIAL | ใช้ `auth.getUser` แบบ fail-closed; forged local ผ่าน แต่ token จากคนละ remote project ยัง NOT RUN |
| browser role เรียก private tables/RPC ไม่ได้ | PASS local | pgTAP ตรวจ grants/default ACL/RLS; server-only RPC เท่านั้นที่ execute ได้ |
| tenant A อ่าน/แก้ project/asset ของ B ไม่ได้ | PASS local | project/asset integration ตรวจ same-workspace และ actor authorization ทั้ง repository/RPC |
| client ปลอม owner/workspace/role/status ไม่เพิ่มสิทธิ์ | PASS local | strict schemas + actor-derived RPC fields + pgTAP constraints |
| concurrent bootstrap ได้ identity/workspace เดียว | PASS local | `bootstrap.concurrent.test.ts` ยิงพร้อมกัน 8 calls |
| สลับบัญชีไม่เห็น project/draft เดิม | PASS local | browser E2E สลับสอง Auth users; account-scoped storage tests และ late-response unit tests |

## Data, concurrency และ offline

| Requirement | สถานะ | Evidence / ขอบเขต |
| --- | --- | --- |
| CAS จาก revision เดียวสำเร็จเพียง request เดียว | PASS local | PostgreSQL concurrent project integration |
| lost response replay receipt เดิม ไม่เพิ่ม revision/project | PASS local | integration + durable save/create/delete unit tests |
| reload/reconnect replay exact mutation ID | PASS local | IndexedDB save/create/delete journal tests + browser reconnect E2E |
| operation ID เดิมต่าง payload เป็น conflict | PASS local | project integration และ durable mutation validation |
| concurrent create/import dedupe | PASS local | project/legacy concurrent integration; same-intent journal recovery |
| failed save/edit ระหว่าง save ไม่ล้าง dirty generation | PASS unit | durable queue generation/retry tests |
| switch project หลัง edit เก็บ draft ก่อน | PASS unit | controller capture-before-switch test |
| offline edit/reconnect ไม่ overwrite เงียบ | PASS local | browser E2E + queue CAS/conflict tests; remote tab event mark conflict |
| offline create/import/delete/upload ถูกปิด | PASS unit/UI | controller/UI guards; browser E2E ยืนยัน offline editing/reconnect |
| delete ไม่ถูก late autosave resurrect | PASS unit | controller disposal + durable delete replay behavior |
| invalid/oversized/unknown documents ถูกปฏิเสธ | PASS local | Zod/API/body-limit unit tests และ RPC validation |
| clean tab refresh; dirty tab conflict ข้ามแท็บ | PASS unit/browser | scoped BroadcastChannel tests + two-tab browser refresh; dirty conflict queue test |

## Assets, migration และ compatibility

| Requirement | สถานะ | Evidence / ขอบเขต |
| --- | --- | --- |
| MIME/bytes/pixels/malformed image และ arbitrary SVG ถูกปฏิเสธ | PASS local | Sharp lifecycle tests + codec SVG fail-closed tests |
| ready object immutable; replay ไม่เปลี่ยน canonical bytes | PASS local | Storage lifecycle/concurrency integration |
| quota/reservation/validator fencing ปลอด race | PASS local | asset pgTAP + concurrent integration |
| cross-workspace/not-ready asset อ้างใน project ไม่ได้ | PASS local | asset lifecycle integration และ project RPC checks |
| portable schema 6 roundtrip ครบ | PASS unit/browser | codec/project-file fixtures; browser export hydrates PNG, import สำเร็จ และไม่รั่ว `assetId` |
| trusted preset add/color/save/reload | PASS browser | local Chrome + real API/Storage E2E |
| รูปเดิมไม่ upload ซ้ำเมื่อ save | PASS unit | SHA/sidecar dedupe tests |
| migration raw backup/consent/skipped/resume/dedupe | PASS unit/browser | migration journal tests + browser consent/raw IndexedDB/dedupe E2E |
| unsupported SVG รายงานว่า skipped ไม่อ้างว่าย้ายครบ | PASS unit | migration repair/skipped + codec preservation tests |
| hydrate failure ไม่ save งานที่รูปหาย | PASS unit | checksum/scope/corrupt download tests |

## Build, runtime และ operations

| Requirement | สถานะ | Evidence / ขอบเขต |
| --- | --- | --- |
| geometry/export regression suite | PASS | รวมอยู่ใน unit 410 tests |
| build/typecheck/API bundles | PASS | `npm run build` |
| frontend bundle ไม่มี server secret/private module | PASS local | bundle scan จาก foundation; build ล่าสุดผ่าน |
| local dev API 401/404/405 และ legacy 410 | PASS local | HTTP smoke |
| preview/deployed route parity รวม 413 | PARTIAL | router/unit/local dev ผ่าน; Vercel preview NOT RUN |
| empty local DB migrate + ACL | PASS local | `db:reset --local` และ pgTAP 133 assertions |
| DB + sample object restore/checksum | PASS local | isolated temp database + Storage object delete/restore drill |
| เปิดงานจาก restored deployment snapshot | NOT RUN | ต้อง restore staging snapshot แล้วชี้ staging app ไปเปิด project/asset จริงก่อน public pilot |
| Google OAuth redirects/provider | NOT RUN | ต้องใช้ Google console + staging Supabase settings |
| remote Storage CORS/private tickets | NOT RUN | local signed upload/download ผ่าน; remote origin ยังไม่ตรวจ |
| Vercel Sharp native packaging | NOT RUN | local native Sharp ผ่าน; deployment runtime ยังไม่ตรวจ |

## Local browser scenarios ที่ผ่าน

1. local email Auth bootstrap และ workspace creation
2. legacy consent, exact raw IndexedDB backup, import dedupe และไม่เปิด modal ซ้ำหลัง reload
3. trusted preset rasterize/upload, เปลี่ยนสี, autosave และ reload
4. สองแท็บ: save จากแท็บแรกทำให้ clean แท็บที่สอง refresh
5. offline edit แล้ว reconnect ส่ง durable save สำเร็จโดยไม่ duplicate project
6. portable export มี embedded PNG และไม่มี cloud `assetId`; import กลับเป็น project ใหม่ได้
7. สลับบัญชีแล้วไม่เห็น project ของบัญชีแรก; สลับกลับเปิดงานเดิมได้
8. ไม่มี uncaught browser page error ตลอด flow

## Gate ก่อน staging/public pilot

- สร้าง staging resource แยก, push migrations แบบตรวจ dry-run และห้าม `db reset --linked`
- ทดสอบ Google OAuth callback + app redirect จริง
- ทดสอบ Vercel preview `/api/v1` parity, origin allowlist, body limit และ Sharp native runtime
- ทดสอบ Storage upload/download/CORS ด้วย staging origin
- restore staging database snapshot และ Storage manifest/objects แล้วเปิด project ที่มีรูปผ่าน app จริง
- บันทึก rollback point, backup owner, alert owner และผล smoke test; จึงค่อยเปลี่ยนสถานะจาก NOT RUN

รายละเอียด setup และขอบเขต backup อยู่ที่ [backend-setup.md](backend-setup.md)
