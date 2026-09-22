create table app_private.assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app_private.workspaces(id) on delete restrict,
  created_by uuid not null references app_private.app_users(id) on delete restrict,
  purpose text not null,
  state text not null default 'pending',
  provider text not null default 'supabase',
  staging_key text not null,
  object_key text,
  declared_mime text not null,
  declared_size bigint not null,
  mime_type text,
  byte_size bigint,
  sha256 text,
  width integer,
  height integer,
  ticket_expires_at timestamptz not null,
  processing_lease_until timestamptz,
  processing_fencing_version bigint not null default 0,
  rejection_code text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint assets_purpose check (purpose in ('project-decoration', 'project-fill')),
  constraint assets_state check (state in ('pending', 'validating', 'ready', 'rejected', 'deleting', 'deleted')),
  constraint assets_provider check (provider = 'supabase'),
  constraint assets_staging_key_unique unique (staging_key),
  constraint assets_object_key_unique unique (object_key),
  constraint assets_declared_mime check (declared_mime in ('image/png', 'image/jpeg')),
  constraint assets_declared_size check (declared_size between 1 and 10485760),
  constraint assets_mime_type check (mime_type is null or mime_type in ('image/png', 'image/jpeg')),
  constraint assets_byte_size check (byte_size is null or byte_size between 1 and 10485760),
  constraint assets_sha256 check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  constraint assets_dimensions check (
    (width is null and height is null)
    or (width between 1 and 20000 and height between 1 and 20000 and width::bigint * height::bigint <= 20000000)
  ),
  constraint assets_fencing_version check (processing_fencing_version >= 0),
  constraint assets_ready_metadata check (
    state <> 'ready'
    or (object_key is not null and mime_type is not null and byte_size is not null
      and sha256 is not null and width is not null and height is not null)
  ),
  constraint assets_id_workspace_unique unique (id, workspace_id)
);

create index assets_workspace_created_idx
  on app_private.assets (workspace_id, created_at desc, id desc);
create index assets_pending_expiry_idx
  on app_private.assets (ticket_expires_at)
  where state in ('pending', 'validating');

create table app_private.asset_operations (
  workspace_id uuid not null references app_private.workspaces(id) on delete restrict,
  actor_user_id uuid not null references app_private.app_users(id) on delete restrict,
  operation_id uuid not null,
  operation_type text not null,
  request_hash text not null,
  asset_id uuid not null,
  result jsonb not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (workspace_id, actor_user_id, operation_id),
  constraint asset_operations_type check (operation_type in ('create', 'renew', 'complete')),
  constraint asset_operations_hash check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint asset_operations_result_object check (jsonb_typeof(result) = 'object'),
  foreign key (asset_id, workspace_id)
    references app_private.assets(id, workspace_id) on delete restrict
);

create index asset_operations_asset_idx
  on app_private.asset_operations (asset_id, created_at desc);

create table app_private.storage_usage (
  workspace_id uuid primary key references app_private.workspaces(id) on delete restrict,
  quota_bytes bigint not null default 262144000,
  reserved_bytes bigint not null default 0,
  committed_bytes bigint not null default 0,
  pending_count integer not null default 0,
  updated_at timestamptz not null default statement_timestamp(),
  constraint storage_usage_quota check (quota_bytes > 0),
  constraint storage_usage_counts check (
    reserved_bytes >= 0 and committed_bytes >= 0 and pending_count >= 0
  ),
  constraint storage_usage_within_quota check (reserved_bytes + committed_bytes <= quota_bytes)
);

create table app_private.storage_reservations (
  asset_id uuid primary key,
  workspace_id uuid not null references app_private.workspaces(id) on delete restrict,
  reserved_bytes bigint not null,
  state text not null default 'reserved',
  expires_at timestamptz not null,
  settled_at timestamptz,
  constraint storage_reservations_bytes check (reserved_bytes between 1 and 10485760),
  constraint storage_reservations_state check (state in ('reserved', 'settled', 'released')),
  constraint storage_reservations_settlement check (
    (state = 'reserved' and settled_at is null)
    or (state in ('settled', 'released') and settled_at is not null)
  ),
  foreign key (asset_id, workspace_id)
    references app_private.assets(id, workspace_id) on delete restrict
);

create index storage_reservations_expiry_idx
  on app_private.storage_reservations (expires_at)
  where state = 'reserved';

