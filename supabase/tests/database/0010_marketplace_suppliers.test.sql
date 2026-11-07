begin;

select plan(67);

select is((
  select count(*)::integer from pg_class where oid in (
    'app_private.supplier_profiles'::regclass, 'app_private.supplier_capabilities'::regclass,
    'app_private.workspace_marketplace_members'::regclass, 'app_private.platform_staff'::regclass,
    'app_private.supplier_create_operations'::regclass, 'app_private.activity_events'::regclass,
    'app_private.notification_outbox'::regclass
  ) and relrowsecurity and not has_table_privilege('anon', oid, 'SELECT, INSERT, UPDATE, DELETE')
  and not has_table_privilege('authenticated', oid, 'SELECT, INSERT, UPDATE, DELETE')
), 7, 'all Marketplace tables have RLS and no direct browser privileges');

select is((
  select count(*)::integer
  from pg_proc where pronamespace = 'public'::regnamespace and proname like 'marketplace_%'
    and not prosecdef and not has_function_privilege('anon', oid, 'EXECUTE')
    and not has_function_privilege('authenticated', oid, 'EXECUTE')
    and has_function_privilege('service_role', oid, 'EXECUTE')
), 8, 'all Marketplace RPCs are service-role-only invokers');

select ok(
  not has_table_privilege('service_role', 'app_private.platform_staff', 'INSERT, DELETE, UPDATE')
  and not has_column_privilege('service_role', 'app_private.platform_staff', 'user_id', 'UPDATE')
  and not has_table_privilege('service_role', 'app_private.activity_events', 'UPDATE, DELETE'),
  'service role cannot provision reviewers, move their grants, or rewrite audit history'
);

insert into app_private.app_users (id, display_name)
values ('f1000000-0000-4000-8000-000000000001', 'Supplier manager'),
       ('f1000000-0000-4000-8000-000000000002', 'Supplier staff'),
       ('f1000000-0000-4000-8000-000000000003', 'Supplier viewer'),
       ('f1000000-0000-4000-8000-000000000004', 'Design-only member'),
       ('f1000000-0000-4000-8000-000000000005', 'Outsider'),
       ('f1000000-0000-4000-8000-000000000006', 'Platform reviewer'),
       ('f1000000-0000-4000-8000-000000000007', 'Other supplier manager'),
       ('f1000000-0000-4000-8000-000000000008', 'Former reviewer');

insert into app_private.platform_staff (user_id, role)
values ('f1000000-0000-4000-8000-000000000006', 'supplier_reviewer'),
       ('f1000000-0000-4000-8000-000000000008', 'supplier_reviewer');
update app_private.app_users set status = 'suspended' where id = 'f1000000-0000-4000-8000-000000000008';

set local role service_role;

create temporary table market_input (profile jsonb);
insert into market_input values ('{
  "kind":"factory","name":"Test cartons","slug":"test-cartons",
  "description":"Cartons and labels","contactEmail":"owner@example.test",
  "capabilities":["offset_printing","digital_printing"]
}'::jsonb);

