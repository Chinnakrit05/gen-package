-- Invited Marketplace members intentionally have no Editor/design membership.
-- Match authoritative Marketplace roles without requiring a design-team grant.
create or replace function app_private.commerce_notification_visible(p_actor uuid,p_event app_private.marketplace_commerce_events)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from app_private.app_users u where u.id=p_actor and u.status='active') and (
 exists(select 1 from app_private.quote_request_drafts d join app_private.workspaces w on w.id=d.workspace_id join app_private.workspace_members m on m.workspace_id=w.id and m.user_id=w.owner_user_id where d.id=p_event.request_id and w.owner_user_id=p_actor and m.role='owner' and p_event.kind<>'request_awarded')
 or exists(select 1 from app_private.supplier_profiles s join app_private.workspace_marketplace_members mm on mm.workspace_id=s.workspace_id
 where s.id=p_event.supplier_id and mm.user_id=p_actor and exists(select 1 from app_private.quote_request_supplier_access a where a.request_id=p_event.request_id and a.supplier_id=s.id)));
$$;

-- Preserve existing supplier request lookup error contract after revision upgrades.
create or replace function public.marketplace_get_supplier_quote_request(p_actor_user_id uuid,p_supplier_id uuid,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 perform app_private.marketplace_assert_quote_request_supplier(p_actor_user_id,p_supplier_id);
 perform app_private.commerce_assert_supplier(p_actor_user_id,p_supplier_id,p_request_id,false);
 select app_private.marketplace_supplier_quote_request_summary(d,p)||jsonb_build_object('notes',r.notes,'spec',r.spec) into result
 from app_private.quote_request_drafts d join app_private.quote_request_publications p on p.request_id=d.id join app_private.marketplace_request_trading t on t.request_id=d.id join app_private.marketplace_request_revisions r on r.id=t.current_revision_id where d.id=p_request_id;
 return result;
end $$;
