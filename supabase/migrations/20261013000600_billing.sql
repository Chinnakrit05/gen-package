-- Billing / entitlement สำหรับแพ็กเกจ Freemium / ซื้อรายแบบ / Pro — ดู docs/billing-freemium-pro.md §2
-- ทุกตารางอยู่ใน app_private เปิด RLS และให้สิทธิ์เฉพาะ service_role; RPC ใน public.* raise ด้วย
-- errcode P0001 + message เป็นรหัสคงที่ ให้ server map เป็น HTTP (server/adapters/supabase/billingRepository.ts)

-- ราคา/เครดิตต่อแพ็กเกจ — เจ้าของผลิตภัณฑ์ปรับตัวเลขได้ที่ตารางนี้โดยไม่ต้องแก้โค้ด
create table app_private.plan_catalog (
  code text primary key,
  amount_minor integer not null,
  currency text not null default 'THB',
  credits integer not null,
  period_days integer,
  updated_at timestamptz not null default statement_timestamp(),
  constraint plan_catalog_code check (code in ('design', 'pro')),
  constraint plan_catalog_amount_positive check (amount_minor > 0),
  constraint plan_catalog_currency check (currency = 'THB'),
  constraint plan_catalog_credits check (credits >= 0),
  constraint plan_catalog_period_days check (period_days is null or period_days > 0),
  -- ซื้อรายแบบ = ซื้อขาด (ไม่มีรอบ), Pro = รายรอบ
  constraint plan_catalog_period_by_code check ((code = 'design') = (period_days is null))
);

create trigger plan_catalog_touch_updated_at
before update on app_private.plan_catalog
for each row execute function app_private.touch_updated_at();

insert into app_private.plan_catalog (code, amount_minor, currency, credits, period_days) values
  ('design', 14900, 'THB', 10, null),
  ('pro', 39900, 'THB', 100, 30);

-- ตัวนับเครดิต AI ต่อ workspace (lock for update ตอนหัก/คืน)
create table app_private.credit_balances (
  workspace_id uuid primary key references app_private.workspaces(id) on delete restrict,
  balance integer not null default 0,
  updated_at timestamptz not null default statement_timestamp(),
  constraint credit_balances_balance check (balance >= 0)
);

create trigger credit_balances_touch_updated_at
before update on app_private.credit_balances
for each row execute function app_private.touch_updated_at();

-- audit อย่างเดียว ไม่ใช้คำนวณยอด
create table app_private.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app_private.workspaces(id) on delete restrict,
  delta integer not null,
  reason text not null,
  ref_id uuid,
  created_at timestamptz not null default statement_timestamp(),
  constraint credit_ledger_delta check (delta <> 0),
  constraint credit_ledger_reason
    check (reason in ('design_purchase', 'pro_period', 'ai_request', 'ai_refund', 'admin'))
);

create index credit_ledger_workspace_created_idx
  on app_private.credit_ledger (workspace_id, created_at desc);

-- คำขอ AI หนึ่งรายการ = จอง 1 เครดิตก่อนเรียก provider แล้ว settle ทีหลัง
create table app_private.ai_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app_private.workspaces(id) on delete restrict,
  actor_user_id uuid not null references app_private.app_users(id) on delete restrict,
  operation_id uuid not null,
  state text not null default 'reserved',
  reserved_units integer not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  settled_at timestamptz,
  constraint ai_requests_state check (state in ('reserved', 'succeeded', 'failed')),
  constraint ai_requests_reserved_units check (reserved_units = 1),
  constraint ai_requests_settled_at check ((state = 'reserved') = (settled_at is null)),
  constraint ai_requests_operation_unique unique (workspace_id, actor_user_id, operation_id)
);

