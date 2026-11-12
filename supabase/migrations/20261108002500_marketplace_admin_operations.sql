-- Scoped account moderation is not supplier suspension or team removal. No
-- grants are automatically assigned, and no accounts are modified by migration.
alter table app_private.marketplace_admin_grants drop constraint marketplace_admin_grants_scope_check;
alter table app_private.marketplace_admin_grants add constraint marketplace_admin_grants_scope_check
 check(scope in ('operations','support','support_supervisor','auditor','user_moderator'));
alter table app_private.app_users add column moderation_revision integer not null default 1 check(moderation_revision>0);
create index marketplace_admin_user_search_idx on app_private.app_users(lower(display_name) text_pattern_ops,id);
create function app_private.marketplace_admin_user_json(p_actor uuid,u app_private.app_users)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',u.id,'displayName',u.display_name,'status',u.status,'revision',u.moderation_revision,'createdAt',u.created_at,
 'canChangeStatus',u.id<>p_actor and u.status<>'deleted' and not exists(select 1 from app_private.platform_staff where user_id=u.id) and not exists(select 1 from app_private.marketplace_admin_grants where user_id=u.id));
$$;
create function public.marketplace_admin_users(p_actor uuid,p_query text,p_after uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare items jsonb; cursor uuid;
begin
 perform app_private.marketplace_admin_assert(p_actor,array['user_moderator']);
 if p_query is null or p_query<>btrim(p_query) or char_length(p_query) not between 1 and 100 then raise exception 'VALIDATION_ERROR'; end if;
 select coalesce(jsonb_agg(app_private.marketplace_admin_user_json(p_actor,u) order by u.id),'[]') into items from (
 select * from app_private.app_users where (p_after is null or id>p_after) and (id::text=p_query or lower(display_name) like replace(replace(replace(lower(p_query),'\','\\'),'%','\%'),'_','\_')||'%' escape '\') order by id limit 25)u;
 if jsonb_array_length(items)>24 then cursor:=(items->23->>'id')::uuid; items:=items-24; end if;
 perform app_private.marketplace_admin_log(p_actor,'user_search','user',null,null,'Account moderation search');
 return jsonb_build_object('items',items,'nextCursor',cursor);
end $$;
create function public.marketplace_admin_user_status(p_actor uuid,p_user uuid,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare u app_private.app_users; op app_private.marketplace_admin_operations; payload jsonb; result jsonb;
begin
 perform app_private.marketplace_admin_assert(p_actor,array['user_moderator']);
 if jsonb_typeof(p_input) is distinct from 'object' or not (p_input ?& array['operationId','expectedRevision','status','reason']) or p_input-array['operationId','expectedRevision','status','reason']<>'{}'::jsonb
 or jsonb_typeof(p_input->'operationId') is distinct from 'string' or jsonb_typeof(p_input->'expectedRevision') is distinct from 'number' or (p_input->>'expectedRevision') !~ '^[0-9]+$'
 or jsonb_typeof(p_input->'status') is distinct from 'string' or p_input->>'status' not in ('active','suspended') or jsonb_typeof(p_input->'reason') is distinct from 'string' then raise exception 'VALIDATION_ERROR'; end if;
 perform app_private.marketplace_admin_reason(p_input->>'reason');
 if p_user=p_actor or exists(select 1 from app_private.platform_staff where user_id=p_user) or exists(select 1 from app_private.marketplace_admin_grants where user_id=p_user) then raise exception 'MARKETPLACE_FORBIDDEN'; end if;
 payload:=jsonb_build_object('action','user_status','user',p_user,'input',p_input);
 perform pg_advisory_xact_lock(hashtextextended('admin-op:'||p_actor::text||':'||(p_input->>'operationId'),0));
 select * into u from app_private.app_users where id=p_user for update;
 if not found then raise exception 'MARKETPLACE_NOT_FOUND'; end if;
 -- Platform staff are changed only through the separately controlled grant
 -- provisioning process. This endpoint cannot lock out the operator or staff.
 if u.status='deleted' or exists(select 1 from app_private.platform_staff where user_id=p_user) or exists(select 1 from app_private.marketplace_admin_grants where user_id=p_user) then raise exception 'MARKETPLACE_FORBIDDEN'; end if;
 select * into op from app_private.marketplace_admin_operations where actor_id=p_actor and operation_id=(p_input->>'operationId')::uuid;
 if found then if op.payload<>payload then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if; return op.result; end if;
 if u.moderation_revision<>(p_input->>'expectedRevision')::integer then raise exception 'REVISION_CONFLICT'; end if;
 if u.status=p_input->>'status' then raise exception 'MARKETPLACE_CONFLICT'; end if;
 update app_private.app_users set status=p_input->>'status',moderation_revision=moderation_revision+1,updated_at=clock_timestamp() where id=p_user returning * into u;
 result:=app_private.marketplace_admin_user_json(p_actor,u);
 insert into app_private.marketplace_admin_operations values(p_actor,(p_input->>'operationId')::uuid,payload,result);
 perform app_private.marketplace_admin_log(p_actor,'user_'||u.status,'user',u.id,null,p_input->>'reason');
 return result;
end $$;
create function public.marketplace_admin_maintenance(p_actor uuid,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare op app_private.marketplace_admin_operations; payload jsonb; result jsonb; candidate record; expired app_private.marketplace_production_orders; n integer:=0; commerce_result jsonb; chat_result jsonb;
begin
 perform app_private.marketplace_admin_assert(p_actor,array['operations']);
 if jsonb_typeof(p_input) is distinct from 'object' or not (p_input ?& array['operationId','reason']) or p_input-array['operationId','reason']<>'{}'::jsonb or jsonb_typeof(p_input->'operationId') is distinct from 'string' or jsonb_typeof(p_input->'reason') is distinct from 'string' then raise exception 'VALIDATION_ERROR'; end if;
 perform app_private.marketplace_admin_reason(p_input->>'reason');
 payload:=jsonb_build_object('action','maintenance','input',p_input);
 perform pg_advisory_xact_lock(hashtextextended('admin-op:'||p_actor::text||':'||(p_input->>'operationId'),0));
 select * into op from app_private.marketplace_admin_operations where actor_id=p_actor and operation_id=(p_input->>'operationId')::uuid;
 if found then if op.payload<>payload then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if; return op.result; end if;
 -- Never lock an order before its request: selection/confirmation use this
 -- same request-first lock order. Busy requests are skipped for the next run.
 for candidate in select id,request_id from app_private.marketplace_production_orders where status='pending_supplier_confirmation' and confirmation_deadline<=clock_timestamp() order by confirmation_deadline,id limit 100 loop
  if pg_try_advisory_xact_lock(hashtextextended('commerce-request:'||candidate.request_id::text,0)) then
   update app_private.marketplace_production_orders set status='expired',revision=revision+1 where id=candidate.id and status='pending_supplier_confirmation' and confirmation_deadline<=clock_timestamp() returning * into expired;
   if found then
    n:=n+1;
    insert into app_private.marketplace_commerce_events(request_id,supplier_id,actor_id,kind,entity_id) values(expired.request_id,expired.supplier_id,p_actor,'order_expired',expired.id);
   end if;
  end if;
 end loop;
 commerce_result:=public.marketplace_drain_commerce_notifications(100);
 chat_result:=public.marketplace_retry_conversation_notifications(100);
 result:=jsonb_build_object('expiredOrders',n,'commerceNotifications',coalesce((commerce_result->>'processed')::integer,0),'chatNotifications',coalesce((chat_result->>'dispatched')::integer,0),'chatFailures',coalesce((chat_result->>'failed')::integer,0));
 insert into app_private.marketplace_admin_operations values(p_actor,(p_input->>'operationId')::uuid,payload,result);
 perform app_private.marketplace_admin_log(p_actor,'maintenance','maintenance',null,null,p_input->>'reason');
 return result;
end $$;
revoke all on function app_private.marketplace_admin_user_json(uuid,app_private.app_users),public.marketplace_admin_users(uuid,text,uuid),public.marketplace_admin_user_status(uuid,uuid,jsonb),public.marketplace_admin_maintenance(uuid,jsonb) from public,anon,authenticated;
grant execute on function app_private.marketplace_admin_user_json(uuid,app_private.app_users),public.marketplace_admin_users(uuid,text,uuid),public.marketplace_admin_user_status(uuid,uuid,jsonb),public.marketplace_admin_maintenance(uuid,jsonb) to service_role;