create table app_private.project_assets (
  project_id uuid not null,
  asset_id uuid not null,
  workspace_id uuid not null,
  primary key (project_id, asset_id),
  foreign key (project_id, workspace_id)
    references app_private.projects(id, workspace_id) on delete restrict,
  foreign key (asset_id, workspace_id)
    references app_private.assets(id, workspace_id) on delete restrict
);

create index project_assets_asset_idx on app_private.project_assets (asset_id, project_id);

alter table app_private.assets enable row level security;
alter table app_private.asset_operations enable row level security;
alter table app_private.storage_usage enable row level security;
alter table app_private.storage_reservations enable row level security;
alter table app_private.project_assets enable row level security;

revoke all on table
  app_private.assets,
  app_private.asset_operations,
  app_private.storage_usage,
  app_private.storage_reservations,
  app_private.project_assets
from public, anon, authenticated;

grant select, insert, update, delete on table
  app_private.assets,
  app_private.asset_operations,
  app_private.storage_usage,
  app_private.storage_reservations,
  app_private.project_assets
to service_role;

create function app_private.asset_result(p_asset app_private.assets)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_asset.id,
    'workspaceId', p_asset.workspace_id,
    'purpose', p_asset.purpose,
    'state', p_asset.state,
    'stagingKey', p_asset.staging_key,
    'objectKey', p_asset.object_key,
    'declaredMime', p_asset.declared_mime,
    'declaredSize', p_asset.declared_size,
    'mimeType', p_asset.mime_type,
    'byteSize', p_asset.byte_size,
    'sha256', p_asset.sha256,
    'width', p_asset.width,
    'height', p_asset.height,
    'ticketExpiresAt', p_asset.ticket_expires_at,
    'processingLeaseUntil', p_asset.processing_lease_until,
    'processingFencingVersion', p_asset.processing_fencing_version,
    'rejectionCode', p_asset.rejection_code,
    'createdAt', p_asset.created_at,
    'updatedAt', p_asset.updated_at
  );
$$;

create function app_private.document_asset_ids(p_document jsonb)
returns table (asset_id uuid)
language sql
immutable
security invoker
set search_path = ''
as $$
  select distinct refs.asset_id_text::uuid
  from (
    select p_document #>> '{fillImage,assetId}' as asset_id_text
    union all
    select item->>'assetId'
    from jsonb_array_elements(coalesce(p_document->'decos', '[]'::jsonb)) item
    where item->>'type' = 'image'
  ) refs
  where refs.asset_id_text is not null;
$$;

create function app_private.assert_document_assets(
  p_workspace_id uuid,
  p_document jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (
    p_document ? 'fillImage'
    and p_document->'fillImage' is not null
    and p_document->'fillImage' <> 'null'::jsonb
    and (
      jsonb_typeof(p_document->'fillImage') <> 'object'
      or not (p_document->'fillImage' ? 'assetId')
      or p_document->'fillImage' ? 'src'
    )
  ) or exists (
    select 1
    from jsonb_array_elements(coalesce(p_document->'decos', '[]'::jsonb)) item
    where item->>'type' = 'image'
      and (not (item ? 'assetId') or item ? 'src')
  ) then
    raise exception using errcode = 'P0001', message = 'ASSET_NOT_READY';
  end if;

  if exists (
    select 1
    from app_private.document_asset_ids(p_document) refs
    left join app_private.assets assets on assets.id = refs.asset_id
    where assets.id is null
      or assets.workspace_id <> p_workspace_id
      or assets.state <> 'ready'
  ) then
    raise exception using errcode = 'P0001', message = 'ASSET_NOT_READY';
  end if;

  perform assets.id
  from app_private.assets assets
  join app_private.document_asset_ids(p_document) refs on refs.asset_id = assets.id
  where assets.workspace_id = p_workspace_id
    and assets.state = 'ready'
  for key share of assets;
end;
$$;

create function app_private.replace_project_assets(
  p_project_id uuid,
  p_workspace_id uuid,
  p_document jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from app_private.project_assets where project_id = p_project_id;
  insert into app_private.project_assets (project_id, asset_id, workspace_id)
  select p_project_id, refs.asset_id, p_workspace_id
  from app_private.document_asset_ids(p_document) refs;
end;
$$;

create function app_private.project_asset_metadata(p_project_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', assets.id,
        'workspaceId', assets.workspace_id,
        'purpose', assets.purpose,
        'state', assets.state,
        'mimeType', assets.mime_type,
        'byteSize', assets.byte_size,
        'sha256', assets.sha256,
        'width', assets.width,
        'height', assets.height,
        'createdAt', assets.created_at
      ) order by assets.id
    ),
    '[]'::jsonb
  )
  from app_private.project_assets links
  join app_private.assets assets on assets.id = links.asset_id
  where links.project_id = p_project_id
    and assets.state = 'ready';
