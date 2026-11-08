begin;

select plan(45);

select ok(
  (select relrowsecurity from pg_class where oid='app_private.quote_request_drafts'::regclass)
  and not has_table_privilege('anon','app_private.quote_request_drafts','SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated','app_private.quote_request_drafts','SELECT,INSERT,UPDATE,DELETE'),
  'private request drafts have RLS and no browser table privileges'
);
select ok(
  has_table_privilege('service_role','app_private.quote_request_drafts','SELECT')
  and has_table_privilege('service_role','app_private.quote_request_drafts','INSERT')
  and not has_table_privilege('service_role','app_private.quote_request_drafts','UPDATE,DELETE'),
  'service role may capture a snapshot but cannot rewrite it'
);
select is((
  select count(*)::integer from pg_proc
  where pronamespace='public'::regnamespace and proname in (
    'marketplace_create_quote_request_draft','marketplace_get_quote_request_draft','marketplace_list_quote_request_drafts'
  ) and not prosecdef and has_function_privilege('service_role',oid,'EXECUTE')
    and not has_function_privilege('anon',oid,'EXECUTE')
    and not has_function_privilege('authenticated',oid,'EXECUTE')
),3,'draft RPCs are service-role-only invokers');

insert into app_private.app_users (id,display_name) values
  ('f1400000-0000-4000-8000-000000000001','Buyer fixture owner'),
  ('f1400000-0000-4000-8000-000000000002','Buyer fixture Editor'),
  ('f1400000-0000-4000-8000-000000000003','Buyer fixture viewer'),
  ('f1400000-0000-4000-8000-000000000004','Other workspace owner'),
  ('f1400000-0000-4000-8000-000000000005','Buyer fixture future owner');

set local role service_role;

insert into app_private.workspaces (id,kind,owner_user_id,name) values
  ('f2400000-0000-4000-8000-000000000001','team','f1400000-0000-4000-8000-000000000001','Buyer fixture team'),
  ('f2400000-0000-4000-8000-000000000002','personal','f1400000-0000-4000-8000-000000000004','Other fixture workspace');
insert into app_private.workspace_members (workspace_id,user_id,role) values
  ('f2400000-0000-4000-8000-000000000001','f1400000-0000-4000-8000-000000000001','owner'),
  ('f2400000-0000-4000-8000-000000000001','f1400000-0000-4000-8000-000000000002','editor'),
  ('f2400000-0000-4000-8000-000000000001','f1400000-0000-4000-8000-000000000003','viewer'),
  ('f2400000-0000-4000-8000-000000000001','f1400000-0000-4000-8000-000000000005','owner'),
  ('f2400000-0000-4000-8000-000000000002','f1400000-0000-4000-8000-000000000004','owner');

insert into app_private.projects (id,workspace_id,created_by,name,document_schema_version,document,revision) values
  ('f3400000-0000-4000-8000-000000000001','f2400000-0000-4000-8000-000000000001','f1400000-0000-4000-8000-000000000001',
   'Original project name',1,'{
     "live":{"template":"tuck-end","materialId":"carton-300","W":80.25,"D":50,"H":120,"handle":true,"assetId":"private-live-data"},
     "qty":7,"fillColor":"#ffffff","decos":[{"type":"text","text":"private artwork"}],
     "history":[{"label":"private history"}],"assets":[{"id":"private asset"}],
     "thumbnail":{"source":"private thumbnail"}
   }',7),
  ('f3400000-0000-4000-8000-000000000002','f2400000-0000-4000-8000-000000000002','f1400000-0000-4000-8000-000000000004',
   'Other source',1,'{"live":{"template":"sticker","materialId":"carton-300","W":10,"D":20,"H":10,"handle":false}}',1),
  ('f3400000-0000-4000-8000-000000000003','f2400000-0000-4000-8000-000000000001','f1400000-0000-4000-8000-000000000001',
   'Malformed stored source',1,'{"live":{"template":"tuck-end","materialId":"carton-300","W":"80","D":50,"H":120}}',1);

