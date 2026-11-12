-- Immutable sent price revisions. All entry points use the current actor, never JWT business roles.
create table app_private.marketplace_quotations (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references app_private.quote_request_publications(request_id),
 supplier_id uuid not null references app_private.supplier_profiles(id),
 revision integer not null default 1 check(revision>0),
 status text not null default 'draft' check(status in ('draft','sent','withdrawn')),
 draft jsonb not null,
 current_revision_id uuid,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique(request_id,supplier_id)
);
create table app_private.marketplace_quotation_revisions (
 id uuid primary key default gen_random_uuid(),
 quotation_id uuid not null references app_private.marketplace_quotations(id),
 request_revision_id uuid not null references app_private.quote_request_publications(revision_id),
 revision integer not null check(revision>0),
 terms jsonb not null,
 sent_at timestamptz not null default clock_timestamp(),
 unique(quotation_id,revision), unique(quotation_id,id)
);
alter table app_private.marketplace_quotations add foreign key(id,current_revision_id)
 references app_private.marketplace_quotation_revisions(quotation_id,id);
create table app_private.marketplace_commerce_operations (
 actor_id uuid not null references app_private.app_users(id), operation_id uuid not null,
 payload jsonb not null, result jsonb not null, created_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,operation_id)
);
create table app_private.marketplace_commerce_events (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references app_private.quote_request_publications(request_id),
 supplier_id uuid not null references app_private.supplier_profiles(id), actor_id uuid not null references app_private.app_users(id),
 kind text not null, entity_id uuid not null, created_at timestamptz not null default clock_timestamp()
);
create index marketplace_quotation_supplier_idx on app_private.marketplace_quotations(supplier_id,id);
create index marketplace_commerce_events_request_idx on app_private.marketplace_commerce_events(request_id,created_at,id);
alter table app_private.marketplace_quotations enable row level security;
alter table app_private.marketplace_quotation_revisions enable row level security;
alter table app_private.marketplace_commerce_operations enable row level security;
alter table app_private.marketplace_commerce_events enable row level security;
revoke all on app_private.marketplace_quotations,app_private.marketplace_quotation_revisions,app_private.marketplace_commerce_operations,app_private.marketplace_commerce_events from public,anon,authenticated,service_role;
grant select,insert,update on app_private.marketplace_quotations to service_role;
grant select,insert on app_private.marketplace_quotation_revisions,app_private.marketplace_commerce_operations,app_private.marketplace_commerce_events to service_role;

create function app_private.commerce_assert_supplier(p_actor uuid,p_supplier uuid,p_request uuid,p_write boolean)
returns void language plpgsql security invoker set search_path='' as $$
begin
 perform app_private.marketplace_member_role(p_actor,p_supplier,p_write);
 perform app_private.marketplace_assert_quote_request_supplier(p_actor,p_supplier);
 perform 1 from app_private.quote_request_supplier_access where request_id=p_request and supplier_id=p_supplier;
 if not found then raise exception 'QUOTE_REQUEST_NOT_FOUND'; end if;
end $$;
create function app_private.commerce_quote_json(p_quote app_private.marketplace_quotations,p_buyer boolean)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',p_quote.id,'requestId',p_quote.request_id,'supplierId',p_quote.supplier_id,
 'supplierName',(select name from app_private.supplier_profiles where id=p_quote.supplier_id),
 'requestTitle',(select title from app_private.quote_request_drafts where id=p_quote.request_id),
 'revision',p_quote.revision,'status',p_quote.status,'draft',case when p_buyer then null else p_quote.draft end,
 'current',(select terms||jsonb_build_object('id',id,'quotationId',quotation_id,'revision',revision,'sentAt',sent_at) from app_private.marketplace_quotation_revisions where id=p_quote.current_revision_id),
 'createdAt',p_quote.created_at,'updatedAt',p_quote.updated_at);
