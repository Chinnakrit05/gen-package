-- โควตาพื้นที่เก็บงานบน cloud ต่อ workspace (เจ้าของผลิตภัณฑ์ตัดสินใจ 23 ต.ค. 2026): Freemium 20 MB / Pro 1 GB — ดู docs/billing-freemium-pro.md §1
-- พื้นที่ที่ใช้ = เอกสารงานที่ยังไม่ถูกลบ + รูป (asset ready) ที่งานเหล่านั้นอ้าง (รูปเดียวกันหลายงานนับครั้งเดียว)
-- ลบงานแล้วพื้นที่คืนทันที (ต่างจากเพดานเดิม storage_usage ที่นับรูปทุกรูปที่เคยอัปโหลดและไม่เคยลดลง)
-- **ยังไม่เปิดใช้**: server เรียก check_storage_quota เฉพาะเมื่อ isStorageQuotaEnabled (server/http/router.ts) ซึ่งตอนนี้ปิดทุก environment
-- migration นี้ไม่เปลี่ยนพฤติกรรมเดิม: เพิ่มตาราง/ฟังก์ชัน และคอลัมน์ขนาดเอกสารที่ trigger เติมให้ตอนเขียนงาน

create table app_private.storage_quotas (
  plan text primary key,
  quota_bytes bigint not null,
  updated_at timestamptz not null default statement_timestamp(),
  constraint storage_quotas_plan check (plan in ('free', 'pro')),
  constraint storage_quotas_bytes check (quota_bytes > 0)
);

create trigger storage_quotas_touch_updated_at
before update on app_private.storage_quotas
for each row execute function app_private.touch_updated_at();

-- ปรับตัวเลขที่ตารางนี้ได้โดยไม่ต้องแก้โค้ด (ไบต์, 1 MB = 1024 × 1024)
insert into app_private.storage_quotas (plan, quota_bytes) values
  ('free', 20971520),
  ('pro', 1073741824);

alter table app_private.storage_quotas enable row level security;
revoke all on table app_private.storage_quotas from public, anon, authenticated;
grant select, insert, update, delete on table app_private.storage_quotas to service_role;

-- ขนาดเอกสารงาน (ไบต์ของ JSON) เก็บตอนเขียน — รวมทั้ง workspace ได้โดยไม่ต้องแปลงเอกสารทุกงานเป็นข้อความทุกครั้งที่ตรวจ
alter table app_private.projects add column document_bytes bigint not null default 0;
alter table app_private.projects add constraint projects_document_bytes check (document_bytes >= 0);

create function app_private.set_project_document_bytes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.document_bytes := pg_catalog.octet_length(new.document::text);
  return new;
end;
$$;

create trigger projects_document_bytes
before insert or update of document on app_private.projects
for each row execute function app_private.set_project_document_bytes();

-- งานที่มีอยู่ก่อน migration (projects ไม่มี trigger แตะ updated_at ลำดับรายการงานจึงไม่เปลี่ยน)
update app_private.projects
set document_bytes = pg_catalog.octet_length(document::text);

-- พื้นที่ที่ workspace ใช้ (ไบต์); p_document ไม่ null = ประมาณการหลังบันทึก: แทนเอกสาร/รูปของงาน p_project_id
-- ด้วย p_document (p_project_id null = งานใหม่)
create function app_private.workspace_storage_bytes(
  p_workspace_id uuid,
  p_project_id uuid default null,
  p_document jsonb default null
)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  with live as (
    select projects.id, projects.document_bytes
    from app_private.projects projects
    where projects.workspace_id = p_workspace_id
      and projects.deleted_at is null
      and (p_document is null or p_project_id is null or projects.id <> p_project_id)
  ),
  referenced as (
    select links.asset_id
    from app_private.project_assets links
    join live on live.id = links.project_id
    union
    select refs.asset_id
    from app_private.document_asset_ids(coalesce(p_document, '{}'::jsonb)) refs
  )
  select (
    coalesce((select sum(live.document_bytes) from live), 0)
    + coalesce(pg_catalog.octet_length(p_document::text), 0)
    + coalesce((
      select sum(assets.byte_size)
      from app_private.assets assets
      join referenced on referenced.asset_id = assets.id
      where assets.workspace_id = p_workspace_id
        and assets.state = 'ready'
    ), 0)
  )::bigint;
$$;