select is(public.marketplace_list_quote_request_drafts(
  'f1400000-0000-4000-8000-000000000001','f2400000-0000-4000-8000-000000000001',null,null
),'{"items":[],"nextCursor":null}'::jsonb,'owner can list an empty private draft set');
select throws_ok($$select public.marketplace_create_quote_request_draft(
  'f1400000-0000-4000-8000-000000000002','f2400000-0000-4000-8000-000000000001','f3400000-0000-4000-8000-000000000001',
  7,'f4400000-0000-4000-8000-000000000001','Quote test',1000,''
)$$,'P0001','MARKETPLACE_NOT_FOUND','design Editor does not have buyer draft rights');
select throws_ok($$select public.marketplace_list_quote_request_drafts(
  'f1400000-0000-4000-8000-000000000003','f2400000-0000-4000-8000-000000000001',null,null
)$$,'P0001','MARKETPLACE_NOT_FOUND','workspace viewer cannot list buyer drafts');
select throws_ok($$select public.marketplace_list_quote_request_drafts(
  'f1400000-0000-4000-8000-000000000005','f2400000-0000-4000-8000-000000000001',null,null
)$$,'P0001','MARKETPLACE_NOT_FOUND','owner membership without canonical ownership is insufficient');
select throws_ok($$select public.marketplace_create_quote_request_draft(
  'f1400000-0000-4000-8000-000000000001','f2400000-0000-4000-8000-000000000001','f3400000-0000-4000-8000-000000000002',
  1,'f4400000-0000-4000-8000-000000000001','Quote test',1000,''
)$$,'P0001','MARKETPLACE_NOT_FOUND','source must belong to the exact owned workspace');

create function pg_temp.quote_draft_stale_detail() returns jsonb language plpgsql as $$
declare
  v_message text;
  v_detail text;
begin
  perform public.marketplace_create_quote_request_draft(
    'f1400000-0000-4000-8000-000000000001','f2400000-0000-4000-8000-000000000001','f3400000-0000-4000-8000-000000000001',
    6,'f4400000-0000-4000-8000-000000000001','Quote test',1000,''
  );
  return null;
exception when raise_exception then
  get stacked diagnostics v_message=message_text, v_detail=pg_exception_detail;
  return jsonb_build_object('message',v_message,'detail',v_detail::jsonb);
end;
$$;
select is(pg_temp.quote_draft_stale_detail(), '{"message":"REVISION_CONFLICT","detail":{"currentRevision":7}}'::jsonb,
  'stale source revision returns the current revision without creating a draft');
select throws_ok($$select public.marketplace_create_quote_request_draft(
  'f1400000-0000-4000-8000-000000000001','f2400000-0000-4000-8000-000000000001','f3400000-0000-4000-8000-000000000003',
  1,'f4400000-0000-4000-8000-000000000001','Quote test',1000,''
)$$,'P0001','MARKETPLACE_CONFLICT','malformed persisted source yields a safe error instead of a malformed snapshot');
select throws_ok($$select public.marketplace_create_quote_request_draft(
  'f1400000-0000-4000-8000-000000000001','f2400000-0000-4000-8000-000000000001','f3400000-0000-4000-8000-000000000001',
  7,'f4400000-0000-4000-8000-000000000001','   ',1000,''
)$$,'22023','VALIDATION_ERROR','blank title is rejected');
select throws_ok($$select public.marketplace_create_quote_request_draft(
  'f1400000-0000-4000-8000-000000000001','f2400000-0000-4000-8000-000000000001','f3400000-0000-4000-8000-000000000001',
  7,'f4400000-0000-4000-8000-000000000001',repeat('ก',101),1000,''
)$$,'22023','VALIDATION_ERROR','title length is bounded by characters');
select throws_ok($$select public.marketplace_create_quote_request_draft(
  'f1400000-0000-4000-8000-000000000001','f2400000-0000-4000-8000-000000000001','f3400000-0000-4000-8000-000000000001',
  7,'f4400000-0000-4000-8000-000000000001','Quote test',1000001,''
)$$,'22023','VALIDATION_ERROR','quantity above one million is rejected');
select throws_ok($$select public.marketplace_create_quote_request_draft(
  'f1400000-0000-4000-8000-000000000001','f2400000-0000-4000-8000-000000000001','f3400000-0000-4000-8000-000000000001',
  7,'f4400000-0000-4000-8000-000000000001','Quote test',1000,repeat('ก',1001)
)$$,'22023','VALIDATION_ERROR','notes length is bounded by characters');
select is((select count(*)::integer from app_private.quote_request_drafts where workspace_id='f2400000-0000-4000-8000-000000000001'),
  0,'rejected attempts leave no draft row or operation receipt');

create temporary table rfq_first as select public.marketplace_create_quote_request_draft(
  'f1400000-0000-4000-8000-000000000001','f2400000-0000-4000-8000-000000000001','f3400000-0000-4000-8000-000000000001',
  7,'f4400000-0000-4000-8000-000000000001','  Quote test  ',1000,'Private buyer notes'
) as result;
select is((select result->>'id' from rfq_first),'f4400000-0000-4000-8000-000000000001','operation ID is the saved draft ID');
select is((select result->>'title' from rfq_first),'Quote test','title is normalized');
select is((select array_agg(key order by key) from jsonb_object_keys((select result from rfq_first)) as item(key)),
  array['createdAt','id','notes','projectId','projectName','projectRevision','quantity','spec','title','workspaceId'],
  'detail response exposes only the exact private DTO fields');
