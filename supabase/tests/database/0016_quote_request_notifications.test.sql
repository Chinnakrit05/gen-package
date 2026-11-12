begin;

select plan(35);

select ok(
  (select relrowsecurity from pg_class where oid='app_private.quote_request_notification_reads'::regclass)
  and not has_table_privilege('anon','app_private.quote_request_notification_reads','SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated','app_private.quote_request_notification_reads','SELECT,INSERT,UPDATE,DELETE')
  and has_table_privilege('service_role','app_private.quote_request_notification_reads','SELECT')
  and has_table_privilege('service_role','app_private.quote_request_notification_reads','INSERT')
  and not has_table_privilege('service_role','app_private.quote_request_notification_reads','UPDATE,DELETE'),
  'receipt table is private with narrow immutable server access'
);
select is((
  select count(*)::integer from pg_proc where pronamespace='public'::regnamespace and proname in (
    'marketplace_list_quote_request_notifications','marketplace_mark_quote_request_notification_read'
  ) and not prosecdef and has_function_privilege('service_role',oid,'EXECUTE')
    and not has_function_privilege('anon',oid,'EXECUTE')
    and not has_function_privilege('authenticated',oid,'EXECUTE')
),2,'both notification RPCs are service-role-only invokers');

insert into app_private.app_users(id,display_name) values
  ('f1600000-0000-4000-8000-000000000001','Quote buyer'),
  ('f1600000-0000-4000-8000-000000000002','Shop A owner'),
  ('f1600000-0000-4000-8000-000000000003','Shop B owner'),
  ('f1600000-0000-4000-8000-000000000004','Member of both shops'),
  ('f1600000-0000-4000-8000-000000000005','Design-only Editor'),
  ('f1600000-0000-4000-8000-000000000006','Shop C owner'),
  ('f1600000-0000-4000-8000-000000000007','Reviewer');
insert into app_private.platform_staff(user_id,role)
values ('f1600000-0000-4000-8000-000000000007','supplier_reviewer');

set local role service_role;

insert into app_private.workspaces(id,kind,owner_user_id,name)
values ('f2600000-0000-4000-8000-000000000001','personal','f1600000-0000-4000-8000-000000000001','Quote buyer workspace');
insert into app_private.workspace_members(workspace_id,user_id,role)
values ('f2600000-0000-4000-8000-000000000001','f1600000-0000-4000-8000-000000000001','owner');
insert into app_private.projects(id,workspace_id,created_by,name,document_schema_version,document)
values ('f3600000-0000-4000-8000-000000000001','f2600000-0000-4000-8000-000000000001','f1600000-0000-4000-8000-000000000001',
  'Private source',1,'{"live":{"template":"tuck-end","materialId":"carton-300","W":80,"D":50,"H":120,"handle":false}}');