$$;

create function public.create_asset_upload_intent(
  p_actor_user_id uuid,
  p_workspace_id uuid,
  p_operation_id uuid,
  p_request_hash text,
  p_purpose text,
  p_declared_mime text,
  p_declared_size bigint,
  p_ticket_expires_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_asset app_private.assets%rowtype;
  v_operation app_private.asset_operations%rowtype;
  v_usage app_private.storage_usage%rowtype;
  v_result jsonb;
  v_reservation_bytes constant bigint := 10485760;
begin
  perform app_private.assert_workspace_access(p_actor_user_id, p_workspace_id, true);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'asset' || pg_catalog.chr(31) || p_workspace_id::text || pg_catalog.chr(31)
      || p_actor_user_id::text || pg_catalog.chr(31) || p_operation_id::text,
      0
    )
  );

  select * into v_operation
  from app_private.asset_operations
  where workspace_id = p_workspace_id
    and actor_user_id = p_actor_user_id
    and operation_id = p_operation_id;

  if found then
    if v_operation.operation_type <> 'create' or v_operation.request_hash <> p_request_hash then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    select * into v_asset from app_private.assets where id = v_operation.asset_id;
    return app_private.asset_result(v_asset);
  end if;

  if p_purpose not in ('project-decoration', 'project-fill') then
    raise exception using errcode = '22023', message = 'ASSET_PURPOSE_INVALID';
  end if;
  if p_declared_mime not in ('image/png', 'image/jpeg') then
    raise exception using errcode = '22023', message = 'ASSET_MIME_INVALID';
  end if;
  if p_declared_size not between 1 and 10485760 then
    raise exception using errcode = '22023', message = 'ASSET_SIZE_INVALID';
  end if;
  if p_ticket_expires_at <= statement_timestamp()
    or p_ticket_expires_at > statement_timestamp() + interval '3 hours' then
    raise exception using errcode = '22023', message = 'ASSET_TICKET_EXPIRY_INVALID';
  end if;

  insert into app_private.storage_usage (workspace_id)
  values (p_workspace_id)
  on conflict (workspace_id) do nothing;

  select * into v_usage
  from app_private.storage_usage
  where workspace_id = p_workspace_id
  for update;

  if v_usage.pending_count >= 20
    or v_usage.reserved_bytes + v_usage.committed_bytes + v_reservation_bytes > v_usage.quota_bytes then
    raise exception using errcode = 'P0001', message = 'ASSET_QUOTA_EXCEEDED';
  end if;

  v_asset.id := gen_random_uuid();
  insert into app_private.assets (
    id, workspace_id, created_by, purpose, staging_key,
    declared_mime, declared_size, ticket_expires_at
  ) values (
    v_asset.id,
    p_workspace_id,
    p_actor_user_id,
    p_purpose,
    'staging/' || p_workspace_id::text || '/' || v_asset.id::text || '/' || gen_random_uuid()::text,
    p_declared_mime,
    p_declared_size,
    p_ticket_expires_at
  ) returning * into v_asset;

  insert into app_private.storage_reservations (
    asset_id, workspace_id, reserved_bytes, expires_at
  ) values (
    v_asset.id, p_workspace_id, v_reservation_bytes, p_ticket_expires_at + interval '1 hour'
  );

  update app_private.storage_usage
  set reserved_bytes = reserved_bytes + v_reservation_bytes,
      pending_count = pending_count + 1,
      updated_at = statement_timestamp()
  where workspace_id = p_workspace_id;

  v_result := app_private.asset_result(v_asset);
  insert into app_private.asset_operations (
    workspace_id, actor_user_id, operation_id, operation_type,
    request_hash, asset_id, result
  ) values (
    p_workspace_id, p_actor_user_id, p_operation_id, 'create',
    p_request_hash, v_asset.id, v_result
  );
  return v_result;