create table app_private.orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app_private.workspaces(id) on delete restrict,
  purchaser_user_id uuid not null references app_private.app_users(id) on delete restrict,
  operation_id uuid not null,
  kind text not null,
  project_id uuid,
  amount_minor integer not null,
  currency text not null,
  credits integer not null,
  status text not null default 'pending',
  provider text not null default 'none',
  provider_ref text,
  created_at timestamptz not null default statement_timestamp(),
  paid_at timestamptz,
  constraint orders_kind check (kind in ('design', 'pro')),
  constraint orders_amount_positive check (amount_minor > 0),
  constraint orders_currency check (currency = 'THB'),
  constraint orders_credits check (credits >= 0),
  constraint orders_status check (status in ('pending', 'paid', 'canceled')),
  constraint orders_provider_length check (char_length(provider) between 1 and 40),
  constraint orders_provider_ref_length
    check (provider_ref is null or char_length(provider_ref) between 1 and 200),
  constraint orders_paid_at check ((status = 'paid') = (paid_at is not null)),
  constraint orders_project_by_kind check ((kind = 'design') = (project_id is not null)),
  constraint orders_operation_unique unique (workspace_id, purchaser_user_id, operation_id),
  foreign key (project_id, workspace_id)
    references app_private.projects(id, workspace_id) on delete restrict
);

create index orders_workspace_created_idx
  on app_private.orders (workspace_id, created_at desc);

-- Pro "กำลังใช้งาน" = มีแถว active ที่ period_end > now() (คำนวณตอนอ่าน ไม่มี cron)
create table app_private.subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app_private.workspaces(id) on delete restrict,
  plan_code text not null default 'pro',
  status text not null default 'active',
  period_start timestamptz not null,
  period_end timestamptz not null,
  order_id uuid references app_private.orders(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint subscriptions_plan_code check (plan_code = 'pro'),
  constraint subscriptions_status check (status in ('active', 'canceled')),
  constraint subscriptions_period check (period_end > period_start)
);

create index subscriptions_workspace_period_idx
  on app_private.subscriptions (workspace_id, period_end desc);

create trigger subscriptions_touch_updated_at
before update on app_private.subscriptions
for each row execute function app_private.touch_updated_at();

-- สิทธิ์ดาวน์โหลดไฟล์ผลิตต่อโปรเจกต์ (1 แบบ = 1 project id) — ไม่ลบตาม project (soft delete อยู่แล้ว)
create table app_private.design_licenses (
  project_id uuid primary key,
  workspace_id uuid not null references app_private.workspaces(id) on delete restrict,
  source text not null,
  order_id uuid references app_private.orders(id) on delete restrict,
  granted_by uuid not null references app_private.app_users(id) on delete restrict,
  granted_at timestamptz not null default statement_timestamp(),
  constraint design_licenses_source check (source in ('purchase', 'pro', 'admin')),
  foreign key (project_id, workspace_id)
    references app_private.projects(id, workspace_id) on delete restrict
);

create index design_licenses_workspace_idx
  on app_private.design_licenses (workspace_id, granted_at desc);

alter table app_private.plan_catalog enable row level security;
alter table app_private.credit_balances enable row level security;
alter table app_private.credit_ledger enable row level security;
alter table app_private.ai_requests enable row level security;
alter table app_private.orders enable row level security;
alter table app_private.subscriptions enable row level security;
alter table app_private.design_licenses enable row level security;

revoke all on table
  app_private.plan_catalog,
  app_private.credit_balances,
  app_private.credit_ledger,
  app_private.ai_requests,
  app_private.orders,
  app_private.subscriptions,
  app_private.design_licenses
from public, anon, authenticated;

grant select, insert, update, delete on table
  app_private.plan_catalog,
  app_private.credit_balances,
  app_private.credit_ledger,
  app_private.ai_requests,
  app_private.orders,
  app_private.subscriptions,
  app_private.design_licenses
to service_role;

-- วันหมดอายุ Pro ที่ยังใช้งานอยู่ (null = ไม่ใช่ Pro)
create function app_private.workspace_pro_until(p_workspace_id uuid)
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$
  select max(subscriptions.period_end)
  from app_private.subscriptions subscriptions
  where subscriptions.workspace_id = p_workspace_id
    and subscriptions.status = 'active'
    and subscriptions.period_end > now();
$$;

