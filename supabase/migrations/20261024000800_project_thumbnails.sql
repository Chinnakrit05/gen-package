-- ภาพย่อ 3D ของงาน (บรรจุภัณฑ์ที่พับ/ขึ้นรูปแล้ว) สำหรับแกลเลอรีงาน — client ถ่ายจากโมเดล 3D ตอนบันทึกแล้วส่งมาเป็นรูปเล็ก
-- (WebP/JPEG ≤ 64 KiB) เก็บในฐานข้อมูลตรง ๆ ไม่ผ่าน asset pipeline: รูปถูกเขียนทับบ่อยและใช้แสดงในรายการงานเท่านั้น
-- (ไม่ไหลเข้าไฟล์ผลิต) จึงไม่ต้องตรวจ/ย้าย bucket/นับโควตาแบบรูปที่ผู้ใช้อัปโหลด และ bucket เดิมรับแค่ PNG/JPEG
-- เพิ่มตาราง/ฟังก์ชันอย่างเดียว ไม่แก้ list_projects เดิม — server รุ่นเก่า/ใหม่กับฐานข้อมูลรุ่นเก่า/ใหม่ใช้ร่วมกันได้ระหว่าง deploy
-- kind/label = ชนิดงานและชื่อชนิดสำหรับป้ายบนการ์ด (รายการงานบน cloud ไม่มีเนื้องาน จึงบอกชนิดเองไม่ได้)

create table app_private.project_thumbnails (
  project_id uuid primary key,
  workspace_id uuid not null,
  mime_type text not null,
  image bytea not null,
  kind text not null,
  label text not null,
  updated_at timestamptz not null default clock_timestamp(),
  constraint project_thumbnails_mime check (mime_type in ('image/webp', 'image/jpeg')),
  constraint project_thumbnails_size check (octet_length(image) between 1 and 65536),
  constraint project_thumbnails_kind check (kind in ('box', 'vessel', 'pouch', 'card')),
  constraint project_thumbnails_label check (char_length(label) between 1 and 60),
  foreign key (project_id, workspace_id)
    references app_private.projects(id, workspace_id) on delete cascade
);

create index project_thumbnails_workspace_idx on app_private.project_thumbnails (workspace_id);

alter table app_private.project_thumbnails enable row level security;
revoke all on table app_private.project_thumbnails from public, anon, authenticated;
grant select, insert, update, delete on table app_private.project_thumbnails to service_role;

-- บันทึก/เขียนทับภาพย่อของงาน (ต้องมีสิทธิ์เขียน workspace ของงาน) — คืน version = เวลาที่บันทึก
create function public.put_project_thumbnail(
  p_actor_user_id uuid,
  p_project_id uuid,
  p_mime_type text,
  p_image_base64 text,
  p_kind text,
  p_label text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_image bytea;
  v_version timestamptz;
begin
  select workspace_id into v_workspace_id
  from app_private.projects
  where id = p_project_id
    and deleted_at is null;

  if not found then
    raise exception using errcode = 'P0001', message = 'PROJECT_NOT_FOUND';
  end if;

  perform app_private.assert_workspace_access(p_actor_user_id, v_workspace_id, true);

  begin
    v_image := pg_catalog.decode(p_image_base64, 'base64');
  exception when others then
    raise exception using errcode = '22023', message = 'THUMBNAIL_INVALID';
  end;

  insert into app_private.project_thumbnails as thumbs (
    project_id, workspace_id, mime_type, image, kind, label, updated_at
  ) values (
    p_project_id, v_workspace_id, p_mime_type, v_image, p_kind, p_label, clock_timestamp()
  )
  on conflict (project_id) do update
  set mime_type = excluded.mime_type,
      image = excluded.image,
      kind = excluded.kind,
      label = excluded.label,
      updated_at = excluded.updated_at
  returning thumbs.updated_at into v_version;

  return jsonb_build_object('projectId', p_project_id, 'version', v_version);
end;
$$;

-- version + ชนิดงานของภาพย่อ (ไม่มีตัวรูป) สำหรับหน้ารายการงาน — เรียกต่อจาก list_projects ด้วย id ของหน้านั้น
create function public.list_project_thumbnail_meta(
  p_actor_user_id uuid,
  p_workspace_id uuid,
  p_project_ids uuid[]
)
returns table (
  project_id uuid,
  thumbnail_version timestamptz,
  kind text,
  label text
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if pg_catalog.cardinality(p_project_ids) > 101 then
    raise exception using errcode = '22023', message = 'THUMBNAIL_LIMIT_INVALID';
  end if;

  perform app_private.assert_workspace_access(p_actor_user_id, p_workspace_id, false);

  return query
  select thumbs.project_id, thumbs.updated_at, thumbs.kind, thumbs.label
  from app_private.project_thumbnails thumbs
  join app_private.projects projects on projects.id = thumbs.project_id
  where thumbs.workspace_id = p_workspace_id
    and thumbs.project_id = any(p_project_ids)
    and projects.deleted_at is null;
end;
$$;

-- ตัวรูปภาพย่อ (base64) ทีละชุด — client ขอเฉพาะรูปที่ยังไม่มีในแคชของเบราว์เซอร์ (version ไม่ตรง)
create function public.get_project_thumbnails(
  p_actor_user_id uuid,
  p_workspace_id uuid,
  p_project_ids uuid[]
)
returns table (
  project_id uuid,
  thumbnail_version timestamptz,
  mime_type text,
  image_base64 text
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if pg_catalog.cardinality(p_project_ids) > 24 then
    raise exception using errcode = '22023', message = 'THUMBNAIL_LIMIT_INVALID';
  end if;

  perform app_private.assert_workspace_access(p_actor_user_id, p_workspace_id, false);

  return query
  select thumbs.project_id, thumbs.updated_at, thumbs.mime_type,
    pg_catalog.translate(pg_catalog.encode(thumbs.image, 'base64'), pg_catalog.chr(10), '')
  from app_private.project_thumbnails thumbs
  join app_private.projects projects on projects.id = thumbs.project_id
  where thumbs.workspace_id = p_workspace_id
    and thumbs.project_id = any(p_project_ids)
    and projects.deleted_at is null;
end;
$$;

revoke all on function public.put_project_thumbnail(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.list_project_thumbnail_meta(uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.get_project_thumbnails(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.put_project_thumbnail(uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.list_project_thumbnail_meta(uuid, uuid, uuid[]) to service_role;
grant execute on function public.get_project_thumbnails(uuid, uuid, uuid[]) to service_role;
