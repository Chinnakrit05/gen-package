begin;

select plan(39);

select has_table('app_private', 'assets', 'assets exists');
select has_table('app_private', 'asset_operations', 'asset_operations exists');
select has_table('app_private', 'storage_usage', 'storage_usage exists');
select has_table('app_private', 'storage_reservations', 'storage_reservations exists');
select has_table('app_private', 'project_assets', 'project_assets exists');
select ok((select relrowsecurity from pg_class where oid = 'app_private.assets'::regclass), 'assets has RLS');
select ok((select relrowsecurity from pg_class where oid = 'app_private.asset_operations'::regclass), 'asset operations has RLS');
select ok((select relrowsecurity from pg_class where oid = 'app_private.storage_usage'::regclass), 'storage usage has RLS');
select ok((select relrowsecurity from pg_class where oid = 'app_private.storage_reservations'::regclass), 'reservations has RLS');
select ok((select relrowsecurity from pg_class where oid = 'app_private.project_assets'::regclass), 'project assets has RLS');
select ok(not has_table_privilege('anon', 'app_private.assets', 'SELECT'), 'anon cannot read assets');
select ok(not has_table_privilege('authenticated', 'app_private.assets', 'SELECT'), 'authenticated cannot read assets');
select ok(not has_table_privilege('anon', 'app_private.project_assets', 'SELECT'), 'anon cannot read project links');
select ok(
  not has_function_privilege(
    'authenticated',
    'public.create_asset_upload_intent(uuid,uuid,uuid,text,text,text,bigint,timestamptz)',
    'EXECUTE'
  ),
  'authenticated cannot create upload intents directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.create_asset_upload_intent(uuid,uuid,uuid,text,text,text,bigint,timestamptz)',
    'EXECUTE'
  ),
  'service role can create upload intents'
);

create temporary table asset_actor as
select * from public.bootstrap_personal_workspace(
  'https://assets.test/auth/v1', 'asset-owner', 'Asset owner', 'asset-owner@example.test'
);
create temporary table asset_other as
select * from public.bootstrap_personal_workspace(
  'https://assets.test/auth/v1', 'asset-other', 'Asset other', 'asset-other@example.test'
);

create temporary table rejected_asset as
select public.create_asset_upload_intent(
  (select app_user_id from asset_actor),
  (select personal_workspace_id from asset_actor),
  '50000000-0000-4000-8000-000000000001', repeat('a', 64),
  'project-decoration', 'image/png', 1000,
  statement_timestamp() + interval '2 hours'
) as result;

select is((select result->>'state' from rejected_asset), 'pending', 'intent starts pending');
select ok(
  starts_with((select result->>'stagingKey' from rejected_asset), 'staging/'),
  'server generates a staging key'
);
select is(
  (select reserved_bytes from app_private.storage_usage
    where workspace_id = (select personal_workspace_id from asset_actor)),
  10485760::bigint,
  'intent reserves the full bucket upload ceiling'
);
select is(
  (select pending_count from app_private.storage_usage
    where workspace_id = (select personal_workspace_id from asset_actor)),
  1,
  'intent increments pending count'
);
select is(
  (public.create_asset_upload_intent(
    (select app_user_id from asset_actor),
    (select personal_workspace_id from asset_actor),
    '50000000-0000-4000-8000-000000000001', repeat('a', 64),
    'project-decoration', 'image/png', 1000,
    statement_timestamp() + interval '2 hours'
  )->>'id')::uuid,
  (select (result->>'id')::uuid from rejected_asset),
  'intent retry returns the same asset'
);
select throws_ok(
  $$select public.create_asset_upload_intent(
    (select app_user_id from asset_actor),
    (select personal_workspace_id from asset_actor),
    '50000000-0000-4000-8000-000000000001', repeat('b', 64),
    'project-fill', 'image/jpeg', 2000,
    statement_timestamp() + interval '2 hours'
  )$$,
  'P0001', 'IDEMPOTENCY_KEY_REUSED',
  'intent operation cannot be reused with another payload'
);
select throws_ok(
  $$select public.get_asset(
    (select app_user_id from asset_other),
    (select (result->>'id')::uuid from rejected_asset)
  )$$,
  'P0001', 'PROJECT_NOT_FOUND',
  'another workspace cannot inspect an asset'
);
select is(
  public.renew_asset_upload_ticket(
    (select app_user_id from asset_actor),
    (select (result->>'id')::uuid from rejected_asset),
    '50000000-0000-4000-8000-000000000002', repeat('c', 64),
    statement_timestamp() + interval '2 hours'
  )->>'state',
  'pending',
  'pending asset can renew its ticket'
);

create temporary table rejected_claim as
select public.claim_asset_validation(
  (select app_user_id from asset_actor),
  (select (result->>'id')::uuid from rejected_asset),
  '50000000-0000-4000-8000-000000000003', repeat('d', 64),
  statement_timestamp() + interval '2 minutes'
) as result;

