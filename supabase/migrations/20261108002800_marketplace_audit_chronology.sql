-- A support action must be discoverable at the top of history, not positioned
-- by random UUID. Timestamp/ID keyset pagination remains stable as events arrive.
create index marketplace_admin_audit_recent_idx on app_private.marketplace_admin_audit(created_at desc,id desc);
create index marketplace_activity_recent_idx on app_private.activity_events(created_at desc,id desc);
create index marketplace_commerce_events_recent_idx on app_private.marketplace_commerce_events(created_at desc,id desc);
create or replace function public.marketplace_admin_audit(p_actor uuid,p_after uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare items jsonb; cursor uuid; after_time timestamptz;
begin
 perform app_private.marketplace_admin_assert(p_actor,array['auditor']);
 if p_after is not null then
  select e.created_at into after_time from (
   select id,created_at from app_private.marketplace_admin_audit
   union all select id,created_at from app_private.activity_events
   union all select id,created_at from app_private.marketplace_commerce_events
  ) e where e.id=p_after;
  if not found then raise exception 'MARKETPLACE_NOT_FOUND'; end if;
 end if;
 with events as (
 select id,actor_id,action,object_type,object_id,case_id,reason,created_at from app_private.marketplace_admin_audit
 union all select id,actor_user_id,'supplier_'||action,'supplier',supplier_id,null,coalesce(reason,'Supplier workflow'),created_at from app_private.activity_events
 union all select id,actor_id,kind,'commerce',entity_id,null,'Marketplace transaction',created_at from app_private.marketplace_commerce_events
 ) select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'actorId',e.actor_id,'action',e.action,'objectType',e.object_type,'objectId',e.object_id,'caseId',e.case_id,'reason',e.reason,'createdAt',e.created_at) order by e.created_at desc,e.id desc),'[]') into items
 from (select * from events where p_after is null or (created_at,id)<(after_time,p_after) order by created_at desc,id desc limit 25)e;
 if jsonb_array_length(items)>24 then cursor:=(items->23->>'id')::uuid; items:=items-24; end if;
 perform app_private.marketplace_admin_log(p_actor,'audit_view','audit',null,null,'Platform audit review');
 return jsonb_build_object('items',items,'nextCursor',cursor);
end $$;
revoke all on function public.marketplace_admin_audit(uuid,uuid) from public,anon,authenticated;
grant execute on function public.marketplace_admin_audit(uuid,uuid) to service_role;