end;
$$;

create function public.renew_asset_upload_ticket(
  p_actor_user_id uuid,
  p_asset_id uuid,
  p_operation_id uuid,
  p_request_hash text,
  p_ticket_expires_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_asset app_private.assets%rowtype;
  v_operation app_private.asset_operations%rowtype;
  v_result jsonb;
begin
  select * into v_asset from app_private.assets where id = p_asset_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ASSET_NOT_FOUND';
  end if;
  perform app_private.assert_workspace_access(p_actor_user_id, v_asset.workspace_id, true);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'asset' || pg_catalog.chr(31) || v_asset.workspace_id::text || pg_catalog.chr(31)
      || p_actor_user_id::text || pg_catalog.chr(31) || p_operation_id::text,
      0
    )
  );

  select * into v_operation
  from app_private.asset_operations
  where workspace_id = v_asset.workspace_id
    and actor_user_id = p_actor_user_id
    and operation_id = p_operation_id;
  if found then
    if v_operation.operation_type <> 'renew'
      or v_operation.asset_id <> p_asset_id
      or v_operation.request_hash <> p_request_hash then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return app_private.asset_result(v_asset);
  end if;

  if v_asset.state <> 'pending' then
    raise exception using errcode = 'P0001', message = 'ASSET_NOT_PENDING';
  end if;
  if p_ticket_expires_at <= statement_timestamp()
    or p_ticket_expires_at > statement_timestamp() + interval '3 hours' then
    raise exception using errcode = '22023', message = 'ASSET_TICKET_EXPIRY_INVALID';
  end if;

  update app_private.assets
  set ticket_expires_at = p_ticket_expires_at,
      updated_at = statement_timestamp()
  where id = p_asset_id
  returning * into v_asset;
  update app_private.storage_reservations
  set expires_at = p_ticket_expires_at + interval '1 hour'
  where asset_id = p_asset_id and state = 'reserved';

  v_result := app_private.asset_result(v_asset);
  insert into app_private.asset_operations (
    workspace_id, actor_user_id, operation_id, operation_type,
    request_hash, asset_id, result
  ) values (
    v_asset.workspace_id, p_actor_user_id, p_operation_id, 'renew',
    p_request_hash, v_asset.id, v_result
  );
  return v_result;
end;
$$;

create function public.claim_asset_validation(
  p_actor_user_id uuid,
  p_asset_id uuid,
  p_operation_id uuid,
  p_request_hash text,
  p_lease_until timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_asset app_private.assets%rowtype;
  v_operation app_private.asset_operations%rowtype;
  v_has_operation boolean;
  v_result jsonb;
begin
  select * into v_asset from app_private.assets where id = p_asset_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ASSET_NOT_FOUND';
  end if;
  perform app_private.assert_workspace_access(p_actor_user_id, v_asset.workspace_id, true);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'asset' || pg_catalog.chr(31) || v_asset.workspace_id::text || pg_catalog.chr(31)
      || p_actor_user_id::text || pg_catalog.chr(31) || p_operation_id::text,
      0
    )
  );

  select * into v_operation
  from app_private.asset_operations
  where workspace_id = v_asset.workspace_id
    and actor_user_id = p_actor_user_id
    and operation_id = p_operation_id;
  v_has_operation := found;
  if v_has_operation then
    if v_operation.operation_type <> 'complete'
      or v_operation.asset_id <> p_asset_id
      or v_operation.request_hash <> p_request_hash then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
  end if;

  if v_asset.state in ('ready', 'rejected') then
    v_result := app_private.asset_result(v_asset);
    if not v_has_operation then
      insert into app_private.asset_operations (
        workspace_id, actor_user_id, operation_id, operation_type,
        request_hash, asset_id, result
      ) values (
        v_asset.workspace_id, p_actor_user_id, p_operation_id, 'complete',
        p_request_hash, v_asset.id, v_result
      );
    end if;
    return v_result || jsonb_build_object('claimed', false);
  end if;
  if v_asset.state = 'validating'
    and v_asset.processing_lease_until is not null
    and v_asset.processing_lease_until > statement_timestamp() then
    return app_private.asset_result(v_asset) || jsonb_build_object('claimed', false);
  end if;
  if v_asset.state not in ('pending', 'validating') then
    raise exception using errcode = 'P0001', message = 'ASSET_NOT_FOUND';
  end if;
  if p_lease_until <= statement_timestamp()
    or p_lease_until > statement_timestamp() + interval '5 minutes' then
    raise exception using errcode = '22023', message = 'ASSET_LEASE_INVALID';
  end if;

  update app_private.assets
  set state = 'validating',
      processing_lease_until = p_lease_until,
      processing_fencing_version = processing_fencing_version + 1,
      updated_at = statement_timestamp()
  where id = p_asset_id
  returning * into v_asset;

  v_result := app_private.asset_result(v_asset);
  if v_has_operation then
    update app_private.asset_operations
    set result = v_result, created_at = statement_timestamp()
    where workspace_id = v_asset.workspace_id
      and actor_user_id = p_actor_user_id
      and operation_id = p_operation_id;
  else
    insert into app_private.asset_operations (
      workspace_id, actor_user_id, operation_id, operation_type,
      request_hash, asset_id, result
    ) values (
      v_asset.workspace_id, p_actor_user_id, p_operation_id, 'complete',
      p_request_hash, v_asset.id, v_result
    );
  end if;
  return v_result || jsonb_build_object('claimed', true);
