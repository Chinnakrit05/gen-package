begin;

select plan(46);

select is((
  select count(*)::integer from pg_class where oid in (
    'app_private.quote_request_publications'::regclass, 'app_private.quote_request_supplier_access'::regclass
  ) and relrowsecurity
    and not has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE')
    and has_table_privilege('service_role',oid,'SELECT')
    and has_table_privilege('service_role',oid,'INSERT')
    and not has_table_privilege('service_role',oid,'UPDATE,DELETE')
),2,'publication and access records are private, service-role-only and immutable');
select is((
  select count(*)::integer from pg_proc where pronamespace='public'::regnamespace and proname in (
    'marketplace_quote_request_publication','marketplace_quote_request_eligible_suppliers',
    'marketplace_publish_quote_request','marketplace_list_supplier_quote_requests','marketplace_get_supplier_quote_request'
  ) and not prosecdef and has_function_privilege('service_role',oid,'EXECUTE')
    and not has_function_privilege('anon',oid,'EXECUTE')
    and not has_function_privilege('authenticated',oid,'EXECUTE')
),5,'five public RPCs are service-role-only invokers');

insert into app_private.app_users(id,display_name) values
  ('f1500000-0000-4000-8000-000000000001','Buyer fixture'),
  ('f1500000-0000-4000-8000-000000000002','Buyer Editor fixture'),
  ('f1500000-0000-4000-8000-000000000003','Selected supplier A owner'),
  ('f1500000-0000-4000-8000-000000000004','Selected supplier B owner'),
  ('f1500000-0000-4000-8000-000000000005','Unselected approved supplier owner'),
  ('f1500000-0000-4000-8000-000000000006','Pending supplier owner'),
  ('f1500000-0000-4000-8000-000000000007','Independent supplier member'),
  ('f1500000-0000-4000-8000-000000000008','Draft supplier owner'),
  ('f1500000-0000-4000-8000-000000000009','Platform reviewer'),
  ('f1500000-0000-4000-8000-000000000010','Supplier design-only Editor');
insert into app_private.platform_staff(user_id,role)
values ('f1500000-0000-4000-8000-000000000009','supplier_reviewer');

set local role service_role;

insert into app_private.workspaces(id,kind,owner_user_id,name)
values ('f2500000-0000-4000-8000-000000000001','team','f1500000-0000-4000-8000-000000000001','Buyer workspace');
insert into app_private.workspace_members(workspace_id,user_id,role) values
  ('f2500000-0000-4000-8000-000000000001','f1500000-0000-4000-8000-000000000001','owner'),
  ('f2500000-0000-4000-8000-000000000001','f1500000-0000-4000-8000-000000000002','editor');
insert into app_private.projects(id,workspace_id,created_by,name,document_schema_version,document)
values ('f3500000-0000-4000-8000-000000000001','f2500000-0000-4000-8000-000000000001','f1500000-0000-4000-8000-000000000001',
  'Private source name',1,'{
    "live":{"template":"tuck-end","materialId":"carton-300","W":80,"D":50,"H":120,"handle":false},
    "thumbnail":{"data":"private"},"decos":[{"type":"text","text":"private artwork"}],"history":[{"label":"private history"}]
  }');

create temporary table publication_draft as select public.marketplace_create_quote_request_draft(
  'f1500000-0000-4000-8000-000000000001','f2500000-0000-4000-8000-000000000001','f3500000-0000-4000-8000-000000000001',
  1,'f4500000-0000-4000-8000-000000000001','Fixture published quote',500,'Buyer notes explicitly shared'
) as result;
create temporary table publication_unshared_draft as select public.marketplace_create_quote_request_draft(
  'f1500000-0000-4000-8000-000000000001','f2500000-0000-4000-8000-000000000001','f3500000-0000-4000-8000-000000000001',
  1,'f4500000-0000-4000-8000-000000000002','Fixture private quote',500,'Buyer notes never published'
);