-- CatalogItem (shared/contracts/billing.ts) ของแพ็กเกจหนึ่งรายการ
create function app_private.catalog_item_json(p_code text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'kind', catalog.code,
    'amountMinor', catalog.amount_minor,
    'currency', catalog.currency,
    'credits', catalog.credits,
    'periodDays', catalog.period_days
  )
  from app_private.plan_catalog catalog
  where catalog.code = p_code;
$$;

-- Entitlements (ไม่รวม devFulfilAvailable — server เติมเอง)
create function app_private.entitlements_json(p_workspace_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_pro_until timestamptz;
  v_credits integer;
  v_licensed jsonb;
begin
  v_pro_until := app_private.workspace_pro_until(p_workspace_id);

  select balance into v_credits
  from app_private.credit_balances
  where workspace_id = p_workspace_id;

  select coalesce(
    jsonb_agg(licenses.project_id order by licenses.granted_at, licenses.project_id),
    '[]'::jsonb
  ) into v_licensed
  from app_private.design_licenses licenses
  join app_private.projects projects on projects.id = licenses.project_id
  where licenses.workspace_id = p_workspace_id
    and projects.deleted_at is null;

  return jsonb_build_object(
    'workspaceId', p_workspace_id,
    'plan', case when v_pro_until is null then 'free' else 'pro' end,
    'proUntil', v_pro_until,
    'credits', coalesce(v_credits, 0),
    'licensedProjectIds', v_licensed,
    'catalog', jsonb_build_object(
      'design', app_private.catalog_item_json('design'),
      'pro', app_private.catalog_item_json('pro')
    )
  );
end;
$$;

create function app_private.order_json(p_order app_private.orders)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_order.id,
    'workspaceId', p_order.workspace_id,
    'kind', p_order.kind,
    'projectId', p_order.project_id,
    'amountMinor', p_order.amount_minor,
    'currency', p_order.currency,
    'credits', p_order.credits,
    'status', p_order.status,
    'provider', p_order.provider,
    'providerRef', p_order.provider_ref,
    'createdAt', p_order.created_at,
    'paidAt', p_order.paid_at
  );
$$;

