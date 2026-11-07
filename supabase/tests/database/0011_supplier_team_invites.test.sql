begin;

select plan(58);

select ok(
  (select relrowsecurity from pg_class where oid = 'app_private.supplier_team_invites'::regclass)
  and not has_table_privilege('anon', 'app_private.supplier_team_invites', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'app_private.supplier_team_invites', 'SELECT,INSERT,UPDATE,DELETE'),
  'invite records are private and RLS is enabled'
);
select ok(
  has_table_privilege('service_role', 'app_private.supplier_team_invites', 'SELECT')
  and not has_table_privilege('service_role', 'app_private.supplier_team_invites', 'UPDATE,DELETE')
  and has_column_privilege('service_role', 'app_private.supplier_team_invites', 'accepted_at', 'UPDATE')
  and not has_column_privilege('service_role', 'app_private.supplier_team_invites', 'token_hash', 'UPDATE'),
  'service role can settle invites but cannot rewrite a token digest or erase a receipt'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'app_private.supplier_team_member_removals'::regclass)
  and not has_table_privilege('anon', 'app_private.supplier_team_member_removals', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'app_private.supplier_team_member_removals', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('service_role', 'app_private.supplier_team_member_removals', 'DELETE'),
  'membership removal cutoffs are private and cannot be erased by the service role'
);
select is((
  select count(*)::integer from pg_proc
  where pronamespace = 'public'::regnamespace and proname in (
    'marketplace_supplier_team', 'marketplace_create_supplier_invite', 'marketplace_accept_supplier_invite',
    'marketplace_change_supplier_member', 'marketplace_remove_supplier_member', 'marketplace_revoke_supplier_invite'
  ) and not prosecdef and has_function_privilege('service_role', oid, 'EXECUTE')
    and not has_function_privilege('anon', oid, 'EXECUTE')
    and not has_function_privilege('authenticated', oid, 'EXECUTE')
), 6, 'the six team RPCs are service-role-only invokers');

insert into app_private.app_users (id, display_name, email) values
  ('f1100000-0000-4000-8000-000000000001', 'Owner', 'owner@example.test'),
  ('f1100000-0000-4000-8000-000000000002', 'Invitee', 'stale-profile-email@example.test'),
  ('f1100000-0000-4000-8000-000000000003', 'Other supplier manager', 'other@example.test'),
  ('f1100000-0000-4000-8000-000000000004', 'Design editor', 'design@example.test'),
  ('f1100000-0000-4000-8000-000000000005', 'Legacy member', 'legacy@example.test');

set local role service_role;

create temporary table team_supplier_input (profile jsonb);
insert into team_supplier_input values ('{
  "kind":"factory","name":"Test supplier team","slug":"test-supplier-team",
  "description":"","contactEmail":"private@example.test","capabilities":[]
}'::jsonb);