select is((select result->'spec' from rfq_first),
  '{"template":"tuck-end","materialId":"carton-300","W":80.25,"D":50,"H":120,"handle":true}'::jsonb,
  'only the six allowlisted live fields enter the frozen spec');
select is((select spec from app_private.quote_request_drafts where id='f4400000-0000-4000-8000-000000000001'),
  (select result->'spec' from rfq_first),'database snapshot also excludes all artwork, thumbnails, assets and history');
select is((select result->>'projectName' from rfq_first),'Original project name','snapshot captures the persisted project name');
select is((select result->'projectRevision' from rfq_first),'7'::jsonb,'snapshot captures the persisted project revision');
select is(public.marketplace_get_quote_request_draft(
  'f1400000-0000-4000-8000-000000000001','f4400000-0000-4000-8000-000000000001'
),(select result from rfq_first),'owner can reopen the exact saved draft');
select throws_ok($$select public.marketplace_get_quote_request_draft(
  'f1400000-0000-4000-8000-000000000004','f4400000-0000-4000-8000-000000000001'
)$$,'P0001','MARKETPLACE_NOT_FOUND','other workspace owner cannot read the draft by ID');
select throws_ok($$select public.marketplace_create_quote_request_draft(
  'f1400000-0000-4000-8000-000000000004','f2400000-0000-4000-8000-000000000002','f3400000-0000-4000-8000-000000000002',
  1,'f4400000-0000-4000-8000-000000000001','Quote test',1000,'Private buyer notes'
)$$,'P0001','MARKETPLACE_CONFLICT','another workspace cannot claim or retrieve a globally occupied operation ID');
select throws_ok($$select public.marketplace_create_quote_request_draft(
  'f1400000-0000-4000-8000-000000000001','f2400000-0000-4000-8000-000000000001','f3400000-0000-4000-8000-000000000001',
  7,'f4400000-0000-4000-8000-000000000001','Quote test',1001,'Private buyer notes'
)$$,'P0001','IDEMPOTENCY_KEY_REUSED','changed quantity cannot reuse an accepted operation ID');
select throws_ok($$select public.marketplace_create_quote_request_draft(
  'f1400000-0000-4000-8000-000000000001','f2400000-0000-4000-8000-000000000001','f3400000-0000-4000-8000-000000000001',
  7,'f4400000-0000-4000-8000-000000000001','Quote test',1000,'Changed notes'
)$$,'P0001','IDEMPOTENCY_KEY_REUSED','changed notes cannot reuse an accepted operation ID');

update app_private.projects set revision=8, name='Edited project',
  document=jsonb_set(document,'{live,W}','95'::jsonb)
