create table app_private.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references app_private.workspaces(id) on delete restrict,
  created_by uuid not null references app_private.app_users(id) on delete restrict,
  name text not null,
  document_schema_version integer not null,
  document jsonb not null,
  revision bigint not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  deleted_at timestamptz,
  constraint projects_name_length check (char_length(btrim(name)) between 1 and 60),
  constraint projects_document_schema_version check (document_schema_version = 1),
  constraint projects_document_object check (jsonb_typeof(document) = 'object'),
  constraint projects_revision_positive check (revision >= 1),
  constraint projects_id_workspace_unique unique (id, workspace_id)
);

create index projects_workspace_updated_idx
  on app_private.projects (workspace_id, updated_at desc, id desc)
  where deleted_at is null;

create table app_private.project_operations (
  workspace_id uuid not null references app_private.workspaces(id) on delete restrict,
  actor_user_id uuid not null references app_private.app_users(id) on delete restrict,
  operation_id uuid not null,
  operation_type text not null,
  request_hash text not null,
  project_id uuid not null references app_private.projects(id) on delete restrict,
  result_revision bigint not null,
  result jsonb not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (workspace_id, actor_user_id, operation_id),
  constraint project_operations_type check (operation_type in ('create', 'save', 'delete')),
  constraint project_operations_hash check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint project_operations_revision_positive check (result_revision >= 1),
  constraint project_operations_result_object check (jsonb_typeof(result) = 'object')
);

create index project_operations_project_idx
  on app_private.project_operations (project_id, created_at desc);

alter table app_private.projects enable row level security;
alter table app_private.project_operations enable row level security;

revoke all on table app_private.projects, app_private.project_operations
  from public, anon, authenticated;
grant select, insert, update, delete on table app_private.projects, app_private.project_operations
  to service_role;

