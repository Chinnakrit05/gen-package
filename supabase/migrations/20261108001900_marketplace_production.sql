-- Production is a bilateral off-platform agreement, not a PackIt billing order.
-- Policy default: suppliers have 72 hours to confirm. A future policy change must
-- preserve the deadline frozen on existing orders.
create table app_private.marketplace_production_orders (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references app_private.quote_request_publications(request_id),
 supplier_id uuid not null references app_private.supplier_profiles(id), accepted_quote_revision_id uuid not null references app_private.marketplace_quotation_revisions(id),
 terms jsonb not null, request_snapshot jsonb not null, supplier_name text not null,
 status text not null default 'pending_supplier_confirmation' check(status in ('pending_supplier_confirmation','confirmed','declined','expired','cancelled','in_production','shipped','completed')),
 revision integer not null default 1 check(revision>0), created_at timestamptz not null default clock_timestamp(),
 confirmation_deadline timestamptz not null default clock_timestamp()+interval '72 hours'
);
create unique index marketplace_one_live_order_per_request on app_private.marketplace_production_orders(request_id)
 where status in ('pending_supplier_confirmation','confirmed','in_production','shipped','completed');
create index marketplace_production_supplier_idx on app_private.marketplace_production_orders(supplier_id,id);
create table app_private.marketplace_order_proofs (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references app_private.marketplace_production_orders(id),
 version integer not null, file_id uuid not null, notes text not null check(char_length(notes)<=2000),
 created_at timestamptz not null default clock_timestamp(), created_by uuid not null references app_private.app_users(id), unique(order_id,version)
);
create table app_private.marketplace_proof_approvals (
 proof_id uuid primary key references app_private.marketplace_order_proofs(id), actor_id uuid not null references app_private.app_users(id), approved_at timestamptz not null default clock_timestamp()
);
create table app_private.marketplace_payment_reports (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references app_private.marketplace_production_orders(id),
 amount_minor bigint not null check(amount_minor>0 and amount_minor<=100000000000), reference text not null check(char_length(btrim(reference)) between 1 and 200),
 file_id uuid, reported_at timestamptz not null default clock_timestamp(), reported_by uuid not null references app_private.app_users(id)
);
create table app_private.marketplace_payment_confirmations (
 report_id uuid primary key references app_private.marketplace_payment_reports(id), actor_id uuid not null references app_private.app_users(id), confirmed_at timestamptz not null default clock_timestamp()
);
alter table app_private.marketplace_production_orders enable row level security;
alter table app_private.marketplace_order_proofs enable row level security;
alter table app_private.marketplace_proof_approvals enable row level security;
alter table app_private.marketplace_payment_reports enable row level security;
alter table app_private.marketplace_payment_confirmations enable row level security;
revoke all on app_private.marketplace_production_orders,app_private.marketplace_order_proofs,app_private.marketplace_proof_approvals,app_private.marketplace_payment_reports,app_private.marketplace_payment_confirmations from public,anon,authenticated,service_role;
grant select,insert,update on app_private.marketplace_production_orders to service_role;
grant select,insert on app_private.marketplace_order_proofs,app_private.marketplace_proof_approvals,app_private.marketplace_payment_reports,app_private.marketplace_payment_confirmations to service_role;

create function app_private.commerce_order_side(p_actor uuid,p_order app_private.marketplace_production_orders,p_write boolean)
returns text language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from app_private.quote_request_drafts d join app_private.workspaces w on w.id=d.workspace_id where d.id=p_order.request_id and w.owner_user_id=p_actor) then
  perform app_private.marketplace_assert_quote_request_buyer(p_actor,p_order.request_id); return 'buyer';
 end if;
 perform app_private.marketplace_member_role(p_actor,p_order.supplier_id,p_write);
 return 'supplier'; -- Existing orders survive suspension, but removed members do not.
