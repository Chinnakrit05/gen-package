# Marketplace commerce: local implementation and operations

This describes the isolated Studio worktree implementation. It does not authorize deployment, remote migrations, or real communications. Payments remain external records only; PackIt does not charge, transfer, refund, or verify a bank transaction.

## Data and policy

- `017`: one quotation per request–supplier, editable draft plus immutable sent revisions. Every sent revision pins the exact public request revision. Manager can send/withdraw; staff can prepare a non-binding draft; viewer can only read. Buyers never receive a supplier's unsent draft.
- `019`: immutable accepted terms and request snapshot; one pending/active/completed production order per request; proof versions and approvals, external payment reports and supplier acknowledgements, exact order/file grants.
- `021`: original private draft and first publication retained unchanged. Follow-up public specs create immutable revisions. Supplier detail/publication APIs expose the current revision; old quotes cannot be selected or confirmed against a newer spec.
- `022`: transactionally persisted, deduplicated commerce outbox and user-specific read receipts. Notifications contain no quote amounts, message text, files, or payment references. Losing suppliers receive only their own request-awarded notification, not the winning supplier/order identity.
- `023`: supplier confirmation rechecks the exact selecting buyer's active ownership, not just the current supplier actor. Proofs are capped at 50 and payment reports at 100 per order.
- `024`: specification history pagination, 24 records per page. The current revision is returned separately from history.
- `026`: notification access works for Marketplace-only invitees without granting Editor/design membership; preserves legacy supplier-request not-found behavior.

Buyer access is deliberately the existing personal-workspace owner model. Do not describe this implementation as supporting delegated buyer business managers/staff. Supplier Marketplace roles are independent of Editor roles. New business requires an approved supplier, while current authorized members retain existing fulfillment-order access after supplier suspension. Account suspension or member revocation is checked on subsequent API operations, including operation-ID retries.

Policy defaults, not user-specified business terms: THB integer satang; 72-hour supplier confirmation deadline frozen per order; initial request acceptance window 30 days; an explicit new spec revision can set acceptance within the next 90 days; price validity at most 365 days. A revised request cannot overwrite a pending/active agreement. Decline, cancellation or pending expiry reopens bidding only while its acceptance deadline is still future. A buyer may explicitly publish another revision to reopen an otherwise closed request when no active agreement exists.

Start production requires approval of the latest proof when the accepted terms require proof, plus supplier acknowledgement of external payment reports totaling at least the accepted deposit. A report is not proof that money moved. Reports cannot exceed the agreed total. Consequential actions require manager/owner and expected order revision; retries bind actor, operation ID and exact payload.

## Immutable request preview

Migration027 copies an actual saved JPEG/WebP thumbnail of at most64 KiB during the first publication only. It validates the signature, omits corrupt/missing thumbnails without failing publication, and never backfills already-published requests from a later mutable image. Frozen bytes have no foreign key to the mutable Editor thumbnail, so overwrite/deletion does not change the public specification reference.

Legacy thumbnails do not record the image's source project revision. Accordingly `sourceProjectRevision` is null and the first spec labels the image `unverified_reference`, even when the current project revision equals the frozen draft revision. Metadata separately records the frozen draft's project revision, current project revision at capture, thumbnail update time, capture time and original public spec ID. Revised specs label the same retained bytes `original_reference`; they never invent an updated visual. Order preview resolves the accepted quote's exact request revision, not the current Editor image. Private buyer/supplier/order APIs recheck current permissions and return bounded bytes, not public URLs. Support does not acquire preview access merely by being staff.

## Files and retention

Production proof and payment attachments use private conversation uploads but acquire a separate order/file grant when referenced. The counterparty downloads through the order endpoint; unsent uploads do not become blanket chat attachments. Foreign keys pin exact conversation/file identity. No public URL or storage bucket is introduced. See `CHAT-OPERATIONS.md` for byte limits, signatures, aggregate quotas and Realtime revocation behavior.

Messages, original specs, sent quotes, accepted terms, proof versions, approvals and payment records are not silently edited or deleted. Production deployment needs an explicit retention/backup policy. No unrequested remote retention job or deletion schedule has been configured.

## Operational recovery

The service-only `marketplace_drain_commerce_notifications(p_limit)` processes up to 100 pending events using locked, deduplicated rows. Inbox reads also drain a bounded batch. `marketplace_retry_conversation_notifications(p_limit)` retries at most 100 persisted chat invalidations and returns dispatched/failed counts. Realtime dispatch is not confirmation of client delivery; authorized API history is the source of truth.

The scoped, MFA-protected Admin maintenance endpoint added in migration `025` is the operator entry point for bounded exception handling. It must log reason and operation ID. The production operator still needs to configure monitoring and a supported scheduler in an explicitly authorized deployment. Until then, unread persisted data is recovered through inbox/history polling and manual audited maintenance, not through an implied background service.

Use the dedicated loopback stack `tmp/marketplace-phase7-local` only. Test scripts enforce its project ID and API/DB ports (55431/55432). Never point these fixture/restore scripts at another local stack or a remote database. Do not print or commit runtime status output, auth sessions, fixture credentials, or tokens.

## Verification records

- `npx tsc --noEmit`: passed after verifying migration024's contract, schema, repository and HTTP routing edits were completely saved.
- `vitest run server/http/commerce.test.ts server/http/marketplace.test.ts server/http/conversations.test.ts --configLoader native --cache false`: 29 tests passed again on current source after migration026 and lifecycle additions.
- `PACKIT_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres vitest run --configLoader native --cache false --config vitest.db.config.ts tests/integration/commerce.lifecycle.test.ts`: 7 real PostgreSQL tests passed with migration027. All fixtures and changes rollback; verifies deadline reopening/closure, expired-selection replacement, latest proof approval/version retention, private downloads, invitee notification access, losing-supplier redaction and membership revocation, plus preview-byte immutability, honest stale provenance, no retroactive capture, corrupt-image omission,64 KiB cap, revised-spec reference labeling and order access.
- Independent concurrency/admin evidence and HTTP/browser/restore evidence are maintained by the audit/integration workers. Do not infer their final acceptance from these unit or transaction tests.
- `scripts/marketplace/phase7-commerce-history.mjs` is a separate real HTTP acceptance script for 26 public revisions, 24+2 pagination, quote-history immutability, stale selection refusal and notification pagination/read receipts. It creates a new synthetic RFQ, never alters the browser fixture RFQ. Executed successfully against real local HTTP/Auth after026: all listed assertions passed, including outsider history/read denial, changed-payload retry conflict and current supplier spec. Its separate synthetic RFQ remains in the isolated stack; browser fixture objects were not modified.

Remaining release gates: current-source full tests/build, final real browser/device flow, final restore fingerprint, operator procedure/scheduler/retention review, and separately authorized staging deployment. Local readiness is not staging or production acceptance.

Preview HTTP acceptance: `node scripts/marketplace/phase7-preview-http.mjs tmp/marketplace-phase7-local` passed with real Auth/API, actual saved JPEG bytes, private buyer/supplier access, overwrite/deletion survival, revised-spec reference and accepted-order preview. It creates a separate synthetic project/request/order and writes only fixture IDs for browser follow-up, not credentials. Current TypeScript passed after027; browser preview display is a separate frontend acceptance gate.
