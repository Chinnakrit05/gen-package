begin;

select plan(42);

select is((
  select count(*)::integer from pg_class where oid in (
    'app_private.supplier_notifications'::regclass, 'app_private.supplier_notification_reads'::regclass
  ) and relrowsecurity
    and not has_table_privilege('anon', oid, 'SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('authenticated', oid, 'SELECT,INSERT,UPDATE,DELETE')
    and has_table_privilege('service_role', oid, 'SELECT')
    and has_table_privilege('service_role', oid, 'INSERT')
    and not has_table_privilege('service_role', oid, 'UPDATE,DELETE')
), 2, 'notification tables enforce RLS, server-only access and immutable delivery/read records');
select is((
  select count(*)::integer from pg_proc where pronamespace='public'::regnamespace and proname in (
    'marketplace_drain_supplier_notifications', 'marketplace_list_supplier_notifications',
    'marketplace_mark_supplier_notification_read'
  ) and not prosecdef and has_function_privilege('service_role', oid, 'EXECUTE')
    and not has_function_privilege('anon', oid, 'EXECUTE')
    and not has_function_privilege('authenticated', oid, 'EXECUTE')
), 3, 'all notification RPCs are service-role-only invokers');

insert into app_private.app_users (id,display_name) values
  ('f1300000-0000-4000-8000-000000000001','Notification supplier manager'),
  ('f1300000-0000-4000-8000-000000000002','Notification supplier viewer'),
  ('f1300000-0000-4000-8000-000000000003','Notification design-only user'),
  ('f1300000-0000-4000-8000-000000000004','Notification platform reviewer'),
  ('f1300000-0000-4000-8000-000000000005','Other notification supplier manager'),
  ('f1300000-0000-4000-8000-000000000006','Notification outsider');
insert into app_private.platform_staff (user_id,role)
values ('f1300000-0000-4000-8000-000000000004','supplier_reviewer');

set local role service_role;

create temporary table notification_profile (profile jsonb);
insert into notification_profile values ('{
  "kind":"factory","name":"Notification test supplier","slug":"notification-fixture",
  "description":"","contactEmail":"notice@example.test","capabilities":["digital_printing"]
}'::jsonb);
create temporary table notification_suppliers as
select (first_supplier #>> '{profile,id}')::uuid as supplier_id,
       (first_supplier #>> '{profile,workspaceId}')::uuid as workspace_id,
       (other_supplier #>> '{profile,id}')::uuid as other_supplier_id
from (select
  public.marketplace_create_supplier(
    'f1300000-0000-4000-8000-000000000001','f2300000-0000-4000-8000-000000000001',profile
  ) as first_supplier,
  public.marketplace_create_supplier(
    'f1300000-0000-4000-8000-000000000005','f2300000-0000-4000-8000-000000000001',
    profile || '{"name":"Other notification supplier","slug":"notification-other-fixture"}'::jsonb
  ) as other_supplier
from notification_profile) created;

insert into app_private.workspace_marketplace_members (workspace_id,user_id,role,requires_workspace_membership)
select workspace_id,'f1300000-0000-4000-8000-000000000002','viewer',false from notification_suppliers;
insert into app_private.workspace_members (workspace_id,user_id,role)
select workspace_id,'f1300000-0000-4000-8000-000000000003','editor' from notification_suppliers;

-- An old backlog includes two events with identical timestamps to exercise
-- deterministic draining and cursor tie-breaking with microsecond precision.
insert into app_private.activity_events (id,supplier_id,actor_user_id,action,from_status,to_status,revision,reason,created_at)
select fixture.id::uuid, case when fixture.other then supplier.other_supplier_id else supplier.supplier_id end,
  'f1300000-0000-4000-8000-000000000004',fixture.action,fixture.from_status,fixture.to_status,fixture.revision,
  fixture.reason,fixture.created_at::timestamptz
from notification_suppliers supplier cross join (values
  ('f3300000-0000-4000-8000-000000000001',false,'approve','pending','approved',11,'Private approval reason','2000-01-01T00:00:00.123456Z'),
  ('f3300000-0000-4000-8000-000000000002',false,'request_changes','pending','draft',12,'Private change request','2000-01-01T00:00:00.123456Z'),
  ('f3300000-0000-4000-8000-000000000003',false,'suspend','approved','suspended',13,'Private suspension reason','2000-01-01T00:00:00.123457Z'),
  ('f3300000-0000-4000-8000-000000000004',false,'resume','suspended','approved',14,'Private resumption reason','2000-01-01T00:00:00.123458Z'),
  ('f3300000-0000-4000-8000-000000000005',true,'approve','pending','approved',11,'Other supplier private reason','2000-01-01T00:00:00.123459Z'),
  ('f3300000-0000-4000-8000-000000000006',false,'reopened','approved','draft',15,null,'2000-01-01T00:00:00.123460Z'),
  ('f3300000-0000-4000-8000-000000000007',false,'submitted','draft','pending',16,null,'2000-01-01T00:00:00.123461Z')
) as fixture(id,other,action,from_status,to_status,revision,reason,created_at);
insert into app_private.notification_outbox (event_id,audience,created_at)
select id,'supplier_workspace',created_at from app_private.activity_events
where id::text like 'f3300000-0000-4000-8000-%';

select throws_ok($$select public.marketplace_drain_supplier_notifications(101)$$,
  '22023', 'VALIDATION_ERROR', 'direct drain has a bounded batch size');
select throws_ok($$select public.marketplace_list_supplier_notifications(
  'f1300000-0000-4000-8000-000000000001',false,25,null,null
)$$, '22023', 'VALIDATION_ERROR', 'feed page is limited to 24');
select throws_ok($$select public.marketplace_list_supplier_notifications(
  'f1300000-0000-4000-8000-000000000001',false,2,'2000-01-01T00:00:00Z',null
)$$, '22023', 'VALIDATION_ERROR', 'cursor timestamp and ID must be supplied together');

select is(public.marketplace_list_supplier_notifications(
  'f1300000-0000-4000-8000-000000000006',false,24,null,null
), '{"items":[],"nextCursor":null}'::jsonb, 'an outsider sees no supplier notifications');
select is(public.marketplace_list_supplier_notifications(
  'f1300000-0000-4000-8000-000000000003',false,24,null,null
), '{"items":[],"nextCursor":null}'::jsonb, 'Editor membership alone does not grant supplier notifications');
select throws_ok($$select public.marketplace_list_supplier_notifications(
  'f1300000-0000-4000-8000-000000000001',true,24,null,null
)$$, 'P0001', 'MARKETPLACE_FORBIDDEN', 'an ungranted manager cannot read or drain reviewer notifications');
select is((select count(*)::integer from app_private.notification_outbox
  where event_id::text like 'f3300000-0000-4000-8000-%' and processed_at is not null),
  0, 'out-of-scope first-page requests do not drain the queue');

savepoint rollback_drain;
create temporary table rolled_back_drain as select public.marketplace_drain_supplier_notifications(1);
rollback to savepoint rollback_drain;
select is((
  select count(*)::integer from app_private.notification_outbox outbox
  left join app_private.supplier_notifications n on n.id=outbox.event_id
  where outbox.event_id::text like 'f3300000-0000-4000-8000-%' and (outbox.processed_at is not null or n.id is not null)
), 0, 'rollback removes both the processed state and its delivery');

select is(public.marketplace_drain_supplier_notifications(1)->>'processed','1','drain processes only its requested bound');
select is((select array_agg(id::text order by id) from app_private.supplier_notifications
  where id::text like 'f3300000-0000-4000-8000-%'),
  array['f3300000-0000-4000-8000-000000000001'], 'oldest timestamp and smaller event ID are drained first');
select ok((
  select n.delivered_at = outbox.processed_at from app_private.supplier_notifications n
  join app_private.notification_outbox outbox on outbox.event_id=n.id
  where n.id='f3300000-0000-4000-8000-000000000001'
), 'delivery and processed time are committed together');
select is(public.marketplace_list_supplier_notifications(
  'f1300000-0000-4000-8000-000000000001',false,24,'9999-01-01T00:00:00Z','f3300000-0000-4000-8000-000000000001'
)#>>'{items,0,id}', 'f3300000-0000-4000-8000-000000000001', 'cursor request can read existing deliveries');
select is((select count(*)::integer from app_private.notification_outbox
  where event_id::text like 'f3300000-0000-4000-8000-%' and processed_at is not null),
  1, 'cursor request does not drain remaining events');

create temporary table notification_first_page as select public.marketplace_list_supplier_notifications(
  'f1300000-0000-4000-8000-000000000001',false,2,null,null
) as result;
select is((select jsonb_array_length(result->'items') from notification_first_page), 2,
  'first-page drain makes eligible events available with the requested page bound');
select is((select result#>>'{items,0,id}' from notification_first_page), 'f3300000-0000-4000-8000-000000000004',
  'supplier feed is ordered newest first and excludes other suppliers');
select is((select result#>'{items,0}' from notification_first_page), (
  select jsonb_build_object(
    'id','f3300000-0000-4000-8000-000000000004','supplierId',supplier_id,'supplierName','Notification test supplier',
    'action','resume','createdAt','2000-01-01T00:00:00.123458Z','readAt',null
  ) from notification_suppliers
), 'notification has exactly the public feed DTO and no private review reason');
select is((select result->'nextCursor' from notification_first_page),
  '{"createdAt":"2000-01-01T00:00:00.123457Z","id":"f3300000-0000-4000-8000-000000000003"}'::jsonb,
  'cursor carries the exact timestamp of the last returned item');
create temporary table notification_second_page as select public.marketplace_list_supplier_notifications(
  'f1300000-0000-4000-8000-000000000001',false,1,
  (select (result#>>'{nextCursor,createdAt}')::timestamptz from notification_first_page),
  (select (result#>>'{nextCursor,id}')::uuid from notification_first_page)
) as result;
select is((select result#>>'{items,0,id}' from notification_second_page), 'f3300000-0000-4000-8000-000000000002',
  'larger UUID sorts first at an equal event timestamp');
create temporary table notification_third_page as select public.marketplace_list_supplier_notifications(
  'f1300000-0000-4000-8000-000000000001',false,1,
  (select (result#>>'{nextCursor,createdAt}')::timestamptz from notification_second_page),
  (select (result#>>'{nextCursor,id}')::uuid from notification_second_page)
) as result;
select is((select result#>>'{items,0,id}' from notification_third_page), 'f3300000-0000-4000-8000-000000000001',
  'remaining tied event appears once on the next page');
select is((select result->'nextCursor' from notification_third_page), 'null'::jsonb, 'last page has no cursor');
select is((select count(*)::integer from app_private.notification_outbox
  where event_id::text like 'f3300000-0000-4000-8000-%' and processed_at is not null),
  7, 'all picked events are processed even if some do not notify');
select is((select count(*)::integer from app_private.supplier_notifications
  where id::text like 'f3300000-0000-4000-8000-%'),
  5, 'reopened and wrong-audience events do not create notifications');
select is((
  select count(*)::integer from app_private.supplier_notifications n
  join app_private.activity_events e on e.id=n.id
  where e.action='created' and e.supplier_id in (
    select supplier_id from notification_suppliers union all select other_supplier_id from notification_suppliers
  )
), 0, 'legacy created events are also consumed without notifications');

select is(public.marketplace_list_supplier_notifications(
  'f1300000-0000-4000-8000-000000000005',false,24,null,null
)#>>'{items,0,id}', 'f3300000-0000-4000-8000-000000000005', 'other supplier member sees only their own event');
select throws_ok($$select public.marketplace_mark_supplier_notification_read(
  'f1300000-0000-4000-8000-000000000005','f3300000-0000-4000-8000-000000000001',false
)$$, 'P0001', 'MARKETPLACE_NOT_FOUND', 'another supplier cannot mark a private event as read');

create temporary table notification_read as select public.marketplace_mark_supplier_notification_read(
  'f1300000-0000-4000-8000-000000000002','f3300000-0000-4000-8000-000000000004',false
) as result;
select is((select result->>'id' from notification_read), 'f3300000-0000-4000-8000-000000000004',
  'independent Marketplace viewer can mark a supplier notification without Editor access');
select is(public.marketplace_mark_supplier_notification_read(
  'f1300000-0000-4000-8000-000000000002','f3300000-0000-4000-8000-000000000004',false
), (select result from notification_read), 'mark read is idempotent and preserves the original timestamp');
select is(public.marketplace_list_supplier_notifications(
  'f1300000-0000-4000-8000-000000000002',false,24,null,null
)#>>'{items,0,readAt}', (select result->>'readAt' from notification_read), 'viewer sees their own read receipt');
select is(public.marketplace_list_supplier_notifications(
  'f1300000-0000-4000-8000-000000000001',false,24,null,null
)#>'{items,0,readAt}', 'null'::jsonb, 'another member remains unread');
select is((select count(*)::integer from app_private.supplier_notification_reads
  where notification_id='f3300000-0000-4000-8000-000000000004'),1, 'retry produces a single user receipt');

create temporary table remove_notification_member as select public.marketplace_remove_supplier_member(
  'f1300000-0000-4000-8000-000000000001',(select supplier_id from notification_suppliers),'f1300000-0000-4000-8000-000000000002'
);
select is(public.marketplace_list_supplier_notifications(
  'f1300000-0000-4000-8000-000000000002',false,24,null,null
), '{"items":[],"nextCursor":null}'::jsonb, 'removed Marketplace membership immediately hides the old feed');
select throws_ok($$select public.marketplace_mark_supplier_notification_read(
  'f1300000-0000-4000-8000-000000000002','f3300000-0000-4000-8000-000000000004',false
)$$, 'P0001', 'MARKETPLACE_NOT_FOUND', 'removed member cannot even retry an existing read receipt');

create temporary table actual_submission as select public.marketplace_submit_supplier(
  'f1300000-0000-4000-8000-000000000001',(select supplier_id from notification_suppliers),1
);
create temporary table actual_review as select public.marketplace_review_supplier(
  'f1300000-0000-4000-8000-000000000004',(select supplier_id from notification_suppliers),2,'approve','Private fixture review reason.'
);
create temporary table submitted_notification as
select id from app_private.activity_events
where supplier_id=(select supplier_id from notification_suppliers) and revision=2 and action='submitted';

select is(public.marketplace_list_supplier_notifications(
  'f1300000-0000-4000-8000-000000000004',true,24,null,null
)#>>'{items,0,id}', (select id::text from submitted_notification), 'reviewer sees submission history after the supplier was approved');
select is(public.marketplace_list_supplier_notifications(
  'f1300000-0000-4000-8000-000000000001',false,24,null,null
)#>>'{items,0,action}', 'approve', 'actual approval queues a new supplier notification');
select throws_ok($$select public.marketplace_mark_supplier_notification_read(
  'f1300000-0000-4000-8000-000000000001',(select id from submitted_notification),false
)$$, 'P0001', 'MARKETPLACE_NOT_FOUND', 'supplier route cannot mark reviewer-only submissions');
select throws_ok($$select public.marketplace_mark_supplier_notification_read(
  'f1300000-0000-4000-8000-000000000004','f3300000-0000-4000-8000-000000000001',true
)$$, 'P0001', 'MARKETPLACE_NOT_FOUND', 'reviewer route cannot mark supplier-only notifications');
select is(public.marketplace_mark_supplier_notification_read(
  'f1300000-0000-4000-8000-000000000004',(select id from submitted_notification),true
)->>'id', (select id::text from submitted_notification), 'current reviewer can mark a reviewer notification');

reset role;
delete from app_private.platform_staff where user_id='f1300000-0000-4000-8000-000000000004' and role='supplier_reviewer';
set local role service_role;
select throws_ok($$select public.marketplace_list_supplier_notifications(
  'f1300000-0000-4000-8000-000000000004',true,24,null,null
)$$, 'P0001', 'MARKETPLACE_FORBIDDEN', 'reviewer grant removal immediately disables the reviewer feed');
select throws_ok($$select public.marketplace_mark_supplier_notification_read(
  'f1300000-0000-4000-8000-000000000004',(select id from submitted_notification),true
)$$, 'P0001', 'MARKETPLACE_FORBIDDEN', 'reviewer grant removal also disables marking');

reset role;
delete from app_private.notification_outbox where event_id='f3300000-0000-4000-8000-000000000004';
select ok(not exists(select 1 from app_private.supplier_notifications where id='f3300000-0000-4000-8000-000000000004')
  and not exists(select 1 from app_private.supplier_notification_reads where notification_id='f3300000-0000-4000-8000-000000000004'),
  'trusted scoped outbox cleanup cascades to delivery and read rows');

select * from finish();
rollback;