where id='f3400000-0000-4000-8000-000000000001';
select is(public.marketplace_create_quote_request_draft(
  'f1400000-0000-4000-8000-000000000001','f2400000-0000-4000-8000-000000000001','f3400000-0000-4000-8000-000000000001',
  7,'f4400000-0000-4000-8000-000000000001','Quote test',1000,'Private buyer notes'
),(select result from rfq_first),'exact retry returns the original snapshot even when source changed');
create temporary table rfq_edited as select public.marketplace_create_quote_request_draft(
  'f1400000-0000-4000-8000-000000000001','f2400000-0000-4000-8000-000000000001','f3400000-0000-4000-8000-000000000001',
  8,'f4400000-0000-4000-8000-000000000002','New quote draft',1,''
) as result;
select is((select result#>'{spec,W}' from rfq_edited),'95'::jsonb,'new operation captures the edited source at the new revision');
select is((select result->>'projectName' from rfq_edited),'Edited project','new snapshot includes the changed project name');
update app_private.projects set revision=9, deleted_at=statement_timestamp() where id='f3400000-0000-4000-8000-000000000001';
select throws_ok($$select public.marketplace_create_quote_request_draft(
  'f1400000-0000-4000-8000-000000000001','f2400000-0000-4000-8000-000000000001','f3400000-0000-4000-8000-000000000001',
  9,'f4400000-0000-4000-8000-000000000003','Unavailable source',1,''
)$$,'P0001','MARKETPLACE_NOT_FOUND','new draft cannot use a deleted source');
select is(public.marketplace_create_quote_request_draft(
  'f1400000-0000-4000-8000-000000000001','f2400000-0000-4000-8000-000000000001','f3400000-0000-4000-8000-000000000001',
  7,'f4400000-0000-4000-8000-000000000001','Quote test',1000,'Private buyer notes'
),(select result from rfq_first),'source soft deletion does not erase an accepted operation receipt');

create temporary table rfq_other as select public.marketplace_create_quote_request_draft(
  'f1400000-0000-4000-8000-000000000004','f2400000-0000-4000-8000-000000000002','f3400000-0000-4000-8000-000000000002',
  1,'f4400000-0000-4000-8000-000000000004',repeat('ก',100),1000000,repeat('ก',1000)
) as result;
select is((select result#>'{spec,W}' from rfq_other),'10'::jsonb,'sticker source supports its smaller dimension range');
select is((select result->'quantity' from rfq_other),'1000000'::jsonb,'maximum valid quantity is accepted');
select is(jsonb_array_length(public.marketplace_list_quote_request_drafts(
  'f1400000-0000-4000-8000-000000000004','f2400000-0000-4000-8000-000000000002',null,null
)->'items'),1,'other workspace list includes only its own request');
select throws_ok($$select public.marketplace_list_quote_request_drafts(
  'f1400000-0000-4000-8000-000000000001','f2400000-0000-4000-8000-000000000001','2090-01-01T00:00:00Z',null
)$$,'22023','VALIDATION_ERROR','cursor must include timestamp and ID together');

-- Same timestamp on 25 rows verifies page cap and UUID tie-breaking.
insert into app_private.quote_request_drafts (
  id,workspace_id,project_id,created_by,project_name,project_revision,title,quantity,notes,spec,created_at
)
select ('f5400000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
  'f2400000-0000-4000-8000-000000000001','f3400000-0000-4000-8000-000000000001','f1400000-0000-4000-8000-000000000001',
  'Original project name',7,'Pagination fixture',1,'Private notes',
  (select result->'spec' from rfq_first),'2090-01-01T00:00:00.123456Z'
from generate_series(1,25) n;
create temporary table rfq_first_page as select public.marketplace_list_quote_request_drafts(
  'f1400000-0000-4000-8000-000000000001','f2400000-0000-4000-8000-000000000001',null,null
) as result;
select is((select jsonb_array_length(result->'items') from rfq_first_page),24,'list page is limited to 24 items');
select is((select array_agg(key order by key) from jsonb_object_keys((select result#>'{items,0}' from rfq_first_page)) as item(key)),
  array['createdAt','id','projectName','quantity','title'],'list uses the exact summary shape without private notes or spec');
select is((select result->'nextCursor' from rfq_first_page),
  '{"createdAt":"2090-01-01T00:00:00.123456Z","id":"f5400000-0000-4000-8000-000000000002"}'::jsonb,
  'cursor preserves microseconds and the last ID in descending tie order');
create temporary table rfq_second_page as select public.marketplace_list_quote_request_drafts(
  'f1400000-0000-4000-8000-000000000001','f2400000-0000-4000-8000-000000000001',
  (select (result#>>'{nextCursor,createdAt}')::timestamptz from rfq_first_page),
  (select (result#>>'{nextCursor,id}')::uuid from rfq_first_page)
) as result;
select is((select result#>>'{items,0,id}' from rfq_second_page),'f5400000-0000-4000-8000-000000000001',
  'next page continues at the remaining tied ID without duplicates');
select is((select result->'nextCursor' from rfq_second_page),'null'::jsonb,'end of list has no cursor');

update app_private.app_users set status='suspended' where id='f1400000-0000-4000-8000-000000000001';
select throws_ok($$select public.marketplace_get_quote_request_draft(
  'f1400000-0000-4000-8000-000000000001','f4400000-0000-4000-8000-000000000001'
)$$,'P0001','MARKETPLACE_NOT_FOUND','inactive workspace owner cannot reopen drafts');
update app_private.app_users set status='active' where id='f1400000-0000-4000-8000-000000000001';
update app_private.workspace_members set role='editor'
where workspace_id='f2400000-0000-4000-8000-000000000001' and user_id='f1400000-0000-4000-8000-000000000001';
select throws_ok($$select public.marketplace_create_quote_request_draft(
  'f1400000-0000-4000-8000-000000000001','f2400000-0000-4000-8000-000000000001','f3400000-0000-4000-8000-000000000001',
  7,'f4400000-0000-4000-8000-000000000001','Quote test',1000,'Private buyer notes'
)$$,'P0001','MARKETPLACE_NOT_FOUND','retry rechecks current owner membership');
update app_private.workspaces set owner_user_id='f1400000-0000-4000-8000-000000000005'
where id='f2400000-0000-4000-8000-000000000001';
select is(public.marketplace_get_quote_request_draft(
  'f1400000-0000-4000-8000-000000000005','f4400000-0000-4000-8000-000000000001'
),(select result from rfq_first),'current workspace owner reads the existing immutable draft');
select throws_ok($$select public.marketplace_create_quote_request_draft(
  'f1400000-0000-4000-8000-000000000005','f2400000-0000-4000-8000-000000000001','f3400000-0000-4000-8000-000000000001',
  7,'f4400000-0000-4000-8000-000000000001','Quote test',1000,'Private buyer notes'
)$$,'P0001','IDEMPOTENCY_KEY_REUSED','new owner cannot replay the previous creator operation as their own');

select * from finish();
rollback;
