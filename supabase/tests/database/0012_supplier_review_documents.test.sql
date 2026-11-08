begin;

select plan(55);

select ok(
  (select relrowsecurity from pg_class where oid = 'app_private.supplier_review_documents'::regclass)
  and not has_table_privilege('anon', 'app_private.supplier_review_documents', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'app_private.supplier_review_documents', 'SELECT,INSERT,UPDATE,DELETE'),
  'supplier review documents have RLS and no direct browser privileges'
);
select ok(
  has_table_privilege('service_role', 'app_private.supplier_review_documents', 'SELECT')
  and not has_table_privilege('service_role', 'app_private.supplier_review_documents', 'UPDATE,DELETE')
  and has_column_privilege('service_role', 'app_private.supplier_review_documents', 'content', 'UPDATE')
  and not has_column_privilege('service_role', 'app_private.supplier_review_documents', 'created_by', 'UPDATE'),
  'the service role can scrub bytes but cannot delete tombstones or change authors'
);
select is((
  select count(*)::integer from pg_proc
  where pronamespace = 'public'::regnamespace and proname in (
    'marketplace_list_supplier_review_documents', 'marketplace_get_supplier_review_document',
    'marketplace_add_supplier_review_document', 'marketplace_remove_supplier_review_document'
  ) and not prosecdef and has_function_privilege('service_role', oid, 'EXECUTE')
    and not has_function_privilege('anon', oid, 'EXECUTE')
    and not has_function_privilege('authenticated', oid, 'EXECUTE')
), 4, 'all document RPCs are service-role-only invokers');

insert into app_private.app_users (id, display_name) values
  ('f1200000-0000-4000-8000-000000000001', 'Supplier owner'),
  ('f1200000-0000-4000-8000-000000000002', 'Independent co-manager'),
  ('f1200000-0000-4000-8000-000000000003', 'Supplier staff'),
  ('f1200000-0000-4000-8000-000000000004', 'Supplier viewer'),
  ('f1200000-0000-4000-8000-000000000005', 'Platform reviewer'),
  ('f1200000-0000-4000-8000-000000000006', 'Other supplier owner');
insert into app_private.platform_staff (user_id, role)
values ('f1200000-0000-4000-8000-000000000005', 'supplier_reviewer');

set local role service_role;

