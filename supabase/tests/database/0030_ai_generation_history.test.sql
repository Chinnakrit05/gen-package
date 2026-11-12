begin;

select plan(18);

select ok(
  not has_function_privilege('anon', 'public.list_my_ai_history(uuid,uuid,uuid,integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.list_my_ai_history(uuid,uuid,uuid,integer)', 'EXECUTE'),
  'browser roles cannot read history directly'
);
select ok(
  not has_function_privilege('anon', 'public.reserve_ai_credit_for_kind(uuid,uuid,uuid,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.reserve_ai_credit_for_kind(uuid,uuid,uuid,text)', 'EXECUTE'),
  'browser roles cannot reserve tagged credits directly'
);
select ok(
  has_function_privilege('service_role', 'public.list_my_ai_history(uuid,uuid,uuid,integer)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.reserve_ai_credit_for_kind(uuid,uuid,uuid,text)', 'EXECUTE'),
  'server can call both history RPCs'
);

create temporary table history_alice as
select * from public.bootstrap_personal_workspace('https://ai-history.test/auth/v1', 'history-alice');
create temporary table history_bob as
select * from public.bootstrap_personal_workspace('https://ai-history.test/auth/v1', 'history-bob');

insert into app_private.workspace_members (workspace_id, user_id, role) values
  ((select personal_workspace_id from history_alice), (select app_user_id from history_bob), 'editor'),
  ((select personal_workspace_id from history_bob), (select app_user_id from history_alice), 'editor');
insert into app_private.credit_balances (workspace_id, balance)
select personal_workspace_id, 5 from history_alice
union all
select personal_workspace_id, 5 from history_bob;

select is(
  (select public.list_my_ai_history(app_user_id, personal_workspace_id) from history_alice),
  '{"items":[],"nextCursor":null}'::jsonb,
  'no requests gives an empty page'
);
select throws_ok(
  $$select public.reserve_ai_credit_for_kind(
    app_user_id, personal_workspace_id, '83000000-0000-4000-8000-000000000001', 'unknown'
  ) from history_alice$$,
  '22023', 'AI_GENERATION_KIND_INVALID', 'unknown generation kind cannot reserve a credit'
);

create temporary table history_requests (label text primary key, reservation jsonb);
insert into history_requests
select 'legacy', public.reserve_ai_credit(
  app_user_id, personal_workspace_id, '83000000-0000-4000-8000-000000000001'
) from history_alice;
insert into history_requests
select 'artwork', public.reserve_ai_credit_for_kind(
  app_user_id, personal_workspace_id, '83000000-0000-4000-8000-000000000002', 'artwork'
) from history_alice;

do $$
begin
  perform public.settle_ai_request(
    (select app_user_id from history_alice), (reservation->>'requestId')::uuid,
    'succeeded', 'internal-model', 100, 200, 300, 400, true
  ) from history_requests where label = 'legacy';
  perform public.settle_ai_request(
    (select app_user_id from history_alice), (reservation->>'requestId')::uuid, 'failed'
  ) from history_requests where label = 'artwork';
end;
$$;

insert into history_requests
select 'spec', public.reserve_ai_credit_for_kind(
  app_user_id, personal_workspace_id, '83000000-0000-4000-8000-000000000003', 'spec'
) from history_alice;
insert into history_requests
select 'bob', public.reserve_ai_credit_for_kind(
  app_user_id, (select personal_workspace_id from history_alice), '83000000-0000-4000-8000-000000000004', 'artwork'
) from history_bob;
insert into history_requests
select 'other_workspace', public.reserve_ai_credit_for_kind(
  app_user_id, (select personal_workspace_id from history_bob), '83000000-0000-4000-8000-000000000005', 'spec'
) from history_alice;

select is(
  (select reservation->>'credits' from history_requests where label = 'spec'), '3',
  'old and tagged reservations use the same credit and refund rules'
);
select throws_ok(
  $$select public.reserve_ai_credit_for_kind(
    app_user_id, personal_workspace_id, '83000000-0000-4000-8000-000000000003', 'artwork'
  ) from history_alice$$,
  'P0001', 'AI_REQUEST_IN_PROGRESS', 'changing kind on a pending operation cannot reserve again'
);

