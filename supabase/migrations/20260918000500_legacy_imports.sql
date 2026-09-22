create table app_private.legacy_imports (
  user_id uuid not null references app_private.app_users(id) on delete restrict,
  workspace_id uuid not null references app_private.workspaces(id) on delete restrict,
  source_installation_id uuid not null,
  source_project_key text not null,
  source_hash text not null,
  target_project_id uuid not null,
  operation_id uuid not null,
  completed_at timestamptz not null default statement_timestamp(),
  primary key (user_id, source_installation_id, source_project_key),
  constraint legacy_imports_source_key_length check (char_length(source_project_key) between 1 and 200),
  constraint legacy_imports_source_hash check (source_hash ~ '^[0-9a-f]{64}$'),
  constraint legacy_imports_project_workspace_fk foreign key (target_project_id, workspace_id)
    references app_private.projects(id, workspace_id) on delete restrict
);

create index legacy_imports_project_idx
  on app_private.legacy_imports (target_project_id);

alter table app_private.legacy_imports enable row level security;
revoke all on table app_private.legacy_imports from public, anon, authenticated;
grant select, insert, update, delete on table app_private.legacy_imports to service_role;

create function public.import_legacy_project(
  p_actor_user_id uuid,
  p_workspace_id uuid,
  p_operation_id uuid,
  p_request_hash text,
  p_source_installation_id uuid,
  p_source_project_key text,
  p_source_hash text,
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
  v_mapping app_private.legacy_imports%rowtype;
  v_project jsonb;
begin
  perform app_private.assert_workspace_access(p_actor_user_id, p_workspace_id, true);
  if char_length(p_source_project_key) not between 1 and 200
    or p_source_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'VALIDATION_ERROR';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_actor_user_id::text || pg_catalog.chr(31)
        || p_source_installation_id::text || pg_catalog.chr(31)
        || p_source_project_key,
      0
    )
  );

  select * into v_mapping
  from app_private.legacy_imports
  where user_id = p_actor_user_id
    and source_installation_id = p_source_installation_id
    and source_project_key = p_source_project_key;

  if found then
    if v_mapping.workspace_id <> p_workspace_id then
      raise exception using errcode = 'P0001', message = 'PROJECT_NOT_FOUND';
    end if;
    if v_mapping.source_hash <> p_source_hash then
      raise exception using errcode = 'P0001', message = 'LEGACY_SOURCE_CHANGED';
    end if;
    v_project := public.get_project(p_actor_user_id, v_mapping.target_project_id);
    return jsonb_build_object(
      'sourceInstallationId', v_mapping.source_installation_id,
      'sourceProjectKey', v_mapping.source_project_key,
      'sourceHash', v_mapping.source_hash,
      'project', v_project,
      'completedAt', v_mapping.completed_at
    );
  end if;

  v_project := public.create_project(
    p_actor_user_id,
    p_workspace_id,
    p_operation_id,
    p_request_hash,
    p_name,
    p_document_schema_version,
    p_document
  );

  insert into app_private.legacy_imports (
    user_id, workspace_id, source_installation_id, source_project_key,
    source_hash, target_project_id, operation_id
  ) values (
    p_actor_user_id, p_workspace_id, p_source_installation_id, p_source_project_key,
    p_source_hash, (v_project->>'id')::uuid, p_operation_id
  ) returning * into v_mapping;

  return jsonb_build_object(
    'sourceInstallationId', v_mapping.source_installation_id,
    'sourceProjectKey', v_mapping.source_project_key,
    'sourceHash', v_mapping.source_hash,
    'project', v_project,
    'completedAt', v_mapping.completed_at
  );
end;
$$;

revoke all on function public.import_legacy_project(
  uuid, uuid, uuid, text, uuid, text, text, text, integer, jsonb
) from public, anon, authenticated;
grant execute on function public.import_legacy_project(
  uuid, uuid, uuid, text, uuid, text, text, text, integer, jsonb
) to service_role;