create temporary table evidence_input (profile jsonb);
insert into evidence_input values ('{
  "kind":"factory","name":"Review evidence fixture","slug":"review-evidence-fixture",
  "description":"","contactEmail":"proof@example.test","capabilities":["digital_printing"]
}'::jsonb);
create temporary table evidence_suppliers as
select
  (first_supplier #>> '{profile,id}')::uuid as supplier_id,
  (first_supplier #>> '{profile,workspaceId}')::uuid as workspace_id,
  (second_supplier #>> '{profile,id}')::uuid as other_supplier_id
from (select
  public.marketplace_create_supplier(
    'f1200000-0000-4000-8000-000000000001', 'f2200000-0000-4000-8000-000000000001', profile
  ) as first_supplier,
  public.marketplace_create_supplier(
    'f1200000-0000-4000-8000-000000000006', 'f2200000-0000-4000-8000-000000000001',
    profile || '{"slug":"review-other-fixture"}'::jsonb
  ) as second_supplier
from evidence_input) created;
insert into app_private.workspace_marketplace_members (workspace_id,user_id,role,requires_workspace_membership)
select workspace_id, fixture.user_id::uuid, fixture.role, false from evidence_suppliers
cross join (values
  ('f1200000-0000-4000-8000-000000000002', 'manager'),
  ('f1200000-0000-4000-8000-000000000003', 'staff'),
  ('f1200000-0000-4000-8000-000000000004', 'viewer')
) as fixture(user_id, role);

select is(public.marketplace_list_supplier_review_documents(
  'f1200000-0000-4000-8000-000000000001', (select supplier_id from evidence_suppliers), false
), '{"documents":[]}'::jsonb, 'draft manager can list an empty optional evidence set');
select throws_ok($$select public.marketplace_list_supplier_review_documents(
  'f1200000-0000-4000-8000-000000000005', (select supplier_id from evidence_suppliers), true
)$$, 'P0001', 'MARKETPLACE_NOT_FOUND', 'reviewers cannot access documents before submission');
select throws_ok($$select public.marketplace_list_supplier_review_documents(
  'f1200000-0000-4000-8000-000000000001', (select supplier_id from evidence_suppliers), true
)$$, 'P0001', 'MARKETPLACE_FORBIDDEN', 'supplier manager cannot self-select reviewer authorization');
select throws_ok($$select public.marketplace_list_supplier_review_documents(
  'f1200000-0000-4000-8000-000000000003', (select supplier_id from evidence_suppliers), false
)$$, 'P0001', 'MARKETPLACE_FORBIDDEN', 'supplier staff cannot list documents');
select throws_ok($$select public.marketplace_list_supplier_review_documents(
  'f1200000-0000-4000-8000-000000000006', (select supplier_id from evidence_suppliers), false
)$$, 'P0001', 'MARKETPLACE_NOT_FOUND', 'another supplier manager cannot list documents');
select throws_ok($$select public.marketplace_list_supplier_review_documents(
  'f1200000-0000-4000-8000-000000000001', (select supplier_id from evidence_suppliers), null
)$$, '22023', 'VALIDATION_ERROR', 'read scope must be explicit');

select throws_ok($$select public.marketplace_add_supplier_review_document(
  'f1200000-0000-4000-8000-000000000001', (select supplier_id from evidence_suppliers),
  'f3200000-0000-4000-8000-000000000001', '../proof.pdf', 'application/pdf', 'JVBERi0='
)$$, '22023', 'VALIDATION_ERROR', 'path-like filenames are rejected');
select throws_ok($$select public.marketplace_add_supplier_review_document(
  'f1200000-0000-4000-8000-000000000001', (select supplier_id from evidence_suppliers),
  'f3200000-0000-4000-8000-000000000001', 'proof' || chr(10) || '.pdf', 'application/pdf', 'JVBERi0='
)$$, '22023', 'VALIDATION_ERROR', 'control characters are rejected in filenames');
select throws_ok($$select public.marketplace_add_supplier_review_document(
  'f1200000-0000-4000-8000-000000000001', (select supplier_id from evidence_suppliers),
  'f3200000-0000-4000-8000-000000000001', repeat('ก',117) || '.pdf', 'application/pdf', 'JVBERi0='
)$$, '22023', 'VALIDATION_ERROR', 'filename limit is 120 Unicode characters');
select throws_ok($$select public.marketplace_add_supplier_review_document(
  'f1200000-0000-4000-8000-000000000001', (select supplier_id from evidence_suppliers),
  'f3200000-0000-4000-8000-000000000001', 'proof.png', 'application/pdf', 'JVBERi0='
)$$, '22023', 'VALIDATION_ERROR', 'filename extension must match the allowed MIME type');
select throws_ok($$select public.marketplace_add_supplier_review_document(
  'f1200000-0000-4000-8000-000000000001', (select supplier_id from evidence_suppliers),
  'f3200000-0000-4000-8000-000000000001', 'proof.png', 'image/png', 'JVBERi0='
)$$, '22023', 'VALIDATION_ERROR', 'PDF bytes cannot masquerade as a PNG');
select throws_ok($$select public.marketplace_add_supplier_review_document(
  'f1200000-0000-4000-8000-000000000001', (select supplier_id from evidence_suppliers),
  'f3200000-0000-4000-8000-000000000001', 'proof.pdf', 'application/pdf', 'JVBER'
)$$, '22023', 'VALIDATION_ERROR', 'malformed base64 has a stable validation error');
select throws_ok($$select public.marketplace_add_supplier_review_document(
  'f1200000-0000-4000-8000-000000000003', (select supplier_id from evidence_suppliers),
  'f3200000-0000-4000-8000-000000000001', 'proof.pdf', 'application/pdf', 'JVBERi0='
)$$, 'P0001', 'MARKETPLACE_FORBIDDEN', 'supplier staff cannot upload documents');

create temporary table evidence_first as select public.marketplace_add_supplier_review_document(
  'f1200000-0000-4000-8000-000000000001', (select supplier_id from evidence_suppliers),
  'f3200000-0000-4000-8000-000000000001', 'proof.pdf', 'application/pdf', 'JVBERi0='
) as result;
select is((select result->>'id' from evidence_first), 'f3200000-0000-4000-8000-000000000001',
  'operation ID is the new document ID');
select is((select array_agg(key order by key) from jsonb_object_keys((select result from evidence_first)) as item(key)),
  array['byteSize','createdAt','id','mimeType','name'], 'upload receipt returns only the exact metadata DTO');
select is((select (result->>'byteSize')::integer from evidence_first), 5, 'receipt reports decoded byte count');
select matches((select result->>'createdAt' from evidence_first), '^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*Z$',
  'metadata timestamp is ISO UTC');
select is(public.marketplace_get_supplier_review_document(
  'f1200000-0000-4000-8000-000000000002', (select supplier_id from evidence_suppliers),
  'f3200000-0000-4000-8000-000000000001', false
), (select jsonb_build_object('document', result, 'dataBase64', 'JVBERi0=') from evidence_first),
  'independent Marketplace manager can download without Editor access');
select is(public.marketplace_list_supplier_review_documents(
  'f1200000-0000-4000-8000-000000000002', (select supplier_id from evidence_suppliers), false
), (select jsonb_build_object('documents', jsonb_build_array(result)) from evidence_first),
  'metadata listing contains no content');
select throws_ok($$select public.marketplace_get_supplier_review_document(
  'f1200000-0000-4000-8000-000000000004', (select supplier_id from evidence_suppliers),
  'f3200000-0000-4000-8000-000000000001', false
)$$, 'P0001', 'MARKETPLACE_FORBIDDEN', 'supplier viewer cannot download');
select throws_ok($$select public.marketplace_get_supplier_review_document(
  'f1200000-0000-4000-8000-000000000006', (select other_supplier_id from evidence_suppliers),
  'f3200000-0000-4000-8000-000000000001', false
)$$, 'P0001', 'MARKETPLACE_NOT_FOUND', 'a document ID cannot be used with another supplier');
select ok(not ((public.marketplace_context('f1200000-0000-4000-8000-000000000001') #> '{suppliers,0,profile}')
  ?| array['documents','dataBase64']), 'Marketplace context does not expose evidence metadata or content');

select throws_ok($$select public.marketplace_add_supplier_review_document(
  'f1200000-0000-4000-8000-000000000002', (select supplier_id from evidence_suppliers),
  'f3200000-0000-4000-8000-000000000001', 'proof.pdf', 'application/pdf', 'JVBERi0='
)$$, 'P0001', 'IDEMPOTENCY_KEY_REUSED', 'a different manager cannot claim the original upload operation');
select throws_ok($$select public.marketplace_add_supplier_review_document(
  'f1200000-0000-4000-8000-000000000001', (select supplier_id from evidence_suppliers),
  'f3200000-0000-4000-8000-000000000001', 'different.pdf', 'application/pdf', 'JVBERi0='
)$$, 'P0001', 'IDEMPOTENCY_KEY_REUSED', 'changed upload metadata cannot reuse the operation ID');
select throws_ok($$select public.marketplace_add_supplier_review_document(
  'f1200000-0000-4000-8000-000000000001', (select supplier_id from evidence_suppliers),
  'f3200000-0000-4000-8000-000000000001', 'proof.pdf', 'application/pdf', 'JVBERi1B'
)$$, 'P0001', 'IDEMPOTENCY_KEY_REUSED', 'changed upload bytes cannot reuse the operation ID');

select throws_ok($$select public.marketplace_add_supplier_review_document(
  'f1200000-0000-4000-8000-000000000001', (select supplier_id from evidence_suppliers),
  'f3200000-0000-4000-8000-000000000002', 'large.pdf', 'application/pdf',
  translate(encode(convert_to('%PDF-' || repeat('a',2097148),'UTF8'),'base64'),chr(10),'')
)$$, '22023', 'VALIDATION_ERROR', 'rejects a file one byte over 2 MiB despite the same base64 length');
create temporary table evidence_large as select public.marketplace_add_supplier_review_document(
  'f1200000-0000-4000-8000-000000000001', (select supplier_id from evidence_suppliers),
  'f3200000-0000-4000-8000-000000000002', repeat('ก',116) || '.PDF', 'application/pdf',
  translate(encode(convert_to('%PDF-' || repeat('a',2097147),'UTF8'),'base64'),chr(10),'')
) as result;
select is((select (result->>'byteSize')::integer from evidence_large), 2097152,
  'accepts exactly 2 MiB and a 120-character filename with uppercase extension');
create temporary table evidence_jpeg as select public.marketplace_add_supplier_review_document(
  'f1200000-0000-4000-8000-000000000001', (select supplier_id from evidence_suppliers),
  'f3200000-0000-4000-8000-000000000003', 'proof.jpeg', 'image/jpeg', '/9j/'
) as result;
select is((select result->>'mimeType' from evidence_jpeg), 'image/jpeg', 'JPEG accepts a matching extension and header');

select throws_ok($$select public.marketplace_add_supplier_review_document(
  'f1200000-0000-4000-8000-000000000001', (select supplier_id from evidence_suppliers),
  'f3200000-0000-4000-8000-000000000004', 'proof.png', 'image/png', 'iVBORw0KGgo='
)$$, 'P0001', 'SUPPLIER_DOCUMENT_LIMIT', 'fourth active document exceeds the supplier cap');
select is(public.marketplace_add_supplier_review_document(
  'f1200000-0000-4000-8000-000000000001', (select supplier_id from evidence_suppliers),
  'f3200000-0000-4000-8000-000000000001', 'proof.pdf', 'application/pdf', 'JVBERi0='
), (select result from evidence_first), 'identical upload retry succeeds without a new slot when full');

select is(public.marketplace_remove_supplier_review_document(
  'f1200000-0000-4000-8000-000000000002', (select supplier_id from evidence_suppliers), 'f3200000-0000-4000-8000-000000000001'
)->>'id', 'f3200000-0000-4000-8000-000000000001', 'another current manager can remove a draft document');
select ok((
  select deleted_at is not null and name is null and mime_type is null and byte_size is null and content is null
  from app_private.supplier_review_documents where supplier_id=(select supplier_id from evidence_suppliers)
    and id='f3200000-0000-4000-8000-000000000001'
), 'removal scrubs metadata and contents while retaining the ID tombstone');
select is(public.marketplace_remove_supplier_review_document(
  'f1200000-0000-4000-8000-000000000002', (select supplier_id from evidence_suppliers), 'f3200000-0000-4000-8000-000000000001'
)->>'id', 'f3200000-0000-4000-8000-000000000001', 'draft deletion is idempotent');
select throws_ok($$select public.marketplace_get_supplier_review_document(
  'f1200000-0000-4000-8000-000000000001', (select supplier_id from evidence_suppliers),
  'f3200000-0000-4000-8000-000000000001', false
)$$, 'P0001', 'MARKETPLACE_NOT_FOUND', 'deleted bytes cannot be downloaded');
select throws_ok($$select public.marketplace_add_supplier_review_document(
  'f1200000-0000-4000-8000-000000000001', (select supplier_id from evidence_suppliers),
  'f3200000-0000-4000-8000-000000000001', 'proof.pdf', 'application/pdf', 'JVBERi0='
)$$, 'P0001', 'IDEMPOTENCY_KEY_REUSED', 'old upload retry cannot resurrect deleted evidence');

create temporary table evidence_png as select public.marketplace_add_supplier_review_document(
  'f1200000-0000-4000-8000-000000000001', (select supplier_id from evidence_suppliers),
  'f3200000-0000-4000-8000-000000000004', 'proof.png', 'image/png', 'iVBORw0KGgo='
) as result;
select is((select result->>'mimeType' from evidence_png), 'image/png', 'a deleted slot can hold new PNG evidence');
select is(public.marketplace_list_supplier_review_documents(
  'f1200000-0000-4000-8000-000000000001', (select supplier_id from evidence_suppliers), false
)->'documents', (select jsonb_build_array(large.result, jpeg.result, png.result)
  from evidence_large large, evidence_jpeg jpeg, evidence_png png), 'list excludes tombstones and sorts active metadata by creation');
select is((select revision from app_private.supplier_profiles where id=(select supplier_id from evidence_suppliers)),
  1, 'draft document changes do not alter the profile revision');
select is(public.marketplace_submit_supplier(
  'f1200000-0000-4000-8000-000000000006', (select other_supplier_id from evidence_suppliers), 1
)#>>'{profile,status}', 'pending', 'submission remains valid without optional documents');
select is(public.marketplace_submit_supplier(
  'f1200000-0000-4000-8000-000000000001', (select supplier_id from evidence_suppliers), 1
)#>>'{profile,status}', 'pending', 'submit freezes the current evidence set');

select is(jsonb_array_length(public.marketplace_list_supplier_review_documents(
  'f1200000-0000-4000-8000-000000000005', (select supplier_id from evidence_suppliers), true
)->'documents'), 3, 'granted platform reviewer can list evidence while pending');
select is(public.marketplace_get_supplier_review_document(
  'f1200000-0000-4000-8000-000000000005', (select supplier_id from evidence_suppliers),
  'f3200000-0000-4000-8000-000000000004', true
)->>'dataBase64', 'iVBORw0KGgo=', 'pending reviewer can retrieve original bytes');
select throws_ok($$select public.marketplace_add_supplier_review_document(
  'f1200000-0000-4000-8000-000000000001', (select supplier_id from evidence_suppliers),
  'f3200000-0000-4000-8000-000000000005', 'proof.png', 'image/png', 'iVBORw0KGgo='
)$$, 'P0001', 'MARKETPLACE_CONFLICT', 'manager cannot upload while pending');
select throws_ok($$select public.marketplace_remove_supplier_review_document(
  'f1200000-0000-4000-8000-000000000001', (select supplier_id from evidence_suppliers), 'f3200000-0000-4000-8000-000000000004'
)$$, 'P0001', 'MARKETPLACE_CONFLICT', 'manager cannot remove while pending');
select is(public.marketplace_get_supplier_review_document(
  'f1200000-0000-4000-8000-000000000001', (select supplier_id from evidence_suppliers),
  'f3200000-0000-4000-8000-000000000004', false
)->>'dataBase64', 'iVBORw0KGgo=', 'manager retains private read access while pending');

create temporary table evidence_request_changes as select public.marketplace_review_supplier(
  'f1200000-0000-4000-8000-000000000005', (select supplier_id from evidence_suppliers), 2, 'request_changes', 'Replace proof.'
);
select throws_ok($$select public.marketplace_get_supplier_review_document(
  'f1200000-0000-4000-8000-000000000005', (select supplier_id from evidence_suppliers),
  'f3200000-0000-4000-8000-000000000004', true
)$$, 'P0001', 'MARKETPLACE_NOT_FOUND', 'reviewer loses evidence access after returning to draft');
select is(public.marketplace_remove_supplier_review_document(
  'f1200000-0000-4000-8000-000000000001', (select supplier_id from evidence_suppliers), 'f3200000-0000-4000-8000-000000000004'
)->>'id', 'f3200000-0000-4000-8000-000000000004', 'requested changes re-enable draft document edits');

create temporary table evidence_resubmit as select public.marketplace_submit_supplier(
  'f1200000-0000-4000-8000-000000000001', (select supplier_id from evidence_suppliers), 3
);
create temporary table evidence_approve as select public.marketplace_review_supplier(
  'f1200000-0000-4000-8000-000000000005', (select supplier_id from evidence_suppliers), 4, 'approve', 'Approved.'
);
select throws_ok($$select public.marketplace_list_supplier_review_documents(
  'f1200000-0000-4000-8000-000000000005', (select supplier_id from evidence_suppliers), true
)$$, 'P0001', 'MARKETPLACE_NOT_FOUND', 'approval closes reviewer evidence access');
select is(jsonb_array_length(public.marketplace_list_supplier_review_documents(
  'f1200000-0000-4000-8000-000000000001', (select supplier_id from evidence_suppliers), false
)->'documents'), 2, 'manager can still list approved supplier evidence');
select ok(not (public.marketplace_public_supplier('review-evidence-fixture') ?| array['documents','dataBase64']),
  'public supplier response never exposes private evidence');

create temporary table evidence_suspend as select public.marketplace_review_supplier(
  'f1200000-0000-4000-8000-000000000005', (select supplier_id from evidence_suppliers), 5, 'suspend', 'Paused.'
);
select is(jsonb_array_length(public.marketplace_list_supplier_review_documents(
  'f1200000-0000-4000-8000-000000000001', (select supplier_id from evidence_suppliers), false
)->'documents'), 2, 'manager can still list suspended supplier evidence');
select throws_ok($$select public.marketplace_add_supplier_review_document(
  'f1200000-0000-4000-8000-000000000001', (select supplier_id from evidence_suppliers),
  'f3200000-0000-4000-8000-000000000005', 'proof.png', 'image/png', 'iVBORw0KGgo='
)$$, 'P0001', 'MARKETPLACE_CONFLICT', 'manager cannot add evidence for a suspended supplier');

select * from finish();
rollback;