update app_private.ai_requests request
set created_at = case when fixture.label = 'spec' then statement_timestamp()
  else statement_timestamp() - interval '1 minute' end
from history_requests fixture
where request.id = (fixture.reservation->>'requestId')::uuid;

create temporary table history_first_page as
select public.list_my_ai_history(app_user_id, personal_workspace_id, null, 0) as result
from history_alice;
create temporary table history_second_page as
select public.list_my_ai_history(
  app_user_id, personal_workspace_id, (select (result->>'nextCursor')::uuid from history_first_page), 2
) as result from history_alice;

select is(
  (select result->'items'->0 from history_first_page),
  (select jsonb_build_object(
    'id', request.id, 'kind', 'spec', 'status', 'reserved', 'createdAt', request.created_at,
    'settledAt', null, 'creditUnits', 1
  ) from app_private.ai_requests request
  where request.id = (select (reservation->>'requestId')::uuid from history_requests where label = 'spec')),
  'the newest item reports the tagged pending reservation with only public fields'
);
select is(
  (select result->>'nextCursor' from history_first_page),
  (select reservation->>'requestId' from history_requests where label = 'spec'),
  'low limit is bounded to one and gives the last visible item as cursor'
);
select is(
  (select jsonb_agg(item->'id' order by ordinal)
    from history_second_page, jsonb_array_elements(result->'items') with ordinality as items(item, ordinal)),
  (select jsonb_agg(reservation->'requestId' order by (reservation->>'requestId')::uuid desc)
    from history_requests where label in ('legacy', 'artwork')),
  'same-time rows paginate in stable UUID order without rows from another user or workspace'
);
select is(
  (select result->'nextCursor' from history_second_page), 'null'::jsonb,
  'an exactly full final page has no next cursor'
);
select is(
  (select item - 'id' - 'createdAt' - 'settledAt'
    from history_second_page, jsonb_array_elements(result->'items') item
    where item->>'id' = (select reservation->>'requestId' from history_requests where label = 'legacy')),
  '{"kind":null,"status":"succeeded","creditUnits":1}'::jsonb,
  'older requests expose a null kind and hide model, tokens and operation ID'
);
select is(
  (select item - 'id' - 'createdAt' - 'settledAt'
    from history_second_page, jsonb_array_elements(result->'items') item
    where item->>'id' = (select reservation->>'requestId' from history_requests where label = 'artwork')),
  '{"kind":"artwork","status":"failed","creditUnits":0}'::jsonb,
  'failed artwork reports the refunded credit'
);
select is(
  (select public.list_my_ai_history(app_user_id, (select personal_workspace_id from history_alice))->'items'->0->>'id'
    from history_bob),
  (select reservation->>'requestId' from history_requests where label = 'bob'),
  'a different member can read their own history in the shared workspace'
);
select throws_ok(
  $$select public.list_my_ai_history(
    app_user_id, personal_workspace_id,
    (select (reservation->>'requestId')::uuid from history_requests where label = 'bob')
  ) from history_alice$$,
  'P0001', 'INVALID_CURSOR', 'cursor cannot address another actor in the same workspace'
);
select throws_ok(
  $$select public.list_my_ai_history(
    app_user_id, personal_workspace_id,
    (select (reservation->>'requestId')::uuid from history_requests where label = 'other_workspace')
  ) from history_alice$$,
  'P0001', 'INVALID_CURSOR', 'cursor cannot address the same actor in another workspace'
);

delete from app_private.workspace_members
where workspace_id = (select personal_workspace_id from history_alice)
  and user_id = (select app_user_id from history_bob);
select throws_ok(
  $$select public.list_my_ai_history(app_user_id, (select personal_workspace_id from history_alice)) from history_bob$$,
  'P0001', 'PROJECT_NOT_FOUND', 'a former member cannot access their old workspace history'
);

insert into app_private.ai_requests (workspace_id, actor_user_id, operation_id, state, settled_at)
select personal_workspace_id, app_user_id, gen_random_uuid(), 'failed', statement_timestamp()
from history_alice cross join generate_series(1, 50);
select is(
  (select jsonb_array_length(public.list_my_ai_history(app_user_id, personal_workspace_id, null, 1000)->'items')
    from history_alice),
  50,
  'a high limit is capped at 50 items'
);

select * from finish();
rollback;