select ok((select (result->>'claimed')::boolean from rejected_claim), 'first completion claims validation');
select is((select (result->>'processingFencingVersion')::bigint from rejected_claim), 1::bigint, 'claim increments fence');
select ok(
  not (public.claim_asset_validation(
    (select app_user_id from asset_actor),
    (select (result->>'id')::uuid from rejected_asset),
    '50000000-0000-4000-8000-000000000003', repeat('d', 64),
    statement_timestamp() + interval '2 minutes'
  )->>'claimed')::boolean,
  'active validation lease is not claimed twice'
);
select throws_ok(
  $$select public.reject_asset_validation(
    (select app_user_id from asset_actor),
    (select (result->>'id')::uuid from rejected_asset),
    '50000000-0000-4000-8000-000000000003', repeat('d', 64),
    2, 'INVALID_IMAGE'
  )$$,
  'P0001', 'ASSET_VALIDATION_FENCED',
  'stale validator fence cannot reject an asset'
);
select is(
  public.reject_asset_validation(
    (select app_user_id from asset_actor),
    (select (result->>'id')::uuid from rejected_asset),
    '50000000-0000-4000-8000-000000000003', repeat('d', 64),
    1, 'INVALID_IMAGE'
  )->>'state',
  'rejected',
  'current validator can reject the asset'
);
select is(
  (select reserved_bytes from app_private.storage_usage
    where workspace_id = (select personal_workspace_id from asset_actor)),
  0::bigint,
  'rejection releases reserved bytes'
);
select is(
  (select pending_count from app_private.storage_usage
    where workspace_id = (select personal_workspace_id from asset_actor)),
  0,
  'rejection releases pending count'
);
select is(
  public.claim_asset_validation(
    (select app_user_id from asset_actor),
    (select (result->>'id')::uuid from rejected_asset),
    '50000000-0000-4000-8000-000000000003', repeat('d', 64),
    statement_timestamp() + interval '2 minutes'
  )->>'state',
  'rejected',
  'completion retry returns the durable rejected receipt'
);

create temporary table ready_asset as
select public.create_asset_upload_intent(
  (select app_user_id from asset_actor),
  (select personal_workspace_id from asset_actor),
  '60000000-0000-4000-8000-000000000001', repeat('e', 64),
  'project-fill', 'image/png', 1000,
  statement_timestamp() + interval '2 hours'
) as result;
create temporary table ready_claim as
select public.claim_asset_validation(
  (select app_user_id from asset_actor),
  (select (result->>'id')::uuid from ready_asset),
  '60000000-0000-4000-8000-000000000002', repeat('f', 64),
  statement_timestamp() + interval '2 minutes'
) as result;
create temporary table finalized_asset as
select public.finalize_asset_validation(
  (select app_user_id from asset_actor),
  (select (result->>'id')::uuid from ready_asset),
  '60000000-0000-4000-8000-000000000002', repeat('f', 64),
  (select (result->>'processingFencingVersion')::bigint from ready_claim),
  'assets/' || (select personal_workspace_id from asset_actor)::text || '/'
    || (select result->>'id' from ready_asset) || '/1.png',
  'image/png', 321, repeat('1', 64), 10, 20
) as result;

select is((select result->>'state' from finalized_asset), 'ready', 'valid metadata finalizes ready asset');
select is(
  (select committed_bytes from app_private.storage_usage
    where workspace_id = (select personal_workspace_id from asset_actor)),
  321::bigint,
  'finalization commits canonical byte size'
);
select is(
  (select count(*)::integer from public.get_assets_for_download(
    (select app_user_id from asset_actor),
    array[(select (result->>'id')::uuid from ready_asset)]
  )),
  1,
  'owner can authorize a ready asset download'
);
select throws_ok(
  $$select * from public.get_assets_for_download(
    (select app_user_id from asset_other),
    array[(select (result->>'id')::uuid from ready_asset)]
  )$$,
  'P0001', 'ASSET_NOT_FOUND',
  'another workspace cannot authorize download'
);

create temporary table asset_project as
select public.create_project(
  (select app_user_id from asset_actor),
  (select personal_workspace_id from asset_actor),
  '70000000-0000-4000-8000-000000000001', repeat('2', 64),
  'Project with asset', 1,
  jsonb_build_object(
    'fillImage', jsonb_build_object('assetId', (select result->>'id' from ready_asset)),
    'decos', '[]'::jsonb
  )
) as result;

select is(
  (select count(*)::integer from app_private.project_assets
    where project_id = (select (result->>'id')::uuid from asset_project)),
  1,
  'project transaction derives one asset link from its document'
);
select is(
  jsonb_array_length((select result->'assets' from asset_project)),
  1,
  'project response includes authorized ready asset metadata'
);
select throws_ok(
  $$select public.create_project(
    (select app_user_id from asset_actor),
    (select personal_workspace_id from asset_actor),
    '70000000-0000-4000-8000-000000000002', repeat('3', 64),
    'Project with rejected asset', 1,
    jsonb_build_object(
      'fillImage', jsonb_build_object('assetId', (select result->>'id' from rejected_asset)),
      'decos', '[]'::jsonb
    )
  )$$,
  'P0001', 'ASSET_NOT_READY',
  'project cannot reference a rejected asset'
);
select throws_ok(
  $$select public.create_project(
    (select app_user_id from asset_actor),
    (select personal_workspace_id from asset_actor),
    '70000000-0000-4000-8000-000000000003', repeat('4', 64),
    'Project with inline image', 1,
    '{"decos":[{"type":"image","src":"data:image/png;base64,AAAA"}]}'::jsonb
  )$$,
  'P0001', 'ASSET_NOT_READY',
  'privileged RPC cannot bypass asset IDs with inline image bytes'
);

select * from finish();
rollback;