end $$;
create function app_private.commerce_order_json(p_actor uuid,p_order app_private.marketplace_production_orders)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare side text; manager boolean;
begin
 side:=app_private.commerce_order_side(p_actor,p_order,false);
 manager:=side='supplier' and app_private.marketplace_member_role(p_actor,p_order.supplier_id,false)='manager';
 return jsonb_build_object('id',p_order.id,'requestId',p_order.request_id,'supplierId',p_order.supplier_id,'supplierName',p_order.supplier_name,
 'requestTitle',p_order.request_snapshot->>'title','requestSnapshot',p_order.request_snapshot,
 'acceptedQuoteRevisionId',p_order.accepted_quote_revision_id,'terms',p_order.terms,'status',p_order.status,'revision',p_order.revision,'createdAt',p_order.created_at,'confirmationDeadline',p_order.confirmation_deadline,
 'permissions',jsonb_build_object('side',side,'canConfirm',manager and p_order.status='pending_supplier_confirmation','canApproveProof',side='buyer' and p_order.status='confirmed',
 'canReportPayment',side='buyer' and p_order.status in ('confirmed','in_production','shipped'),
 'canConfirmPayment',manager and p_order.status in ('confirmed','in_production','shipped'),
 'canUploadProof',manager and p_order.status='confirmed','canUpdateStatus',manager and p_order.status in ('confirmed','in_production','shipped'),
 'canCancel',side='buyer' and p_order.status='pending_supplier_confirmation'),
 'proofs',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'version',p.version,'fileId',p.file_id,'notes',p.notes,'createdAt',p.created_at,'approvedAt',a.approved_at) order by p.version) from app_private.marketplace_order_proofs p left join app_private.marketplace_proof_approvals a on a.proof_id=p.id where p.order_id=p_order.id),'[]'),
 'payments',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'amountMinor',p.amount_minor,'reference',p.reference,'fileId',p.file_id,'reportedAt',p.reported_at,'confirmedAt',c.confirmed_at) order by p.reported_at,p.id) from app_private.marketplace_payment_reports p left join app_private.marketplace_payment_confirmations c on c.report_id=p.id where p.order_id=p_order.id),'[]'));
end $$;
create function app_private.commerce_assert_request_open(p_request uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from app_private.marketplace_production_orders where request_id=p_request and status in ('pending_supplier_confirmation','confirmed','in_production','shipped','completed')) then raise exception 'MARKETPLACE_CONFLICT'; end if;
end $$;
-- Close the race between quote changes and selecting/confirming an order.
create function app_private.commerce_guard_quote_mutation() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('commerce-request:'||new.request_id::text,0));
 perform app_private.commerce_assert_request_open(new.request_id);
 return new;
end $$;
create trigger commerce_guard_quote before insert or update on app_private.marketplace_quotations for each row execute function app_private.commerce_guard_quote_mutation();

