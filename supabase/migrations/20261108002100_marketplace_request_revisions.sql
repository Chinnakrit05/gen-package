-- Keep the first publication and private draft immutable. Each revised public
-- spec is independently retained and all commercial checks pin its exact ID.
create table app_private.marketplace_request_revisions (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references app_private.quote_request_publications(request_id),
 revision integer not null check(revision>0), title text not null check(char_length(btrim(title)) between 1 and 100),
 quantity integer not null check(quantity between 1 and 1000000), notes text not null check(char_length(notes)<=1000),
 spec jsonb not null check(app_private.marketplace_quote_request_spec_valid(spec)),
 created_at timestamptz not null default clock_timestamp(), created_by uuid not null references app_private.app_users(id),
 unique(request_id,revision), unique(request_id,id)
);
create table app_private.marketplace_request_trading (
 request_id uuid primary key references app_private.quote_request_publications(request_id), current_revision_id uuid not null,
 accepting_until timestamptz not null,
 foreign key(request_id,current_revision_id) references app_private.marketplace_request_revisions(request_id,id)
);
alter table app_private.marketplace_request_revisions enable row level security;
alter table app_private.marketplace_request_trading enable row level security;
revoke all on app_private.marketplace_request_revisions,app_private.marketplace_request_trading from public,anon,authenticated,service_role;
grant select,insert on app_private.marketplace_request_revisions to service_role;
grant select,insert,update on app_private.marketplace_request_trading to service_role;
insert into app_private.marketplace_request_revisions(id,request_id,revision,title,quantity,notes,spec,created_at,created_by)
select p.revision_id,p.request_id,1,d.title,d.quantity,d.notes,d.spec,p.published_at,p.published_by from app_private.quote_request_publications p join app_private.quote_request_drafts d on d.id=p.request_id;
-- 30 days is the initial acceptance policy, editable explicitly with a revision.
insert into app_private.marketplace_request_trading(request_id,current_revision_id,accepting_until)
select request_id,revision_id,published_at+interval '30 days' from app_private.quote_request_publications;
alter table app_private.marketplace_quotation_revisions drop constraint marketplace_quotation_revisions_request_revision_id_fkey;
alter table app_private.marketplace_quotation_revisions add foreign key(request_revision_id) references app_private.marketplace_request_revisions(id);
create function app_private.commerce_initial_request_revision() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 insert into app_private.marketplace_request_revisions(id,request_id,revision,title,quantity,notes,spec,created_at,created_by)
 select new.revision_id,new.request_id,1,d.title,d.quantity,d.notes,d.spec,new.published_at,new.published_by from app_private.quote_request_drafts d where d.id=new.request_id;
 insert into app_private.marketplace_request_trading(request_id,current_revision_id,accepting_until) values(new.request_id,new.revision_id,new.published_at+interval '30 days');
 return new;
end $$;
create trigger commerce_initial_request_revision after insert on app_private.quote_request_publications for each row execute function app_private.commerce_initial_request_revision();
create function app_private.commerce_request_status(p_request uuid) returns text language sql stable security invoker set search_path='' as $$
 select case
 when exists(select 1 from app_private.marketplace_production_orders where request_id=p_request and status in ('confirmed','in_production','shipped','completed')) then 'awarded'
 when exists(select 1 from app_private.marketplace_production_orders where request_id=p_request and status='pending_supplier_confirmation' and confirmation_deadline>statement_timestamp()) then 'selection_pending'
 when (select accepting_until from app_private.marketplace_request_trading where request_id=p_request)>statement_timestamp() then 'open' else 'closed' end;
