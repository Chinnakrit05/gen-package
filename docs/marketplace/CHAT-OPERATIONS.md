# Marketplace chat operations and verification

Implementation: migration `20261108001800_marketplace_conversations.sql`, `shared/contracts/conversations.ts`, dedicated conversation HTTP/repository modules. These are local implementation results, not staging/production approval.

## Access and persistence

- One conversation per published request–supplier grant, preserved through the production-order lifecycle. Creating a new conversation requires an approved supplier. Suspending a supplier does not erase access to an existing fulfillment conversation.
- The current buyer workspace owner and current supplier Marketplace members can read. Buyer, manager and staff can send; viewer cannot send/upload. Platform support/reviewer status alone grants no access.
- Every API read, file download, mutation and retry checks current active-user and membership state. Linked legacy design memberships cascade Marketplace-role removal through migration 011's generated foreign key. Invitees are intentionally independent of design workspace membership.
- Messages, file bytes and message/file grants are immutable to the server role. Sending under an existing operation ID returns the same message only when actor, body and sorted attachment IDs match. A revoked actor cannot replay an earlier successful operation.
- Message sequence increments under a conversation row lock, so concurrent sends and backward pagination have a stable order. Read cursors are actor-specific and monotonic.

## Files

PDF/PNG/JPEG uploads are limited to 2 MiB each, 3 attachments per message, 50 files per room and 100 MiB across all rooms of a buyer workspace. Both file name/extension and byte signatures are checked. The workspace total is protected by a workspace advisory lock before the room lock, not just by a UI check.

Bytes are stored in private PostgreSQL tables, following the existing review-document pattern. There are no public buckets or durable download URLs. An unsent upload is private to its uploader. A committed message/file link shares it with current room participants. A production proof/payment reference needs its own exact order/file grant and current-order permission check; the helper `marketplace_order_conversation_file` validates context, not blanket sharing.

These are conservative pilot limits, not user-specified business policy. Unsent uploads count toward limits. Automatic retention/deletion is not configured; an authorized operator must review abandoned-file retention before growing beyond the pilot. Do not delete a file referenced by a message, proof, or payment.

## Private Realtime and revocation

Clients subscribe to the exact private `marketplace:conversation:<id>` topic returned by the API. The `changed` event is only an invalidation hint. Its authored payload is empty; the installed Realtime transport may add a random message ID. It carries no message body, file, quote, sender or financial content. Clients always reload authorized API data.

The subscription policy resolves the JWT issuer and subject to an active application user and current room membership. It grants no client send permission. Existing socket authorization may be cached after membership revocation, so it is not an immediate server-side disconnect mechanism. The frontend must periodically revalidate active-room access (target about 15 seconds while active), revalidate on focus/reconnect, clear private caches and unsubscribe on 403/404, and clear data on account/context change. Background/offline timer throttling means the interval is not a hard wall-clock guarantee. Do not present cached private content on foreground before revalidation.

## Outbox retry

The message, its file grants and outbox row commit together. A successful dispatch marks `dispatched_at`, meaning enqueued to Realtime, not confirmed client delivery. A dispatch exception is caught; the message remains persisted and the outbox retains a null dispatch time, attempt count and SQLSTATE only. Raw exception contents are not stored.

The service-role-only RPC `marketplace_retry_conversation_notifications(p_limit)` retries at most 100 pending rows using `FOR UPDATE SKIP LOCKED`. An operations worker should call it periodically and monitor the pending count/age and failures. No remote scheduler has been configured by this implementation. Reconnect and periodic API polling still recover persisted messages if a notification is missed. Operator-managed outbox retention remains a deployment checklist item.

## Verified locally

Dedicated Supabase stack: `tmp/marketplace-phase7-local`, loopback DB port 55432. No remote migration or data change.

- `supabase test db supabase/tests/database/0018_marketplace_conversations.test.sql --local --workdir tmp/marketplace-phase7-local`: **47 assertions passed**, including roles, visibility, idempotency, current-permission revocation, issuer-specific Realtime authorization, files, pagination, read cursors, both storage caps, and dispatch failure/retry.
- Failure test injects a synthetic transport exception at the application's own dispatch seam inside a rollback-contained transaction. It does not modify the managed Realtime schema. Actual transport/HTTP coverage is tracked by the integration worker separately.
- `PACKIT_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres npx vitest run --configLoader native --config vitest.db.config.ts tests/integration/conversations.concurrent.test.ts`: **5 passed**, using concurrent real database sessions and service-role mutations. Twelve concurrent ensure/send retries produce one room/message; independent sends produce contiguous sequences; late read receipts cannot regress; revocation denies retry/read.
- `npx vitest run --configLoader native server/http/conversations.test.ts`: **10 passed**.
- `npx tsc --noEmit`: passed after integration with current worktree.

The first concurrency cleanup attempt omitted new migration 021 request-revision foreign keys. Cleanup was corrected, the full suite reran successfully, and the exact leftover synthetic fixture was removed. These results do not establish mobile/browser, cloud reconnect, scheduled retry, retention or remote restore readiness by themselves.

## Shared route context

Migration029 returns an authoritative optional-compatible `Conversation.side` field. The migrated API always sends buyer or supplier, derived from `marketplace_conversation_role`, with buyer ownership taking precedence when an actor also belongs to the supplier. Frontend navigation should use that returned context and must not infer the party from membership lists. The helper uses current role locks and is marked volatile accordingly. Real rollback-contained lifecycle tests verify buyer, manager, staff, viewer and dual-role cases;8 lifecycle tests and10 conversation HTTP tests passed after029.

## Additional local cross-room quota concurrency — 9 November 2026

`tests/integration/conversations.quota.concurrent.test.ts` passed on the verified isolated PostgreSQL stack at loopback DB55432. At 99 MiB of actual stored bytes across two rooms in the same buyer workspace, two real upload RPCs were observed waiting concurrently at the workspace advisory lock. Exactly one 1 MiB upload succeeded and the other returned the quota error; both declared and actual byte totals were exactly 100 MiB. Six same-operation retries, a changed-payload rejection and repeated over-cap attempts added no files or bytes. An intentionally rolled-back upload restored capacity, and a previously rejected operation succeeded only after synthetic capacity was freed. Fixtures were cleaned; TypeScript and diff checks passed.

Evidence: `tmp/marketplace-phase7-local/quota-concurrency.log`, displayed runner start time 11:47:25. Command: `PACKIT_TEST_DATABASE_URL=<local55432> node node_modules/vitest/vitest.mjs run --configLoader native --cache=false --config vitest.db.config.ts tests/integration/conversations.quota.concurrent.test.ts`. No remote operations or runtime changes. Unsent uploads still consume quota; automatic abandoned-file reclamation/retention remains unverified.