create temporary table quote_notification_suppliers as
select fixture.label,fixture.owner_id::uuid,(result#>>'{profile,id}')::uuid as id,
  (result#>>'{profile,workspaceId}')::uuid as workspace_id
from (values
  ('a','f1600000-0000-4000-8000-000000000002','Shop A'),
  ('b','f1600000-0000-4000-8000-000000000003','Shop B'),
  ('c','f1600000-0000-4000-8000-000000000006','Shop C')
) as fixture(label,owner_id,name)
cross join lateral (select public.marketplace_create_supplier(fixture.owner_id::uuid,
  'f5600000-0000-4000-8000-000000000001',
  jsonb_build_object('kind','factory','name',fixture.name,'slug','quote-alert-supplier-' || fixture.label,
    'description','','contactEmail','shop@example.test','capabilities','["digital_printing"]'::jsonb)
) as result) created;
create temporary table quote_notification_submitted as select public.marketplace_submit_supplier(owner_id,id,1)
from quote_notification_suppliers;
create temporary table quote_notification_approved as select public.marketplace_review_supplier(
  'f1600000-0000-4000-8000-000000000007',id,2,'approve','Approved synthetic shop.'
) from quote_notification_suppliers;
insert into app_private.workspace_marketplace_members(workspace_id,user_id,role,requires_workspace_membership)
select workspace_id,'f1600000-0000-4000-8000-000000000004','viewer',false
from quote_notification_suppliers where label in ('a','b');
insert into app_private.workspace_members(workspace_id,user_id,role)
select workspace_id,'f1600000-0000-4000-8000-000000000005','editor' from quote_notification_suppliers where label='a';

insert into app_private.quote_request_drafts(id,workspace_id,project_id,created_by,project_name,project_revision,title,quantity,notes,spec)
select ('f4600000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
  'f2600000-0000-4000-8000-000000000001','f3600000-0000-4000-8000-000000000001','f1600000-0000-4000-8000-000000000001',
  'Private source',1,'Published title ' || n,100,'Buyer notes',
  '{"template":"tuck-end","materialId":"carton-300","W":80,"D":50,"H":120,"handle":false}'
from generate_series(1,15) n;

create temporary table historical_publication as select public.marketplace_publish_quote_request(
  'f1600000-0000-4000-8000-000000000001','f4600000-0000-4000-8000-000000000014',
  array[(select id from quote_notification_suppliers where label='c')]
) as result;
select is(public.marketplace_list_quote_request_notifications(
  'f1600000-0000-4000-8000-000000000006',null,null,null
)#>>'{items,0,createdAt}',(select result->>'publishedAt' from historical_publication),
  'an existing publication grant appears once with its original publication time');
select is(jsonb_array_length(public.marketplace_list_quote_request_notifications(
  'f1600000-0000-4000-8000-000000000006',null,null,null
)->'items'),1,'listing needs no delivery row or backfill');

-- 25 visible alerts, one latest single grant and 12 two-shop requests at
-- precisely the same time. The page boundary splits request 1 across shops.
insert into app_private.quote_request_publications(request_id,published_by,published_at)
select id,'f1600000-0000-4000-8000-000000000001','2090-01-01T00:00:00.123456Z'
from app_private.quote_request_drafts
where id between 'f4600000-0000-4000-8000-000000000001' and 'f4600000-0000-4000-8000-000000000013';
insert into app_private.quote_request_supplier_access(request_id,supplier_id,supplier_name)
select p.request_id,s.id,'Published Shop ' || upper(s.label)
from app_private.quote_request_publications p cross join quote_notification_suppliers s
where p.request_id between 'f4600000-0000-4000-8000-000000000001' and 'f4600000-0000-4000-8000-000000000013'
  and s.label in ('a','b') and (p.request_id <> 'f4600000-0000-4000-8000-000000000013' or s.label='a');

select is(public.marketplace_list_quote_request_notifications(
  'f1600000-0000-4000-8000-000000000001',null,null,null
),'{"items":[],"nextCursor":null,"hasUnread":false}'::jsonb,'active buyer without supplier membership gets an empty inbox');
select is(public.marketplace_list_quote_request_notifications(
  'f1600000-0000-4000-8000-000000000005',null,null,null
),'{"items":[],"nextCursor":null,"hasUnread":false}'::jsonb,'design membership alone grants no request alerts');
select throws_ok($$select public.marketplace_list_quote_request_notifications(
  'f1600000-0000-4000-8000-000000000004','2090-01-01T00:00:00.123456Z',
  'f4600000-0000-4000-8000-000000000001',null
)$$,'22023','VALIDATION_ERROR','all three cursor fields are required together');

create temporary table quote_alert_first_page as select public.marketplace_list_quote_request_notifications(
  'f1600000-0000-4000-8000-000000000004',null,null,null
) as result;
select is((select jsonb_array_length(result->'items') from quote_alert_first_page),24,'page has the fixed limit of 24 alerts');
select is((select result#>>'{items,0,requestId}' from quote_alert_first_page),'f4600000-0000-4000-8000-000000000013',
  'highest request UUID sorts first for equal publication times');
select is((select result#>'{items,0}' from quote_alert_first_page),(
  select jsonb_build_object(
    'requestId','f4600000-0000-4000-8000-000000000013','supplierId',id,'supplierName','Published Shop A',
    'requestTitle','Published title 13','createdAt','2090-01-01T00:00:00.123456Z','readAt',null
  ) from quote_notification_suppliers where label='a'
),'alert projects only its published labels and receipt state, never source or notes');
select is((select result->'nextCursor' from quote_alert_first_page),(
  select jsonb_build_object('createdAt','2090-01-01T00:00:00.123456Z','requestId','f4600000-0000-4000-8000-000000000001','supplierId',id)
  from quote_notification_suppliers where label in ('a','b') order by id desc limit 1
),'cursor preserves full microseconds, request ID and the larger tied supplier ID');

create temporary table quote_alert_last_page as select public.marketplace_list_quote_request_notifications(
  'f1600000-0000-4000-8000-000000000004',
  (select (result#>>'{nextCursor,createdAt}')::timestamptz from quote_alert_first_page),
  (select (result#>>'{nextCursor,requestId}')::uuid from quote_alert_first_page),
  (select (result#>>'{nextCursor,supplierId}')::uuid from quote_alert_first_page)
) as result;
select is((select jsonb_array_length(result->'items') from quote_alert_last_page),1,'only the smaller tied supplier remains after the cursor');
select is((select result#>>'{items,0,requestId}' from quote_alert_last_page),
  'f4600000-0000-4000-8000-000000000001','next page retains the same request across different grants');
select is((select result#>>'{items,0,supplierId}' from quote_alert_last_page),
  (select id::text from quote_notification_suppliers where label in ('a','b') order by id limit 1),
  'triple cursor correctly distinguishes both grants at equal timestamp and request');
select is((select result->'nextCursor' from quote_alert_last_page),'null'::jsonb,'last page has no continuation');
select is((select result->'hasUnread' from quote_alert_last_page),'true'::jsonb,'authorized inbox initially contains unread alerts');

select throws_ok($$select public.marketplace_mark_quote_request_notification_read(
  'f1600000-0000-4000-8000-000000000005',(select id from quote_notification_suppliers where label='a'),
  'f4600000-0000-4000-8000-000000000001'
)$$,'P0001','QUOTE_REQUEST_NOT_FOUND','design Editor cannot mark a supplier alert');
select throws_ok($$select public.marketplace_mark_quote_request_notification_read(
  'f1600000-0000-4000-8000-000000000002',(select id from quote_notification_suppliers where label='a'),
  'f4600000-0000-4000-8000-000000000014'
)$$,'P0001','QUOTE_REQUEST_NOT_FOUND','approved shop cannot mark an ungranted request');
select throws_ok($$select public.marketplace_mark_quote_request_notification_read(
  'f1600000-0000-4000-8000-000000000002',(select id from quote_notification_suppliers where label='b'),
  'f4600000-0000-4000-8000-000000000001'
)$$,'P0001','QUOTE_REQUEST_NOT_FOUND','member cannot claim another granted shop');

create temporary table quote_alert_read as select public.marketplace_mark_quote_request_notification_read(
  'f1600000-0000-4000-8000-000000000004',
  (select (result#>>'{items,0,supplierId}')::uuid from quote_alert_last_page),
  'f4600000-0000-4000-8000-000000000001'
) as result;
select matches((select result->>'readAt' from quote_alert_read),'^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*\.[0-9]{6}Z$',
  'first read receipt preserves UTC microseconds');
select is(public.marketplace_mark_quote_request_notification_read(
  'f1600000-0000-4000-8000-000000000004',
  (select (result->>'supplierId')::uuid from quote_alert_read),
  'f4600000-0000-4000-8000-000000000001'
),(select result from quote_alert_read),'read retry returns the same receipt without writing a duplicate');
select is(public.marketplace_list_quote_request_notifications(
  'f1600000-0000-4000-8000-000000000004',
  (select (result#>>'{nextCursor,createdAt}')::timestamptz from quote_alert_first_page),
  (select (result#>>'{nextCursor,requestId}')::uuid from quote_alert_first_page),
  (select (result#>>'{nextCursor,supplierId}')::uuid from quote_alert_first_page)
)->'hasUnread','true'::jsonb,'hasUnread remains true on an all-read page if earlier authorized alerts are unread');
select is((
  select count(*)::integer from app_private.quote_request_notification_reads
  where request_id='f4600000-0000-4000-8000-000000000001' and user_id='f1600000-0000-4000-8000-000000000004'
),1,'reading one grant does not mark the other shop for the same request');
select is(public.marketplace_list_quote_request_notifications(
  'f1600000-0000-4000-8000-000000000002',null,null,null
)->'hasUnread','true'::jsonb,'another account retains its own unread state');

create temporary table mark_remaining_alerts as
select public.marketplace_mark_quote_request_notification_read(
  'f1600000-0000-4000-8000-000000000004',(item->>'supplierId')::uuid,(item->>'requestId')::uuid
)
from jsonb_array_elements((select result->'items' from quote_alert_first_page)) item;
select is(public.marketplace_list_quote_request_notifications(
  'f1600000-0000-4000-8000-000000000004',null,null,null
)->'hasUnread','false'::jsonb,'all authorized receipts clear the inbox-wide unread flag');
select is((select count(*)::integer from app_private.quote_request_notification_reads
  where user_id='f1600000-0000-4000-8000-000000000004'),25,'same user can read both grants independently');

insert into app_private.quote_request_publications(request_id,published_by,published_at)
values ('f4600000-0000-4000-8000-000000000015','f1600000-0000-4000-8000-000000000001','2090-01-01T00:00:00.123457Z');
insert into app_private.quote_request_supplier_access(request_id,supplier_id,supplier_name)
select 'f4600000-0000-4000-8000-000000000015',id,'Published Shop B' from quote_notification_suppliers where label='b';
select is(public.marketplace_list_quote_request_notifications(
  'f1600000-0000-4000-8000-000000000004',null,null,null
)->'hasUnread','true'::jsonb,'a new grant immediately contributes unread state');
create temporary table revoke_quote_alert_member as select public.marketplace_remove_supplier_member(
  'f1600000-0000-4000-8000-000000000003',(select id from quote_notification_suppliers where label='b'),
  'f1600000-0000-4000-8000-000000000004'
);
select is(jsonb_array_length(public.marketplace_list_quote_request_notifications(
  'f1600000-0000-4000-8000-000000000004',null,null,null
)->'items'),13,'removed membership filters both previous and new alerts for that supplier');
select is(public.marketplace_list_quote_request_notifications(
  'f1600000-0000-4000-8000-000000000004',null,null,null
)->'hasUnread','false'::jsonb,'unread from the removed supplier is no longer counted');
select throws_ok($$select public.marketplace_mark_quote_request_notification_read(
  'f1600000-0000-4000-8000-000000000004',(select id from quote_notification_suppliers where label='b'),
  'f4600000-0000-4000-8000-000000000001'
)$$,'P0001','QUOTE_REQUEST_NOT_FOUND','removed membership cannot retry even a previously recorded read');

create temporary table suspend_quote_alert_supplier as select public.marketplace_review_supplier(
  'f1600000-0000-4000-8000-000000000007',(select id from quote_notification_suppliers where label='a'),
  3,'suspend','Synthetic suspension.'
);
select is(public.marketplace_list_quote_request_notifications(
  'f1600000-0000-4000-8000-000000000004',null,null,null
),'{"items":[],"nextCursor":null,"hasUnread":false}'::jsonb,'suspended supplier is excluded from list and unread count');
select throws_ok($$select public.marketplace_mark_quote_request_notification_read(
  'f1600000-0000-4000-8000-000000000004',(select id from quote_notification_suppliers where label='a'),
  'f4600000-0000-4000-8000-000000000001'
)$$,'P0001','QUOTE_REQUEST_NOT_FOUND','suspension prevents marking');
create temporary table resume_quote_alert_supplier as select public.marketplace_review_supplier(
  'f1600000-0000-4000-8000-000000000007',(select id from quote_notification_suppliers where label='a'),
  4,'resume','Synthetic reapproval.'
);
select is(public.marketplace_list_quote_request_notifications(
  'f1600000-0000-4000-8000-000000000004',null,null,null
)->'hasUnread','false'::jsonb,'resumed shop preserves the account receipts');
select is((select count(*)::integer from app_private.notification_outbox outbox
  join app_private.activity_events event on event.id=outbox.event_id
  where event.supplier_id in (select id from quote_notification_suppliers) and outbox.processed_at is not null),
  0,'request alert lists and marks do not drain or mutate the 013 outbox');

reset role;
delete from app_private.quote_request_supplier_access
where request_id='f4600000-0000-4000-8000-000000000001' and supplier_id=(select id from quote_notification_suppliers where label='a');
select ok(not exists(select 1 from app_private.quote_request_notification_reads
  where request_id='f4600000-0000-4000-8000-000000000001' and supplier_id=(select id from quote_notification_suppliers where label='a'))
  and exists(select 1 from app_private.quote_request_notification_reads
  where request_id='f4600000-0000-4000-8000-000000000001' and supplier_id=(select id from quote_notification_suppliers where label='b')),
  'trusted grant deletion cascades only receipts for that exact grant');

select * from finish();
rollback;
