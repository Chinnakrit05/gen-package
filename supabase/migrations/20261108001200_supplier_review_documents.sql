-- Private evidence for supplier review. This is separate from Editor assets.
-- Reviewer RPC callers must also have a verified AAL2 session at the HTTP boundary.

create function app_private.marketplace_supplier_document_name_valid(p_name text, p_mime_type text)
returns boolean
language sql immutable security invoker set search_path = ''
as $$
  select coalesce(
    char_length(p_name) between 1 and 120
    and p_name = btrim(p_name)
    and p_name !~ '[[:cntrl:]]'
    and position('/' in p_name) = 0
    and position(chr(92) in p_name) = 0
    and case p_mime_type
      when 'application/pdf' then lower(p_name collate "C") like '%.pdf'
      when 'image/png' then lower(p_name collate "C") like '%.png'
      when 'image/jpeg' then lower(p_name collate "C") like any(array['%.jpg', '%.jpeg'])
      else false
    end,
    false
  );
$$;

create function app_private.marketplace_supplier_document_mime_matches(p_mime_type text, p_content bytea)
returns boolean
language sql immutable security invoker set search_path = ''
as $$
  select coalesce(case p_mime_type
    when 'application/pdf' then substring(p_content, 1, 5) = decode('255044462d', 'hex')
    when 'image/png' then substring(p_content, 1, 8) = decode('89504e470d0a1a0a', 'hex')
    when 'image/jpeg' then substring(p_content, 1, 3) = decode('ffd8ff', 'hex')
    else false
  end, false);
$$;

create table app_private.supplier_review_documents (
  supplier_id uuid not null references app_private.supplier_profiles(id) on delete cascade,
  id uuid not null,
  created_by uuid not null references app_private.app_users(id) on delete restrict,
  name text,
  mime_type text,
  byte_size integer,
  content bytea,
  created_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  primary key (supplier_id, id),
  constraint supplier_review_documents_active_or_scrubbed check (
    (deleted_at is null
      and name is not null and mime_type is not null and byte_size is not null and content is not null
      and byte_size between 1 and 2097152 and byte_size = octet_length(content)
      and app_private.marketplace_supplier_document_name_valid(name, mime_type)
      and app_private.marketplace_supplier_document_mime_matches(mime_type, content))
    or (deleted_at is not null and name is null and mime_type is null and byte_size is null and content is null)
  )
);

create index supplier_review_documents_active_idx
  on app_private.supplier_review_documents (supplier_id, created_at, id) where deleted_at is null;
create index supplier_review_documents_creator_idx on app_private.supplier_review_documents (created_by);

alter table app_private.supplier_review_documents enable row level security;
revoke all on table app_private.supplier_review_documents from public, anon, authenticated, service_role;
grant select, insert on table app_private.supplier_review_documents to service_role;
grant update (name, mime_type, byte_size, content, deleted_at)
  on table app_private.supplier_review_documents to service_role;