$$;
create function app_private.commerce_validate_terms(p_terms jsonb,p_request uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_terms is null or jsonb_typeof(p_terms)<>'object' or not (p_terms ?& array['requestRevisionId','totalMinor','currency','leadDays','validUntil','depositMinor','requiresProof','notes'])
 or jsonb_typeof(p_terms->'requestRevisionId') is distinct from 'string'
 or jsonb_typeof(p_terms->'validUntil') is distinct from 'string'
 or (p_terms->>'currency') is distinct from 'THB'
 or jsonb_typeof(p_terms->'totalMinor')<>'number' or (p_terms->>'totalMinor') !~ '^[0-9]+$'
 or (p_terms->>'totalMinor')::numeric not between 1 and 100000000000
 or jsonb_typeof(p_terms->'depositMinor')<>'number' or (p_terms->>'depositMinor') !~ '^[0-9]+$'
 or (p_terms->>'depositMinor')::numeric not between 0 and (p_terms->>'totalMinor')::numeric
 or jsonb_typeof(p_terms->'leadDays')<>'number' or (p_terms->>'leadDays') !~ '^[0-9]+$'
 or (p_terms->>'leadDays')::integer not between 1 and 365
 or jsonb_typeof(p_terms->'requiresProof')<>'boolean' or jsonb_typeof(p_terms->'notes')<>'string'
 or char_length(p_terms->>'notes')>4000
 or (p_terms->>'validUntil')::timestamptz<=clock_timestamp()
 or (p_terms->>'validUntil')::timestamptz>clock_timestamp()+interval '365 days'
 then raise exception 'VALIDATION_ERROR'; end if;
 if not exists(select 1 from app_private.quote_request_publications where request_id=p_request and revision_id=(p_terms->>'requestRevisionId')::uuid)
 then raise exception 'REVISION_CONFLICT'; end if;
end $$;
create function public.marketplace_quotation_get(p_actor uuid,p_supplier uuid,p_request uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare q app_private.marketplace_quotations;
begin
 perform app_private.commerce_assert_supplier(p_actor,p_supplier,p_request,false);
 select * into q from app_private.marketplace_quotations where request_id=p_request and supplier_id=p_supplier;
 return jsonb_build_object('quotation',case when q.id is null then null else app_private.commerce_quote_json(q,false) end);
end $$;
create function public.marketplace_quotation_list(p_actor uuid,p_supplier uuid,p_request uuid,p_after uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare items jsonb; cursor uuid;
begin
 if p_supplier is null then perform app_private.marketplace_assert_quote_request_buyer(p_actor,p_request);
 else perform app_private.marketplace_member_role(p_actor,p_supplier,false); perform app_private.marketplace_assert_quote_request_supplier(p_actor,p_supplier); end if;
 select coalesce(jsonb_agg(app_private.commerce_quote_json(q,p_supplier is null) order by q.id),'[]') into items
 from (select q.* from app_private.marketplace_quotations q
 where (p_after is null or q.id>p_after) and
 ((p_supplier is null and q.request_id=p_request and q.current_revision_id is not null) or (p_supplier is not null and q.supplier_id=p_supplier and exists(select 1 from app_private.quote_request_supplier_access a where a.request_id=q.request_id and a.supplier_id=q.supplier_id)))
 order by q.id limit 25) q;
 if jsonb_array_length(items)>24 then cursor:=(items->23->>'id')::uuid; items:=items-24; end if;
 return jsonb_build_object('items',items,'nextCursor',cursor);
end $$;
create function public.marketplace_quotation_write(p_actor uuid,p_supplier uuid,p_request uuid,p_action text,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare q app_private.marketplace_quotations; op app_private.marketplace_commerce_operations; payload jsonb; terms jsonb; result jsonb; rid uuid;
begin
 perform app_private.commerce_assert_supplier(p_actor,p_supplier,p_request,p_action<>'save');
 if p_action='save' and app_private.marketplace_member_role(p_actor,p_supplier,false)='viewer' then raise exception 'MARKETPLACE_FORBIDDEN'; end if;
 if p_action not in ('save','send','withdraw') or p_input->>'operationId' is null or p_input->>'expectedRevision' is null then raise exception 'VALIDATION_ERROR'; end if;
 payload:=jsonb_build_object('action',p_action,'supplier',p_supplier,'request',p_request,'input',p_input);
 perform pg_advisory_xact_lock(hashtextextended('commerce-op:'||p_actor::text||':'||(p_input->>'operationId'),0));
 select * into op from app_private.marketplace_commerce_operations where actor_id=p_actor and operation_id=(p_input->>'operationId')::uuid;
 if found then if op.payload<>payload then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if; return op.result; end if;
 -- This lock is shared by quotation mutation, selection and supplier confirmation.
 perform pg_advisory_xact_lock(hashtextextended('commerce-request:'||p_request::text,0));
 select * into q from app_private.marketplace_quotations where request_id=p_request and supplier_id=p_supplier for update;
 if coalesce(q.revision,0)<>(p_input->>'expectedRevision')::integer then raise exception 'REVISION_CONFLICT'; end if;
 if p_action='save' then
  terms:=p_input-'operationId'-'expectedRevision';
  perform app_private.commerce_validate_terms(terms,p_request);
  if q.id is null then insert into app_private.marketplace_quotations(request_id,supplier_id,draft) values(p_request,p_supplier,terms) returning * into q;
  else update app_private.marketplace_quotations set draft=terms,revision=revision+1,updated_at=clock_timestamp() where id=q.id returning * into q; end if;
 elsif q.id is null then raise exception 'MARKETPLACE_NOT_FOUND';
 elsif p_action='send' then
  perform app_private.commerce_validate_terms(q.draft,p_request);
  insert into app_private.marketplace_quotation_revisions(quotation_id,request_revision_id,revision,terms)
  values(q.id,(q.draft->>'requestRevisionId')::uuid,q.revision+1,q.draft) returning id into rid;
  update app_private.marketplace_quotations set current_revision_id=rid,status='sent',revision=revision+1,updated_at=clock_timestamp() where id=q.id returning * into q;
 else
  if q.status<>'sent' then raise exception 'MARKETPLACE_CONFLICT'; end if;
  update app_private.marketplace_quotations set status='withdrawn',revision=revision+1,updated_at=clock_timestamp() where id=q.id returning * into q;
 end if;
 result:=app_private.commerce_quote_json(q,false);
 insert into app_private.marketplace_commerce_operations(actor_id,operation_id,payload,result) values(p_actor,(p_input->>'operationId')::uuid,payload,result);
 insert into app_private.marketplace_commerce_events(request_id,supplier_id,actor_id,kind,entity_id) values(p_request,p_supplier,p_actor,'quotation_'||p_action,q.id);
 return result;
end $$;
revoke all on function app_private.commerce_assert_supplier(uuid,uuid,uuid,boolean),app_private.commerce_quote_json(app_private.marketplace_quotations,boolean),app_private.commerce_validate_terms(jsonb,uuid),public.marketplace_quotation_get(uuid,uuid,uuid),public.marketplace_quotation_list(uuid,uuid,uuid,uuid),public.marketplace_quotation_write(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function app_private.commerce_assert_supplier(uuid,uuid,uuid,boolean),app_private.commerce_quote_json(app_private.marketplace_quotations,boolean),app_private.commerce_validate_terms(jsonb,uuid),public.marketplace_quotation_get(uuid,uuid,uuid),public.marketplace_quotation_list(uuid,uuid,uuid,uuid),public.marketplace_quotation_write(uuid,uuid,uuid,text,jsonb) to service_role;
