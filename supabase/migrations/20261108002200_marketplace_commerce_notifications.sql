-- Transactional outbox contains no price, message, financial or file payload.
create table app_private.marketplace_commerce_outbox (
 event_id uuid primary key references app_private.marketplace_commerce_events(id),
 created_at timestamptz not null default clock_timestamp(), delivered_at timestamptz
);
create table app_private.marketplace_commerce_notification_reads (
 event_id uuid not null references app_private.marketplace_commerce_outbox(event_id),
 actor_id uuid not null references app_private.app_users(id), read_at timestamptz not null default clock_timestamp(), primary key(event_id,actor_id)
);
alter table app_private.marketplace_commerce_outbox enable row level security;
alter table app_private.marketplace_commerce_notification_reads enable row level security;
revoke all on app_private.marketplace_commerce_outbox,app_private.marketplace_commerce_notification_reads from public,anon,authenticated,service_role;
grant select,insert on app_private.marketplace_commerce_outbox,app_private.marketplace_commerce_notification_reads to service_role;
grant update(delivered_at) on app_private.marketplace_commerce_outbox to service_role;
create index marketplace_commerce_outbox_pending_idx on app_private.marketplace_commerce_outbox(created_at,event_id) where delivered_at is null;
create function app_private.commerce_queue_notification() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.kind<>'quotation_save' then insert into app_private.marketplace_commerce_outbox(event_id) values(new.id) on conflict do nothing; end if;
 -- Other invited suppliers learn only that the request was awarded, never
 -- the chosen supplier, quote, order ID, conversation or amount.
 if new.kind='order_confirm' then
  insert into app_private.marketplace_commerce_events(request_id,supplier_id,actor_id,kind,entity_id)
  select new.request_id,a.supplier_id,new.actor_id,'request_awarded',new.request_id from app_private.quote_request_supplier_access a where a.request_id=new.request_id and a.supplier_id<>new.supplier_id;
 end if;
 return new;
end $$;
create trigger commerce_queue_notification after insert on app_private.marketplace_commerce_events for each row execute function app_private.commerce_queue_notification();
insert into app_private.marketplace_commerce_outbox(event_id) select id from app_private.marketplace_commerce_events where kind<>'quotation_save' on conflict do nothing;
create function public.marketplace_drain_commerce_notifications(p_limit integer) returns jsonb language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'VALIDATION_ERROR'; end if;
 with picked as (select event_id from app_private.marketplace_commerce_outbox where delivered_at is null order by created_at,event_id limit p_limit for update skip locked), updated as (
 update app_private.marketplace_commerce_outbox o set delivered_at=clock_timestamp() from picked p where o.event_id=p.event_id returning o.event_id) select count(*) into n from updated;
 return jsonb_build_object('processed',n);
end $$;
create function app_private.commerce_notification_visible(p_actor uuid,p_event app_private.marketplace_commerce_events)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from app_private.app_users u where u.id=p_actor and u.status='active') and (
 exists(select 1 from app_private.quote_request_drafts d join app_private.workspaces w on w.id=d.workspace_id join app_private.workspace_members m on m.workspace_id=w.id and m.user_id=w.owner_user_id where d.id=p_event.request_id and w.owner_user_id=p_actor and m.role='owner' and p_event.kind<>'request_awarded')
 or exists(select 1 from app_private.supplier_profiles s join app_private.workspace_marketplace_members mm on mm.workspace_id=s.workspace_id join app_private.workspace_members wm on wm.workspace_id=s.workspace_id and wm.user_id=mm.user_id
 where s.id=p_event.supplier_id and mm.user_id=p_actor and exists(select 1 from app_private.quote_request_supplier_access a where a.request_id=p_event.request_id and a.supplier_id=s.id)));
