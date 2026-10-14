-- เปิดสิทธิ์ Pro ให้ทุก workspace ระหว่างยังไม่เปิดขาย (เจ้าของผลิตภัณฑ์ตัดสินใจ 15 ต.ค. 2026) — ดู docs/billing-freemium-pro.md §1
-- server เรียกสองฟังก์ชัน public ด้านล่างแทน get_entitlements/authorize_export เมื่อ open access เปิด
-- (isOpenAccess ใน server/http/router.ts) — เพิ่ม function อย่างเดียว ไม่แก้ตาราง/ฟังก์ชันเดิม
-- รอบ Pro ฟรี = แถว subscriptions ที่ order_id เป็น null ยาว period_days ของ catalog 'pro' และต่อรอบใหม่เองเมื่อหมด
-- เครดิตต่อรอบเติมให้ถึงโควตาของ catalog 'pro' (ไม่บวกสะสมแบบ order ที่จ่ายเงิน)
-- ดาวน์โหลดช่วงนี้ไม่ออก design_licenses — ปิด open access แล้วแบบที่ไม่ได้ซื้อกลับไปใช้กติกาปกติ

-- ให้รอบ Pro ฟรีเมื่อ workspace ไม่มี Pro ที่ใช้งานอยู่ (มีอยู่แล้ว ไม่ว่าจ่ายเงินหรือฟรี = ไม่ทำอะไร)
create function app_private.ensure_complimentary_pro(p_workspace_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_catalog app_private.plan_catalog%rowtype;
  v_subscription_id uuid;
  v_balance integer;
begin
  -- คีย์ lock เดียวกับ fulfil_order: สร้างรอบ/เติมเครดิตของ workspace เดียวกันต้องเรียงกัน
  -- (หลายแท็บโหลดสิทธิ์พร้อมกันต้องได้รอบเดียว)
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('billing' || pg_catalog.chr(31) || p_workspace_id::text, 0)
  );

  if app_private.workspace_pro_until(p_workspace_id) is not null then
    return;
  end if;

  select * into v_catalog
  from app_private.plan_catalog
  where code = 'pro';

  if not found then
    raise exception using errcode = 'P0001', message = 'PLAN_NOT_AVAILABLE';
  end if;

  insert into app_private.subscriptions (
    workspace_id, plan_code, status, period_start, period_end, order_id
  ) values (
    p_workspace_id, 'pro', 'active', now(),
    now() + make_interval(days => v_catalog.period_days), null
  ) returning id into v_subscription_id;

  insert into app_private.credit_balances (workspace_id)
  values (p_workspace_id)
  on conflict (workspace_id) do nothing;

  select balance into v_balance
  from app_private.credit_balances
  where workspace_id = p_workspace_id
  for update;

  if v_balance < v_catalog.credits then
    update app_private.credit_balances
    set balance = v_catalog.credits
    where workspace_id = p_workspace_id;

    insert into app_private.credit_ledger (workspace_id, delta, reason, ref_id)
    values (p_workspace_id, v_catalog.credits - v_balance, 'pro_period', v_subscription_id);
  end if;
end;
$$;

-- สิทธิ์ของ workspace ตอน open access (shape เดียวกับ get_entitlements)
create function public.ensure_open_access(
  p_actor_user_id uuid,
  p_workspace_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform app_private.assert_workspace_access(p_actor_user_id, p_workspace_id, false);
  perform app_private.ensure_complimentary_pro(p_workspace_id);
  return app_private.entitlements_json(p_workspace_id);
end;
$$;

-- สิทธิ์ดาวน์โหลดตอน open access: ตรวจโปรเจกต์/สมาชิกเหมือน authorize_export แต่ไม่ออก license ใหม่
-- source = license เดิมถ้ามี ไม่งั้น 'pro' (ได้สิทธิ์จากรอบ Pro ฟรี)
create function public.authorize_open_access_export(
  p_actor_user_id uuid,
  p_project_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_project app_private.projects%rowtype;
  v_source text;
begin
  select * into v_project
  from app_private.projects
  where id = p_project_id
    and deleted_at is null;

  if not found then
    raise exception using errcode = 'P0001', message = 'PROJECT_NOT_FOUND';
  end if;

  perform app_private.assert_workspace_access(p_actor_user_id, v_project.workspace_id, false);
  perform app_private.ensure_complimentary_pro(v_project.workspace_id);

  select source into v_source
  from app_private.design_licenses
  where project_id = p_project_id;

  return jsonb_build_object(
    'projectId', p_project_id,
    'source', coalesce(v_source, 'pro'),
    'entitlements', app_private.entitlements_json(v_project.workspace_id)
  );
end;
$$;

revoke all on function app_private.ensure_complimentary_pro(uuid) from public, anon, authenticated;
revoke all on function public.ensure_open_access(uuid, uuid) from public, anon, authenticated;
revoke all on function public.authorize_open_access_export(uuid, uuid) from public, anon, authenticated;

grant execute on function app_private.ensure_complimentary_pro(uuid) to service_role;
grant execute on function public.ensure_open_access(uuid, uuid) to service_role;
grant execute on function public.authorize_open_access_export(uuid, uuid) to service_role;
