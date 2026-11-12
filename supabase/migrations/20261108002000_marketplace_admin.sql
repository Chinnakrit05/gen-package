-- Platform scopes are provisioned by a database administrator, never by supplier
-- ownership, the browser, or the application service role. Existing reviewer
-- grants remain independent; their UPDATE(role) privilege cannot expand scopes.
create table app_private.marketplace_admin_grants (
 user_id uuid not null references app_private.app_users(id),
 scope text not null check(scope in ('operations','support','support_supervisor','auditor')),
 primary key(user_id,scope)
);
create table app_private.marketplace_support_cases (
 id uuid primary key default gen_random_uuid(), title text not null check(char_length(title) between 3 and 100),
 reason text not null check(char_length(reason) between 5 and 500),
 assigned_to uuid not null references app_private.app_users(id), created_by uuid not null references app_private.app_users(id),
 conversation_id uuid references app_private.marketplace_conversations(id), order_id uuid references app_private.marketplace_production_orders(id),
 permissions text[] not null check(permissions <@ array['messages','message_files','order_details','order_files']::text[]),
 status text not null default 'open' check(status in ('open','closed')), revision integer not null default 1 check(revision>0),
 created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null,
 check(conversation_id is not null or order_id is not null),
 check(not permissions && array['messages','message_files']::text[] or conversation_id is not null),
 check(not permissions && array['order_details','order_files']::text[] or order_id is not null)
);
create index marketplace_support_cases_assignee_idx on app_private.marketplace_support_cases(assigned_to,id);
create index marketplace_support_cases_open_idx on app_private.marketplace_support_cases(expires_at,id) where status='open';
create table app_private.marketplace_admin_audit (
 id uuid primary key default gen_random_uuid(), actor_id uuid not null references app_private.app_users(id),
 action text not null, object_type text not null, object_id uuid, case_id uuid references app_private.marketplace_support_cases(id),
 reason text not null check(char_length(reason) between 5 and 500), created_at timestamptz not null default clock_timestamp()
);
create index marketplace_admin_audit_actor_idx on app_private.marketplace_admin_audit(actor_id,created_at,id);
create index marketplace_admin_audit_case_idx on app_private.marketplace_admin_audit(case_id,created_at,id);
create table app_private.marketplace_admin_operations (
 actor_id uuid not null references app_private.app_users(id), operation_id uuid not null, payload jsonb not null, result jsonb not null,
 primary key(actor_id,operation_id)
);
create index marketplace_admin_supplier_search_idx on app_private.supplier_profiles(lower(name) text_pattern_ops,id);
create index marketplace_admin_request_search_idx on app_private.quote_request_drafts(lower(title) text_pattern_ops,id);
alter table app_private.marketplace_admin_grants enable row level security;
alter table app_private.marketplace_support_cases enable row level security;
alter table app_private.marketplace_admin_audit enable row level security;
alter table app_private.marketplace_admin_operations enable row level security;
revoke all on app_private.marketplace_admin_grants,app_private.marketplace_support_cases,app_private.marketplace_admin_audit,app_private.marketplace_admin_operations from public,anon,authenticated,service_role;
grant select on app_private.marketplace_admin_grants to service_role;
grant select,insert on app_private.marketplace_support_cases,app_private.marketplace_admin_audit,app_private.marketplace_admin_operations to service_role;
grant update(status,revision) on app_private.marketplace_support_cases to service_role;

-- Fixed, narrow definer helper locks the current grants without granting the
-- service role UPDATE privileges that could assign itself platform access.
create function app_private.marketplace_admin_assert(p_actor uuid,p_scopes text[])
returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from app_private.app_users where id=p_actor and status='active' for share;
 if not found then raise exception 'MARKETPLACE_FORBIDDEN'; end if;
 perform 1 from app_private.marketplace_admin_grants where user_id=p_actor and scope=any(p_scopes) for share;
 if not found then raise exception 'MARKETPLACE_FORBIDDEN'; end if;