create function public.get_entitlements(
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
  return app_private.entitlements_json(p_workspace_id);
end;
$$;

-- ตัดสินสิทธิ์ดาวน์โหลดไฟล์ผลิตของโปรเจกต์: มี license → คืน; Pro กำลังใช้งาน → ออก license 'pro' ให้;
-- ไม่งั้น EXPORT_PAYMENT_REQUIRED (detail = CatalogItem ของ design ให้ server แนบราคาใน details)
create function public.authorize_export(
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
  v_license app_private.design_licenses%rowtype;
begin
  select * into v_project
  from app_private.projects
  where id = p_project_id
    and deleted_at is null;

  if not found then
    raise exception using errcode = 'P0001', message = 'PROJECT_NOT_FOUND';
  end if;

  perform app_private.assert_workspace_access(p_actor_user_id, v_project.workspace_id, false);

  select * into v_license
  from app_private.design_licenses
  where project_id = p_project_id;

  if not found then
    if app_private.workspace_pro_until(v_project.workspace_id) is null then
      raise exception using
        errcode = 'P0001',
        message = 'EXPORT_PAYMENT_REQUIRED',
        detail = app_private.catalog_item_json('design')::text;
    end if;

    insert into app_private.design_licenses (project_id, workspace_id, source, granted_by)
    values (p_project_id, v_project.workspace_id, 'pro', p_actor_user_id)
    on conflict (project_id) do nothing;

    select * into v_license
    from app_private.design_licenses
    where project_id = p_project_id;
  end if;

  return jsonb_build_object(
    'projectId', v_license.project_id,
    'source', v_license.source,
    'entitlements', app_private.entitlements_json(v_project.workspace_id)
  );
end;
$$;

-- จอง 1 เครดิตก่อนเรียก provider (หักทันที); operation_id เดิมที่ยังค้าง → AI_REQUEST_IN_PROGRESS,
-- ที่ settle แล้ว → IDEMPOTENCY_KEY_REUSED; เครดิตไม่พอ → AI_CREDITS_EXHAUSTED (detail = plan)
create function public.reserve_ai_credit(
  p_actor_user_id uuid,
  p_workspace_id uuid,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request app_private.ai_requests%rowtype;
  v_balance app_private.credit_balances%rowtype;
  v_refund integer;
begin
  perform app_private.assert_workspace_access(p_actor_user_id, p_workspace_id, true);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ai-credit' || pg_catalog.chr(31) || p_workspace_id::text, 0)
  );

  insert into app_private.credit_balances (workspace_id)
  values (p_workspace_id)
  on conflict (workspace_id) do nothing;

  -- คืนเครดิตคำขอที่ค้าง reserved เกิน 15 นาที (function ถูก kill ระหว่างรอ provider หรือคืนเครดิตไม่สำเร็จ)
  -- แบบ lazy ตอนจองครั้งถัดไปของ workspace เดียวกัน (ไม่มี cron); 15 นาทีนานกว่า timeout ของ provider มาก
  -- จึงไม่คืนคำขอที่ยังวิ่งอยู่ — ถ้าเกิดขึ้น settle 'succeeded' ฝั่ง server ทนได้ (คำขอนั้นกลายเป็นฟรี)
  with stale as (
    update app_private.ai_requests
    set state = 'failed',
        settled_at = statement_timestamp()
    where workspace_id = p_workspace_id
      and state = 'reserved'
      and created_at < statement_timestamp() - interval '15 minutes'
    returning id, reserved_units
  ), refunded as (
    insert into app_private.credit_ledger (workspace_id, delta, reason, ref_id)
    select p_workspace_id, stale.reserved_units, 'ai_refund', stale.id
    from stale
    returning delta
  )
  select coalesce(sum(refunded.delta), 0)::integer into v_refund
  from refunded;

  if v_refund > 0 then
    update app_private.credit_balances
    set balance = balance + v_refund
    where workspace_id = p_workspace_id;
  end if;

  select * into v_request
  from app_private.ai_requests
  where workspace_id = p_workspace_id
    and actor_user_id = p_actor_user_id
    and operation_id = p_operation_id;

  if found then
    if v_request.state = 'reserved' then
      raise exception using errcode = 'P0001', message = 'AI_REQUEST_IN_PROGRESS';
    end if;
    raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_REUSED';
  end if;

  select * into v_balance
  from app_private.credit_balances
  where workspace_id = p_workspace_id
  for update;

  if v_balance.balance < 1 then
    raise exception using
      errcode = 'P0001',
      message = 'AI_CREDITS_EXHAUSTED',
      detail = case when app_private.workspace_pro_until(p_workspace_id) is null then 'free' else 'pro' end;
  end if;

  v_request.id := gen_random_uuid();

  update app_private.credit_balances
  set balance = balance - 1
  where workspace_id = p_workspace_id
  returning * into v_balance;

  insert into app_private.credit_ledger (workspace_id, delta, reason, ref_id)
  values (p_workspace_id, -1, 'ai_request', v_request.id);

  insert into app_private.ai_requests (
    id, workspace_id, actor_user_id, operation_id, state, reserved_units
  ) values (
    v_request.id, p_workspace_id, p_actor_user_id, p_operation_id, 'reserved', 1
  );

  return jsonb_build_object('requestId', v_request.id, 'credits', v_balance.balance);
end;
$$;

-- ปิดคำขอ AI: failed → คืนเครดิต; succeeded → ไม่คืน; ต้องเป็นของ actor และยัง reserved
create function public.settle_ai_request(
  p_actor_user_id uuid,
  p_request_id uuid,
  p_outcome text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request app_private.ai_requests%rowtype;
  v_balance app_private.credit_balances%rowtype;
begin
  if p_outcome not in ('succeeded', 'failed') then
    raise exception using errcode = '22023', message = 'AI_OUTCOME_INVALID';
  end if;

  select * into v_request
  from app_private.ai_requests
  where id = p_request_id
  for update;

  if not found
    or v_request.actor_user_id is distinct from p_actor_user_id
    or v_request.state <> 'reserved' then
    raise exception using errcode = 'P0001', message = 'AI_REQUEST_NOT_RESERVED';
  end if;

  if p_outcome = 'failed' then
    update app_private.credit_balances
    set balance = balance + v_request.reserved_units
    where workspace_id = v_request.workspace_id
    returning * into v_balance;

    insert into app_private.credit_ledger (workspace_id, delta, reason, ref_id)
    values (v_request.workspace_id, v_request.reserved_units, 'ai_refund', v_request.id);
  else
    select * into v_balance
    from app_private.credit_balances
    where workspace_id = v_request.workspace_id;
  end if;

  update app_private.ai_requests
  set state = p_outcome,
      settled_at = statement_timestamp()
  where id = p_request_id;

  return jsonb_build_object('credits', coalesce(v_balance.balance, 0));
end;
$$;

-- สั่งซื้อ (pending, provider 'none' จนกว่าจะเลือกผู้ให้บริการ) ราคา/เครดิต snapshot จาก catalog ตอนสั่ง
create function public.create_order(
  p_actor_user_id uuid,
  p_workspace_id uuid,
  p_operation_id uuid,
  p_kind text,
  p_project_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order app_private.orders%rowtype;
  v_catalog app_private.plan_catalog%rowtype;
begin
  perform app_private.assert_workspace_access(p_actor_user_id, p_workspace_id, true);

  if p_kind not in ('design', 'pro') then
    raise exception using errcode = '22023', message = 'ORDER_KIND_INVALID';
  end if;
  if (p_kind = 'design') <> (p_project_id is not null) then
    raise exception using errcode = '22023', message = 'ORDER_PROJECT_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'order' || pg_catalog.chr(31) || p_workspace_id::text || pg_catalog.chr(31)
      || p_actor_user_id::text || pg_catalog.chr(31) || p_operation_id::text,
      0
    )
  );

  select * into v_order
  from app_private.orders
  where workspace_id = p_workspace_id
    and purchaser_user_id = p_actor_user_id
    and operation_id = p_operation_id;

  if found then
    if v_order.kind <> p_kind or v_order.project_id is distinct from p_project_id then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return app_private.order_json(v_order);
  end if;

  if p_kind = 'design' then
    if not exists (
      select 1
      from app_private.projects
      where id = p_project_id
        and workspace_id = p_workspace_id
        and deleted_at is null
    ) then
      raise exception using errcode = 'P0001', message = 'PROJECT_NOT_FOUND';
    end if;
    if exists (select 1 from app_private.design_licenses where project_id = p_project_id) then
      raise exception using errcode = 'P0001', message = 'ALREADY_LICENSED';
    end if;
  end if;

  select * into v_catalog
  from app_private.plan_catalog
  where code = p_kind;

  if not found then
    raise exception using errcode = 'P0001', message = 'PLAN_NOT_AVAILABLE';
  end if;

  insert into app_private.orders (
    workspace_id, purchaser_user_id, operation_id, kind, project_id,
    amount_minor, currency, credits, status, provider
  ) values (
    p_workspace_id, p_actor_user_id, p_operation_id, p_kind, p_project_id,
    v_catalog.amount_minor, v_catalog.currency, v_catalog.credits, 'pending', 'none'
  ) returning * into v_order;

  return app_private.order_json(v_order);
end;
$$;

-- ยืนยันการชำระ (idempotent): design → license 'purchase'; pro → รอบสมาชิกต่อจากวันหมดเดิม; เติมเครดิตตาม order
-- p_actor_user_id null = webhook ของผู้ให้บริการในอนาคต (ไม่ตรวจ purchaser)
create function public.fulfil_order(
  p_actor_user_id uuid,
  p_order_id uuid,
  p_provider text,
  p_provider_ref text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order app_private.orders%rowtype;
  v_catalog app_private.plan_catalog%rowtype;
  v_period_start timestamptz;
begin
  if p_provider is null or char_length(btrim(p_provider)) not between 1 and 40 then
    raise exception using errcode = '22023', message = 'ORDER_PROVIDER_INVALID';
  end if;

  select * into v_order
  from app_private.orders
  where id = p_order_id
  for update;

  if not found or (p_actor_user_id is not null and v_order.purchaser_user_id <> p_actor_user_id) then
    raise exception using errcode = 'P0001', message = 'ORDER_NOT_FOUND';
  end if;

  if v_order.status = 'paid' then
    return app_private.order_json(v_order);
  end if;
  if v_order.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'ORDER_NOT_PAYABLE';
  end if;

  -- ต่อรอบ Pro/เติมเครดิตของ workspace เดียวกันต้องเรียงกัน ไม่งั้นรอบใหม่อาจซ้อนรอบเดิม
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('billing' || pg_catalog.chr(31) || v_order.workspace_id::text, 0)
  );

  update app_private.orders
  set status = 'paid',
      provider = btrim(p_provider),
      provider_ref = p_provider_ref,
      paid_at = statement_timestamp()
  where id = p_order_id
  returning * into v_order;

  if v_order.kind = 'design' then
    insert into app_private.design_licenses (project_id, workspace_id, source, order_id, granted_by)
    values (
      v_order.project_id, v_order.workspace_id, 'purchase', v_order.id,
      coalesce(p_actor_user_id, v_order.purchaser_user_id)
    )
    on conflict (project_id) do nothing;
  else
    select * into v_catalog
    from app_private.plan_catalog
    where code = 'pro';

    v_period_start := greatest(now(), coalesce(app_private.workspace_pro_until(v_order.workspace_id), now()));

    insert into app_private.subscriptions (
      workspace_id, plan_code, status, period_start, period_end, order_id
    ) values (
      v_order.workspace_id, 'pro', 'active', v_period_start,
      v_period_start + make_interval(days => v_catalog.period_days), v_order.id
    );
  end if;

  if v_order.credits > 0 then
    insert into app_private.credit_balances as balances (workspace_id, balance)
    values (v_order.workspace_id, v_order.credits)
    on conflict (workspace_id) do update
      set balance = balances.balance + excluded.balance;

    insert into app_private.credit_ledger (workspace_id, delta, reason, ref_id)
    values (
      v_order.workspace_id, v_order.credits,
      case when v_order.kind = 'design' then 'design_purchase' else 'pro_period' end,
      v_order.id
    );
  end if;

  return app_private.order_json(v_order);
end;
$$;

revoke all on function app_private.workspace_pro_until(uuid) from public, anon, authenticated;
revoke all on function app_private.catalog_item_json(text) from public, anon, authenticated;
revoke all on function app_private.entitlements_json(uuid) from public, anon, authenticated;
revoke all on function app_private.order_json(app_private.orders) from public, anon, authenticated;
revoke all on function public.get_entitlements(uuid, uuid) from public, anon, authenticated;
revoke all on function public.authorize_export(uuid, uuid) from public, anon, authenticated;
revoke all on function public.reserve_ai_credit(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.settle_ai_request(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.create_order(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.fulfil_order(uuid, uuid, text, text) from public, anon, authenticated;

grant execute on function app_private.workspace_pro_until(uuid) to service_role;
grant execute on function app_private.catalog_item_json(text) to service_role;
grant execute on function app_private.entitlements_json(uuid) to service_role;
grant execute on function app_private.order_json(app_private.orders) to service_role;
grant execute on function public.get_entitlements(uuid, uuid) to service_role;
grant execute on function public.authorize_export(uuid, uuid) to service_role;
grant execute on function public.reserve_ai_credit(uuid, uuid, uuid) to service_role;
grant execute on function public.settle_ai_request(uuid, uuid, text) to service_role;
grant execute on function public.create_order(uuid, uuid, uuid, text, uuid) to service_role;
grant execute on function public.fulfil_order(uuid, uuid, text, text) to service_role;
