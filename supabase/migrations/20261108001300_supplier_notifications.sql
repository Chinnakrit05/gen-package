-- One in-app delivery per eligible outbox event. Recipient access is resolved
-- at read time, without creating per-recipient copies of supplier information.

create table app_private.supplier_notifications (
  id uuid primary key references app_private.notification_outbox(event_id) on delete cascade,
  delivered_at timestamptz not null
);

create table app_private.supplier_notification_reads (
  notification_id uuid not null references app_private.supplier_notifications(id) on delete cascade,
  user_id uuid not null references app_private.app_users(id) on delete cascade,
  read_at timestamptz not null default clock_timestamp(),
  primary key (notification_id, user_id)
);

create index supplier_notification_reads_user_idx on app_private.supplier_notification_reads (user_id);

create index notification_outbox_delivered_page_idx
  on app_private.notification_outbox (audience, created_at desc, event_id desc) where processed_at is not null;

alter table app_private.supplier_notifications enable row level security;
alter table app_private.supplier_notification_reads enable row level security;
revoke all on table app_private.supplier_notifications, app_private.supplier_notification_reads
  from public, anon, authenticated, service_role;
grant select, insert on table app_private.supplier_notifications, app_private.supplier_notification_reads to service_role;

create function public.marketplace_drain_supplier_notifications(p_limit integer)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_processed integer;
  v_now timestamptz := clock_timestamp();
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;

  with picked as (
    select event_id from app_private.notification_outbox
    where processed_at is null
    order by created_at, event_id
    limit p_limit for update skip locked
  ), finalized as (
    update app_private.notification_outbox outbox set processed_at = v_now
    from picked where outbox.event_id = picked.event_id
    returning outbox.event_id, outbox.audience
  ), delivered as (
    insert into app_private.supplier_notifications (id, delivered_at)
    select event.id, v_now
    from finalized join app_private.activity_events event on event.id = finalized.event_id
    where (event.action = 'submitted' and finalized.audience = 'supplier_reviewers')
       or (event.action in ('approve', 'request_changes', 'suspend', 'resume') and finalized.audience = 'supplier_workspace')
    on conflict (id) do nothing
    returning id
  )
  select count(*) into v_processed from finalized;

  return jsonb_build_object('processed', v_processed);
end;
$$;

create function public.marketplace_list_supplier_notifications(
  p_actor_user_id uuid, p_as_reviewer boolean, p_limit integer, p_after_created_at timestamptz, p_after_id uuid
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_items jsonb;
  v_cursor jsonb;
  v_audience text;
begin
  if p_as_reviewer is null or p_limit is null or p_limit not between 1 and 24
    or ((p_after_created_at is null) <> (p_after_id is null))
    or (p_after_created_at is not null and not isfinite(p_after_created_at))
  then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;

  if p_as_reviewer then
    perform app_private.marketplace_assert_reviewer(p_actor_user_id);
    v_audience := 'supplier_reviewers';
  else
    perform app_private.marketplace_assert_active(p_actor_user_id);
    v_audience := 'supplier_workspace';
    if not exists (
      select 1 from app_private.workspace_marketplace_members member
      join app_private.supplier_profiles supplier on supplier.workspace_id = member.workspace_id
      where member.user_id = p_actor_user_id
    ) then
      return jsonb_build_object('items', '[]'::jsonb, 'nextCursor', null);
    end if;
  end if;

  -- A first-page read from an authorized audience makes progress on the
  -- shared outbox. Subsequent pages only read already delivered events.
  if p_after_created_at is null then
    perform public.marketplace_drain_supplier_notifications(50);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', page.id,
    'supplierId', page.supplier_id,
    'supplierName', page.name,
    'action', page.action,
    'createdAt', to_char(page.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'readAt', to_char(page.read_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  ) order by page.created_at desc, page.id desc), '[]'::jsonb)
  into v_items
  from (
    select notification.id, event.supplier_id, supplier.name, event.action, outbox.created_at, receipt.read_at
    from app_private.notification_outbox outbox
    join app_private.supplier_notifications notification on notification.id = outbox.event_id
    join app_private.activity_events event on event.id = notification.id
    join app_private.supplier_profiles supplier on supplier.id = event.supplier_id
    left join app_private.supplier_notification_reads receipt
      on receipt.notification_id = notification.id and receipt.user_id = p_actor_user_id
    where outbox.processed_at is not null and outbox.audience = v_audience
      and (p_after_created_at is null or (outbox.created_at, outbox.event_id) < (p_after_created_at, p_after_id))
      and (p_as_reviewer or exists (
        select 1 from app_private.workspace_marketplace_members member
        where member.workspace_id = supplier.workspace_id and member.user_id = p_actor_user_id
      ))
    order by outbox.created_at desc, outbox.event_id desc
    limit p_limit + 1
  ) page;

  if jsonb_array_length(v_items) > p_limit then
    v_cursor := jsonb_build_object(
      'createdAt', v_items->(p_limit - 1)->>'createdAt',
      'id', v_items->(p_limit - 1)->>'id'
    );
    v_items := v_items - p_limit;
  end if;
  return jsonb_build_object('items', v_items, 'nextCursor', v_cursor);
end;
$$;

create function public.marketplace_mark_supplier_notification_read(
  p_actor_user_id uuid, p_notification_id uuid, p_as_reviewer boolean
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_audience text;
  v_supplier_id uuid;
  v_read_at timestamptz;
begin
  if p_as_reviewer is null then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;
  if p_as_reviewer then
    perform app_private.marketplace_assert_reviewer(p_actor_user_id);
    v_audience := 'supplier_reviewers';
  else
    v_audience := 'supplier_workspace';
  end if;

  select event.supplier_id into v_supplier_id
  from app_private.supplier_notifications notification
  join app_private.notification_outbox outbox on outbox.event_id = notification.id
  join app_private.activity_events event on event.id = notification.id
  where notification.id = p_notification_id and outbox.audience = v_audience and outbox.processed_at is not null;
  if not found then
    raise exception using errcode = 'P0001', message = 'MARKETPLACE_NOT_FOUND';
  end if;
  if not p_as_reviewer then
    -- Hold the membership row through the write so removal and marking
    -- are ordered even when the requests arrive together.
    perform app_private.marketplace_member_role(p_actor_user_id, v_supplier_id, false);
  end if;

  insert into app_private.supplier_notification_reads (notification_id, user_id)
  values (p_notification_id, p_actor_user_id)
  on conflict (notification_id, user_id) do nothing
  returning read_at into v_read_at;
  if not found then
    select read_at into v_read_at from app_private.supplier_notification_reads
    where notification_id = p_notification_id and user_id = p_actor_user_id;
  end if;

  return jsonb_build_object(
    'id', p_notification_id,
    'readAt', to_char(v_read_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  );
end;
$$;

revoke all on function public.marketplace_drain_supplier_notifications(integer),
  public.marketplace_list_supplier_notifications(uuid, boolean, integer, timestamptz, uuid),
  public.marketplace_mark_supplier_notification_read(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.marketplace_drain_supplier_notifications(integer),
  public.marketplace_list_supplier_notifications(uuid, boolean, integer, timestamptz, uuid),
  public.marketplace_mark_supplier_notification_read(uuid, uuid, boolean) to service_role;