end $$;
create function app_private.marketplace_admin_reason(p_reason text)
returns void language plpgsql immutable security invoker set search_path='' as $$
begin
 if p_reason is null or p_reason<>btrim(p_reason) or char_length(p_reason) not between 5 and 500 then raise exception 'VALIDATION_ERROR'; end if;
end $$;
create function app_private.marketplace_admin_log(p_actor uuid,p_action text,p_type text,p_object uuid,p_case uuid,p_reason text)
returns void language sql security invoker set search_path='' as $$
 insert into app_private.marketplace_admin_audit(actor_id,action,object_type,object_id,case_id,reason) values(p_actor,p_action,p_type,p_object,p_case,p_reason);
$$;
create function app_private.marketplace_support_case_json(c app_private.marketplace_support_cases)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',c.id,'title',c.title,'reason',c.reason,'assignedTo',c.assigned_to,'createdBy',c.created_by,'conversationId',c.conversation_id,'orderId',c.order_id,'permissions',c.permissions,'status',c.status,'revision',c.revision,'createdAt',c.created_at,'expiresAt',c.expires_at);
$$;
create function app_private.marketplace_support_assert(p_actor uuid,p_case uuid,p_permission text)
returns app_private.marketplace_support_cases language plpgsql security invoker set search_path='' as $$
declare c app_private.marketplace_support_cases;
begin
 perform app_private.marketplace_admin_assert(p_actor,array['support']);
 select * into c from app_private.marketplace_support_cases where id=p_case and assigned_to=p_actor for share;
 if not found or c.status<>'open' or c.expires_at<=clock_timestamp() or not p_permission=any(c.permissions) then raise exception 'MARKETPLACE_NOT_FOUND'; end if;
 return c;