create temporary table market_first as
select public.marketplace_create_supplier(
  'f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001',
  (select profile from market_input)
) as result;
create temporary table market_ids as
select (result #>> '{profile,id}')::uuid as supplier_id, (result #>> '{profile,workspaceId}')::uuid as workspace_id
from market_first;

select is((select result->>'role' from market_first), 'manager', 'creating a supplier grants the Marketplace manager role');
select is((select result #>> '{profile,status}' from market_first), 'draft', 'new supplier starts in draft');
select is((select result #>> '{profile,revision}' from market_first), '1', 'new supplier starts at revision 1');
select is((select kind from app_private.workspaces where id = (select workspace_id from market_ids)), 'team',
  'supplier receives a dedicated team workspace');
select is((select role from app_private.workspace_members where workspace_id = (select workspace_id from market_ids)
  and user_id = 'f1000000-0000-4000-8000-000000000001'), 'owner', 'workspace ownership remains separate');
select is((select result #> '{profile,capabilities}' from market_first), '["digital_printing","offset_printing"]'::jsonb,
  'capabilities have a deterministic order');
select matches((select result #>> '{profile,updatedAt}' from market_first), '^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*Z$',
  'private profile has an ISO UTC timestamp');

select is(public.marketplace_create_supplier(
  'f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001',
  (select jsonb_set(profile, '{capabilities}', '["digital_printing","offset_printing"]'::jsonb) from market_input)
), (select result from market_first), 'retry with reordered capabilities returns the same supplier');
select throws_ok($$select public.marketplace_create_supplier(
  'f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001',
  (select jsonb_set(profile, '{name}', '"Different name"'::jsonb) from market_input)
)$$, 'P0001', 'IDEMPOTENCY_KEY_REUSED', 'same operation with changed payload is rejected');
select throws_ok($$select public.marketplace_create_supplier(
  'f1000000-0000-4000-8000-000000000007', 'f2000000-0000-4000-8000-000000000001',
  (select profile from market_input)
)$$, 'P0001', 'MARKETPLACE_CONFLICT', 'another actor cannot claim the same slug');
select is((select count(*)::integer from app_private.workspaces where owner_user_id = 'f1000000-0000-4000-8000-000000000007'),
  0, 'rejected create leaves no orphan workspace');
select throws_ok($$select public.marketplace_create_supplier(
  'f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000003',
  (select profile || '{"status":"approved"}'::jsonb from market_input)
)$$, '22023', 'VALIDATION_ERROR', 'create rejects injected server-managed fields');
select throws_ok($$select public.marketplace_create_supplier(
  'f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000003',
  (select jsonb_set(profile, '{capabilities}', '["digital_printing","digital_printing"]'::jsonb) from market_input)
)$$, '22023', 'VALIDATION_ERROR', 'duplicate capabilities are rejected');

create temporary table market_empty as
select public.marketplace_create_supplier(
  'f1000000-0000-4000-8000-000000000007', 'f2000000-0000-4000-8000-000000000001',
  (select profile || '{"name":"Blank profile","slug":"blank-profile","capabilities":[]}'::jsonb from market_input)
) as result;
select is((select result #> '{profile,capabilities}' from market_empty), '[]'::jsonb,
  'independent actors can use the same operation ID and can save an incomplete draft');
select throws_ok($$select public.marketplace_submit_supplier(
  'f1000000-0000-4000-8000-000000000007', (select (result #>> '{profile,id}')::uuid from market_empty), 1
)$$, '22023', 'VALIDATION_ERROR', 'at least one capability is required to submit');
select throws_ok($$select public.marketplace_update_supplier(
  'f1000000-0000-4000-8000-000000000001', (select supplier_id from market_ids), 1,
  (select profile || '{"slug":"blank-profile"}'::jsonb from market_input)
)$$, 'P0001', 'MARKETPLACE_CONFLICT', 'update cannot take a slug from another supplier');
select is((select revision from app_private.supplier_profiles where id = (select supplier_id from market_ids)), 1,
  'rejected update leaves revision unchanged');
select throws_ok($$select public.marketplace_public_supplier('test-cartons')$$,
  'P0001', 'MARKETPLACE_NOT_FOUND', 'draft profile is not public');

insert into app_private.workspace_members (workspace_id, user_id, role)
select workspace_id, fixture.user_id::uuid, fixture.role from market_ids
cross join (values
  ('f1000000-0000-4000-8000-000000000002', 'viewer'),
  ('f1000000-0000-4000-8000-000000000003', 'editor'),
  ('f1000000-0000-4000-8000-000000000004', 'editor')
) as fixture(user_id, role);
insert into app_private.workspace_marketplace_members (workspace_id, user_id, role)
select workspace_id, fixture.user_id::uuid, fixture.role from market_ids
cross join (values
  ('f1000000-0000-4000-8000-000000000002', 'staff'),
  ('f1000000-0000-4000-8000-000000000003', 'viewer')
) as fixture(user_id, role);

select throws_ok($$insert into app_private.workspace_marketplace_members (workspace_id,user_id,role)
  select workspace_id, 'f1000000-0000-4000-8000-000000000005', 'manager' from market_ids$$,
  '23503', null, 'Marketplace membership requires corresponding workspace membership');
select is(public.marketplace_get_supplier(
  'f1000000-0000-4000-8000-000000000002', (select supplier_id from market_ids)
)->>'role', 'staff', 'Marketplace staff can read despite having only workspace viewer permission');
select is(public.marketplace_get_supplier(
  'f1000000-0000-4000-8000-000000000003', (select supplier_id from market_ids)
)->>'role', 'viewer', 'Marketplace viewer can read');
select throws_ok($$select public.marketplace_get_supplier(
  'f1000000-0000-4000-8000-000000000004', (select supplier_id from market_ids)
)$$, 'P0001', 'MARKETPLACE_NOT_FOUND', 'design editor without a Marketplace role cannot read the supplier');
select throws_ok($$select public.marketplace_get_supplier(
  'f1000000-0000-4000-8000-000000000005', (select supplier_id from market_ids)
)$$, 'P0001', 'MARKETPLACE_NOT_FOUND', 'outsider cannot read private supplier');
select is(public.marketplace_context('f1000000-0000-4000-8000-000000000004')->'suppliers', '[]'::jsonb,
  'context hides suppliers from design-only members');
select is(public.marketplace_context('f1000000-0000-4000-8000-000000000006')->'isSupplierReviewer', 'true'::jsonb,
  'context reports the explicit reviewer grant');
select is(public.marketplace_context('f1000000-0000-4000-8000-000000000001')->'isSupplierReviewer', 'false'::jsonb,
  'supplier ownership does not make someone a platform reviewer');
select throws_ok($$select public.marketplace_submit_supplier(
  'f1000000-0000-4000-8000-000000000002', (select supplier_id from market_ids), 1
)$$, 'P0001', 'MARKETPLACE_FORBIDDEN', 'Marketplace staff cannot submit');
select throws_ok($$select public.marketplace_update_supplier(
  'f1000000-0000-4000-8000-000000000003', (select supplier_id from market_ids), 1, (select profile from market_input)
)$$, 'P0001', 'MARKETPLACE_FORBIDDEN', 'Marketplace viewer cannot edit even with design editor role');
select throws_ok($$select public.marketplace_review_supplier(
  'f1000000-0000-4000-8000-000000000001', (select supplier_id from market_ids), 1, 'approve', 'Reviewed'
)$$, 'P0001', 'MARKETPLACE_FORBIDDEN', 'manager cannot review their own or another supplier without a grant');
select throws_ok($$select public.marketplace_admin_suppliers(
  'f1000000-0000-4000-8000-000000000008', null, null
)$$, 'P0001', 'MARKETPLACE_FORBIDDEN', 'inactive user cannot use an existing reviewer grant');

select is(public.marketplace_submit_supplier(
  'f1000000-0000-4000-8000-000000000001', (select supplier_id from market_ids), 1
)#>>'{profile,status}', 'pending', 'manager submits a draft for review');
select throws_ok($$select public.marketplace_public_supplier('test-cartons')$$,
  'P0001', 'MARKETPLACE_NOT_FOUND', 'pending profile is not public');
select throws_ok($$select public.marketplace_submit_supplier(
  'f1000000-0000-4000-8000-000000000001', (select supplier_id from market_ids), 1
)$$, 'P0001', 'REVISION_CONFLICT', 'stale submit is rejected without a second transition');
select throws_ok($$select public.marketplace_update_supplier(
  'f1000000-0000-4000-8000-000000000001', (select supplier_id from market_ids), 2, (select profile from market_input)
)$$, 'P0001', 'MARKETPLACE_CONFLICT', 'submitted profiles cannot change during review');
select throws_ok($$select public.marketplace_review_supplier(
  'f1000000-0000-4000-8000-000000000006', (select supplier_id from market_ids), 2, 'approve', '   '
)$$, '22023', 'VALIDATION_ERROR', 'review requires a reason');
select is(jsonb_array_length(public.marketplace_admin_suppliers(
  'f1000000-0000-4000-8000-000000000006', 'pending', null
)->'items'), 1, 'reviewer can see pending applications without joining supplier workspaces');

select is(public.marketplace_review_supplier(
  'f1000000-0000-4000-8000-000000000006', (select supplier_id from market_ids), 2, 'request_changes', 'Clarify printing.'
)->>'status', 'draft', 'reviewer can return pending application to draft');

update market_input set profile = jsonb_set(profile, '{description}', '"Boxes and labels"'::jsonb);
select is(public.marketplace_update_supplier(
  'f1000000-0000-4000-8000-000000000001', (select supplier_id from market_ids), 3, (select profile from market_input)
)#>>'{profile,reviewNote}', 'Clarify printing.', 'editing a returned draft preserves the review note');
select is(public.marketplace_submit_supplier(
  'f1000000-0000-4000-8000-000000000001', (select supplier_id from market_ids), 4
)#>'{profile,reviewNote}', 'null'::jsonb, 'resubmission clears the old review note');
select throws_ok($$select public.marketplace_review_supplier(
  'f1000000-0000-4000-8000-000000000006', (select supplier_id from market_ids), 2, 'approve', 'Old revision'
)$$, 'P0001', 'REVISION_CONFLICT', 'review cannot approve a stale submission');
select is(public.marketplace_review_supplier(
  'f1000000-0000-4000-8000-000000000006', (select supplier_id from market_ids), 5, 'approve', 'Ready.'
)->>'status', 'approved', 'reviewer approves the current pending submission');
select is(public.marketplace_public_supplier('test-cartons'), (select jsonb_build_object(
  'id', supplier_id, 'kind', 'factory', 'name', 'Test cartons', 'slug', 'test-cartons', 'description', 'Boxes and labels',
  'capabilities', '["digital_printing","offset_printing"]'::jsonb
) from market_ids), 'approved public profile exposes only its allowed public fields');
select is(public.marketplace_update_supplier(
  'f1000000-0000-4000-8000-000000000001', (select supplier_id from market_ids), 6, (select profile from market_input)
)#>>'{profile,revision}', '6', 'unchanged approved profile stays approved at the same revision');

select is(public.marketplace_review_supplier(
  'f1000000-0000-4000-8000-000000000006', (select supplier_id from market_ids), 6, 'suspend', 'Pause requested.'
)->>'status', 'suspended', 'reviewer can suspend an approved supplier');
select throws_ok($$select public.marketplace_public_supplier('test-cartons')$$,
  'P0001', 'MARKETPLACE_NOT_FOUND', 'suspension removes the public profile');
select throws_ok($$select public.marketplace_update_supplier(
  'f1000000-0000-4000-8000-000000000001', (select supplier_id from market_ids), 7, (select profile from market_input)
)$$, 'P0001', 'MARKETPLACE_CONFLICT', 'supplier cannot work around suspension by editing its profile');
select is(public.marketplace_review_supplier(
  'f1000000-0000-4000-8000-000000000006', (select supplier_id from market_ids), 7, 'resume', 'Ready again.'
)->>'status', 'approved', 'reviewer can resume the suspended supplier');
select is(public.marketplace_public_supplier('test-cartons')->>'name', 'Test cartons', 'resume restores the approved public profile');
select is(public.marketplace_update_supplier(
  'f1000000-0000-4000-8000-000000000001', (select supplier_id from market_ids), 8,
  (select profile || '{"capabilities":["lamination"]}'::jsonb from market_input)
)#>>'{profile,status}', 'draft', 'changing an approved profile requires a fresh review');
select is(public.marketplace_get_supplier(
  'f1000000-0000-4000-8000-000000000001', (select supplier_id from market_ids)
)#>'{profile,capabilities}', '["lamination"]'::jsonb, 'capability updates replace the old set');
select throws_ok($$select public.marketplace_public_supplier('test-cartons')$$,
  'P0001', 'MARKETPLACE_NOT_FOUND', 'updated unreviewed information is not published');

select is((
  select array_agg(action order by revision) from app_private.activity_events where supplier_id = (select supplier_id from market_ids)
), array['created','submitted','request_changes','submitted','approve','suspend','resume','reopened'],
  'each successful state change is recorded once, with no event for failed or unchanged writes');
select is((
  select count(*)::integer from app_private.notification_outbox join app_private.activity_events on activity_events.id = event_id
  where supplier_id = (select supplier_id from market_ids) and audience = 'supplier_reviewers'
), 2, 'only submissions enqueue reviewer notifications');
select is((
  select count(*)::integer from app_private.notification_outbox join app_private.activity_events on activity_events.id = event_id
  where supplier_id = (select supplier_id from market_ids)
), 8, 'every transition and its outbox reference commit together');
select is((
  select reason from app_private.activity_events where supplier_id = (select supplier_id from market_ids) and action = 'suspend'
), 'Pause requested.', 'review reason remains in restricted audit history');

delete from app_private.workspace_members where workspace_id = (select workspace_id from market_ids)
  and user_id = 'f1000000-0000-4000-8000-000000000002';
select throws_ok($$select public.marketplace_get_supplier(
  'f1000000-0000-4000-8000-000000000002', (select supplier_id from market_ids)
)$$, 'P0001', 'MARKETPLACE_NOT_FOUND', 'removing workspace membership immediately removes Marketplace access');
update app_private.app_users set status = 'suspended' where id = 'f1000000-0000-4000-8000-000000000003';
select throws_ok($$select public.marketplace_get_supplier(
  'f1000000-0000-4000-8000-000000000003', (select supplier_id from market_ids)
)$$, 'P0001', 'MARKETPLACE_NOT_FOUND', 'inactive account cannot use valid memberships');
delete from app_private.workspace_marketplace_members where workspace_id = (select workspace_id from market_ids)
  and user_id = 'f1000000-0000-4000-8000-000000000001';
select is((select role from app_private.workspace_members where workspace_id = (select workspace_id from market_ids)
  and user_id = 'f1000000-0000-4000-8000-000000000001'), 'owner', 'revoking Marketplace access preserves design ownership');
select is(public.marketplace_context('f1000000-0000-4000-8000-000000000001')->'suppliers', '[]'::jsonb,
  'context reflects removal of the separate Marketplace role');
select throws_ok($$select public.marketplace_create_supplier(
  'f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001',
  (select profile from market_input)
)$$, 'P0001', 'MARKETPLACE_NOT_FOUND', 'replaying create cannot bypass current access');

-- The maximal prefix sorts after every randomly generated v4 supplier ID.
insert into app_private.workspaces (id, kind, owner_user_id, name)
select ('f4000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid, 'team', 'f1000000-0000-4000-8000-000000000007', 'Page fixture'
from generate_series(1,25) n;
insert into app_private.supplier_profiles (id, workspace_id, kind, name, slug, description, contact_email)
select ('ffffffff-ffff-ffff-ffff-' || lpad(n::text,12,'0'))::uuid,
       ('f4000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
       'print_shop', 'Page fixture', 'marketplace-page-' || n, '', 'page@example.test'
from generate_series(1,25) n;
create temporary table market_page as select public.marketplace_admin_suppliers(
  'f1000000-0000-4000-8000-000000000006', 'draft', 'ffffffff-ffff-ffff-ffff-000000000000'
) as result;
select is(jsonb_array_length((select result->'items' from market_page)), 24, 'admin page is capped at 24');
select is((select result->>'nextCursor' from market_page), 'ffffffff-ffff-ffff-ffff-000000000024',
  'admin cursor is the last returned ID in ascending order');
select is(jsonb_array_length(public.marketplace_admin_suppliers(
  'f1000000-0000-4000-8000-000000000006', 'draft', (select (result->>'nextCursor')::uuid from market_page)
)->'items'), 1, 'next admin page starts after the cursor');
select is(public.marketplace_admin_suppliers(
  'f1000000-0000-4000-8000-000000000006', 'draft', (select (result->>'nextCursor')::uuid from market_page)
)->'nextCursor', 'null'::jsonb, 'last admin page has no further cursor');

select * from finish();
rollback;