-- ตรวจโควตาก่อนเขียน (server เรียกก่อน create/save/import งาน และก่อนขออัปโหลดรูป เมื่อเปิดใช้):
--   p_project_id ไม่ null = บันทึกทับงานนั้น (workspace มาจากงาน), null = งานใหม่/รูปใหม่ใน p_workspace_id
--   p_document = เอกสารที่จะเก็บ (null = ขออัปโหลดรูป), p_extra_bytes = ขนาดรูปที่กำลังจะอัปโหลด
--   p_open_access = เปิดรอบ Pro ฟรีก่อนคิดแพ็กเกจ (แบบ ensure_open_access — รอบหมดระหว่างแก้งานต้องไม่ตกเป็นโควตา Freemium)
-- ok เมื่อหลังเขียนไม่เกินโควตา หรือไม่ได้ใช้พื้นที่เพิ่มจากเดิม: งานที่เกินโควตาอยู่แล้ว (เช่น Pro หมดอายุ) ยังบันทึก
-- ที่ทำให้เล็กลง/เท่าเดิมได้ และลบงานได้เสมอ; operation ที่เคยสำเร็จแล้ว (client ส่งซ้ำ) ผ่านเสมอ
-- ไม่ lock: สองแท็บบันทึกพร้อมกันอาจเกินโควตาได้เล็กน้อย ครั้งถัดไปจึงถูกกัน (โควตาแบบนุ่ม ยอมรับได้)
create function public.check_storage_quota(
  p_actor_user_id uuid,
  p_workspace_id uuid,
  p_project_id uuid,
  p_operation_id uuid,
  p_document jsonb,
  p_extra_bytes bigint,
  p_open_access boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_workspace_id uuid := p_workspace_id;
  v_plan text;
  v_limit bigint;
  v_used bigint;
  v_projected bigint;
begin
  if p_project_id is not null then
    select workspace_id into v_workspace_id
    from app_private.projects
    where id = p_project_id
      and deleted_at is null;
    if not found then
      raise exception using errcode = 'P0001', message = 'PROJECT_NOT_FOUND';
    end if;
  end if;
  perform app_private.assert_workspace_access(p_actor_user_id, v_workspace_id, true);
  if coalesce(p_extra_bytes, 0) < 0 then
    raise exception using errcode = '22023', message = 'STORAGE_EXTRA_BYTES_INVALID';
  end if;
  if coalesce(p_open_access, false) then
    perform app_private.ensure_complimentary_pro(v_workspace_id);
  end if;

  v_plan := case when app_private.workspace_pro_until(v_workspace_id) is null then 'free' else 'pro' end;
  select quota_bytes into v_limit
  from app_private.storage_quotas
  where plan = v_plan;
  if v_limit is null then
    raise exception using errcode = 'P0001', message = 'STORAGE_QUOTA_MISSING';
  end if;

  v_used := app_private.workspace_storage_bytes(v_workspace_id);
  if p_operation_id is not null and (
    exists (
      select 1 from app_private.project_operations operations
      where operations.workspace_id = v_workspace_id
        and operations.actor_user_id = p_actor_user_id
        and operations.operation_id = p_operation_id
    )
    or exists (
      select 1 from app_private.asset_operations operations
      where operations.workspace_id = v_workspace_id
        and operations.actor_user_id = p_actor_user_id
        and operations.operation_id = p_operation_id
    )
  ) then
    v_projected := v_used;
  elsif p_document is null then
    v_projected := v_used + coalesce(p_extra_bytes, 0);
  else
    v_projected := app_private.workspace_storage_bytes(v_workspace_id, p_project_id, p_document)
      + coalesce(p_extra_bytes, 0);
  end if;

  return jsonb_build_object(
    'ok', v_projected <= v_limit or v_projected <= v_used,
    'plan', v_plan,
    'limitBytes', v_limit,
    'usedBytes', v_used,
    'projectedBytes', v_projected
  );
end;
$$;

revoke all on function app_private.set_project_document_bytes() from public, anon, authenticated;
revoke all on function app_private.workspace_storage_bytes(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.check_storage_quota(uuid, uuid, uuid, uuid, jsonb, bigint, boolean)
  from public, anon, authenticated;

grant execute on function app_private.workspace_storage_bytes(uuid, uuid, jsonb) to service_role;
grant execute on function public.check_storage_quota(uuid, uuid, uuid, uuid, jsonb, bigint, boolean) to service_role;