$$;
create function public.marketplace_commerce_notifications(p_actor uuid,p_after uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare items jsonb; cursor uuid; after_time timestamptz;
begin
 perform app_private.marketplace_assert_active(p_actor);
 if p_after is not null then
  select e.created_at into after_time from app_private.marketplace_commerce_events e where e.id=p_after and app_private.commerce_notification_visible(p_actor,e);
  if not found then raise exception 'MARKETPLACE_NOT_FOUND'; end if;
 end if;
 perform public.marketplace_drain_commerce_notifications(100);
 select coalesce(jsonb_agg(item order by created_at desc,id desc),'[]') into items from (
 select e.id,e.created_at,jsonb_build_object('id',e.id,'requestId',e.request_id,'supplierId',e.supplier_id,'kind',e.kind,'entityId',e.entity_id,'createdAt',e.created_at,'readAt',r.read_at,
 'requestTitle',d.title,'supplierName',s.name) item
 from app_private.marketplace_commerce_outbox o join app_private.marketplace_commerce_events e on e.id=o.event_id
 join app_private.quote_request_drafts d on d.id=e.request_id join app_private.supplier_profiles s on s.id=e.supplier_id
 left join app_private.marketplace_commerce_notification_reads r on r.event_id=e.id and r.actor_id=p_actor
 where o.delivered_at is not null and (p_after is null or (e.created_at,e.id)<(after_time,p_after)) and app_private.commerce_notification_visible(p_actor,e) order by e.created_at desc,e.id desc limit 25) page;
 if jsonb_array_length(items)>24 then cursor:=(items->23->>'id')::uuid; items:=items-24; end if;
 return jsonb_build_object('items',items,'nextCursor',cursor);
end $$;
create function public.marketplace_commerce_notification_read(p_actor uuid,p_event uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare e app_private.marketplace_commerce_events; read_time timestamptz;
begin
 select * into e from app_private.marketplace_commerce_events where id=p_event;
 if e.id is null or not app_private.commerce_notification_visible(p_actor,e) then raise exception 'MARKETPLACE_NOT_FOUND'; end if;
 insert into app_private.marketplace_commerce_notification_reads(event_id,actor_id) values(e.id,p_actor) on conflict do nothing;
 select read_at into read_time from app_private.marketplace_commerce_notification_reads where event_id=e.id and actor_id=p_actor;
 return jsonb_build_object('id',e.id,'readAt',read_time);
end $$;
create function public.marketplace_quotation_history(p_actor uuid,p_quotation uuid,p_supplier uuid,p_after integer) returns jsonb language plpgsql security invoker set search_path='' as $$
declare q app_private.marketplace_quotations; items jsonb; cursor integer;
begin
 select * into q from app_private.marketplace_quotations where id=p_quotation;
 if not found then raise exception 'MARKETPLACE_NOT_FOUND'; end if;
 if p_supplier is null then perform app_private.marketplace_assert_quote_request_buyer(p_actor,q.request_id);
 else if p_supplier<>q.supplier_id then raise exception 'MARKETPLACE_NOT_FOUND'; end if; perform app_private.commerce_assert_supplier(p_actor,q.supplier_id,q.request_id,false); end if;
 select coalesce(jsonb_agg(terms||jsonb_build_object('id',id,'quotationId',quotation_id,'revision',revision,'sentAt',sent_at) order by revision desc),'[]') into items
 from (select * from app_private.marketplace_quotation_revisions where quotation_id=q.id and (p_after is null or revision<p_after) order by revision desc limit 25) p;
 if jsonb_array_length(items)>24 then cursor:=(items->23->>'revision')::integer; items:=items-24; end if;
 return jsonb_build_object('items',items,'nextCursor',cursor);
end $$;
do $$ declare f regprocedure; begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
 (n.nspname='app_private' and p.proname in ('commerce_queue_notification','commerce_notification_visible')) or
 (n.nspname='public' and p.proname in ('marketplace_drain_commerce_notifications','marketplace_commerce_notifications','marketplace_commerce_notification_read','marketplace_quotation_history'))
 loop execute format('revoke all on function %s from public,anon,authenticated',f); execute format('grant execute on function %s to service_role',f); end loop;
end $$;
