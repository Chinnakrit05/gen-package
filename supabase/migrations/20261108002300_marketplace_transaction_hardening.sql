-- Preserve the buyer who selected the terms; confirmation must not silently
-- revive authorization after that actor is suspended or loses ownership.
alter table app_private.marketplace_production_orders add column selected_by uuid references app_private.app_users(id);
update app_private.marketplace_production_orders o set selected_by=coalesce((select e.actor_id from app_private.marketplace_commerce_events e where e.entity_id=o.id and e.kind='order_selected' order by e.created_at limit 1),(select created_by from app_private.quote_request_drafts where id=o.request_id));
alter table app_private.marketplace_production_orders alter column selected_by set not null;
create or replace function public.marketplace_order_select(p_actor uuid,p_request uuid,p_input jsonb)
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
 insert into app_private.marketplace_production_orders(request_id,supplier_id,accepted_quote_revision_id,terms,request_snapshot,supplier_name,selected_by)
 select p_request,q.supplier_id,r.id,r.terms||jsonb_build_object('id',r.id,'quotationId',r.quotation_id,'revision',r.revision,'sentAt',r.sent_at),
 jsonb_build_object('title',d.title,'quantity',d.quantity,'notes',d.notes,'spec',d.spec),s.name,p_actor
 from app_private.quote_request_drafts d cross join app_private.supplier_profiles s where d.id=p_request and s.id=q.supplier_id returning * into o;
 result:=app_private.commerce_order_json(p_actor,o);
 insert into app_private.marketplace_commerce_operations(actor_id,operation_id,payload,result) values(p_actor,(p_input->>'operationId')::uuid,payload,result);
 insert into app_private.marketplace_commerce_events(request_id,supplier_id,actor_id,kind,entity_id) values(p_request,q.supplier_id,p_actor,'order_selected',o.id);
 return result;
end $$;
create or replace function public.marketplace_order_action(p_actor uuid,p_order uuid,p_action text,p_input jsonb)
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
   perform app_private.marketplace_assert_quote_request_buyer(o.selected_by,o.request_id);
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
  if (select count(*) from app_private.marketplace_order_proofs where order_id=o.id)>=50 then raise exception 'MARKETPLACE_CONFLICT'; end if;
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
  if (select count(*) from app_private.marketplace_payment_reports where order_id=o.id)>=100 then raise exception 'MARKETPLACE_CONFLICT'; end if;
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
