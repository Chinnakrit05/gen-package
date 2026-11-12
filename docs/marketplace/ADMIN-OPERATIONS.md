# Marketplace Admin operations

Local implementation checkpoint. No production staff grants, deployment or scheduled worker has been created by this work.

## Separate responsibilities

The existing `platform_staff.supplier_reviewer` role only reviews suppliers. Marketplace ownership never creates a staff role. New scopes live in `app_private.marketplace_admin_grants` and are provisioned by an authorized database administrator, not by the application service role or browser:

- `operations`: dashboard, bounded metadata search, and audited maintenance.
- `support_supervisor`: create and close targeted, assigned support cases. Does not itself grant access to message or order contents.
- `support`: only assigned, open, unexpired case permissions. Every content or file read requires a reason and produces an audit event.
- `auditor`: audit history, not unrestricted underlying message/files/prices.
- `user_moderator`: bounded account search and reversible account suspension/resumption. It cannot modify its own account, platform staff, deleted accounts, or any role grants.

Grant only the roles a particular staff member needs after verifying the user ID, purpose and MFA readiness. There is deliberately no self-service grant endpoint and no default broad administrator. Do not grant operations/support to an entire supplier team.

All Admin HTTP endpoints except the scope-only context endpoint require a verified AAL2 session. Context reports whether MFA is needed but contains no operational or private case data. Roles and current account state are rechecked by the database for every action. Service-role invoker functions are not executable by browser roles; the narrow grant-check definer has an empty search path and fixed queries.

## Support privacy

A supervisor records a title, reason, explicit assignee, exact conversation and/or order, selected permissions and expiry no more than 24 hours away. If both objects are specified they must refer to the same buyer request and supplier. An assignee must currently hold support scope. File access is separate from message/order content access.

Case access does not expose another conversation, a competitor quote, or unsent file uploads. Downloads use newly authorized byte responses rather than long-lived bearer URLs. Closing a case, reaching its expiry, withdrawing support scope, or suspending the assignee blocks subsequent reads. A supervisor cannot read case contents merely because they created or can list the case.

## Account moderation

`GET /api/v1/admin/users?q=...` uses a name prefix or exact application-user UUID and returns at most 24 rows per page. It excludes emails, authentication subjects and credentials. The UI must require a deliberate confirmation and reason before `POST /api/v1/admin/users/:id/status`.

A status change supplies an operation ID and expected moderation revision. Repeating the same operation is safe; changing its body is rejected. Old revisions fail rather than overwrite a concurrent change. Only active and suspended are accepted target states. Suspension affects future authenticated application actions; it does not remove team membership, suspend a supplier, cancel a production order, or erase existing obligations. Those are different actions and must not be represented as equivalent.

## Exceptions and maintenance

`POST /api/v1/admin/maintenance` requires operations scope, fresh MFA, an operation ID and a reason. One run:

1. Examines up to 100 overdue pending supplier confirmations, using the same request-first transaction lock as selection/confirmation. Busy requests are skipped. Only genuinely overdue pending orders become expired, with a commerce event.
2. Drains at most 100 commerce notifications.
3. Retries at most 100 undelivered chat notifications and reports both dispatched and failed counts.
4. Records an immutable action receipt and audit reason.

The endpoint cannot force-confirm a quote, approve a proof, acknowledge money, change the frozen production agreement, or override a production gate. It returns actual counts, not an inferred success. Operators can investigate failures and repeat with a new operation after resolving their cause. Retrying an uncertain request uses the original operation ID.

No recurring maintenance or remote scheduler is configured. Deployment needs an explicitly authorized rollout, role provisioning and an operational owner. See `CHAT-OPERATIONS.md` for chat outbox details and `PHASE-7-ACCEPTANCE.md` for verified versus pending acceptance gates.