create function public.resolve_app_actor(
  p_identity_issuer text,
  p_identity_subject text
)
returns table (
  app_user_id uuid,
  user_status text
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return query
  select users.id, users.status
  from app_private.auth_identities identities
  join app_private.app_users users on users.id = identities.app_user_id
  where identities.issuer = btrim(p_identity_issuer)
    and identities.subject = btrim(p_identity_subject);

  if not found then
    raise exception using errcode = 'P0001', message = 'IDENTITY_NOT_BOOTSTRAPPED';
  end if;

  if exists (
    select 1
    from app_private.auth_identities identities
    join app_private.app_users users on users.id = identities.app_user_id
    where identities.issuer = btrim(p_identity_issuer)
      and identities.subject = btrim(p_identity_subject)
      and users.status <> 'active'
  ) then
    raise exception using errcode = 'P0001', message = 'APP_USER_NOT_ACTIVE';
  end if;
end;
$$;

create function app_private.assert_workspace_access(
  p_actor_user_id uuid,
  p_workspace_id uuid,
  p_write boolean
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_role text;
begin
  select status into v_status
  from app_private.app_users
  where id = p_actor_user_id;

  if v_status is null or v_status <> 'active' then
    raise exception using errcode = 'P0001', message = 'APP_USER_NOT_ACTIVE';
  end if;

  select role into v_role
  from app_private.workspace_members
  where workspace_id = p_workspace_id
    and user_id = p_actor_user_id;

  if v_role is null or (p_write and v_role not in ('owner', 'editor')) then
    raise exception using errcode = 'P0001', message = 'PROJECT_NOT_FOUND';
  end if;

  return v_role;
end;
$$;

create function public.create_project(
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

  select * into v_operation
  from app_private.project_operations
  where workspace_id = p_workspace_id
    and actor_user_id = p_actor_user_id
    and operation_id = p_operation_id;

  if found then
    if v_operation.operation_type <> 'create' or v_operation.request_hash <> p_request_hash then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return v_operation.result;
  end if;

  insert into app_private.projects (
    workspace_id, created_by, name, document_schema_version, document
  ) values (
    p_workspace_id, p_actor_user_id, btrim(p_name), p_document_schema_version, p_document
  ) returning * into v_project;

  v_result := jsonb_build_object(
    'id', v_project.id,
    'workspaceId', v_project.workspace_id,
    'name', v_project.name,
    'documentSchemaVersion', v_project.document_schema_version,
    'document', v_project.document,
    'revision', v_project.revision,
    'createdAt', v_project.created_at,
    'updatedAt', v_project.updated_at
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

create function public.save_project(
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
  select * into v_project
  from app_private.projects
  where id = p_project_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'PROJECT_NOT_FOUND';
  end if;

  perform app_private.assert_workspace_access(p_actor_user_id, v_project.workspace_id, true);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_project.workspace_id::text || pg_catalog.chr(31) || p_actor_user_id::text || pg_catalog.chr(31) || p_operation_id::text,
      0
    )
  );

  select * into v_operation
  from app_private.project_operations
  where workspace_id = v_project.workspace_id
    and actor_user_id = p_actor_user_id
    and operation_id = p_operation_id;

  if found then
    if v_operation.operation_type <> 'save'
      or v_operation.project_id <> p_project_id
      or v_operation.request_hash <> p_request_hash then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return v_operation.result;
  end if;

  if v_project.deleted_at is not null then
    raise exception using errcode = 'P0001', message = 'PROJECT_NOT_FOUND';
  end if;

  if v_project.revision <> p_expected_revision then
    raise exception using
      errcode = 'P0001',
      message = 'REVISION_CONFLICT',
      detail = v_project.revision::text;
  end if;

  update app_private.projects
  set name = btrim(p_name),
      document_schema_version = p_document_schema_version,
      document = p_document,
      revision = revision + 1,
      updated_at = statement_timestamp()
  where id = p_project_id
  returning * into v_project;

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

create function public.delete_project(
  p_actor_user_id uuid,
  p_project_id uuid,
  p_operation_id uuid,
  p_request_hash text,
  p_expected_revision bigint
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
  select * into v_project
  from app_private.projects
  where id = p_project_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'PROJECT_NOT_FOUND';
  end if;

  perform app_private.assert_workspace_access(p_actor_user_id, v_project.workspace_id, true);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_project.workspace_id::text || pg_catalog.chr(31) || p_actor_user_id::text || pg_catalog.chr(31) || p_operation_id::text,
      0
    )
  );

  select * into v_operation
  from app_private.project_operations
  where workspace_id = v_project.workspace_id
    and actor_user_id = p_actor_user_id
    and operation_id = p_operation_id;

  if found then
    if v_operation.operation_type <> 'delete'
      or v_operation.project_id <> p_project_id
      or v_operation.request_hash <> p_request_hash then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return v_operation.result;
  end if;

  if v_project.deleted_at is not null then
    raise exception using errcode = 'P0001', message = 'PROJECT_NOT_FOUND';
  end if;

  if v_project.revision <> p_expected_revision then
    raise exception using
      errcode = 'P0001',
      message = 'REVISION_CONFLICT',
      detail = v_project.revision::text;
  end if;

  update app_private.projects
  set deleted_at = statement_timestamp(),
      revision = revision + 1,
      updated_at = statement_timestamp()
  where id = p_project_id
  returning * into v_project;

  v_result := jsonb_build_object(
    'projectId', v_project.id,
    'revision', v_project.revision,
    'deletedAt', v_project.deleted_at,
    'operationId', p_operation_id
  );

  insert into app_private.project_operations (
    workspace_id, actor_user_id, operation_id, operation_type,
    request_hash, project_id, result_revision, result
  ) values (
    v_project.workspace_id, p_actor_user_id, p_operation_id, 'delete',
    p_request_hash, v_project.id, v_project.revision, v_result
  );

  return v_result;
end;
$$;

create function public.get_project(
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
  select * into v_project
  from app_private.projects
  where id = p_project_id
    and deleted_at is null;

  if not found then
    raise exception using errcode = 'P0001', message = 'PROJECT_NOT_FOUND';
  end if;

  perform app_private.assert_workspace_access(p_actor_user_id, v_project.workspace_id, false);

  return jsonb_build_object(
    'id', v_project.id,
    'workspaceId', v_project.workspace_id,
    'name', v_project.name,
    'documentSchemaVersion', v_project.document_schema_version,
    'document', v_project.document,
    'revision', v_project.revision,
    'createdAt', v_project.created_at,
    'updatedAt', v_project.updated_at
  );
end;
$$;

create function public.list_projects(
  p_actor_user_id uuid,
  p_workspace_id uuid,
  p_cursor_updated_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 21
)
returns table (
  project_id uuid,
  workspace_id uuid,
  project_name text,
  project_revision bigint,
  project_updated_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_limit not between 1 and 101 then
    raise exception using errcode = '22023', message = 'PROJECT_LIMIT_INVALID';
  end if;
  if (p_cursor_updated_at is null) <> (p_cursor_id is null) then
    raise exception using errcode = '22023', message = 'PROJECT_CURSOR_INVALID';
  end if;

  perform app_private.assert_workspace_access(p_actor_user_id, p_workspace_id, false);

  return query
  select projects.id, projects.workspace_id, projects.name, projects.revision, projects.updated_at
  from app_private.projects projects
  where projects.workspace_id = p_workspace_id
    and projects.deleted_at is null
    and (
      p_cursor_updated_at is null
      or (projects.updated_at, projects.id) < (p_cursor_updated_at, p_cursor_id)
    )
  order by projects.updated_at desc, projects.id desc
  limit p_limit;
end;
$$;

create function public.get_me(p_actor_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user app_private.app_users%rowtype;
  v_workspaces jsonb;
begin
  select * into v_user
  from app_private.app_users
  where id = p_actor_user_id;

  if not found or v_user.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'APP_USER_NOT_ACTIVE';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', workspaces.id,
        'kind', workspaces.kind,
        'name', workspaces.name,
        'role', members.role
      ) order by workspaces.created_at, workspaces.id
    ),
    '[]'::jsonb
  ) into v_workspaces
  from app_private.workspace_members members
  join app_private.workspaces workspaces on workspaces.id = members.workspace_id
  where members.user_id = p_actor_user_id;

  return jsonb_build_object(
    'user', jsonb_build_object(
      'id', v_user.id,
      'displayName', v_user.display_name,
      'email', v_user.email
    ),
    'workspaces', v_workspaces
  );
end;
$$;

revoke all on function public.resolve_app_actor(text, text) from public, anon, authenticated;
revoke all on function app_private.assert_workspace_access(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.create_project(uuid, uuid, uuid, text, text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.save_project(uuid, uuid, uuid, text, bigint, text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.delete_project(uuid, uuid, uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.get_project(uuid, uuid) from public, anon, authenticated;
revoke all on function public.list_projects(uuid, uuid, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.get_me(uuid) from public, anon, authenticated;

grant execute on function public.resolve_app_actor(text, text) to service_role;
grant execute on function app_private.assert_workspace_access(uuid, uuid, boolean) to service_role;
grant execute on function public.create_project(uuid, uuid, uuid, text, text, integer, jsonb) to service_role;
grant execute on function public.save_project(uuid, uuid, uuid, text, bigint, text, integer, jsonb) to service_role;
grant execute on function public.delete_project(uuid, uuid, uuid, text, bigint) to service_role;
grant execute on function public.get_project(uuid, uuid) to service_role;
grant execute on function public.list_projects(uuid, uuid, timestamptz, uuid, integer) to service_role;
grant execute on function public.get_me(uuid) to service_role;
