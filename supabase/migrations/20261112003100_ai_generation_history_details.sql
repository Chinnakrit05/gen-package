create or replace function public.list_my_ai_history(
  p_actor_user_id uuid,
  p_workspace_id uuid,
  p_cursor uuid default null,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 50));
  v_cursor_created_at timestamptz;
  v_items jsonb;
  v_next_cursor uuid;
begin
  perform app_private.assert_workspace_access(p_actor_user_id, p_workspace_id, false);

  if p_cursor is not null then
    select created_at into v_cursor_created_at
    from app_private.ai_requests
    where id = p_cursor
      and workspace_id = p_workspace_id
      and actor_user_id = p_actor_user_id;

    if not found then
      raise exception using errcode = 'P0001', message = 'INVALID_CURSOR';
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', page.id,
    'kind', page.generation_kind,
    'status', page.state,
    'createdAt', page.created_at,
    'settledAt', page.settled_at,
    'creditUnits', case when page.state = 'failed' then 0 else page.reserved_units end,
    'model', page.model,
    'inputTokens', page.input_tokens,
    'outputTokens', page.output_tokens,
    'cacheReadTokens', page.cache_read_tokens,
    'cacheCreationTokens', page.cache_creation_tokens,
    'hasImage', page.has_image
  ) order by page.created_at desc, page.id desc), '[]'::jsonb)
  into v_items
  from (
    select id, generation_kind, state, created_at, settled_at, reserved_units,
      model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, has_image
    from app_private.ai_requests
    where workspace_id = p_workspace_id
      and actor_user_id = p_actor_user_id
      and (p_cursor is null or (created_at, id) < (v_cursor_created_at, p_cursor))
    order by created_at desc, id desc
    limit v_limit + 1
  ) page;

  if jsonb_array_length(v_items) > v_limit then
    v_next_cursor := (v_items->(v_limit - 1)->>'id')::uuid;
    v_items := v_items - v_limit;
  end if;

  return jsonb_build_object('items', v_items, 'nextCursor', v_next_cursor);
end;
$$;