$$;
create or replace function app_private.commerce_assert_request_open(p_request uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
 -- Expiry is explicit persisted housekeeping in mutation transactions. Reads
 -- show effective status without silently modifying the order history.
 update app_private.marketplace_production_orders set status='expired',revision=revision+1 where request_id=p_request and status='pending_supplier_confirmation' and confirmation_deadline<=clock_timestamp();
 if app_private.commerce_request_status(p_request)<>'open' then raise exception 'MARKETPLACE_CONFLICT'; end if;
end $$;
create function app_private.commerce_request_revision_json(p_revision app_private.marketplace_request_revisions)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',p_revision.id,'revision',p_revision.revision,'title',p_revision.title,'quantity',p_revision.quantity,'notes',p_revision.notes,'spec',p_revision.spec,'createdAt',p_revision.created_at);
$$;
create function app_private.commerce_trading_json(p_request uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('status',app_private.commerce_request_status(t.request_id),'acceptingUntil',t.accepting_until,'currentRevision',app_private.commerce_request_revision_json(r),
 'revisions',(select jsonb_agg(app_private.commerce_request_revision_json(h) order by h.revision desc) from app_private.marketplace_request_revisions h where h.request_id=t.request_id))
 from app_private.marketplace_request_trading t join app_private.marketplace_request_revisions r on r.id=t.current_revision_id where t.request_id=p_request;
$$;
create function public.marketplace_request_trading_get(p_actor uuid,p_request uuid,p_supplier uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if p_supplier is null then perform app_private.marketplace_assert_quote_request_buyer(p_actor,p_request);
 else perform app_private.commerce_assert_supplier(p_actor,p_supplier,p_request,false); end if;
 if not exists(select 1 from app_private.marketplace_request_trading where request_id=p_request) then raise exception 'MARKETPLACE_NOT_FOUND'; end if;
 return app_private.commerce_trading_json(p_request);
end $$;
create function public.marketplace_request_revise(p_actor uuid,p_request uuid,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare op app_private.marketplace_commerce_operations; payload jsonb; t app_private.marketplace_request_trading; r app_private.marketplace_request_revisions; result jsonb;
begin
 perform app_private.marketplace_assert_quote_request_buyer(p_actor,p_request);
 if p_input->>'operationId' is null or p_input->>'expectedRevisionId' is null or jsonb_typeof(p_input->'acceptingUntil') is distinct from 'string' then raise exception 'VALIDATION_ERROR'; end if;
 payload:=jsonb_build_object('action','request-revise','request',p_request,'input',p_input);
 perform pg_advisory_xact_lock(hashtextextended('commerce-op:'||p_actor::text||':'||(p_input->>'operationId'),0));
 select * into op from app_private.marketplace_commerce_operations where actor_id=p_actor and operation_id=(p_input->>'operationId')::uuid;
 if found then if op.payload<>payload then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if; return op.result; end if;
 perform pg_advisory_xact_lock(hashtextextended('commerce-request:'||p_request::text,0));
 update app_private.marketplace_production_orders set status='expired',revision=revision+1 where request_id=p_request and status='pending_supplier_confirmation' and confirmation_deadline<=clock_timestamp();
 if exists(select 1 from app_private.marketplace_production_orders where request_id=p_request and status in ('pending_supplier_confirmation','confirmed','in_production','shipped','completed')) then raise exception 'MARKETPLACE_CONFLICT'; end if;
 select * into t from app_private.marketplace_request_trading where request_id=p_request for update;
 if t.current_revision_id is null then raise exception 'MARKETPLACE_NOT_FOUND'; end if;
 if t.current_revision_id is distinct from (p_input->>'expectedRevisionId')::uuid then raise exception 'REVISION_CONFLICT'; end if;
 if (p_input->>'acceptingUntil')::timestamptz<=clock_timestamp() or (p_input->>'acceptingUntil')::timestamptz>clock_timestamp()+interval '90 days'
 or jsonb_typeof(p_input->'title') is distinct from 'string' or jsonb_typeof(p_input->'quantity') is distinct from 'number' or (p_input->>'quantity') !~ '^[0-9]+$'
 or jsonb_typeof(p_input->'notes') is distinct from 'string' or app_private.marketplace_quote_request_spec_valid(p_input->'spec') is distinct from true then raise exception 'VALIDATION_ERROR'; end if;
 insert into app_private.marketplace_request_revisions(request_id,revision,title,quantity,notes,spec,created_by)
 select p_request,revision+1,btrim(p_input->>'title'),(p_input->>'quantity')::integer,p_input->>'notes',p_input->'spec',p_actor from app_private.marketplace_request_revisions where id=t.current_revision_id returning * into r;
 update app_private.marketplace_request_trading set current_revision_id=r.id,accepting_until=(p_input->>'acceptingUntil')::timestamptz where request_id=p_request;
 result:=app_private.commerce_trading_json(p_request);
 insert into app_private.marketplace_commerce_operations(actor_id,operation_id,payload,result) values(p_actor,(p_input->>'operationId')::uuid,payload,result);
 insert into app_private.marketplace_commerce_events(request_id,supplier_id,actor_id,kind,entity_id) select p_request,supplier_id,p_actor,'request_revised',r.id from app_private.quote_request_supplier_access where request_id=p_request;
 return result;
end $$;
-- Keep older supplier/publication DTOs compatible, but expose the actual current spec.
create or replace function app_private.marketplace_quote_request_publication_json(p_request_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('revisionId',t.current_revision_id,'publishedAt',to_char(p.published_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'suppliers',coalesce((select jsonb_agg(jsonb_build_object('id',a.supplier_id,'name',a.supplier_name) order by a.supplier_id) from app_private.quote_request_supplier_access a where a.request_id=p.request_id),'[]'))
 from app_private.quote_request_publications p join app_private.marketplace_request_trading t on t.request_id=p.request_id where p.request_id=p_request_id;
$$;
create or replace function app_private.marketplace_supplier_quote_request_summary(p_draft app_private.quote_request_drafts,p_publication app_private.quote_request_publications)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',p_draft.id,'revisionId',r.id,'title',r.title,'quantity',r.quantity,'publishedAt',to_char(p_publication.published_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) from app_private.marketplace_request_trading t join app_private.marketplace_request_revisions r on r.id=t.current_revision_id where t.request_id=p_draft.id;
$$;
create or replace function public.marketplace_get_supplier_quote_request(p_actor_user_id uuid,p_supplier_id uuid,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 perform app_private.commerce_assert_supplier(p_actor_user_id,p_supplier_id,p_request_id,false);
 select app_private.marketplace_supplier_quote_request_summary(d,p)||jsonb_build_object('notes',r.notes,'spec',r.spec) into result
 from app_private.quote_request_drafts d join app_private.quote_request_publications p on p.request_id=d.id join app_private.marketplace_request_trading t on t.request_id=d.id join app_private.marketplace_request_revisions r on r.id=t.current_revision_id where d.id=p_request_id;
 return result;
end $$;
create function app_private.commerce_order_current_snapshot() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 select jsonb_build_object('title',r.title,'quantity',r.quantity,'notes',r.notes,'spec',r.spec) into new.request_snapshot from app_private.marketplace_request_trading t join app_private.marketplace_request_revisions r on r.id=t.current_revision_id where t.request_id=new.request_id;
 return new;
end $$;
create trigger commerce_order_current_snapshot before insert on app_private.marketplace_production_orders for each row execute function app_private.commerce_order_current_snapshot();

create or replace function app_private.commerce_validate_terms(p_terms jsonb,p_request uuid)
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
 if not exists(select 1 from app_private.marketplace_request_trading where request_id=p_request and current_revision_id=(p_terms->>'requestRevisionId')::uuid)
 then raise exception 'REVISION_CONFLICT'; end if;
end $$;

do $$ declare f regprocedure; begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
 (n.nspname='app_private' and p.proname in ('commerce_initial_request_revision','commerce_request_status','commerce_request_revision_json','commerce_trading_json','commerce_order_current_snapshot')) or
 (n.nspname='public' and p.proname in ('marketplace_request_trading_get','marketplace_request_revise'))
 loop execute format('revoke all on function %s from public,anon,authenticated',f); execute format('grant execute on function %s to service_role',f); end loop;
end $$;