create temporary table teams as
select
  (first_supplier #>> '{profile,id}')::uuid as supplier_id,
  (first_supplier #>> '{profile,workspaceId}')::uuid as workspace_id,
  (second_supplier #>> '{profile,id}')::uuid as other_supplier_id
from (select
  public.marketplace_create_supplier(
    'f1100000-0000-4000-8000-000000000001', 'f2100000-0000-4000-8000-000000000001', profile
  ) as first_supplier,
  public.marketplace_create_supplier(
    'f1100000-0000-4000-8000-000000000003', 'f2100000-0000-4000-8000-000000000002',
    profile || '{"slug":"test-other-supplier-team"}'::jsonb
  ) as second_supplier
from team_supplier_input) creations;

select is(public.marketplace_supplier_team(
  'f1100000-0000-4000-8000-000000000001', (select supplier_id from teams)
), '{
  "members":[{"userId":"f1100000-0000-4000-8000-000000000001","displayName":"Owner","role":"manager","isWorkspaceOwner":true}],
  "invites":[]
}'::jsonb, 'roster exposes only its own owner and no private member emails');
select is((select requires_workspace_membership from app_private.workspace_marketplace_members
  where workspace_id=(select workspace_id from teams) and user_id='f1100000-0000-4000-8000-000000000001'),
  true, 'supplier creation still grants a legacy-linked Marketplace role to the owner');
select throws_ok($$select public.marketplace_supplier_team(
  'f1100000-0000-4000-8000-000000000003', (select supplier_id from teams)
)$$, 'P0001', 'MARKETPLACE_NOT_FOUND', 'a manager in another supplier cannot read the roster');
select throws_ok($$select public.marketplace_create_supplier_invite(
  'f1100000-0000-4000-8000-000000000001', (select supplier_id from teams), 'unusable', 'staff', repeat('1',64)
)$$, '22023', 'VALIDATION_ERROR', 'invalid email is rejected before invite insertion');
select throws_ok($$select public.marketplace_create_supplier_invite(
  'f1100000-0000-4000-8000-000000000001', (select supplier_id from teams), 'new@example.test', 'owner', repeat('1',64)
)$$, '22023', 'VALIDATION_ERROR', 'invites cannot confer workspace ownership');
select throws_ok($$select public.marketplace_create_supplier_invite(
  'f1100000-0000-4000-8000-000000000001', (select supplier_id from teams), 'new@example.test', 'staff', 'raw-token'
)$$, '22023', 'VALIDATION_ERROR', 'SQL accepts a SHA-256 digest, not the raw invite token');

create temporary table first_invite as select public.marketplace_create_supplier_invite(
  'f1100000-0000-4000-8000-000000000001', (select supplier_id from teams), ' Invitee@Example.Test ', 'staff', repeat('1',64)
) as result;
select is((select result->>'email' from first_invite), 'invitee@example.test', 'invite email is canonicalized');
select is((
  select array_agg(key order by key) from jsonb_object_keys((select result from first_invite)) as item(key)
), array['createdAt','email','expiresAt','id','role'], 'invite response has no token digest or raw token');
select is((
  select expires_at-created_at from app_private.supplier_team_invites
  where id=(select (result->>'id')::uuid from first_invite)
), interval '7 days', 'invite expires after seven days');
select is(public.marketplace_supplier_team(
  'f1100000-0000-4000-8000-000000000001', (select supplier_id from teams)
)->'invites', (select jsonb_build_array(result) from first_invite), 'manager can list pending invites with no token data');
select throws_ok($$select public.marketplace_create_supplier_invite(
  'f1100000-0000-4000-8000-000000000001', (select supplier_id from teams), 'INVITEE@example.test', 'viewer', repeat('2',64)
)$$, 'P0001', 'MARKETPLACE_INVITE_EXISTS', 'duplicate pending normalized email is rejected');
select throws_ok($$select public.marketplace_accept_supplier_invite(
  'f1100000-0000-4000-8000-000000000003', 'other@example.test', repeat('1',64)
)$$, 'P0001', 'MARKETPLACE_INVITE_INVALID', 'wrong authenticated email gets a generic invalid invitation');
select throws_ok($$select public.marketplace_accept_supplier_invite(
  'f1100000-0000-4000-8000-000000000002', null, repeat('1',64)
)$$, 'P0001', 'MARKETPLACE_INVITE_INVALID', 'verified email is required');
select throws_ok($$select public.marketplace_accept_supplier_invite(
  'f1100000-0000-4000-8000-000000000002', 'invitee@example.test', repeat('3',64)
)$$, 'P0001', 'MARKETPLACE_INVITE_INVALID', 'unknown token has the same denial as a wrong email');

create temporary table accepted as select public.marketplace_accept_supplier_invite(
  'f1100000-0000-4000-8000-000000000002', ' INVITEE@example.test ', repeat('1',64)
) as result;
select is((select result #>> '{profile,id}' from accepted), (select supplier_id::text from teams),
  'acceptance opens only the supplier named by the invite');
select is((select result->>'role' from accepted), 'staff', 'invite grants its exact Marketplace role');
select is((
  select count(*)::integer from app_private.workspace_members
  where workspace_id=(select workspace_id from teams) and user_id='f1100000-0000-4000-8000-000000000002'
), 0, 'invite redemption grants no Editor workspace membership');
select is((
  select count(*)::integer from app_private.workspace_marketplace_members
  where workspace_id=(select workspace_id from teams) and user_id='f1100000-0000-4000-8000-000000000002'
    and not requires_workspace_membership and workspace_member_user_id is null
), 1, 'invite grants an independent Marketplace membership');
select is(public.marketplace_get_supplier(
  'f1100000-0000-4000-8000-000000000002', (select supplier_id from teams)
), (select result from accepted), 'independent member reads private supplier details without Editor access');
select is(public.marketplace_context('f1100000-0000-4000-8000-000000000002')->'suppliers',
  (select jsonb_build_array(result) from accepted), 'context includes the independent Marketplace membership');
select is(public.marketplace_supplier_team(
  'f1100000-0000-4000-8000-000000000001', (select supplier_id from teams)
)->'invites', '[]'::jsonb, 'accepted invite leaves the pending list');
select throws_ok($$select public.marketplace_supplier_team(
  'f1100000-0000-4000-8000-000000000002', (select supplier_id from teams)
)$$, 'P0001', 'MARKETPLACE_FORBIDDEN', 'staff cannot list team members or invite emails');
select is(public.marketplace_accept_supplier_invite(
  'f1100000-0000-4000-8000-000000000002', 'invitee@example.test', repeat('1',64)
), (select result from accepted), 'same actor can retry a successful acceptance');
select throws_ok($$select public.marketplace_accept_supplier_invite(
  'f1100000-0000-4000-8000-000000000003', 'invitee@example.test', repeat('1',64)
)$$, 'P0001', 'MARKETPLACE_INVITE_INVALID', 'a used token cannot be claimed by a different actor');
select throws_ok($$select public.marketplace_revoke_supplier_invite(
  'f1100000-0000-4000-8000-000000000001', (select supplier_id from teams), (select (result->>'id')::uuid from first_invite)
)$$, 'P0001', 'MARKETPLACE_INVITE_INVALID', 'revoking an accepted invite does not remove membership');

select is(public.marketplace_change_supplier_member(
  'f1100000-0000-4000-8000-000000000001', (select supplier_id from teams),
  'f1100000-0000-4000-8000-000000000002', 'manager'
)->>'role', 'manager', 'manager can promote another member');
select is(public.marketplace_accept_supplier_invite(
  'f1100000-0000-4000-8000-000000000002', 'invitee@example.test', repeat('1',64)
)->>'role', 'manager', 'acceptance retry returns the current role without reverting later changes');
select throws_ok($$select public.marketplace_change_supplier_member(
  'f1100000-0000-4000-8000-000000000002', (select supplier_id from teams), 'f1100000-0000-4000-8000-000000000001', 'viewer'
)$$, 'P0001', 'MARKETPLACE_OWNER_PROTECTED', 'co-manager cannot change workspace owner access');
select throws_ok($$select public.marketplace_remove_supplier_member(
  'f1100000-0000-4000-8000-000000000002', (select supplier_id from teams), 'f1100000-0000-4000-8000-000000000001'
)$$, 'P0001', 'MARKETPLACE_OWNER_PROTECTED', 'co-manager cannot remove workspace owner access');

create temporary table issuer_suspension_invite as select public.marketplace_create_supplier_invite(
  'f1100000-0000-4000-8000-000000000001', (select supplier_id from teams), 'design@example.test', 'viewer', repeat('8',64)
) as result;
update app_private.app_users set status='suspended' where id='f1100000-0000-4000-8000-000000000001';
select throws_ok($$select public.marketplace_accept_supplier_invite(
  'f1100000-0000-4000-8000-000000000004', 'design@example.test', repeat('8',64)
)$$, 'P0001', 'MARKETPLACE_INVITE_INVALID', 'unconsumed invite requires a still-active issuer');
select is(public.marketplace_accept_supplier_invite(
  'f1100000-0000-4000-8000-000000000002', 'invitee@example.test', repeat('1',64)
)->>'role', 'manager', 'same-member acceptance retry survives later issuer suspension');
select throws_ok($$select public.marketplace_change_supplier_member(
  'f1100000-0000-4000-8000-000000000002', (select supplier_id from teams), 'f1100000-0000-4000-8000-000000000002', 'staff'
)$$, 'P0001', 'MARKETPLACE_MANAGER_REQUIRED', 'inactive owner does not count toward the last active manager');
select throws_ok($$select public.marketplace_remove_supplier_member(
  'f1100000-0000-4000-8000-000000000002', (select supplier_id from teams), 'f1100000-0000-4000-8000-000000000002'
)$$, 'P0001', 'MARKETPLACE_MANAGER_REQUIRED', 'last active manager cannot remove themself');
update app_private.app_users set status='active' where id='f1100000-0000-4000-8000-000000000001';

create temporary table issuer_suspension_cleanup as select public.marketplace_revoke_supplier_invite(
  'f1100000-0000-4000-8000-000000000001', (select supplier_id from teams),
  (select (result->>'id')::uuid from issuer_suspension_invite)
);
create temporary table self_invite_before_demotion as select public.marketplace_create_supplier_invite(
  'f1100000-0000-4000-8000-000000000002', (select supplier_id from teams), 'invitee@example.test', 'manager', repeat('9',64)
);
select is(public.marketplace_change_supplier_member(
  'f1100000-0000-4000-8000-000000000001', (select supplier_id from teams), 'f1100000-0000-4000-8000-000000000002', 'staff'
)->>'role', 'staff', 'owner can demote a co-manager');
select throws_ok($$select public.marketplace_accept_supplier_invite(
  'f1100000-0000-4000-8000-000000000002', 'invitee@example.test', repeat('9',64)
)$$, 'P0001', 'MARKETPLACE_INVITE_INVALID', 'demoted manager cannot redeem their old self-invite');
create temporary table restore_co_manager as select public.marketplace_change_supplier_member(
  'f1100000-0000-4000-8000-000000000001', (select supplier_id from teams), 'f1100000-0000-4000-8000-000000000002', 'manager'
);
create temporary table earlier_invite_by_owner as select public.marketplace_create_supplier_invite(
  'f1100000-0000-4000-8000-000000000001', (select supplier_id from teams), 'invitee@example.test', 'staff', repeat('a',64)
) as result;
create temporary table self_invite_before_removal as select public.marketplace_create_supplier_invite(
  'f1100000-0000-4000-8000-000000000002', (select supplier_id from teams), 'alternate@example.test', 'manager', repeat('b',64)
);
select is(public.marketplace_remove_supplier_member(
  'f1100000-0000-4000-8000-000000000001', (select supplier_id from teams), 'f1100000-0000-4000-8000-000000000002'
)->>'userId', 'f1100000-0000-4000-8000-000000000002', 'manager can remove a non-owner when another active manager remains');
select is((select revoked_by::text from app_private.supplier_team_invites where token_hash=repeat('b',64)),
  'f1100000-0000-4000-8000-000000000001', 'removing a manager atomically revokes the outstanding invites they issued');
select throws_ok($$select public.marketplace_accept_supplier_invite(
  'f1100000-0000-4000-8000-000000000002', 'invitee@example.test', repeat('a',64)
)$$, 'P0001', 'MARKETPLACE_INVITE_INVALID', 'a pending invite from a different active manager cannot undo removal');
select throws_ok($$select public.marketplace_accept_supplier_invite(
  'f1100000-0000-4000-8000-000000000002', 'invitee@example.test', repeat('1',64)
)$$, 'P0001', 'MARKETPLACE_INVITE_INVALID', 'replay cannot resurrect revoked membership');
select is(public.marketplace_context('f1100000-0000-4000-8000-000000000002')->'suppliers', '[]'::jsonb,
  'removal is reflected in Marketplace context immediately');
create temporary table revoke_stale_invite_by_owner as select public.marketplace_revoke_supplier_invite(
  'f1100000-0000-4000-8000-000000000001', (select supplier_id from teams),
  (select (result->>'id')::uuid from earlier_invite_by_owner)
);
create temporary table fresh_invite_after_removal as select public.marketplace_create_supplier_invite(
  'f1100000-0000-4000-8000-000000000001', (select supplier_id from teams), 'invitee@example.test', 'viewer', repeat('c',64)
);
select is(public.marketplace_accept_supplier_invite(
  'f1100000-0000-4000-8000-000000000002', 'invitee@example.test', repeat('c',64)
)->>'role', 'viewer', 'explicit fresh invite after removal can grant new access');
select throws_ok($$select public.marketplace_accept_supplier_invite(
  'f1100000-0000-4000-8000-000000000002', 'invitee@example.test', repeat('1',64)
)$$, 'P0001', 'MARKETPLACE_INVITE_INVALID', 'receipt for a removed membership stays invalid after a fresh rejoin');
select throws_ok($$select public.marketplace_remove_supplier_member(
  'f1100000-0000-4000-8000-000000000001', (select supplier_id from teams), 'f1100000-0000-4000-8000-000000000003'
)$$, 'P0001', 'MARKETPLACE_NOT_FOUND', 'cannot remove a user who only manages a different supplier');

insert into app_private.workspace_members (workspace_id,user_id,role)
select workspace_id,'f1100000-0000-4000-8000-000000000004'::uuid,'editor' from teams
union all
select workspace_id,'f1100000-0000-4000-8000-000000000005'::uuid,'viewer' from teams;

create temporary table design_invite as select public.marketplace_create_supplier_invite(
  'f1100000-0000-4000-8000-000000000001', (select supplier_id from teams), 'design@example.test', 'viewer', repeat('4',64)
) as result;
select is(public.marketplace_accept_supplier_invite(
  'f1100000-0000-4000-8000-000000000004', 'design@example.test', repeat('4',64)
)->>'role', 'viewer', 'a design editor can independently join Marketplace as a viewer');
create temporary table duplicate_member_invite as select public.marketplace_create_supplier_invite(
  'f1100000-0000-4000-8000-000000000001', (select supplier_id from teams), 'design@example.test', 'manager', repeat('5',64)
) as result;
select throws_ok($$select public.marketplace_accept_supplier_invite(
  'f1100000-0000-4000-8000-000000000004', 'design@example.test', repeat('5',64)
)$$, 'P0001', 'MARKETPLACE_MEMBER_EXISTS', 'accepting a second invite cannot overwrite a current role');
select throws_ok($$select public.marketplace_revoke_supplier_invite(
  'f1100000-0000-4000-8000-000000000003', (select other_supplier_id from teams),
  (select (result->>'id')::uuid from duplicate_member_invite)
)$$, 'P0001', 'MARKETPLACE_INVITE_INVALID', 'revoke cannot cross supplier boundaries');
select is(public.marketplace_revoke_supplier_invite(
  'f1100000-0000-4000-8000-000000000001', (select supplier_id from teams),
  (select (result->>'id')::uuid from duplicate_member_invite)
)->>'id', (select result->>'id' from duplicate_member_invite), 'manager can revoke a pending invite');
select throws_ok($$select public.marketplace_accept_supplier_invite(
  'f1100000-0000-4000-8000-000000000004', 'design@example.test', repeat('5',64)
)$$, 'P0001', 'MARKETPLACE_INVITE_INVALID', 'revoked token cannot be used');

create temporary table design_removed as select public.marketplace_remove_supplier_member(
  'f1100000-0000-4000-8000-000000000001', (select supplier_id from teams), 'f1100000-0000-4000-8000-000000000004'
);
select is((select role from app_private.workspace_members where workspace_id=(select workspace_id from teams)
  and user_id='f1100000-0000-4000-8000-000000000004'), 'editor', 'Marketplace removal preserves prior design access');

insert into app_private.workspace_marketplace_members (workspace_id,user_id,role)
select workspace_id,'f1100000-0000-4000-8000-000000000005','viewer' from teams;
create temporary table invite_before_legacy_removal as select public.marketplace_create_supplier_invite(
  'f1100000-0000-4000-8000-000000000001', (select supplier_id from teams), 'legacy@example.test', 'staff', repeat('d',64)
) as result;
delete from app_private.workspace_members where workspace_id=(select workspace_id from teams)
  and user_id='f1100000-0000-4000-8000-000000000005';
select is((select count(*)::integer from app_private.workspace_marketplace_members
  where workspace_id=(select workspace_id from teams) and user_id='f1100000-0000-4000-8000-000000000005'), 0,
  'deleting a legacy workspace membership still cascades its linked Marketplace role');
select throws_ok($$select public.marketplace_accept_supplier_invite(
  'f1100000-0000-4000-8000-000000000005', 'legacy@example.test', repeat('d',64)
)$$, 'P0001', 'MARKETPLACE_INVITE_INVALID', 'legacy cascade also records a cutoff for earlier invites');
create temporary table revoke_stale_legacy_invite as select public.marketplace_revoke_supplier_invite(
  'f1100000-0000-4000-8000-000000000001', (select supplier_id from teams),
  (select (result->>'id')::uuid from invite_before_legacy_removal)
);

insert into app_private.supplier_team_invites (supplier_id,email,role,token_hash,created_by,created_at,expires_at)
select supplier_id,'legacy@example.test','staff',repeat('6',64),'f1100000-0000-4000-8000-000000000001',
       statement_timestamp()-interval '8 days',statement_timestamp()-interval '1 day'
from teams;
select throws_ok($$select public.marketplace_accept_supplier_invite(
  'f1100000-0000-4000-8000-000000000005', 'legacy@example.test', repeat('6',64)
)$$, 'P0001', 'MARKETPLACE_INVITE_INVALID', 'expired token cannot be used');
select is(public.marketplace_create_supplier_invite(
  'f1100000-0000-4000-8000-000000000001', (select supplier_id from teams), 'legacy@example.test', 'viewer', repeat('7',64)
)->>'role', 'viewer', 'an expired invite does not block a fresh invite for the same email');
select is(jsonb_array_length(public.marketplace_supplier_team(
  'f1100000-0000-4000-8000-000000000001', (select supplier_id from teams)
)->'invites'), 1, 'only the fresh pending invite is listed');

select * from finish();
rollback;
