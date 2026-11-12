-- Persist first, notify after commit. No message/file content is ever broadcast.
-- Private bounded files use PostgreSQL bytea, as supplier-review documents do;
-- downloads never issue durable bearer URLs and always recheck current membership.
create table app_private.marketplace_conversations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  supplier_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  last_sequence bigint not null default 0 check (last_sequence between 0 and 9007199254740991),
  unique(request_id, supplier_id),
  foreign key(request_id,supplier_id) references app_private.quote_request_supplier_access(request_id,supplier_id) on delete restrict
);
create index marketplace_conversations_supplier_idx on app_private.marketplace_conversations(supplier_id,id);
create table app_private.marketplace_conversation_messages (
  conversation_id uuid not null references app_private.marketplace_conversations(id) on delete restrict,
  id uuid not null,
  sequence bigint not null check(sequence between 1 and 9007199254740991),
  sender_id uuid not null references app_private.app_users(id) on delete restrict,
  sender_name text not null,
  body text not null check(char_length(body)<=4000 and body=btrim(body)),
  created_at timestamptz not null default clock_timestamp(),
  primary key(conversation_id,id),
  unique(conversation_id,sequence)
);
create table app_private.marketplace_conversation_reads (
  conversation_id uuid not null references app_private.marketplace_conversations(id) on delete restrict,
  user_id uuid not null references app_private.app_users(id) on delete restrict,
  last_read_sequence bigint not null check(last_read_sequence>=0),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(conversation_id,user_id)
);
create table app_private.marketplace_conversation_files (
  conversation_id uuid not null references app_private.marketplace_conversations(id) on delete restrict,
  id uuid not null,
  created_by uuid not null references app_private.app_users(id) on delete restrict,
  name text not null,
  mime_type text not null,
  content bytea not null,
  byte_size integer not null check(byte_size between 1 and 2097152),
  created_at timestamptz not null default clock_timestamp(),
  primary key(conversation_id,id),
  check(byte_size=octet_length(content)),
  check(app_private.marketplace_supplier_document_name_valid(name,mime_type)),
  check(app_private.marketplace_supplier_document_mime_matches(mime_type,content))
);
-- A message link is the grant to the other conversation participant. Unsent
-- uploads remain accessible only to their uploader, never to platform support.
create table app_private.marketplace_conversation_file_grants (
  conversation_id uuid not null,
  message_id uuid not null,
  file_id uuid not null,
  primary key(conversation_id,message_id,file_id),
  foreign key(conversation_id,message_id) references app_private.marketplace_conversation_messages(conversation_id,id) on delete restrict,
  foreign key(conversation_id,file_id) references app_private.marketplace_conversation_files(conversation_id,id) on delete restrict
);
create table app_private.marketplace_conversation_outbox (
  conversation_id uuid not null,
  message_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  dispatched_at timestamptz,
  attempts integer not null default 0,
  last_error_code text,
  primary key(conversation_id,message_id),
  foreign key(conversation_id,message_id) references app_private.marketplace_conversation_messages(conversation_id,id) on delete restrict
);

create function app_private.marketplace_conversation_role(p_actor_user_id uuid,p_request_id uuid,p_supplier_id uuid)
returns text language plpgsql security invoker set search_path='' as $$
declare v_role text;
begin
  perform 1 from app_private.quote_request_drafts d
    join app_private.workspaces w on w.id=d.workspace_id
    join app_private.workspace_members m on m.workspace_id=w.id and m.user_id=w.owner_user_id
    join app_private.app_users u on u.id=m.user_id
    where d.id=p_request_id and u.id=p_actor_user_id and u.status='active' and m.role='owner'
    for share of w,m,u;
  if found then return 'buyer'; end if;
  select m.role into v_role from app_private.supplier_profiles s
    join app_private.workspace_marketplace_members m on m.workspace_id=s.workspace_id
    join app_private.app_users u on u.id=m.user_id
    where s.id=p_supplier_id and u.id=p_actor_user_id and u.status='active'
    for share of m,u;
  return v_role;