create function public.marketplace_order_select(p_actor uuid,p_request uuid,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare op app_private.marketplace_commerce_operations; payload jsonb; q app_private.marketplace_quotations; r app_private.marketplace_quotation_revisions; o app_private.marketplace_production_orders; result jsonb;
begin
 perform app_private.marketplace_assert_quote_request_buyer(p_actor,p_request);
 if p_input->>'operationId' is null or p_input->>'quoteRevisionId' is null then raise exception 'VALIDATION_ERROR'; end if;
 payload:=jsonb_build_object('action','select','request',p_request,'input',p_input);
 perform pg_advisory_xact_lock(hashtextextended('commerce-op:'||p_actor::text||':'||(p_input->>'operationId'),0));
 select * into op from app_private.marketplace_commerce_operations where actor_id=p_actor and operation_id=(p_input->>'operationId')::uuid;
 if found then if op.payload<>payload then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if; return op.result; end if;
 perform pg_advisory_xact_lock(hashtextextended('commerce-request:'||p_request::text,0));
 update app_private.marketplace_production_orders set status='expired',revision=revision+1 where request_id=p_request and status='pending_supplier_confirmation' and confirmation_deadline<=clock_timestamp();
 perform app_private.commerce_assert_request_open(p_request);
 select * into r from app_private.marketplace_quotation_revisions where id=(p_input->>'quoteRevisionId')::uuid;
 select * into q from app_private.marketplace_quotations where id=r.quotation_id and request_id=p_request for update;
 if q.id is null or q.status<>'sent' or q.current_revision_id<>r.id then raise exception 'MARKETPLACE_CONFLICT'; end if;
 perform 1 from app_private.supplier_profiles where id=q.supplier_id and status='approved' for share;
 if not found then raise exception 'MARKETPLACE_CONFLICT'; end if;
 if not exists(select 1 from app_private.quote_request_supplier_access where request_id=p_request and supplier_id=q.supplier_id) then raise exception 'MARKETPLACE_CONFLICT'; end if;
 perform app_private.commerce_validate_terms(r.terms,p_request);
 insert into app_private.marketplace_production_orders(request_id,supplier_id,accepted_quote_revision_id,terms,request_snapshot,supplier_name)
 select p_request,q.supplier_id,r.id,r.terms||jsonb_build_object('id',r.id,'quotationId',r.quotation_id,'revision',r.revision,'sentAt',r.sent_at),
 jsonb_build_object('title',d.title,'quantity',d.quantity,'notes',d.notes,'spec',d.spec),s.name
 from app_private.quote_request_drafts d cross join app_private.supplier_profiles s where d.id=p_request and s.id=q.supplier_id returning * into o;
 result:=app_private.commerce_order_json(p_actor,o);
 insert into app_private.marketplace_commerce_operations(actor_id,operation_id,payload,result) values(p_actor,(p_input->>'operationId')::uuid,payload,result);
 insert into app_private.marketplace_commerce_events(request_id,supplier_id,actor_id,kind,entity_id) values(p_request,q.supplier_id,p_actor,'order_selected',o.id);
 return result;
end $$;
create function public.marketplace_order_get(p_actor uuid,p_order uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o app_private.marketplace_production_orders;
begin
 select * into o from app_private.marketplace_production_orders where id=p_order;
 if not found then raise exception 'MARKETPLACE_NOT_FOUND'; end if;
 return app_private.commerce_order_json(p_actor,o);
end $$;
create function public.marketplace_order_list(p_actor uuid,p_supplier uuid,p_after uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare items jsonb; cursor uuid;
begin
 if p_supplier is not null then perform app_private.marketplace_member_role(p_actor,p_supplier,false); end if;
 perform 1 from app_private.app_users where id=p_actor and status='active' for share;
 if not found then raise exception 'MARKETPLACE_NOT_FOUND'; end if;
 select coalesce(jsonb_agg(app_private.commerce_order_json(p_actor,o) order by o.id),'[]') into items from (
 select o.* from app_private.marketplace_production_orders o
 join app_private.quote_request_drafts d on d.id=o.request_id join app_private.workspaces w on w.id=d.workspace_id
 where (p_after is null or o.id>p_after) and ((p_supplier is not null and o.supplier_id=p_supplier) or (p_supplier is null and w.owner_user_id=p_actor)) order by o.id limit 25) o;
 if jsonb_array_length(items)>24 then cursor:=(items->23->>'id')::uuid; items:=items-24; end if;
 return jsonb_build_object('items',items,'nextCursor',cursor);
end $$;
create table app_private.marketplace_order_file_grants (
 order_id uuid not null references app_private.marketplace_production_orders(id),
 file_id uuid not null, conversation_id uuid not null,
 primary key(order_id,file_id),
 foreign key(conversation_id,file_id) references app_private.marketplace_conversation_files(conversation_id,id)
);
alter table app_private.marketplace_order_file_grants enable row level security;
revoke all on app_private.marketplace_order_file_grants from public,anon,authenticated,service_role;
grant select,insert on app_private.marketplace_order_file_grants to service_role;
alter table app_private.marketplace_order_proofs add foreign key(order_id,file_id) references app_private.marketplace_order_file_grants(order_id,file_id);
alter table app_private.marketplace_payment_reports add foreign key(order_id,file_id) references app_private.marketplace_order_file_grants(order_id,file_id);
create function app_private.commerce_grant_order_file(p_actor uuid,p_order app_private.marketplace_production_orders,p_file uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare f app_private.marketplace_conversation_files;
begin
 f:=app_private.marketplace_order_conversation_file(p_actor,p_order.request_id,p_order.supplier_id,p_file,true);
 insert into app_private.marketplace_order_file_grants(order_id,file_id,conversation_id) values(p_order.id,f.id,f.conversation_id) on conflict do nothing;
end $$;
create function public.marketplace_order_download_file(p_actor uuid,p_order uuid,p_file uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o app_private.marketplace_production_orders; f app_private.marketplace_conversation_files;
begin
 select * into o from app_private.marketplace_production_orders where id=p_order;
 if not found then raise exception 'MARKETPLACE_NOT_FOUND'; end if;
 perform app_private.commerce_order_side(p_actor,o,false);
 select stored.* into f from app_private.marketplace_order_file_grants g join app_private.marketplace_conversation_files stored on stored.id=g.file_id and stored.conversation_id=g.conversation_id where g.order_id=p_order and g.file_id=p_file;
 if not found then raise exception 'MARKETPLACE_NOT_FOUND'; end if;
 return jsonb_build_object('file',app_private.marketplace_conversation_file_json(f),'dataBase64',translate(encode(f.content,'base64'),chr(10),''));
end $$;
revoke all on function app_private.commerce_grant_order_file(uuid,app_private.marketplace_production_orders,uuid),public.marketplace_order_download_file(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function app_private.commerce_grant_order_file(uuid,app_private.marketplace_production_orders,uuid),public.marketplace_order_download_file(uuid,uuid,uuid) to service_role;

create function public.marketplace_order_action(p_actor uuid,p_order uuid,p_action text,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o app_private.marketplace_production_orders; op app_private.marketplace_commerce_operations; payload jsonb; side text; result jsonb; proof app_private.marketplace_order_proofs; paid bigint; r app_private.marketplace_quotation_revisions; q app_private.marketplace_quotations;
begin
 select * into o from app_private.marketplace_production_orders where id=p_order;
 if not found then raise exception 'MARKETPLACE_NOT_FOUND'; end if;
 side:=app_private.commerce_order_side(p_actor,o,true);
 if p_input->>'operationId' is null or p_input->>'expectedRevision' is null then raise exception 'VALIDATION_ERROR'; end if;
 if (side='buyer' and p_action not in ('cancel','approve-proof','payment')) or (side='supplier' and p_action not in ('confirm','decline','proof','confirm-payment','start-production','ship','complete')) then raise exception 'MARKETPLACE_FORBIDDEN'; end if;
 payload:=jsonb_build_object('action',p_action,'order',p_order,'input',p_input);
 perform pg_advisory_xact_lock(hashtextextended('commerce-op:'||p_actor::text||':'||(p_input->>'operationId'),0));
 select * into op from app_private.marketplace_commerce_operations where actor_id=p_actor and operation_id=(p_input->>'operationId')::uuid;
 if found then if op.payload<>payload then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if; return op.result; end if;
 perform pg_advisory_xact_lock(hashtextextended('commerce-request:'||o.request_id::text,0));
 select * into o from app_private.marketplace_production_orders where id=p_order for update;
 if o.revision<>(p_input->>'expectedRevision')::integer then raise exception 'REVISION_CONFLICT'; end if;
 if p_action in ('confirm','decline','cancel') then
  if o.status<>'pending_supplier_confirmation' then raise exception 'MARKETPLACE_CONFLICT'; end if;
  if p_action='confirm' then
   if o.confirmation_deadline<=clock_timestamp() then raise exception 'MARKETPLACE_CONFLICT'; end if;
   perform app_private.commerce_assert_supplier(p_actor,o.supplier_id,o.request_id,true);
   select * into r from app_private.marketplace_quotation_revisions where id=o.accepted_quote_revision_id;
   select * into q from app_private.marketplace_quotations where id=r.quotation_id for update;
   if q.status<>'sent' or q.current_revision_id<>r.id then raise exception 'MARKETPLACE_CONFLICT'; end if;
   perform app_private.commerce_validate_terms(r.terms,o.request_id);
   o.status:='confirmed';
  else
   if char_length(btrim(coalesce(p_input->>'reason',''))) not between 1 and 1000 then raise exception 'VALIDATION_ERROR'; end if;
   o.status:=case when p_action='decline' then 'declined' else 'cancelled' end;
  end if;
 elsif p_action='proof' then
  if o.status<>'confirmed' then raise exception 'MARKETPLACE_CONFLICT'; end if;
  if p_input->>'fileId' is null or char_length(coalesce(p_input->>'notes',''))>2000 then raise exception 'VALIDATION_ERROR'; end if;
  -- The file helper checks conversation pair, uploader, current role and immutable file identity.
  perform app_private.commerce_grant_order_file(p_actor,o,(p_input->>'fileId')::uuid);
  insert into app_private.marketplace_order_proofs(order_id,version,file_id,notes,created_by)
  select o.id,coalesce(max(version),0)+1,(p_input->>'fileId')::uuid,coalesce(p_input->>'notes',''),p_actor from app_private.marketplace_order_proofs where order_id=o.id;
 elsif p_action='approve-proof' then
  if o.status<>'confirmed' then raise exception 'MARKETPLACE_CONFLICT'; end if;
  select * into proof from app_private.marketplace_order_proofs where order_id=o.id order by version desc limit 1;
  if proof.id is null or proof.id is distinct from (p_input->>'proofId')::uuid then raise exception 'REVISION_CONFLICT'; end if;
  insert into app_private.marketplace_proof_approvals(proof_id,actor_id) values(proof.id,p_actor) on conflict do nothing;
 elsif p_action='payment' then
  if o.status not in ('confirmed','in_production','shipped') then raise exception 'MARKETPLACE_CONFLICT'; end if;
  if (p_input->>'amountMinor') is null or (p_input->>'amountMinor') !~ '^[0-9]+$' or (p_input->>'amountMinor')::bigint not between 1 and (o.terms->>'totalMinor')::bigint or char_length(btrim(coalesce(p_input->>'reference',''))) not between 1 and 200 then raise exception 'VALIDATION_ERROR'; end if;
  select coalesce(sum(amount_minor),0) into paid from app_private.marketplace_payment_reports where order_id=o.id;
  if paid+(p_input->>'amountMinor')::bigint>(o.terms->>'totalMinor')::bigint then raise exception 'MARKETPLACE_CONFLICT'; end if;
  if p_input->>'fileId' is not null then perform app_private.commerce_grant_order_file(p_actor,o,(p_input->>'fileId')::uuid); end if;
  insert into app_private.marketplace_payment_reports(order_id,amount_minor,reference,file_id,reported_by) values(o.id,(p_input->>'amountMinor')::bigint,p_input->>'reference',(p_input->>'fileId')::uuid,p_actor);
 elsif p_action='confirm-payment' then
  if o.status not in ('confirmed','in_production','shipped') then raise exception 'MARKETPLACE_CONFLICT'; end if;
  perform 1 from app_private.marketplace_payment_reports where id=(p_input->>'paymentReportId')::uuid and order_id=o.id;
  if not found then raise exception 'MARKETPLACE_NOT_FOUND'; end if;
  insert into app_private.marketplace_payment_confirmations(report_id,actor_id) values((p_input->>'paymentReportId')::uuid,p_actor) on conflict do nothing;
 elsif p_action='start-production' then
  if o.status<>'confirmed' then raise exception 'MARKETPLACE_CONFLICT'; end if;
  select * into proof from app_private.marketplace_order_proofs where order_id=o.id order by version desc limit 1;
  if (o.terms->>'requiresProof')::boolean and (proof.id is null or not exists(select 1 from app_private.marketplace_proof_approvals where proof_id=proof.id)) then raise exception 'MARKETPLACE_CONFLICT'; end if;
  select coalesce(sum(p.amount_minor),0) into paid from app_private.marketplace_payment_reports p join app_private.marketplace_payment_confirmations c on c.report_id=p.id where p.order_id=o.id;
  if paid<(o.terms->>'depositMinor')::bigint then raise exception 'MARKETPLACE_CONFLICT'; end if;
  o.status:='in_production';
 elsif p_action='ship' then
  if o.status<>'in_production' then raise exception 'MARKETPLACE_CONFLICT'; end if; o.status:='shipped';
 elsif p_action='complete' then
  if o.status<>'shipped' then raise exception 'MARKETPLACE_CONFLICT'; end if; o.status:='completed';
 else raise exception 'VALIDATION_ERROR'; end if;
 update app_private.marketplace_production_orders set status=o.status,revision=revision+1 where id=o.id returning * into o;
 result:=app_private.commerce_order_json(p_actor,o);
 insert into app_private.marketplace_commerce_operations(actor_id,operation_id,payload,result) values(p_actor,(p_input->>'operationId')::uuid,payload,result);
 insert into app_private.marketplace_commerce_events(request_id,supplier_id,actor_id,kind,entity_id) values(o.request_id,o.supplier_id,p_actor,'order_'||p_action,o.id);
 return result;
end $$;
revoke all on function app_private.commerce_order_side(uuid,app_private.marketplace_production_orders,boolean),app_private.commerce_order_json(uuid,app_private.marketplace_production_orders),app_private.commerce_assert_request_open(uuid),app_private.commerce_guard_quote_mutation(),public.marketplace_order_select(uuid,uuid,jsonb),public.marketplace_order_get(uuid,uuid),public.marketplace_order_list(uuid,uuid,uuid),public.marketplace_order_action(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function app_private.commerce_order_side(uuid,app_private.marketplace_production_orders,boolean),app_private.commerce_order_json(uuid,app_private.marketplace_production_orders),app_private.commerce_assert_request_open(uuid),app_private.commerce_guard_quote_mutation(),public.marketplace_order_select(uuid,uuid,jsonb),public.marketplace_order_get(uuid,uuid),public.marketplace_order_list(uuid,uuid,uuid),public.marketplace_order_action(uuid,uuid,text,jsonb) to service_role;
