-- Shared conversation routes use the same authoritative actor side as permissions.
-- Buyer ownership takes precedence when the actor also belongs to the supplier.
create or replace function app_private.marketplace_conversation_json(p_actor_user_id uuid,p_room app_private.marketplace_conversations)
returns jsonb language sql volatile security invoker set search_path='' as $$
  select jsonb_build_object('id',p_room.id,'requestId',p_room.request_id,'supplierId',p_room.supplier_id,
    'side',case when app_private.marketplace_conversation_role(p_actor_user_id,p_room.request_id,p_room.supplier_id)='buyer' then 'buyer' else 'supplier' end,
    'supplierName',s.name,'requestTitle',d.title,'createdAt',p_room.created_at,'updatedAt',p_room.updated_at,
    'lastSequence',p_room.last_sequence,'lastReadSequence',coalesce(r.last_read_sequence,0),
    'unreadCount',(select count(*) from app_private.marketplace_conversation_messages m where m.conversation_id=p_room.id and m.sequence>coalesce(r.last_read_sequence,0) and m.sender_id<>p_actor_user_id),
    'canWrite',exists(select 1 from app_private.workspaces w join app_private.workspace_members wm on wm.workspace_id=w.id and wm.user_id=w.owner_user_id where w.id=d.workspace_id and w.owner_user_id=p_actor_user_id and wm.role='owner')
      or exists(select 1 from app_private.workspace_marketplace_members mm where mm.workspace_id=s.workspace_id and mm.user_id=p_actor_user_id and mm.role in ('manager','staff')),
    'realtimeTopic','marketplace:conversation:'||p_room.id::text)
  from app_private.quote_request_drafts d join app_private.supplier_profiles s on s.id=p_room.supplier_id
  left join app_private.marketplace_conversation_reads r on r.conversation_id=p_room.id and r.user_id=p_actor_user_id
  where d.id=p_room.request_id;
$$;