end; $$;
create function app_private.marketplace_assert_conversation_member(p_actor_user_id uuid,p_conversation_id uuid,p_write boolean)
returns text language plpgsql security invoker set search_path='' as $$
declare v_room app_private.marketplace_conversations; v_role text;
begin
  select * into v_room from app_private.marketplace_conversations where id=p_conversation_id;
  if not found then raise exception using message='CONVERSATION_NOT_FOUND'; end if;
  v_role := app_private.marketplace_conversation_role(p_actor_user_id,v_room.request_id,v_room.supplier_id);
  if v_role is null then raise exception using message='CONVERSATION_NOT_FOUND'; end if;
  if p_write and v_role='viewer' then raise exception using message='MARKETPLACE_FORBIDDEN'; end if;
  return v_role;
end; $$;
create function app_private.marketplace_conversation_json(p_actor_user_id uuid,p_room app_private.marketplace_conversations)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',p_room.id,'requestId',p_room.request_id,'supplierId',p_room.supplier_id,
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
create function app_private.marketplace_conversation_file_json(p_file app_private.marketplace_conversation_files)
returns jsonb language sql stable security invoker set search_path='' as $$
select jsonb_build_object('id',p_file.id,'name',p_file.name,'mimeType',p_file.mime_type,'byteSize',p_file.byte_size,'createdAt',p_file.created_at);
$$;
create function app_private.marketplace_conversation_message_json(p_message app_private.marketplace_conversation_messages)
returns jsonb language sql stable security invoker set search_path='' as $$
select jsonb_build_object('id',p_message.id,'conversationId',p_message.conversation_id,'sequence',p_message.sequence,
  'senderId',p_message.sender_id,'senderName',p_message.sender_name,'body',p_message.body,'createdAt',p_message.created_at,
  'attachments',coalesce((select jsonb_agg(app_private.marketplace_conversation_file_json(f) order by f.id)
    from app_private.marketplace_conversation_file_grants g join app_private.marketplace_conversation_files f on f.conversation_id=g.conversation_id and f.id=g.file_id
    where g.conversation_id=p_message.conversation_id and g.message_id=p_message.id),'[]'::jsonb));
$$;