end $$;
create function public.marketplace_admin_context(p_actor uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from app_private.app_users where id=p_actor and status='active' for share;
 if not found then raise exception 'MARKETPLACE_FORBIDDEN'; end if;
 return jsonb_build_object('scopes',coalesce((select jsonb_agg(scope order by scope) from app_private.marketplace_admin_grants where user_id=p_actor),'[]'::jsonb),'requiresMfa',false);
end $$;
create function public.marketplace_admin_dashboard(p_actor uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 perform app_private.marketplace_admin_assert(p_actor,array['operations']);
 select jsonb_build_object(
 'suppliers',coalesce((select jsonb_object_agg(status,n) from (select status,count(*) n from app_private.supplier_profiles group by status) s),'{}'),
 'requests',(select count(*) from app_private.quote_request_publications),
 'orders',coalesce((select jsonb_object_agg(status,n) from (select status,count(*) n from app_private.marketplace_production_orders group by status) s),'{}'),
 'openCases',(select count(*) from app_private.marketplace_support_cases where status='open' and expires_at>clock_timestamp()),
 'overdueConfirmations',(select count(*) from app_private.marketplace_production_orders where status='pending_supplier_confirmation' and confirmation_deadline<=clock_timestamp())) into result;
 perform app_private.marketplace_admin_log(p_actor,'dashboard_view','dashboard',null,null,'Operational dashboard');
 return result;
end $$;
create function public.marketplace_admin_search(p_actor uuid,p_query text,p_kind text,p_after uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare items jsonb; cursor uuid;
begin
 perform app_private.marketplace_admin_assert(p_actor,array['operations']);
 if p_query is null or p_query<>btrim(p_query) or char_length(p_query) not between 1 and 100 or p_kind is null or p_kind not in ('supplier','request','order') then raise exception 'VALIDATION_ERROR'; end if;
 -- Prefix/exact identifier search is bounded and indexed; no contact data,
 -- project files, quote counts/prices, or message content appears in results.
 with candidates as (
 select s.id,'supplier'::text kind,s.name title,s.status from app_private.supplier_profiles s where p_kind='supplier' and (lower(s.name) like replace(replace(replace(lower(p_query),'\','\\'),'%','\%'),'_','\_')||'%' escape '\' or s.id::text=p_query)
 union all select d.id,'request',d.title,'published' from app_private.quote_request_drafts d join app_private.quote_request_publications p on p.request_id=d.id where p_kind='request' and (lower(d.title) like replace(replace(replace(lower(p_query),'\','\\'),'%','\%'),'_','\_')||'%' escape '\' or d.id::text=p_query)
 union all select o.id,'order',o.request_snapshot->>'title',o.status from app_private.marketplace_production_orders o where p_kind='order' and (o.id::text=p_query or o.request_id::text=p_query)
 ) select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') into items from (select * from candidates where p_after is null or id>p_after order by id limit 25)c;
 if jsonb_array_length(items)>24 then cursor:=(items->23->>'id')::uuid; items:=items-24; end if;
 perform app_private.marketplace_admin_log(p_actor,'search','search',null,null,'Operational metadata search');
 return jsonb_build_object('items',items,'nextCursor',cursor);
end $$;
create function public.marketplace_support_cases(p_actor uuid,p_after uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare items jsonb; cursor uuid; supervisor boolean;
begin
 perform app_private.marketplace_admin_assert(p_actor,array['support','support_supervisor']);
 supervisor:=exists(select 1 from app_private.marketplace_admin_grants where user_id=p_actor and scope='support_supervisor');
 select coalesce(jsonb_agg(app_private.marketplace_support_case_json(c) order by c.id),'[]') into items from (select * from app_private.marketplace_support_cases where (supervisor or assigned_to=p_actor) and (p_after is null or id>p_after) order by id limit 25)c;
 if jsonb_array_length(items)>24 then cursor:=(items->23->>'id')::uuid; items:=items-24; end if;
 perform app_private.marketplace_admin_log(p_actor,'case_list','support_case',null,null,'Assigned support queue');
 return jsonb_build_object('items',items,'nextCursor',cursor);
end $$;
create function public.marketplace_support_case_create(p_actor uuid,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c app_private.marketplace_support_cases; op app_private.marketplace_admin_operations; result jsonb; perms text[]; conversation app_private.marketplace_conversations; production app_private.marketplace_production_orders;
begin
 perform app_private.marketplace_admin_assert(p_actor,array['support_supervisor']);
 if jsonb_typeof(p_input) is distinct from 'object' or not (p_input ?& array['operationId','title','reason','assignedTo','conversationId','orderId','permissions','expiresAt']) or p_input-array['operationId','title','reason','assignedTo','conversationId','orderId','permissions','expiresAt'] <> '{}'::jsonb
 or jsonb_typeof(p_input->'operationId') is distinct from 'string' or jsonb_typeof(p_input->'title') is distinct from 'string' or jsonb_typeof(p_input->'reason') is distinct from 'string' or jsonb_typeof(p_input->'assignedTo') is distinct from 'string' or jsonb_typeof(p_input->'expiresAt') is distinct from 'string' or jsonb_typeof(p_input->'permissions') is distinct from 'array'
 then raise exception 'VALIDATION_ERROR'; end if;
 perform app_private.marketplace_admin_reason(p_input->>'reason');
 if p_input->>'title'<>btrim(p_input->>'title') or char_length(p_input->>'title') not between 3 and 100 then raise exception 'VALIDATION_ERROR'; end if;
 perform pg_advisory_xact_lock(hashtextextended('admin-op:'||p_actor::text||':'||(p_input->>'operationId'),0));
 select * into op from app_private.marketplace_admin_operations where actor_id=p_actor and operation_id=(p_input->>'operationId')::uuid;
 if found then if op.payload<>jsonb_build_object('action','create','input',p_input) then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if; return op.result; end if;
 if (p_input->>'expiresAt')::timestamptz<=clock_timestamp() or (p_input->>'expiresAt')::timestamptz>clock_timestamp()+interval '24 hours' then raise exception 'VALIDATION_ERROR'; end if;
 perform app_private.marketplace_admin_assert((p_input->>'assignedTo')::uuid,array['support']);
 select coalesce(array_agg(x),'{}') into perms from jsonb_array_elements_text(p_input->'permissions') x;
 if cardinality(perms)>4 or not perms<@array['messages','message_files','order_details','order_files']::text[] or array_position(perms,null) is not null or cardinality(perms)<>(select count(distinct x) from unnest(perms)x) then raise exception 'VALIDATION_ERROR'; end if;
 if p_input->>'conversationId' is not null then select * into conversation from app_private.marketplace_conversations where id=(p_input->>'conversationId')::uuid; if not found then raise exception 'MARKETPLACE_NOT_FOUND'; end if; end if;
 if p_input->>'orderId' is not null then select * into production from app_private.marketplace_production_orders where id=(p_input->>'orderId')::uuid; if not found then raise exception 'MARKETPLACE_NOT_FOUND'; end if; end if;
 if conversation.id is null and production.id is null then raise exception 'VALIDATION_ERROR'; end if;
 if conversation.id is not null and production.id is not null and (conversation.request_id<>production.request_id or conversation.supplier_id<>production.supplier_id) then raise exception 'VALIDATION_ERROR'; end if;
 if (perms&&array['messages','message_files']::text[] and conversation.id is null) or (perms&&array['order_details','order_files']::text[] and production.id is null) then raise exception 'VALIDATION_ERROR'; end if;
 insert into app_private.marketplace_support_cases(title,reason,assigned_to,created_by,conversation_id,order_id,permissions,expires_at)
 values(p_input->>'title',p_input->>'reason',(p_input->>'assignedTo')::uuid,p_actor,conversation.id,production.id,perms,(p_input->>'expiresAt')::timestamptz) returning * into c;
 result:=app_private.marketplace_support_case_json(c);
 insert into app_private.marketplace_admin_operations values(p_actor,(p_input->>'operationId')::uuid,jsonb_build_object('action','create','input',p_input),result);
 perform app_private.marketplace_admin_log(p_actor,'case_create','support_case',c.id,c.id,p_input->>'reason');
 return result;
end $$;
create function public.marketplace_support_case_close(p_actor uuid,p_case uuid,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c app_private.marketplace_support_cases; op app_private.marketplace_admin_operations; payload jsonb; result jsonb;
begin
 perform app_private.marketplace_admin_assert(p_actor,array['support','support_supervisor']);
 perform app_private.marketplace_admin_reason(p_input->>'reason');
 if jsonb_typeof(p_input->'operationId') is distinct from 'string' or jsonb_typeof(p_input->'expectedRevision') is distinct from 'number' or (p_input->>'expectedRevision') !~ '^[0-9]+$' then raise exception 'VALIDATION_ERROR'; end if;
 payload:=jsonb_build_object('action','close','case',p_case,'input',p_input);
 perform pg_advisory_xact_lock(hashtextextended('admin-op:'||p_actor::text||':'||(p_input->>'operationId'),0));
 select * into c from app_private.marketplace_support_cases where id=p_case and (assigned_to=p_actor or exists(select 1 from app_private.marketplace_admin_grants where user_id=p_actor and scope='support_supervisor')) for update;
 if not found then raise exception 'MARKETPLACE_NOT_FOUND'; end if;
 select * into op from app_private.marketplace_admin_operations where actor_id=p_actor and operation_id=(p_input->>'operationId')::uuid;
 if found then if op.payload<>payload then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if; return op.result; end if;
 if c.revision<>(p_input->>'expectedRevision')::integer then raise exception 'REVISION_CONFLICT'; end if;
 if c.status<>'open' then raise exception 'MARKETPLACE_CONFLICT'; end if;
 update app_private.marketplace_support_cases set status='closed',revision=revision+1 where id=p_case returning * into c;
 result:=app_private.marketplace_support_case_json(c);
 insert into app_private.marketplace_admin_operations values(p_actor,(p_input->>'operationId')::uuid,payload,result);
 perform app_private.marketplace_admin_log(p_actor,'case_close','support_case',c.id,c.id,p_input->>'reason');
 return result;
end $$;
create function public.marketplace_support_access(p_actor uuid,p_case uuid,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c app_private.marketplace_support_cases; messages jsonb; production jsonb; next_before bigint; view_kind text; before_sequence bigint;
begin
 perform app_private.marketplace_admin_reason(p_input->>'reason');
 view_kind:=p_input->>'view';
 if view_kind is null or view_kind not in ('messages','order_details') then raise exception 'VALIDATION_ERROR'; end if;
 c:=app_private.marketplace_support_assert(p_actor,p_case,view_kind);
 if view_kind='messages' then
  if p_input->>'beforeSequence' is not null and ((p_input->>'beforeSequence') !~ '^[0-9]+$' or (p_input->>'beforeSequence')::numeric not between 1 and 9007199254740991) then raise exception 'VALIDATION_ERROR'; end if;
  before_sequence:=(p_input->>'beforeSequence')::bigint;
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'sequence',m.sequence,'senderName',m.sender_name,'body',m.body,'createdAt',m.created_at,
  'files',case when 'message_files'=any(c.permissions) then coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'mimeType',f.mime_type,'byteSize',f.byte_size) order by f.id) from app_private.marketplace_conversation_file_grants g join app_private.marketplace_conversation_files f on f.conversation_id=g.conversation_id and f.id=g.file_id where g.conversation_id=m.conversation_id and g.message_id=m.id),'[]') else '[]'::jsonb end) order by m.sequence desc),'[]') into messages
  from (select * from app_private.marketplace_conversation_messages where conversation_id=c.conversation_id and (before_sequence is null or sequence<before_sequence) order by sequence desc limit 25)m;
  if jsonb_array_length(messages)>24 then next_before:=(messages->23->>'sequence')::bigint; messages:=messages-24; end if;
 else
  select jsonb_build_object('id',o.id,'requestId',o.request_id,'supplierId',o.supplier_id,'supplierName',o.supplier_name,'status',o.status,'revision',o.revision,'terms',o.terms,'requestSnapshot',o.request_snapshot,
  'proofs',coalesce((select jsonb_agg(jsonb_build_object('id',id,'version',version,'fileId',file_id,'notes',notes) order by version) from app_private.marketplace_order_proofs where order_id=o.id),'[]'),
  'payments',coalesce((select jsonb_agg(jsonb_build_object('id',id,'fileId',file_id,'amountMinor',amount_minor,'reference',reference) order by reported_at,id) from app_private.marketplace_payment_reports where order_id=o.id),'[]')) into production from app_private.marketplace_production_orders o where id=c.order_id;
 end if;
 perform app_private.marketplace_admin_log(p_actor,'case_access_'||view_kind,'support_case',c.id,c.id,p_input->>'reason');
 return jsonb_build_object('case',app_private.marketplace_support_case_json(c),'messages',messages,'nextBeforeSequence',next_before,'order',production);
end $$;
create function public.marketplace_support_file(p_actor uuid,p_case uuid,p_file uuid,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c app_private.marketplace_support_cases; f app_private.marketplace_conversation_files;
begin
 perform app_private.marketplace_admin_reason(p_reason);
 perform app_private.marketplace_admin_assert(p_actor,array['support']);
 select * into c from app_private.marketplace_support_cases where id=p_case and assigned_to=p_actor for share;
 if not found or c.status<>'open' or c.expires_at<=clock_timestamp() then raise exception 'MARKETPLACE_NOT_FOUND'; end if;
 select file_row.* into f from app_private.marketplace_conversation_files file_row where file_row.id=p_file and (
 ('message_files'=any(c.permissions) and file_row.conversation_id=c.conversation_id and exists(select 1 from app_private.marketplace_conversation_file_grants g where g.conversation_id=file_row.conversation_id and g.file_id=file_row.id))
 or ('order_files'=any(c.permissions) and exists(select 1 from app_private.marketplace_order_file_grants g where g.order_id=c.order_id and g.conversation_id=file_row.conversation_id and g.file_id=file_row.id)));
 if not found then raise exception 'MARKETPLACE_NOT_FOUND'; end if;
 perform app_private.marketplace_admin_log(p_actor,'case_file_download','file',p_file,c.id,p_reason);
 return jsonb_build_object('file',jsonb_build_object('id',f.id,'name',f.name,'mimeType',f.mime_type,'byteSize',f.byte_size),'dataBase64',translate(encode(f.content,'base64'),chr(10),''));
end $$;
create function public.marketplace_admin_audit(p_actor uuid,p_after uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare items jsonb; cursor uuid;
begin
 perform app_private.marketplace_admin_assert(p_actor,array['auditor']);
 with events as (
 select id,actor_id,action,object_type,object_id,case_id,reason,created_at from app_private.marketplace_admin_audit
 union all select id,actor_user_id,'supplier_'||action,'supplier',supplier_id,null,coalesce(reason,'Supplier workflow'),created_at from app_private.activity_events
 union all select id,actor_id,kind,'commerce',entity_id,null,'Marketplace transaction',created_at from app_private.marketplace_commerce_events
 ) select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'actorId',e.actor_id,'action',e.action,'objectType',e.object_type,'objectId',e.object_id,'caseId',e.case_id,'reason',e.reason,'createdAt',e.created_at) order by e.id),'[]') into items from (select * from events where p_after is null or id>p_after order by id limit 25)e;
 if jsonb_array_length(items)>24 then cursor:=(items->23->>'id')::uuid; items:=items-24; end if;
 perform app_private.marketplace_admin_log(p_actor,'audit_view','audit',null,null,'Platform audit review');
 return jsonb_build_object('items',items,'nextCursor',cursor);
end $$;
revoke all on function app_private.marketplace_admin_assert(uuid,text[]),app_private.marketplace_admin_reason(text),app_private.marketplace_admin_log(uuid,text,text,uuid,uuid,text),app_private.marketplace_support_case_json(app_private.marketplace_support_cases),app_private.marketplace_support_assert(uuid,uuid,text),public.marketplace_admin_context(uuid),public.marketplace_admin_dashboard(uuid),public.marketplace_admin_search(uuid,text,text,uuid),public.marketplace_support_cases(uuid,uuid),public.marketplace_support_case_create(uuid,jsonb),public.marketplace_support_case_close(uuid,uuid,jsonb),public.marketplace_support_access(uuid,uuid,jsonb),public.marketplace_support_file(uuid,uuid,uuid,text),public.marketplace_admin_audit(uuid,uuid) from public,anon,authenticated;
grant execute on function app_private.marketplace_admin_assert(uuid,text[]),app_private.marketplace_admin_reason(text),app_private.marketplace_admin_log(uuid,text,text,uuid,uuid,text),app_private.marketplace_support_case_json(app_private.marketplace_support_cases),app_private.marketplace_support_assert(uuid,uuid,text),public.marketplace_admin_context(uuid),public.marketplace_admin_dashboard(uuid),public.marketplace_admin_search(uuid,text,text,uuid),public.marketplace_support_cases(uuid,uuid),public.marketplace_support_case_create(uuid,jsonb),public.marketplace_support_case_close(uuid,uuid,jsonb),public.marketplace_support_access(uuid,uuid,jsonb),public.marketplace_support_file(uuid,uuid,uuid,text),public.marketplace_admin_audit(uuid,uuid) to service_role;
