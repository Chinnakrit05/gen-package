begin;
select no_plan();
select is((select count(*)::integer from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app_private' and c.relname in ('marketplace_conversations','marketplace_conversation_messages','marketplace_conversation_reads','marketplace_conversation_files','marketplace_conversation_file_grants','marketplace_conversation_outbox') and c.relrowsecurity),6,'all chat tables have RLS');
select is((select count(*)::integer from pg_proc where pronamespace='public'::regnamespace and proname in ('marketplace_ensure_conversation','marketplace_get_conversation','marketplace_list_conversations','marketplace_list_conversation_messages','marketplace_send_conversation_message','marketplace_read_conversation','marketplace_upload_conversation_file','marketplace_download_conversation_file') and not prosecdef and has_function_privilege('service_role',oid,'execute') and not has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('anon',oid,'execute')),8,'all business RPCs are service-only invokers');
select ok(not has_table_privilege('authenticated','app_private.marketplace_conversation_messages','select') and not has_table_privilege('authenticated','app_private.marketplace_conversation_files','select'),'browser cannot directly read messages or bytes');
select ok(not has_table_privilege('service_role','app_private.marketplace_conversation_messages','update,delete'),'messages immutable for service');
select ok(not has_table_privilege('service_role','app_private.marketplace_conversation_files','update,delete'),'files immutable for service');
insert into app_private.app_users(id,display_name) values
 ('f1800000-0000-4000-8000-000000000001','Chat buyer'),('f1800000-0000-4000-8000-000000000002','Chat manager'),
 ('f1800000-0000-4000-8000-000000000003','Chat staff'),('f1800000-0000-4000-8000-000000000004','Chat viewer'),
 ('f1800000-0000-4000-8000-000000000005','Chat outsider'),('f1800000-0000-4000-8000-000000000006','Chat reviewer');
insert into app_private.workspaces(id,kind,owner_user_id,name) values
 ('f2800000-0000-4000-8000-000000000001','personal','f1800000-0000-4000-8000-000000000001','Buyer'),
 ('f2800000-0000-4000-8000-000000000002','team','f1800000-0000-4000-8000-000000000002','Factory');
insert into app_private.workspace_members(workspace_id,user_id,role) values
 ('f2800000-0000-4000-8000-000000000001','f1800000-0000-4000-8000-000000000001','owner'),
 ('f2800000-0000-4000-8000-000000000002','f1800000-0000-4000-8000-000000000002','owner');
insert into app_private.workspace_marketplace_members(workspace_id,user_id,role,requires_workspace_membership) values
 ('f2800000-0000-4000-8000-000000000002','f1800000-0000-4000-8000-000000000002','manager',true),
 ('f2800000-0000-4000-8000-000000000002','f1800000-0000-4000-8000-000000000003','staff',false),
 ('f2800000-0000-4000-8000-000000000002','f1800000-0000-4000-8000-000000000004','viewer',false);
insert into app_private.platform_staff(user_id,role) values('f1800000-0000-4000-8000-000000000006','supplier_reviewer');
insert into app_private.supplier_profiles(id,workspace_id,kind,name,slug,description,contact_email,status)
 values('f3800000-0000-4000-8000-000000000001','f2800000-0000-4000-8000-000000000002','factory','Chat factory','chat-test-factory','','chat@example.test','approved');
insert into app_private.projects(id,workspace_id,created_by,name,document_schema_version,document)
 values('f4800000-0000-4000-8000-000000000001','f2800000-0000-4000-8000-000000000001','f1800000-0000-4000-8000-000000000001','Chat project',1,'{}');
insert into app_private.quote_request_drafts(id,workspace_id,project_id,created_by,project_name,project_revision,title,quantity,notes,spec)
 values('f5800000-0000-4000-8000-000000000001','f2800000-0000-4000-8000-000000000001','f4800000-0000-4000-8000-000000000001','f1800000-0000-4000-8000-000000000001','Chat project',1,'Chat RFQ',500,'','{"template":"tuck-end","materialId":"carton-300","W":80,"D":50,"H":120,"handle":false}');
insert into app_private.quote_request_publications(request_id,published_by) values('f5800000-0000-4000-8000-000000000001','f1800000-0000-4000-8000-000000000001');
insert into app_private.quote_request_supplier_access(request_id,supplier_id,supplier_name) values('f5800000-0000-4000-8000-000000000001','f3800000-0000-4000-8000-000000000001','Chat factory');
set local role service_role;
create temporary table chat_room as select public.marketplace_ensure_conversation('f1800000-0000-4000-8000-000000000001','f5800000-0000-4000-8000-000000000001','f3800000-0000-4000-8000-000000000001') as data;
select is(public.marketplace_ensure_conversation('f1800000-0000-4000-8000-000000000002','f5800000-0000-4000-8000-000000000001','f3800000-0000-4000-8000-000000000001')->>'id',(select data->>'id' from chat_room),'both parties resolve to one room');
select throws_ok($$select public.marketplace_ensure_conversation('f1800000-0000-4000-8000-000000000005','f5800000-0000-4000-8000-000000000001','f3800000-0000-4000-8000-000000000001')$$,'P0001','CONVERSATION_NOT_FOUND','outsider cannot ensure room');
select is(jsonb_array_length(public.marketplace_list_conversations('f1800000-0000-4000-8000-000000000005',null)->'items'),0,'outsider list is empty');
select is(public.marketplace_get_conversation('f1800000-0000-4000-8000-000000000004',(select(data->>'id')::uuid from chat_room))->>'canWrite','false','viewer reads but cannot write');
select throws_ok($$select public.marketplace_get_conversation('f1800000-0000-4000-8000-000000000006',(select(data->>'id')::uuid from chat_room))$$,'P0001','CONVERSATION_NOT_FOUND','platform reviewer does not inherit chat access');
select throws_ok($$select public.marketplace_send_conversation_message('f1800000-0000-4000-8000-000000000004',(select(data->>'id')::uuid from chat_room),'f6800000-0000-4000-8000-000000000001','no','{}')$$,'P0001','MARKETPLACE_FORBIDDEN','viewer cannot send');
create temporary table chat_sent as select public.marketplace_send_conversation_message('f1800000-0000-4000-8000-000000000003',(select(data->>'id')::uuid from chat_room),'f6800000-0000-4000-8000-000000000001','Hello','{}') as data;
select is(public.marketplace_send_conversation_message('f1800000-0000-4000-8000-000000000003',(select(data->>'id')::uuid from chat_room),'f6800000-0000-4000-8000-000000000001','Hello','{}'),(select data from chat_sent),'lost response retry returns exact message');
select throws_ok($$select public.marketplace_send_conversation_message('f1800000-0000-4000-8000-000000000003',(select(data->>'id')::uuid from chat_room),'f6800000-0000-4000-8000-000000000001','changed','{}')$$,'P0001','IDEMPOTENCY_KEY_REUSED','same key different body conflicts');
select throws_ok($$select public.marketplace_send_conversation_message('f1800000-0000-4000-8000-000000000002',(select(data->>'id')::uuid from chat_room),'f6800000-0000-4000-8000-000000000001','Hello','{}')$$,'P0001','IDEMPOTENCY_KEY_REUSED','another sender cannot reuse key');
select is((select count(*)::integer from app_private.marketplace_conversation_outbox where conversation_id=(select(data->>'id')::uuid from chat_room)),1,'retry creates one outbox row');
select is(public.marketplace_get_conversation('f1800000-0000-4000-8000-000000000001',(select(data->>'id')::uuid from chat_room))->>'unreadCount','1','buyer sees unread message');
select is(public.marketplace_read_conversation('f1800000-0000-4000-8000-000000000001',(select(data->>'id')::uuid from chat_room),1)->>'lastReadSequence','1','buyer read cursor saved');
select is(public.marketplace_read_conversation('f1800000-0000-4000-8000-000000000001',(select(data->>'id')::uuid from chat_room),0)->>'lastReadSequence','1','late cursor cannot regress');
select is(public.marketplace_get_conversation('f1800000-0000-4000-8000-000000000004',(select(data->>'id')::uuid from chat_room))->>'lastReadSequence','0','read cursor private per actor');
select throws_ok($$select public.marketplace_read_conversation('f1800000-0000-4000-8000-000000000001',(select(data->>'id')::uuid from chat_room),500)$$,'P0001','VALIDATION_ERROR','future read cursor rejected');
select is(public.marketplace_upload_conversation_file('f1800000-0000-4000-8000-000000000003',(select(data->>'id')::uuid from chat_room),'f7800000-0000-4000-8000-000000000001','test.pdf','application/pdf','JVBERi0=')->>'byteSize','5','valid bounded PDF saved');
select throws_ok($$select public.marketplace_upload_conversation_file('f1800000-0000-4000-8000-000000000003',(select(data->>'id')::uuid from chat_room),'f7800000-0000-4000-8000-000000000002','test.pdf','application/pdf','SGVsbG8=')$$,'P0001','VALIDATION_ERROR','MIME spoof rejected');
select throws_ok($$select public.marketplace_download_conversation_file('f1800000-0000-4000-8000-000000000001',(select(data->>'id')::uuid from chat_room),'f7800000-0000-4000-8000-000000000001')$$,'P0001','CONVERSATION_NOT_FOUND','unsent upload private to uploader');
select is(public.marketplace_download_conversation_file('f1800000-0000-4000-8000-000000000003',(select(data->>'id')::uuid from chat_room),'f7800000-0000-4000-8000-000000000001')->>'dataBase64','JVBERi0=','uploader can download exact bytes');
select throws_ok($$select public.marketplace_send_conversation_message('f1800000-0000-4000-8000-000000000002',(select(data->>'id')::uuid from chat_room),'f6800000-0000-4000-8000-000000000002','','{f7800000-0000-4000-8000-000000000001}')$$,'P0001','CONVERSATION_NOT_FOUND','another member cannot publish private upload');
select is(public.marketplace_send_conversation_message('f1800000-0000-4000-8000-000000000003',(select(data->>'id')::uuid from chat_room),'f6800000-0000-4000-8000-000000000002','','{f7800000-0000-4000-8000-000000000001}')#>>'{attachments,0,name}','test.pdf','attachment grant committed with message');
select is(public.marketplace_download_conversation_file('f1800000-0000-4000-8000-000000000001',(select(data->>'id')::uuid from chat_room),'f7800000-0000-4000-8000-000000000001')->>'dataBase64','JVBERi0=','buyer downloads only after sharing');
create temporary table chat_bulk as select public.marketplace_send_conversation_message('f1800000-0000-4000-8000-000000000003',(select(data->>'id')::uuid from chat_room),gen_random_uuid(),'page '||n,'{}') from generate_series(1,45)n;
select is(jsonb_array_length(public.marketplace_list_conversation_messages('f1800000-0000-4000-8000-000000000001',(select(data->>'id')::uuid from chat_room),null)->'items'),40,'message page bounded to 40');
select is(public.marketplace_list_conversation_messages('f1800000-0000-4000-8000-000000000001',(select(data->>'id')::uuid from chat_room),null)->>'nextCursor','8','cursor is oldest included sequence');
select is(public.marketplace_list_conversation_messages('f1800000-0000-4000-8000-000000000001',(select(data->>'id')::uuid from chat_room),null)#>>'{items,0,sequence}','8','page renders oldest to newest');
select is(jsonb_array_length(public.marketplace_list_conversation_messages('f1800000-0000-4000-8000-000000000001',(select(data->>'id')::uuid from chat_room),8)->'items'),7,'older page complete without overlap');
reset role;
update app_private.supplier_profiles set status='suspended' where id='f3800000-0000-4000-8000-000000000001';
set local role service_role;
select lives_ok($$select public.marketplace_get_conversation('f1800000-0000-4000-8000-000000000003',(select(data->>'id')::uuid from chat_room))$$,'suspension preserves existing fulfillment conversation');
reset role;
delete from app_private.workspace_marketplace_members where user_id='f1800000-0000-4000-8000-000000000003';
set local role service_role;
select throws_ok($$select public.marketplace_send_conversation_message('f1800000-0000-4000-8000-000000000003',(select(data->>'id')::uuid from chat_room),'f6800000-0000-4000-8000-000000000001','Hello','{}')$$,'P0001','CONVERSATION_NOT_FOUND','revocation checked before idempotent retry');
select throws_ok($$select public.marketplace_download_conversation_file('f1800000-0000-4000-8000-000000000003',(select(data->>'id')::uuid from chat_room),'f7800000-0000-4000-8000-000000000001')$$,'P0001','CONVERSATION_NOT_FOUND','revoked uploader cannot download');
select is(jsonb_array_length(public.marketplace_list_conversations('f1800000-0000-4000-8000-000000000003',null)->'items'),0,'revoked member inbox empty');
reset role;
insert into app_private.auth_identities(app_user_id,provider,issuer,subject) values('f1800000-0000-4000-8000-000000000002','supabase','https://chat-fixture.invalid/auth/v1','f9800000-0000-4000-8000-000000000002');
select set_config('request.jwt.claims','{"sub":"f9800000-0000-4000-8000-000000000002","iss":"https://chat-fixture.invalid/auth/v1","role":"authenticated"}',true);
select ok(public.marketplace_can_receive_conversation('marketplace:conversation:'||(select data->>'id' from chat_room)),'realtime authorization resolves issuer and subject');
select set_config('request.jwt.claims','{"sub":"f9800000-0000-4000-8000-000000000002","iss":"https://wrong.invalid/auth/v1","role":"authenticated"}',true);
select ok(not public.marketplace_can_receive_conversation('marketplace:conversation:'||(select data->>'id' from chat_room)),'issuer mismatch denies realtime');
select ok(not public.marketplace_can_receive_conversation('marketplace:conversation:not-a-uuid'),'malformed topic safely denied');
-- Failure injection is rollback-contained and never touches another stack.
create temporary table original_chat_dispatch as select pg_get_functiondef('app_private.marketplace_dispatch_conversation_notification(uuid,uuid)'::regprocedure) as definition;
-- Inject a transport exception at our own dispatch seam; managed Realtime
-- schema is deliberately not modified. Remaining production catch path is real.
do $inject$ begin execute replace((select definition from original_chat_dispatch),
  $old$perform realtime.send('{}'::jsonb,'changed','marketplace:conversation:'||p_conversation_id::text,true);$old$,
  $new$raise exception using errcode='P0001',message='synthetic dispatch failure';$new$); end; $inject$;
set local role service_role;
select lives_ok($$select public.marketplace_send_conversation_message('f1800000-0000-4000-8000-000000000002',(select(data->>'id')::uuid from chat_room),'f6800000-0000-4000-8000-000000000003','Survives Realtime outage','{}')$$,'Realtime outage never loses durable message');
select is((select count(*)::integer from app_private.marketplace_conversation_messages where conversation_id=(select(data->>'id')::uuid from chat_room) and id='f6800000-0000-4000-8000-000000000003'),1,'failed dispatch message retained');
select is((select last_error_code from app_private.marketplace_conversation_outbox where conversation_id=(select(data->>'id')::uuid from chat_room) and message_id='f6800000-0000-4000-8000-000000000003'),'P0001','outbox records only safe SQLSTATE');
select ok((select dispatched_at is null from app_private.marketplace_conversation_outbox where conversation_id=(select(data->>'id')::uuid from chat_room) and message_id='f6800000-0000-4000-8000-000000000003'),'failure remains pending');
reset role;
do $$begin execute (select definition from original_chat_dispatch); end;$$;
set local role service_role;
select is(public.marketplace_retry_conversation_notifications(100)->>'failed','0','restored transport retries pending notification');
select ok((select dispatched_at is not null and attempts=2 and last_error_code is null from app_private.marketplace_conversation_outbox where conversation_id=(select(data->>'id')::uuid from chat_room) and message_id='f6800000-0000-4000-8000-000000000003'),'retry marks enqueue and clears safe error');
reset role;
-- Seed compressible bytes to test both caps without external storage or secrets.
insert into app_private.marketplace_conversation_files(conversation_id,id,created_by,name,mime_type,content,byte_size)
select (select(data->>'id')::uuid from chat_room),gen_random_uuid(),'f1800000-0000-4000-8000-000000000002','quota.pdf','application/pdf',convert_to('%PDF-'||repeat('x',2097147),'UTF8'),2097152 from generate_series(1,49);
insert into app_private.quote_request_drafts(id,workspace_id,project_id,created_by,project_name,project_revision,title,quantity,notes,spec)
 select 'f5800000-0000-4000-8000-000000000002',workspace_id,project_id,created_by,project_name,project_revision,'Second chat RFQ',quantity,notes,spec from app_private.quote_request_drafts where id='f5800000-0000-4000-8000-000000000001';
insert into app_private.quote_request_publications(request_id,published_by) values('f5800000-0000-4000-8000-000000000002','f1800000-0000-4000-8000-000000000001');
insert into app_private.quote_request_supplier_access(request_id,supplier_id,supplier_name) values('f5800000-0000-4000-8000-000000000002','f3800000-0000-4000-8000-000000000001','Chat factory');
insert into app_private.marketplace_conversations(id,request_id,supplier_id) values('fa800000-0000-4000-8000-000000000002','f5800000-0000-4000-8000-000000000002','f3800000-0000-4000-8000-000000000001');
set local role service_role;
select throws_ok($$select public.marketplace_upload_conversation_file('f1800000-0000-4000-8000-000000000002',(select(data->>'id')::uuid from chat_room),gen_random_uuid(),'quota.pdf','application/pdf','JVBERi0=')$$,'P0001','CONVERSATION_FILE_LIMIT','50 file per-room cap enforced');
select throws_ok($$select public.marketplace_upload_conversation_file('f1800000-0000-4000-8000-000000000002','fa800000-0000-4000-8000-000000000002',gen_random_uuid(),'quota.pdf','application/pdf',translate(encode(convert_to('%PDF-'||repeat('x',2097147),'UTF8'),'base64'),chr(10),''))$$,'P0001','CONVERSATION_FILE_LIMIT','100MiB cap spans different rooms of same buyer workspace');
select lives_ok($$select public.marketplace_upload_conversation_file('f1800000-0000-4000-8000-000000000002','fa800000-0000-4000-8000-000000000002',gen_random_uuid(),'quota.pdf','application/pdf','JVBERi0=')$$,'small upload below shared remaining quota allowed');
reset role;
select * from finish();
rollback;