create function app_private.marketplace_supplier_document_json(p_document app_private.supplier_review_documents)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'id', (p_document).id,
    'name', (p_document).name,
    'mimeType', (p_document).mime_type,
    'byteSize', (p_document).byte_size,
    'createdAt', to_char((p_document).created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
$$;

create function app_private.marketplace_assert_supplier_document_read(
  p_actor_user_id uuid, p_supplier_id uuid, p_as_reviewer boolean
)
returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  if p_as_reviewer is null then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;
  if p_as_reviewer then
    perform app_private.marketplace_assert_reviewer(p_actor_user_id);
    -- Match review's actor/grant-then-supplier lock order. A status change
    -- cannot close the review while an authorized list/download is in flight.
    perform 1 from app_private.supplier_profiles where id = p_supplier_id and status = 'pending' for share;
    if not found then
      raise exception using errcode = 'P0001', message = 'MARKETPLACE_NOT_FOUND';
    end if;
  else
    perform app_private.marketplace_member_role(p_actor_user_id, p_supplier_id, true);
  end if;
end;
$$;

create function app_private.marketplace_lock_supplier_document_write(p_actor_user_id uuid, p_supplier_id uuid)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_status text;
begin
  perform app_private.marketplace_member_role(p_actor_user_id, p_supplier_id, true);
  -- Submit and review already lock this row, so quota checks and the final
  -- evidence set are serialized with the transition out of draft.
  select status into v_status from app_private.supplier_profiles where id = p_supplier_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'MARKETPLACE_NOT_FOUND';
  end if;
  if v_status <> 'draft' then
    raise exception using errcode = 'P0001', message = 'MARKETPLACE_CONFLICT';
  end if;
end;
$$;

create function public.marketplace_list_supplier_review_documents(
  p_actor_user_id uuid, p_supplier_id uuid, p_as_reviewer boolean
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_documents jsonb;
begin
  perform app_private.marketplace_assert_supplier_document_read(p_actor_user_id, p_supplier_id, p_as_reviewer);
  select coalesce(jsonb_agg(
    app_private.marketplace_supplier_document_json(document) order by document.created_at, document.id
  ), '[]'::jsonb) into v_documents
  from app_private.supplier_review_documents document where document.supplier_id = p_supplier_id and document.deleted_at is null;
  return jsonb_build_object('documents', v_documents);
end;
$$;

create function public.marketplace_get_supplier_review_document(
  p_actor_user_id uuid, p_supplier_id uuid, p_document_id uuid, p_as_reviewer boolean
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_document app_private.supplier_review_documents%rowtype;
begin
  perform app_private.marketplace_assert_supplier_document_read(p_actor_user_id, p_supplier_id, p_as_reviewer);
  select * into v_document from app_private.supplier_review_documents
  where supplier_id = p_supplier_id and id = p_document_id and deleted_at is null;
  if not found then
    raise exception using errcode = 'P0001', message = 'MARKETPLACE_NOT_FOUND';
  end if;
  return jsonb_build_object(
    'document', app_private.marketplace_supplier_document_json(v_document),
    'dataBase64', translate(encode(v_document.content, 'base64'), chr(10), '')
  );
end;
$$;

create function public.marketplace_add_supplier_review_document(
  p_actor_user_id uuid, p_supplier_id uuid, p_operation_id uuid, p_name text, p_mime_type text, p_data_base64 text
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_content bytea;
  v_size integer;
  v_document app_private.supplier_review_documents%rowtype;
begin
  perform app_private.marketplace_lock_supplier_document_write(p_actor_user_id, p_supplier_id);
  if p_operation_id is null or not app_private.marketplace_supplier_document_name_valid(p_name, p_mime_type)
    or p_data_base64 is null or octet_length(p_data_base64) not between 4 and 2796204
    or p_data_base64 collate "C" !~ '^[A-Za-z0-9+/]+={0,2}$'
  then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;
  begin
    v_content := decode(p_data_base64, 'base64');
  exception when invalid_parameter_value then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end;
  v_size := octet_length(v_content);
  if v_size not between 1 and 2097152
    or not app_private.marketplace_supplier_document_mime_matches(p_mime_type, v_content)
  then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;

  select * into v_document from app_private.supplier_review_documents where supplier_id = p_supplier_id and id = p_operation_id;
  if found then
    if v_document.deleted_at is not null or v_document.created_by <> p_actor_user_id
      or v_document.name <> p_name or v_document.mime_type <> p_mime_type or v_document.content <> v_content
    then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return app_private.marketplace_supplier_document_json(v_document);
  end if;

  if (select count(*) from app_private.supplier_review_documents where supplier_id = p_supplier_id and deleted_at is null) >= 3 then
    raise exception using errcode = 'P0001', message = 'SUPPLIER_DOCUMENT_LIMIT';
  end if;
  insert into app_private.supplier_review_documents (supplier_id, id, created_by, name, mime_type, byte_size, content)
  values (p_supplier_id, p_operation_id, p_actor_user_id, p_name, p_mime_type, v_size, v_content)
  returning * into v_document;
  return app_private.marketplace_supplier_document_json(v_document);
end;
$$;

create function public.marketplace_remove_supplier_review_document(
  p_actor_user_id uuid, p_supplier_id uuid, p_document_id uuid
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
begin
  perform app_private.marketplace_lock_supplier_document_write(p_actor_user_id, p_supplier_id);
  update app_private.supplier_review_documents
  set name = null, mime_type = null, byte_size = null, content = null, deleted_at = clock_timestamp()
  where supplier_id = p_supplier_id and id = p_document_id and deleted_at is null;
  if not found and not exists (
    select 1 from app_private.supplier_review_documents where supplier_id = p_supplier_id and id = p_document_id
  ) then
    raise exception using errcode = 'P0001', message = 'MARKETPLACE_NOT_FOUND';
  end if;
  return jsonb_build_object('id', p_document_id);
end;
$$;

revoke all on function app_private.marketplace_supplier_document_name_valid(text, text),
  app_private.marketplace_supplier_document_mime_matches(text, bytea),
  app_private.marketplace_supplier_document_json(app_private.supplier_review_documents),
  app_private.marketplace_assert_supplier_document_read(uuid, uuid, boolean),
  app_private.marketplace_lock_supplier_document_write(uuid, uuid) from public, anon, authenticated;
grant execute on function app_private.marketplace_supplier_document_name_valid(text, text),
  app_private.marketplace_supplier_document_mime_matches(text, bytea),
  app_private.marketplace_supplier_document_json(app_private.supplier_review_documents),
  app_private.marketplace_assert_supplier_document_read(uuid, uuid, boolean),
  app_private.marketplace_lock_supplier_document_write(uuid, uuid) to service_role;

revoke all on function public.marketplace_list_supplier_review_documents(uuid, uuid, boolean),
  public.marketplace_get_supplier_review_document(uuid, uuid, uuid, boolean),
  public.marketplace_add_supplier_review_document(uuid, uuid, uuid, text, text, text),
  public.marketplace_remove_supplier_review_document(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.marketplace_list_supplier_review_documents(uuid, uuid, boolean),
  public.marketplace_get_supplier_review_document(uuid, uuid, uuid, boolean),
  public.marketplace_add_supplier_review_document(uuid, uuid, uuid, text, text, text),
  public.marketplace_remove_supplier_review_document(uuid, uuid, uuid) to service_role;