end;
$$;

create function public.finalize_asset_validation(
  p_actor_user_id uuid,
  p_asset_id uuid,
  p_operation_id uuid,
  p_request_hash text,
  p_fencing_version bigint,
  p_object_key text,
  p_mime_type text,
  p_byte_size bigint,
  p_sha256 text,
  p_width integer,
  p_height integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_asset app_private.assets%rowtype;
  v_operation app_private.asset_operations%rowtype;
  v_reservation app_private.storage_reservations%rowtype;
  v_result jsonb;
  v_extension text;
begin
  select * into v_asset from app_private.assets where id = p_asset_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ASSET_NOT_FOUND';
  end if;
  perform app_private.assert_workspace_access(p_actor_user_id, v_asset.workspace_id, true);

  select * into v_operation
  from app_private.asset_operations
  where workspace_id = v_asset.workspace_id
    and actor_user_id = p_actor_user_id
    and operation_id = p_operation_id;
  if found then
    if v_operation.operation_type <> 'complete'
      or v_operation.asset_id <> p_asset_id
      or v_operation.request_hash <> p_request_hash then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    if v_asset.state in ('ready', 'rejected') then
      return app_private.asset_result(v_asset);
    end if;
  else
    raise exception using errcode = 'P0001', message = 'ASSET_VALIDATION_FENCED';
  end if;

  if v_asset.state <> 'validating'
    or v_asset.processing_fencing_version <> p_fencing_version then
    raise exception using errcode = 'P0001', message = 'ASSET_VALIDATION_FENCED';
  end if;
  if p_mime_type is null
    or p_byte_size is null
    or p_sha256 is null
    or p_width is null
    or p_height is null
    or p_mime_type not in ('image/png', 'image/jpeg')
    or p_mime_type <> v_asset.declared_mime
    or p_byte_size not between 1 and 10485760
    or p_sha256 !~ '^[0-9a-f]{64}$'
    or p_width not between 1 and 20000
    or p_height not between 1 and 20000
    or p_width::bigint * p_height::bigint > 20000000 then
    raise exception using errcode = '22023', message = 'ASSET_METADATA_INVALID';
  end if;
  v_extension := case p_mime_type when 'image/png' then 'png' else 'jpg' end;
  if p_object_key <> 'assets/' || v_asset.workspace_id::text || '/' || v_asset.id::text
    || '/' || p_fencing_version::text || '.' || v_extension then
    raise exception using errcode = '22023', message = 'ASSET_OBJECT_KEY_INVALID';
  end if;

  select * into v_reservation
  from app_private.storage_reservations
  where asset_id = p_asset_id
  for update;
  if not found or v_reservation.state <> 'reserved' then
    raise exception using errcode = 'P0001', message = 'ASSET_RESERVATION_INVALID';
  end if;
  perform 1 from app_private.storage_usage
  where workspace_id = v_asset.workspace_id
  for update;

  update app_private.assets
  set state = 'ready',
      object_key = p_object_key,
      mime_type = p_mime_type,
      byte_size = p_byte_size,
      sha256 = p_sha256,
      width = p_width,
      height = p_height,
      processing_lease_until = null,
      rejection_code = null,
      updated_at = statement_timestamp()
  where id = p_asset_id
  returning * into v_asset;

  update app_private.storage_reservations
  set state = 'settled', settled_at = statement_timestamp()
  where asset_id = p_asset_id;
  update app_private.storage_usage
  set reserved_bytes = reserved_bytes - v_reservation.reserved_bytes,
      committed_bytes = committed_bytes + p_byte_size,
      pending_count = pending_count - 1,
      updated_at = statement_timestamp()
  where workspace_id = v_asset.workspace_id;

  v_result := app_private.asset_result(v_asset);
  update app_private.asset_operations
  set result = v_result
  where workspace_id = v_asset.workspace_id
    and actor_user_id = p_actor_user_id
    and operation_id = p_operation_id;
  return v_result;
end;
$$;

create function public.reject_asset_validation(
  p_actor_user_id uuid,
  p_asset_id uuid,
  p_operation_id uuid,
  p_request_hash text,
  p_fencing_version bigint,
  p_rejection_code text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_asset app_private.assets%rowtype;
  v_operation app_private.asset_operations%rowtype;
  v_reservation app_private.storage_reservations%rowtype;
  v_result jsonb;
begin
  select * into v_asset from app_private.assets where id = p_asset_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ASSET_NOT_FOUND';
  end if;
  perform app_private.assert_workspace_access(p_actor_user_id, v_asset.workspace_id, true);

  select * into v_operation
  from app_private.asset_operations
  where workspace_id = v_asset.workspace_id
    and actor_user_id = p_actor_user_id
    and operation_id = p_operation_id;
  if found then
    if v_operation.operation_type <> 'complete'
      or v_operation.asset_id <> p_asset_id
      or v_operation.request_hash <> p_request_hash then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    if v_asset.state in ('ready', 'rejected') then
      return app_private.asset_result(v_asset);
    end if;
  else
    raise exception using errcode = 'P0001', message = 'ASSET_VALIDATION_FENCED';
  end if;

  if v_asset.state <> 'validating'
    or v_asset.processing_fencing_version <> p_fencing_version then
    raise exception using errcode = 'P0001', message = 'ASSET_VALIDATION_FENCED';
  end if;
  if p_rejection_code not in (
    'OBJECT_MISSING', 'MIME_MISMATCH', 'INVALID_IMAGE', 'IMAGE_TOO_LARGE',
    'ANIMATED_IMAGE', 'FINAL_OBJECT_TOO_LARGE', 'STORAGE_FAILURE'
  ) then
    raise exception using errcode = '22023', message = 'ASSET_REJECTION_INVALID';
  end if;

  select * into v_reservation
  from app_private.storage_reservations
  where asset_id = p_asset_id
  for update;
  if not found or v_reservation.state <> 'reserved' then
    raise exception using errcode = 'P0001', message = 'ASSET_RESERVATION_INVALID';
  end if;
  perform 1 from app_private.storage_usage
  where workspace_id = v_asset.workspace_id
  for update;

  update app_private.assets
  set state = 'rejected',
      rejection_code = p_rejection_code,
      processing_lease_until = null,
      updated_at = statement_timestamp()
  where id = p_asset_id
  returning * into v_asset;
  update app_private.storage_reservations
  set state = 'released', settled_at = statement_timestamp()
  where asset_id = p_asset_id;
  update app_private.storage_usage
  set reserved_bytes = reserved_bytes - v_reservation.reserved_bytes,
      pending_count = pending_count - 1,
      updated_at = statement_timestamp()
  where workspace_id = v_asset.workspace_id;

  v_result := app_private.asset_result(v_asset);
  update app_private.asset_operations
  set result = v_result
  where workspace_id = v_asset.workspace_id
    and actor_user_id = p_actor_user_id
    and operation_id = p_operation_id;
  return v_result;
end;
$$;

create function public.get_asset(
  p_actor_user_id uuid,
  p_asset_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_asset app_private.assets%rowtype;
begin
  select * into v_asset from app_private.assets where id = p_asset_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'ASSET_NOT_FOUND';
  end if;
  perform app_private.assert_workspace_access(p_actor_user_id, v_asset.workspace_id, false);
  return app_private.asset_result(v_asset);
end;
$$;

create function public.get_assets_for_download(
  p_actor_user_id uuid,
  p_asset_ids uuid[]
)
returns table (
  asset_id uuid,
  workspace_id uuid,
  purpose text,
  object_key text,
  mime_type text,
  byte_size bigint,
  sha256 text,
  width integer,
  height integer,
  created_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_requested integer;
begin
  if p_asset_ids is null or cardinality(p_asset_ids) not between 1 and 50 then
    raise exception using errcode = '22023', message = 'ASSET_IDS_INVALID';
  end if;
  select count(distinct ids.id)::integer into v_requested from unnest(p_asset_ids) ids(id);
  if v_requested <> cardinality(p_asset_ids) then
    raise exception using errcode = '22023', message = 'ASSET_IDS_INVALID';
  end if;
  if not exists (
    select 1 from app_private.app_users
    where id = p_actor_user_id and status = 'active'
  ) then
    raise exception using errcode = 'P0001', message = 'APP_USER_NOT_ACTIVE';
  end if;

  if (
    select count(*)
    from app_private.assets assets
    join app_private.workspace_members members
      on members.workspace_id = assets.workspace_id and members.user_id = p_actor_user_id
    where assets.id = any(p_asset_ids) and assets.state = 'ready'
  ) <> v_requested then
    raise exception using errcode = 'P0001', message = 'ASSET_NOT_FOUND';
  end if;

  return query
  select assets.id, assets.workspace_id, assets.purpose, assets.object_key,
    assets.mime_type, assets.byte_size, assets.sha256, assets.width, assets.height, assets.created_at
  from app_private.assets assets
  where assets.id = any(p_asset_ids)
  order by assets.id;
end;
$$;

create or replace function public.create_project(
  p_actor_user_id uuid,
  p_workspace_id uuid,
  p_operation_id uuid,
  p_request_hash text,
  p_name text,
  p_document_schema_version integer,
  p_document jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_project app_private.projects%rowtype;
  v_operation app_private.project_operations%rowtype;
  v_result jsonb;
begin
  perform app_private.assert_workspace_access(p_actor_user_id, p_workspace_id, true);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_workspace_id::text || pg_catalog.chr(31) || p_actor_user_id::text || pg_catalog.chr(31) || p_operation_id::text,
      0
    )
  );
  select * into v_operation from app_private.project_operations
  where workspace_id = p_workspace_id and actor_user_id = p_actor_user_id and operation_id = p_operation_id;
  if found then
    if v_operation.operation_type <> 'create' or v_operation.request_hash <> p_request_hash then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return v_operation.result;
  end if;

  perform app_private.assert_document_assets(p_workspace_id, p_document);
  insert into app_private.projects (workspace_id, created_by, name, document_schema_version, document)
  values (p_workspace_id, p_actor_user_id, btrim(p_name), p_document_schema_version, p_document)
  returning * into v_project;
  perform app_private.replace_project_assets(v_project.id, v_project.workspace_id, v_project.document);

  v_result := jsonb_build_object(
    'id', v_project.id,
    'workspaceId', v_project.workspace_id,
    'name', v_project.name,
    'documentSchemaVersion', v_project.document_schema_version,
    'document', v_project.document,
    'revision', v_project.revision,
    'createdAt', v_project.created_at,
    'updatedAt', v_project.updated_at,
    'assets', app_private.project_asset_metadata(v_project.id)
  );
  insert into app_private.project_operations (
    workspace_id, actor_user_id, operation_id, operation_type,
    request_hash, project_id, result_revision, result
  ) values (
    p_workspace_id, p_actor_user_id, p_operation_id, 'create',
    p_request_hash, v_project.id, v_project.revision, v_result
  );
  return v_result;
end;
$$;

create or replace function public.save_project(
  p_actor_user_id uuid,
  p_project_id uuid,
  p_operation_id uuid,
  p_request_hash text,
  p_expected_revision bigint,
  p_name text,
  p_document_schema_version integer,
  p_document jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_project app_private.projects%rowtype;
  v_operation app_private.project_operations%rowtype;
  v_result jsonb;
begin
  select * into v_project from app_private.projects where id = p_project_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'PROJECT_NOT_FOUND'; end if;
  perform app_private.assert_workspace_access(p_actor_user_id, v_project.workspace_id, true);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_project.workspace_id::text || pg_catalog.chr(31) || p_actor_user_id::text || pg_catalog.chr(31) || p_operation_id::text,
      0
    )
  );
  select * into v_operation from app_private.project_operations
  where workspace_id = v_project.workspace_id and actor_user_id = p_actor_user_id and operation_id = p_operation_id;
  if found then
    if v_operation.operation_type <> 'save' or v_operation.project_id <> p_project_id
      or v_operation.request_hash <> p_request_hash then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return v_operation.result;
  end if;
  if v_project.deleted_at is not null then
    raise exception using errcode = 'P0001', message = 'PROJECT_NOT_FOUND';
  end if;
  if v_project.revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'REVISION_CONFLICT', detail = v_project.revision::text;
  end if;

  perform app_private.assert_document_assets(v_project.workspace_id, p_document);
  update app_private.projects
  set name = btrim(p_name), document_schema_version = p_document_schema_version,
      document = p_document, revision = revision + 1, updated_at = statement_timestamp()
  where id = p_project_id
  returning * into v_project;
  perform app_private.replace_project_assets(v_project.id, v_project.workspace_id, v_project.document);

  v_result := jsonb_build_object(
    'projectId', v_project.id,
    'revision', v_project.revision,
    'updatedAt', v_project.updated_at,
    'operationId', p_operation_id
  );
  insert into app_private.project_operations (
    workspace_id, actor_user_id, operation_id, operation_type,
    request_hash, project_id, result_revision, result
  ) values (
    v_project.workspace_id, p_actor_user_id, p_operation_id, 'save',
    p_request_hash, v_project.id, v_project.revision, v_result
  );
  return v_result;
end;
$$;

create or replace function public.get_project(
  p_actor_user_id uuid,
  p_project_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_project app_private.projects%rowtype;
begin
  select * into v_project from app_private.projects
  where id = p_project_id and deleted_at is null;
  if not found then raise exception using errcode = 'P0001', message = 'PROJECT_NOT_FOUND'; end if;
  perform app_private.assert_workspace_access(p_actor_user_id, v_project.workspace_id, false);
  return jsonb_build_object(
    'id', v_project.id,
    'workspaceId', v_project.workspace_id,
    'name', v_project.name,
    'documentSchemaVersion', v_project.document_schema_version,
    'document', v_project.document,
    'revision', v_project.revision,
    'createdAt', v_project.created_at,
    'updatedAt', v_project.updated_at,
    'assets', app_private.project_asset_metadata(v_project.id)
  );
end;
$$;

revoke all on function app_private.asset_result(app_private.assets) from public, anon, authenticated;
revoke all on function app_private.document_asset_ids(jsonb) from public, anon, authenticated;
revoke all on function app_private.assert_document_assets(uuid, jsonb) from public, anon, authenticated;
revoke all on function app_private.replace_project_assets(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function app_private.project_asset_metadata(uuid) from public, anon, authenticated;
revoke all on function public.create_asset_upload_intent(uuid, uuid, uuid, text, text, text, bigint, timestamptz) from public, anon, authenticated;
revoke all on function public.renew_asset_upload_ticket(uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_asset_validation(uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.finalize_asset_validation(uuid, uuid, uuid, text, bigint, text, text, bigint, text, integer, integer) from public, anon, authenticated;
revoke all on function public.reject_asset_validation(uuid, uuid, uuid, text, bigint, text) from public, anon, authenticated;
revoke all on function public.get_asset(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_assets_for_download(uuid, uuid[]) from public, anon, authenticated;

grant execute on function app_private.asset_result(app_private.assets) to service_role;
grant execute on function app_private.document_asset_ids(jsonb) to service_role;
grant execute on function app_private.assert_document_assets(uuid, jsonb) to service_role;
grant execute on function app_private.replace_project_assets(uuid, uuid, jsonb) to service_role;
grant execute on function app_private.project_asset_metadata(uuid) to service_role;
grant execute on function public.create_asset_upload_intent(uuid, uuid, uuid, text, text, text, bigint, timestamptz) to service_role;
grant execute on function public.renew_asset_upload_ticket(uuid, uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.claim_asset_validation(uuid, uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.finalize_asset_validation(uuid, uuid, uuid, text, bigint, text, text, bigint, text, integer, integer) to service_role;
grant execute on function public.reject_asset_validation(uuid, uuid, uuid, text, bigint, text) to service_role;
grant execute on function public.get_asset(uuid, uuid) to service_role;
grant execute on function public.get_assets_for_download(uuid, uuid[]) to service_role;