create temporary table publication_suppliers as
select fixture.label,fixture.owner_id::uuid,(result#>>'{profile,id}')::uuid as id,
  (result#>>'{profile,workspaceId}')::uuid as workspace_id
from (values
  ('a','f1500000-0000-4000-8000-000000000003','Selected supplier A'),
  ('b','f1500000-0000-4000-8000-000000000004','Selected supplier B'),
  ('unselected','f1500000-0000-4000-8000-000000000005','Approved unselected'),
  ('pending','f1500000-0000-4000-8000-000000000006','Pending supplier'),
  ('draft','f1500000-0000-4000-8000-000000000008','Draft supplier')
) as fixture(label,owner_id,name)
cross join lateral (select public.marketplace_create_supplier(fixture.owner_id::uuid,
  'f5500000-0000-4000-8000-000000000001',
  jsonb_build_object('kind','factory','name',fixture.name,'slug','publication-supplier-' || fixture.label,
    'description','Private supplier description','contactEmail','supplier@example.test','capabilities','["offset_printing","digital_printing"]'::jsonb)
) as result) created;

create temporary table publication_submitted as select public.marketplace_submit_supplier(owner_id,id,1)
from publication_suppliers where label <> 'draft';
create temporary table publication_approved as select public.marketplace_review_supplier(
  'f1500000-0000-4000-8000-000000000009',id,2,'approve','Synthetic supplier approved.'
) from publication_suppliers where label in ('a','b','unselected');

insert into app_private.workspace_marketplace_members(workspace_id,user_id,role,requires_workspace_membership)
select workspace_id,'f1500000-0000-4000-8000-000000000007','viewer',false from publication_suppliers where label='a';
insert into app_private.workspace_members(workspace_id,user_id,role)
select workspace_id,'f1500000-0000-4000-8000-000000000010','editor' from publication_suppliers where label='a';

select is(public.marketplace_quote_request_publication(
  'f1500000-0000-4000-8000-000000000001','f4500000-0000-4000-8000-000000000001'
),'{"publication":null}'::jsonb,'buyer sees no publication before sending');
select throws_ok($$select public.marketplace_quote_request_publication(
  'f1500000-0000-4000-8000-000000000002','f4500000-0000-4000-8000-000000000001'
)$$,'P0001','MARKETPLACE_NOT_FOUND','buyer Editor cannot see publication state');
select throws_ok($$select public.marketplace_quote_request_eligible_suppliers(
  'f1500000-0000-4000-8000-000000000003','f4500000-0000-4000-8000-000000000001',null
)$$,'P0001','MARKETPLACE_NOT_FOUND','supplier cannot browse the buyer selection endpoint');

create temporary table publication_eligible as select public.marketplace_quote_request_eligible_suppliers(
  'f1500000-0000-4000-8000-000000000001','f4500000-0000-4000-8000-000000000001',null
) as result;
select is((
  select count(*)::integer from jsonb_array_elements((select result->'items' from publication_eligible)) item
  join publication_suppliers s on s.id=(item->>'id')::uuid
),3,'eligible list includes approved suppliers and omits pending and draft suppliers');
select is((
  select item from jsonb_array_elements((select result->'items' from publication_eligible)) item
  where item->>'id'=(select id::text from publication_suppliers where label='a')
),(
  select jsonb_build_object('id',id,'name','Selected supplier A','kind','factory',
    'capabilities','["digital_printing","offset_printing"]'::jsonb)
  from publication_suppliers where label='a'
),'eligible item exposes only ID, name, kind and capabilities');

select throws_ok($$select public.marketplace_get_supplier_quote_request(
  'f1500000-0000-4000-8000-000000000003',(select id from publication_suppliers where label='a'),
  'f4500000-0000-4000-8000-000000000001'
)$$,'P0001','QUOTE_REQUEST_NOT_FOUND','approved supplier cannot see a private unpublished draft');
select throws_ok($$select public.marketplace_publish_quote_request(
  'f1500000-0000-4000-8000-000000000002','f4500000-0000-4000-8000-000000000001',
  array[(select id from publication_suppliers where label='a')]
)$$,'P0001','MARKETPLACE_NOT_FOUND','buyer Editor cannot publish for the owner');
select throws_ok($$select public.marketplace_publish_quote_request(
  'f1500000-0000-4000-8000-000000000001','f4500000-0000-4000-8000-000000000001',array[]::uuid[]
)$$,'22023','VALIDATION_ERROR','publication requires at least one supplier');
select throws_ok($$select public.marketplace_publish_quote_request(
  'f1500000-0000-4000-8000-000000000001','f4500000-0000-4000-8000-000000000001',
  array_fill((select id from publication_suppliers where label='a'),array[6])
)$$,'22023','VALIDATION_ERROR','publication rejects more than five supplier selections');
select throws_ok($$select public.marketplace_publish_quote_request(
  'f1500000-0000-4000-8000-000000000001','f4500000-0000-4000-8000-000000000001',
  array_fill((select id from publication_suppliers where label='a'),array[2])
)$$,'22023','VALIDATION_ERROR','duplicate supplier selections are rejected');
select throws_ok($$select public.marketplace_publish_quote_request(
  'f1500000-0000-4000-8000-000000000001','f4500000-0000-4000-8000-000000000001',
  array(select id from publication_suppliers where label in ('a','pending'))
)$$,'P0001','QUOTE_REQUEST_SUPPLIER_UNAVAILABLE','one pending supplier rejects the entire selection');
select throws_ok($$select public.marketplace_publish_quote_request(
  'f1500000-0000-4000-8000-000000000001','f4500000-0000-4000-8000-000000000001',
  array[(select id from publication_suppliers where label='a'),'f5500000-0000-4000-8000-000000000099'::uuid]
)$$,'P0001','QUOTE_REQUEST_SUPPLIER_UNAVAILABLE','unknown and unapproved supplier IDs have the same error');
select ok(not exists(select 1 from app_private.quote_request_publications where request_id='f4500000-0000-4000-8000-000000000001')
  and not exists(select 1 from app_private.quote_request_supplier_access where request_id='f4500000-0000-4000-8000-000000000001'),
  'failed selection leaves no partial publication or grants');

-- A changed or removed live Editor source cannot affect the frozen 014 draft.
update app_private.projects set name='Edited private source',revision=2,deleted_at=statement_timestamp(),
  document=jsonb_set(document,'{live,W}','99'::jsonb)
where id='f3500000-0000-4000-8000-000000000001';
create temporary table publication_receipt as select public.marketplace_publish_quote_request(
  'f1500000-0000-4000-8000-000000000001','f4500000-0000-4000-8000-000000000001',
  array(select id from publication_suppliers where label in ('a','b') order by id desc)
) as result;
select is((select array_agg(key order by key) from jsonb_object_keys((select result from publication_receipt)) as item(key)),
  array['publishedAt','revisionId','suppliers'],'receipt has the exact immutable public shape');
select matches((select result->>'publishedAt' from publication_receipt),'^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*\.[0-9]{6}Z$',
  'publication timestamp preserves UTC microseconds');
select is((select result->'suppliers' from publication_receipt),(
  select jsonb_agg(jsonb_build_object('id',s.id,'name',p.name) order by s.id)
  from publication_suppliers s join app_private.supplier_profiles p on p.id=s.id where s.label in ('a','b')
),'receipt contains exactly the selected suppliers in canonical ID order');
select is(public.marketplace_quote_request_publication(
  'f1500000-0000-4000-8000-000000000001','f4500000-0000-4000-8000-000000000001'
)->'publication',(select result from publication_receipt),'buyer reads the stored publication receipt');
select is(public.marketplace_publish_quote_request(
  'f1500000-0000-4000-8000-000000000001','f4500000-0000-4000-8000-000000000001',
  array(select id from publication_suppliers where label in ('a','b') order by id)
),(select result from publication_receipt),'reordering the same supplier set returns the original revision and receipt');
select is((select count(*)::integer from app_private.quote_request_supplier_access
  where request_id='f4500000-0000-4000-8000-000000000001'),2,'retry creates no additional grants');
select throws_ok($$select public.marketplace_publish_quote_request(
  'f1500000-0000-4000-8000-000000000001','f4500000-0000-4000-8000-000000000001',
  array(select id from publication_suppliers where label in ('a','unselected'))
)$$,'P0001','QUOTE_REQUEST_ALREADY_PUBLISHED','changing the set is rejected after publication');

create temporary table publication_seller_detail as select public.marketplace_get_supplier_quote_request(
  'f1500000-0000-4000-8000-000000000007',(select id from publication_suppliers where label='a'),
  'f4500000-0000-4000-8000-000000000001'
) as result;
select is((select array_agg(key order by key) from jsonb_object_keys((select result from publication_seller_detail)) as item(key)),
  array['id','notes','publishedAt','quantity','revisionId','spec','title'],
  'independent seller sees only the published request projection');
select is((select result->'spec' from publication_seller_detail),(select result->'spec' from publication_draft),
  'seller sees the original allowlisted draft spec after Editor source edits and deletion');
select is((select result->>'notes' from publication_seller_detail),'Buyer notes explicitly shared','seller receives explicitly published buyer notes');
select is((select result->>'revisionId' from publication_seller_detail),(select result->>'revisionId' from publication_receipt),
  'seller reads the exact publication revision');
select is(public.marketplace_list_supplier_quote_requests(
  'f1500000-0000-4000-8000-000000000004',(select id from publication_suppliers where label='b'),null,null
)#>'{items,0}',(select result - array['notes','spec'] from publication_seller_detail),
  'other selected supplier list returns the same summary without private notes or spec');
select is(public.marketplace_list_supplier_quote_requests(
  'f1500000-0000-4000-8000-000000000005',(select id from publication_suppliers where label='unselected'),null,null
),'{"items":[],"nextCursor":null}'::jsonb,'unselected approved supplier sees no requests');
select throws_ok($$select public.marketplace_get_supplier_quote_request(
  'f1500000-0000-4000-8000-000000000005',(select id from publication_suppliers where label='unselected'),
  'f4500000-0000-4000-8000-000000000001'
)$$,'P0001','QUOTE_REQUEST_NOT_FOUND','unselected supplier cannot retrieve a published request by ID');
select throws_ok($$select public.marketplace_get_supplier_quote_request(
  'f1500000-0000-4000-8000-000000000010',(select id from publication_suppliers where label='a'),
  'f4500000-0000-4000-8000-000000000001'
)$$,'P0001','QUOTE_REQUEST_NOT_FOUND','seller design Editor without a Marketplace role cannot read grants');
select throws_ok($$select public.marketplace_get_supplier_quote_request(
  'f1500000-0000-4000-8000-000000000003',(select id from publication_suppliers where label='b'),
  'f4500000-0000-4000-8000-000000000001'
)$$,'P0001','QUOTE_REQUEST_NOT_FOUND','seller cannot claim another selected supplier identity');
select is((select count(*)::integer from app_private.workspace_members
  where workspace_id='f2500000-0000-4000-8000-000000000001' and user_id in (
    'f1500000-0000-4000-8000-000000000003','f1500000-0000-4000-8000-000000000004','f1500000-0000-4000-8000-000000000007'
  )),0,'publication does not add sellers to the buyer Editor workspace');

create temporary table publication_revoke_member as select public.marketplace_remove_supplier_member(
  'f1500000-0000-4000-8000-000000000003',(select id from publication_suppliers where label='a'),
  'f1500000-0000-4000-8000-000000000007'
);
select throws_ok($$select public.marketplace_get_supplier_quote_request(
  'f1500000-0000-4000-8000-000000000007',(select id from publication_suppliers where label='a'),
  'f4500000-0000-4000-8000-000000000001'
)$$,'P0001','QUOTE_REQUEST_NOT_FOUND','removing current membership closes access to old grants');

create temporary table publication_suspend as select public.marketplace_review_supplier(
  'f1500000-0000-4000-8000-000000000009',(select id from publication_suppliers where label='a'),3,'suspend','Temporary pause.'
);
select throws_ok($$select public.marketplace_list_supplier_quote_requests(
  'f1500000-0000-4000-8000-000000000003',(select id from publication_suppliers where label='a'),null,null
)$$,'P0001','QUOTE_REQUEST_NOT_FOUND','suspended supplier cannot see previously granted requests');
select is(public.marketplace_publish_quote_request(
  'f1500000-0000-4000-8000-000000000001','f4500000-0000-4000-8000-000000000001',
  array(select id from publication_suppliers where label in ('a','b'))
),(select result from publication_receipt),'exact retry still returns the original receipt after supplier suspension');
select throws_ok($$select public.marketplace_publish_quote_request(
  'f1500000-0000-4000-8000-000000000001','f4500000-0000-4000-8000-000000000002',
  array(select id from publication_suppliers where label in ('a','b'))
)$$,'P0001','QUOTE_REQUEST_SUPPLIER_UNAVAILABLE','fresh publication cannot grant access to a suspended supplier');

create temporary table publication_resume as select public.marketplace_review_supplier(
  'f1500000-0000-4000-8000-000000000009',(select id from publication_suppliers where label='a'),4,'resume','Approved again.'
);
select is(public.marketplace_get_supplier_quote_request(
  'f1500000-0000-4000-8000-000000000003',(select id from publication_suppliers where label='a'),
  'f4500000-0000-4000-8000-000000000001'
),(select result from publication_seller_detail),'reapproved supplier can reopen the same frozen request');
create temporary table publication_rename as select public.marketplace_update_supplier(
  'f1500000-0000-4000-8000-000000000003',(select id from publication_suppliers where label='a'),5,
  '{"kind":"factory","name":"Renamed supplier","slug":"publication-supplier-a","description":"Private supplier description",
   "contactEmail":"supplier@example.test","capabilities":["offset_printing","digital_printing"]}'::jsonb
);
select is(public.marketplace_publish_quote_request(
  'f1500000-0000-4000-8000-000000000001','f4500000-0000-4000-8000-000000000001',
  array(select id from publication_suppliers where label in ('a','b'))
),(select result from publication_receipt),'supplier rename does not rewrite the historical receipt');
select throws_ok($$select public.marketplace_get_supplier_quote_request(
  'f1500000-0000-4000-8000-000000000003',(select id from publication_suppliers where label='a'),
  'f4500000-0000-4000-8000-000000000001'
)$$,'P0001','QUOTE_REQUEST_NOT_FOUND','return to draft closes seller access pending fresh approval');

-- Approved supplier selection has its own stable 24-item UUID cursor.
insert into app_private.workspaces(id,kind,owner_user_id,name)
select ('f6500000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,'team','f1500000-0000-4000-8000-000000000005','Page fixture'
from generate_series(1,25) n;
insert into app_private.supplier_profiles(id,workspace_id,kind,name,slug,description,contact_email,status)
select ('ffffffff-ffff-ffff-ffff-' || lpad(n::text,12,'0'))::uuid,
  ('f6500000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,'factory','Page fixture',
  'publication-supplier-page-' || n,'','page@example.test','approved'
from generate_series(1,25) n;
create temporary table publication_eligible_page as select public.marketplace_quote_request_eligible_suppliers(
  'f1500000-0000-4000-8000-000000000001','f4500000-0000-4000-8000-000000000001','ffffffff-ffff-ffff-ffff-000000000000'
) as result;
select is((select jsonb_array_length(result->'items') from publication_eligible_page),24,'eligible supplier page is capped at 24');
select is((select result->>'nextCursor' from publication_eligible_page),'ffffffff-ffff-ffff-ffff-000000000024',
  'eligible supplier cursor is the last returned UUID');
select is(public.marketplace_quote_request_eligible_suppliers(
  'f1500000-0000-4000-8000-000000000001','f4500000-0000-4000-8000-000000000001',
  (select (result->>'nextCursor')::uuid from publication_eligible_page)
)#>>'{items,0,id}','ffffffff-ffff-ffff-ffff-000000000025','eligible supplier cursor continues after the prior UUID');

-- Seller inbox has a separate published-time keyset cursor.
insert into app_private.quote_request_drafts(id,workspace_id,project_id,created_by,project_name,project_revision,title,quantity,notes,spec)
select ('f7500000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,'f2500000-0000-4000-8000-000000000001',
  'f3500000-0000-4000-8000-000000000001','f1500000-0000-4000-8000-000000000001','Private source name',1,
  'Page fixture',100,'', (select result->'spec' from publication_draft)
from generate_series(1,25) n;
insert into app_private.quote_request_publications(request_id,published_by,published_at)
select id,'f1500000-0000-4000-8000-000000000001','2090-01-01T00:00:00.123456Z'
from app_private.quote_request_drafts where id::text like 'f7500000-0000-4000-8000-%';
insert into app_private.quote_request_supplier_access(request_id,supplier_id,supplier_name)
select request_id,(select id from publication_suppliers where label='b'),'Selected supplier B'
from app_private.quote_request_publications where request_id::text like 'f7500000-0000-4000-8000-%';

create temporary table publication_inbox_page as select public.marketplace_list_supplier_quote_requests(
  'f1500000-0000-4000-8000-000000000004',(select id from publication_suppliers where label='b'),null,null
) as result;
select is((select jsonb_array_length(result->'items') from publication_inbox_page),24,'seller inbox page is capped at 24');
select is((select result->'nextCursor' from publication_inbox_page),
  '{"createdAt":"2090-01-01T00:00:00.123456Z","id":"f7500000-0000-4000-8000-000000000002"}'::jsonb,
  'seller inbox cursor keeps full microsecond timestamp and UUID tie-break');
select is(public.marketplace_list_supplier_quote_requests(
  'f1500000-0000-4000-8000-000000000004',(select id from publication_suppliers where label='b'),
  (select (result#>>'{nextCursor,createdAt}')::timestamptz from publication_inbox_page),
  (select (result#>>'{nextCursor,id}')::uuid from publication_inbox_page)
)#>>'{items,0,id}','f7500000-0000-4000-8000-000000000001','seller inbox continues at the next tied UUID');

update app_private.workspace_members set role='editor'
where workspace_id='f2500000-0000-4000-8000-000000000001' and user_id='f1500000-0000-4000-8000-000000000001';
select throws_ok($$select public.marketplace_publish_quote_request(
  'f1500000-0000-4000-8000-000000000001','f4500000-0000-4000-8000-000000000001',
  array(select id from publication_suppliers where label in ('a','b'))
)$$,'P0001','MARKETPLACE_NOT_FOUND','even an idempotent publication retry checks current buyer ownership');

select * from finish();
rollback;
