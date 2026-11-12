-- Bounded specification history; current snapshot remains available separately.
create or replace function app_private.commerce_trading_json(p_request uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('status',app_private.commerce_request_status(t.request_id),'acceptingUntil',t.accepting_until,'currentRevision',app_private.commerce_request_revision_json(r),
 'revisions',(select jsonb_agg(app_private.commerce_request_revision_json(h) order by h.revision desc) from (select * from app_private.marketplace_request_revisions where request_id=t.request_id order by revision desc limit 24) h),
 'revisionsNextCursor',case when r.revision>24 then r.revision-23 else null end)
 from app_private.marketplace_request_trading t join app_private.marketplace_request_revisions r on r.id=t.current_revision_id where t.request_id=p_request;
$$;
create function public.marketplace_request_history(p_actor uuid,p_request uuid,p_supplier uuid,p_after integer) returns jsonb language plpgsql security invoker set search_path='' as $$
declare items jsonb; cursor integer;
begin
 if p_supplier is null then perform app_private.marketplace_assert_quote_request_buyer(p_actor,p_request);
 else perform app_private.commerce_assert_supplier(p_actor,p_supplier,p_request,false); end if;
 select coalesce(jsonb_agg(app_private.commerce_request_revision_json(r) order by r.revision desc),'[]') into items
 from (select * from app_private.marketplace_request_revisions where request_id=p_request and (p_after is null or revision<p_after) order by revision desc limit 25) r;
 if jsonb_array_length(items)>24 then cursor:=(items->23->>'revision')::integer; items:=items-24; end if;
 return jsonb_build_object('items',items,'nextCursor',cursor);
end $$;
revoke all on function public.marketplace_request_history(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.marketplace_request_history(uuid,uuid,uuid,integer) to service_role;