create function public.marketplace_ensure_conversation(p_actor_user_id uuid,p_request_id uuid,p_supplier_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_room app_private.marketplace_conversations; v_role text;
begin
  if p_request_id is null or p_supplier_id is null then raise exception using message='VALIDATION_ERROR'; end if;
  v_role:=app_private.marketplace_conversation_role(p_actor_user_id,p_request_id,p_supplier_id);
  if v_role is null then raise exception using message='CONVERSATION_NOT_FOUND'; end if;
  if v_role='viewer' then raise exception using message='MARKETPLACE_FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended('conversation:'||p_request_id::text||':'||p_supplier_id::text,0));
  select * into v_room from app_private.marketplace_conversations where request_id=p_request_id and supplier_id=p_supplier_id;
  if not found then
    perform 1 from app_private.quote_request_supplier_access a join app_private.supplier_profiles s on s.id=a.supplier_id
      where a.request_id=p_request_id and a.supplier_id=p_supplier_id and s.status='approved' for share of s;
    if not found then raise exception using message='CONVERSATION_NOT_FOUND'; end if;
    insert into app_private.marketplace_conversations(request_id,supplier_id) values(p_request_id,p_supplier_id) returning * into v_room;
  end if;
  return app_private.marketplace_conversation_json(p_actor_user_id,v_room);
end; $$;
create function public.marketplace_get_conversation(p_actor_user_id uuid,p_conversation_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  perform app_private.marketplace_assert_conversation_member(p_actor_user_id,p_conversation_id,false);
  return (select app_private.marketplace_conversation_json(p_actor_user_id,c) from app_private.marketplace_conversations c where id=p_conversation_id);
end; $$;
create function public.marketplace_list_conversations(p_actor_user_id uuid,p_after uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_items jsonb:='[]'::jsonb; v_room app_private.marketplace_conversations; v_cursor uuid;
begin
  perform app_private.marketplace_assert_active(p_actor_user_id);
  for v_room in select c.* from app_private.marketplace_conversations c
    join app_private.quote_request_drafts d on d.id=c.request_id
    join app_private.supplier_profiles s on s.id=c.supplier_id
    where (p_after is null or c.id>p_after) and (
      exists(select 1 from app_private.workspaces w join app_private.workspace_members m on m.workspace_id=w.id and m.user_id=w.owner_user_id where w.id=d.workspace_id and w.owner_user_id=p_actor_user_id and m.role='owner')
      or exists(select 1 from app_private.workspace_marketplace_members m where m.workspace_id=s.workspace_id and m.user_id=p_actor_user_id))
    order by c.id limit 25
  loop
    -- Acquire current membership locks for each returned record, as on detail.
    perform app_private.marketplace_assert_conversation_member(p_actor_user_id,v_room.id,false);
    v_items:=v_items||jsonb_build_array(app_private.marketplace_conversation_json(p_actor_user_id,v_room));
  end loop;
  if jsonb_array_length(v_items)>24 then v_cursor:=(v_items->23->>'id')::uuid; v_items:=v_items-24; end if;
  return jsonb_build_object('items',v_items,'nextCursor',v_cursor);
end; $$;
create function public.marketplace_list_conversation_messages(p_actor_user_id uuid,p_conversation_id uuid,p_before bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_items jsonb; v_cursor bigint;
begin
  perform app_private.marketplace_assert_conversation_member(p_actor_user_id,p_conversation_id,false);
  if p_before is not null and p_before<1 then raise exception using message='VALIDATION_ERROR'; end if;
  select coalesce(jsonb_agg(app_private.marketplace_conversation_message_json(m) order by m.sequence desc),'[]'::jsonb)
    into v_items from (select * from app_private.marketplace_conversation_messages where conversation_id=p_conversation_id and (p_before is null or sequence<p_before) order by sequence desc limit 41) m;
  if jsonb_array_length(v_items)>40 then v_cursor:=(v_items->39->>'sequence')::bigint; v_items:=v_items-40; end if;
  select coalesce(jsonb_agg(e.value order by e.ordinality desc),'[]'::jsonb) into v_items from jsonb_array_elements(v_items) with ordinality e;
  return jsonb_build_object('items',v_items,'nextCursor',v_cursor);
end; $$;
create function public.marketplace_send_conversation_message(p_actor_user_id uuid,p_conversation_id uuid,p_operation_id uuid,p_body text,p_attachment_ids uuid[])
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_message app_private.marketplace_conversation_messages; v_sequence bigint; v_existing_ids uuid[]; v_ids uuid[];
begin
  perform app_private.marketplace_assert_conversation_member(p_actor_user_id,p_conversation_id,true);
  if p_operation_id is null or p_body is null or p_body<>btrim(p_body) or char_length(p_body)>4000
    or p_attachment_ids is null or cardinality(p_attachment_ids)>3
    or (p_body='' and cardinality(p_attachment_ids)=0)
    or exists(select 1 from unnest(p_attachment_ids) i where i is null)
    or (cardinality(p_attachment_ids)>0 and array_ndims(p_attachment_ids)<>1)
    then raise exception using message='VALIDATION_ERROR'; end if;
  select coalesce(array_agg(distinct i order by i),'{}'::uuid[]) into v_ids from unnest(p_attachment_ids) i;
  if cardinality(v_ids)<>cardinality(p_attachment_ids) then raise exception using message='VALIDATION_ERROR'; end if;
  perform 1 from app_private.marketplace_conversations where id=p_conversation_id for update;
  select * into v_message from app_private.marketplace_conversation_messages where conversation_id=p_conversation_id and id=p_operation_id;
  if found then
    select coalesce(array_agg(file_id order by file_id),'{}'::uuid[]) into v_existing_ids from app_private.marketplace_conversation_file_grants where conversation_id=p_conversation_id and message_id=p_operation_id;
    if v_message.sender_id<>p_actor_user_id or v_message.body<>p_body or v_existing_ids<>v_ids then raise exception using message='IDEMPOTENCY_KEY_REUSED'; end if;
    return app_private.marketplace_conversation_message_json(v_message);
  end if;
  if (select count(*) from app_private.marketplace_conversation_files where conversation_id=p_conversation_id and id=any(v_ids) and created_by=p_actor_user_id)<>cardinality(v_ids) then raise exception using message='CONVERSATION_NOT_FOUND'; end if;
  update app_private.marketplace_conversations set last_sequence=last_sequence+1,updated_at=clock_timestamp() where id=p_conversation_id returning last_sequence into v_sequence;
  insert into app_private.marketplace_conversation_messages(conversation_id,id,sequence,sender_id,sender_name,body)
    values(p_conversation_id,p_operation_id,v_sequence,p_actor_user_id,(select display_name from app_private.app_users where id=p_actor_user_id),p_body) returning * into v_message;
  insert into app_private.marketplace_conversation_file_grants(conversation_id,message_id,file_id) select p_conversation_id,p_operation_id,i from unnest(v_ids) i;
  insert into app_private.marketplace_conversation_outbox(conversation_id,message_id) values(p_conversation_id,p_operation_id);
  return app_private.marketplace_conversation_message_json(v_message);
end; $$;
create function public.marketplace_read_conversation(p_actor_user_id uuid,p_conversation_id uuid,p_sequence bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_sequence bigint;
begin
  perform app_private.marketplace_assert_conversation_member(p_actor_user_id,p_conversation_id,false);
  if p_sequence is null or p_sequence<0 or p_sequence>(select last_sequence from app_private.marketplace_conversations where id=p_conversation_id) then raise exception using message='VALIDATION_ERROR'; end if;
  insert into app_private.marketplace_conversation_reads(conversation_id,user_id,last_read_sequence) values(p_conversation_id,p_actor_user_id,p_sequence)
    on conflict(conversation_id,user_id) do update set last_read_sequence=greatest(app_private.marketplace_conversation_reads.last_read_sequence,excluded.last_read_sequence),updated_at=clock_timestamp()
    returning last_read_sequence into v_sequence;
  return jsonb_build_object('lastReadSequence',v_sequence);
end; $$;
create function public.marketplace_upload_conversation_file(p_actor_user_id uuid,p_conversation_id uuid,p_operation_id uuid,p_name text,p_mime_type text,p_data_base64 text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_content bytea; v_file app_private.marketplace_conversation_files; v_workspace_id uuid;
begin
  perform app_private.marketplace_assert_conversation_member(p_actor_user_id,p_conversation_id,true);
  if p_operation_id is null or not app_private.marketplace_supplier_document_name_valid(p_name,p_mime_type)
    or p_data_base64 is null or octet_length(p_data_base64) not between 4 and 2796204 or p_data_base64 collate "C" !~ '^[A-Za-z0-9+/]+={0,2}$' then raise exception using message='VALIDATION_ERROR'; end if;
  begin v_content:=decode(p_data_base64,'base64'); exception when invalid_parameter_value then raise exception using message='VALIDATION_ERROR'; end;
  if octet_length(v_content) not between 1 and 2097152 or not app_private.marketplace_supplier_document_mime_matches(p_mime_type,v_content) then raise exception using message='VALIDATION_ERROR'; end if;
  select d.workspace_id into v_workspace_id from app_private.marketplace_conversations c join app_private.quote_request_drafts d on d.id=c.request_id where c.id=p_conversation_id;
  perform pg_advisory_xact_lock(hashtextextended('conversation-storage:'||v_workspace_id::text,0));
  perform 1 from app_private.marketplace_conversations where id=p_conversation_id for update;
  select * into v_file from app_private.marketplace_conversation_files where conversation_id=p_conversation_id and id=p_operation_id;
  if found then
    if v_file.created_by<>p_actor_user_id or v_file.name<>p_name or v_file.mime_type<>p_mime_type or v_file.content<>v_content then raise exception using message='IDEMPOTENCY_KEY_REUSED'; end if;
    return app_private.marketplace_conversation_file_json(v_file);
  end if;
  if (select count(*) from app_private.marketplace_conversation_files where conversation_id=p_conversation_id)>=50
    or (select coalesce(sum(f.byte_size),0) from app_private.marketplace_conversation_files f join app_private.marketplace_conversations c on c.id=f.conversation_id join app_private.quote_request_drafts d on d.id=c.request_id where d.workspace_id=v_workspace_id)+octet_length(v_content)>104857600
    then raise exception using message='CONVERSATION_FILE_LIMIT'; end if;
  insert into app_private.marketplace_conversation_files(conversation_id,id,created_by,name,mime_type,content,byte_size)
    values(p_conversation_id,p_operation_id,p_actor_user_id,p_name,p_mime_type,v_content,octet_length(v_content)) returning * into v_file;
  return app_private.marketplace_conversation_file_json(v_file);
end; $$;
create function public.marketplace_download_conversation_file(p_actor_user_id uuid,p_conversation_id uuid,p_file_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_file app_private.marketplace_conversation_files;
begin
  perform app_private.marketplace_assert_conversation_member(p_actor_user_id,p_conversation_id,false);
  select * into v_file from app_private.marketplace_conversation_files f where f.conversation_id=p_conversation_id and f.id=p_file_id
    and (f.created_by=p_actor_user_id or exists(select 1 from app_private.marketplace_conversation_file_grants g where g.conversation_id=f.conversation_id and g.file_id=f.id));
  if not found then raise exception using message='CONVERSATION_NOT_FOUND'; end if;
  return jsonb_build_object('file',app_private.marketplace_conversation_file_json(v_file),'dataBase64',translate(encode(v_file.content,'base64'),chr(10),''));
end; $$;

-- Realtime authorizes only private, exact room topics against JWT issuer+subject.
-- Deliberately broadcast no message/file/price/user data. A cached subscription
-- never grants access to API data; clients must clear data after any 403/404.
create function public.marketplace_can_receive_conversation(p_topic text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from app_private.marketplace_conversations c
    join app_private.quote_request_drafts d on d.id=c.request_id
    join app_private.supplier_profiles s on s.id=c.supplier_id
    join app_private.auth_identities i on i.subject=auth.uid()::text and i.issuer=auth.jwt()->>'iss'
    join app_private.app_users u on u.id=i.app_user_id and u.status='active'
    where p_topic='marketplace:conversation:'||c.id::text and (
      exists(select 1 from app_private.workspaces w join app_private.workspace_members m on m.workspace_id=w.id and m.user_id=w.owner_user_id where w.id=d.workspace_id and w.owner_user_id=u.id and m.role='owner')
      or exists(select 1 from app_private.workspace_marketplace_members m where m.workspace_id=s.workspace_id and m.user_id=u.id)));
$$;
revoke all on function public.marketplace_can_receive_conversation(text) from public,anon;
grant execute on function public.marketplace_can_receive_conversation(text) to authenticated,service_role;
create policy marketplace_conversation_receive on realtime.messages for select to authenticated
  using (extension='broadcast' and public.marketplace_can_receive_conversation(realtime.topic()));
-- A failed Realtime dispatch never rolls back the durable message or grant.
-- Operational retry is a service-only bounded job; dispatched means enqueued,
-- not proof that any client received the event. Reconnect always reloads API.
create function app_private.marketplace_dispatch_conversation_notification(p_conversation_id uuid,p_message_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  begin
    perform realtime.send('{}'::jsonb,'changed','marketplace:conversation:'||p_conversation_id::text,true);
    update app_private.marketplace_conversation_outbox set dispatched_at=clock_timestamp(),attempts=attempts+1,last_error_code=null where conversation_id=p_conversation_id and message_id=p_message_id;
    return true;
  exception when others then
    update app_private.marketplace_conversation_outbox set attempts=attempts+1,last_error_code=sqlstate where conversation_id=p_conversation_id and message_id=p_message_id;
    return false;
  end;
end; $$;
revoke all on function app_private.marketplace_dispatch_conversation_notification(uuid,uuid) from public,anon,authenticated,service_role;
create function app_private.marketplace_broadcast_conversation_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform app_private.marketplace_dispatch_conversation_notification(new.conversation_id,new.message_id);
  return new;
end; $$;
revoke all on function app_private.marketplace_broadcast_conversation_change() from public,anon,authenticated,service_role;
create trigger marketplace_conversation_outbox_broadcast after insert on app_private.marketplace_conversation_outbox
for each row execute function app_private.marketplace_broadcast_conversation_change();
create function public.marketplace_retry_conversation_notifications(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row app_private.marketplace_conversation_outbox; v_sent integer:=0; v_failed integer:=0;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception using message='VALIDATION_ERROR'; end if;
  for v_row in select * from app_private.marketplace_conversation_outbox where dispatched_at is null order by created_at limit p_limit for update skip locked loop
    if app_private.marketplace_dispatch_conversation_notification(v_row.conversation_id,v_row.message_id) then v_sent:=v_sent+1; else v_failed:=v_failed+1; end if;
  end loop;
  return jsonb_build_object('dispatched',v_sent,'failed',v_failed);
end; $$;
revoke all on function public.marketplace_retry_conversation_notifications(integer) from public,anon,authenticated;
grant execute on function public.marketplace_retry_conversation_notifications(integer) to service_role;

-- All application RPCs are invoker functions restricted to the server role.
do $$ declare v_name text; v_proc regprocedure; begin
  foreach v_name in array array['marketplace_conversations','marketplace_conversation_messages','marketplace_conversation_reads','marketplace_conversation_files','marketplace_conversation_file_grants','marketplace_conversation_outbox'] loop
    execute format('alter table app_private.%I enable row level security',v_name);
    execute format('revoke all on table app_private.%I from public,anon,authenticated,service_role',v_name);
    execute format('grant select,insert on table app_private.%I to service_role',v_name);
  end loop;
  for v_proc in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='app_private' and p.proname in ('marketplace_conversation_role','marketplace_assert_conversation_member','marketplace_conversation_json','marketplace_conversation_file_json','marketplace_conversation_message_json'))
      or (n.nspname='public' and p.proname in ('marketplace_ensure_conversation','marketplace_get_conversation','marketplace_list_conversations','marketplace_list_conversation_messages','marketplace_send_conversation_message','marketplace_read_conversation','marketplace_upload_conversation_file','marketplace_download_conversation_file'))
  loop execute format('revoke all on function %s from public,anon,authenticated',v_proc); execute format('grant execute on function %s to service_role',v_proc); end loop;
end; $$;
grant update(last_sequence,updated_at) on app_private.marketplace_conversations to service_role;
grant update(last_read_sequence,updated_at) on app_private.marketplace_conversation_reads to service_role;

-- Order RPCs may validate an unsent upload at proof/payment creation, then
-- persist their own exact order-file grant. Do not expose the returned bytea
-- before independently checking that order grant and current order membership.
create function app_private.marketplace_order_conversation_file(p_actor_user_id uuid,p_request_id uuid,p_supplier_id uuid,p_file_id uuid,p_require_uploader boolean)
returns app_private.marketplace_conversation_files language plpgsql security invoker set search_path='' as $$
declare v_room_id uuid; v_file app_private.marketplace_conversation_files;
begin
  select id into v_room_id from app_private.marketplace_conversations where request_id=p_request_id and supplier_id=p_supplier_id;
  perform app_private.marketplace_assert_conversation_member(p_actor_user_id,v_room_id,false);
  if p_require_uploader is null then raise exception using message='VALIDATION_ERROR'; end if;
  select * into v_file from app_private.marketplace_conversation_files f where f.conversation_id=v_room_id and f.id=p_file_id
    and (f.created_by=p_actor_user_id or (not p_require_uploader and exists(select 1 from app_private.marketplace_conversation_file_grants g where g.conversation_id=f.conversation_id and g.file_id=f.id)));
  if not found then raise exception using message='CONVERSATION_NOT_FOUND'; end if;
  return v_file;
end; $$;
revoke all on function app_private.marketplace_order_conversation_file(uuid,uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function app_private.marketplace_order_conversation_file(uuid,uuid,uuid,uuid,boolean) to service_role;
