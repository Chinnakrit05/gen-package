# Phase 7 staging rollout and pilot gates

Prepared 9 November 2026 UTC. This is a runbook, not authorization for remote changes. Current execution is recorded in [STAGING-EXECUTION.md](STAGING-EXECUTION.md): staging upgrade and protected Preview are deployed, Google login/read-only landing checks passed, while full remote transaction/pilot acceptance remains incomplete. The remaining sections preserve the rollout gates and historical preparation evidence. See [PHASE-7-ACCEPTANCE.md](PHASE-7-ACCEPTANCE.md).

## Verified target and current blockers

Read-only inspection on 8 November, with project health/history refreshed on 9 November, confirmed:

- Supabase `gen-package-staging`, ref `feuwdzgixarxpsscrwxp`, organization `xbevtlzmeoojfvsrvkng`: `ACTIVE_HEALTHY`.
- Applied history: 001–008 and 010–015. **009 and 016–029 are absent.** Catalog checks confirm 009's quota table, project-byte column/constraint, functions and triggers are genuinely absent, not merely missing history.
- `https://packit-design.vercel.app` root/health respond; new `/api/v1/admin/context` returns 404. `https://gen-package-staging.vercel.app` redirects to this existing app.
- Backup metadata via existing authenticated CLI on 9 November returned no listed restore point (`backups:null`, empty physical-backup data), with PITR disabled. WAL-G being enabled does not prove a recoverable snapshot. Last-success timestamp and retention are unverified. Browser Supabase Dashboard is signed out; no login was attempted.
- Read-only Auth configuration confirms Site URL `https://packit-design.vercel.app`. Allowed redirects are local `127.0.0.1:5173` and `localhost:5173`, the old staging/public domains, and one existing integration Preview (`https://gen-package-staging-git-codex-mar-442afb-chinnakrit05s-projects.vercel.app`). A new Studio Preview origin is not yet verified/allowed. CLI `config diff --project-ref … --output-format json` exposed only the selected URL fields; no provider secret was revealed and no setting changed.
- Studio worktree is unlinked. No project link, remote schema, deployment, role, account or configuration was changed.
- Read-only signed-in Safari verification on 9 November: [Vercel project chinnakrit05s-projects/gen-package-staging](https://vercel.com/chinnakrit05s-projects/gen-package-staging), Ready deployment `Ad2QnUkDBWwHXU9m6eMonZB4jybM`, `main` at `0f108942638fdf7d924c2bdb9bc8596be78bd2e1`. The public alias is the **Production slot**; pushes to main update it.
- Separate branch Preview deployments exist, but current Preview environment overrides apply only to `codex/marketplace-phase-1-integration`. A Studio branch Preview will need its own applicable configuration; no shared variables are linked. Production-only names include `VITE_MARKETPLACE_SUPPLIERS_ENABLED` and `ANTHROPIC_API_KEY`. No values were revealed and no settings changed.

A Preview using the existing staging database still shares data/schema with the current app. The public alias is not a disposable isolated test environment merely because the project is named staging. Do not copy real account records, files, sessions or credentials into fixtures.

## Read-only preflight

```sh
npm run staging:readiness
node --test scripts/verify-staging-readiness.test.mjs
```

The tool targets the exact known staging project using existing authenticated CLI access, without linking the worktree. It validates project identity and distinguishes historical gaps from tail migrations. CLI 2.117.0 returns a text migration table despite `--output json`; strict parsers support this and valid JSON and reject ambiguous output. It never calls push, repair, reset or link.

Current expected result: **BLOCKED, exit 1**, listing 009 and 016–029. This is a correct readiness result, not a failed mutation. Evidence: `tmp/marketplace-phase7-local/staging-preflight.log` and refreshed `staging-preflight-20261109.log`. Committed bucket/Auth checks describe local configuration, not live provider settings. Even a future metadata pass does not verify remote SQL contents, OAuth, deployed private Realtime, backups, devices or pilot readiness.

## 1. Freeze and prove the populated upgrade

- Preserve working-tree files and generated API with a hash manifest. HEAD `0f10894` is only the base, not a commit containing this uncommitted implementation.
- Existing local acceptance migration-set SHA-256: `7cd70e922c39d76b77c70fea86d1a0c00a61d34f4665ba1a117094b6bed37621` for 001–029.
- Rehearse actual remote order in a **new disposable local database**: 001–008 and 010–015, preexisting synthetic project/supplier/published-request records, then 009 and 016–029. Compare bytes, snapshots, memberships and old API behavior. Clean install success alone does not prove this upgrade.
- Populated rehearsal **PASS** on 9 November in `tmp/marketplace-upgrade-local`, project `packit-marketplace-upgrade-local`, API 55541 / DB 55542. Applied 009, then 016–022, seeded a pending order, then 023–029. Existing Thai project JSON bytes/revision/updated_at and frozen published RFQ were preserved. Migration 023 backfilled the exact selecting buyer and preserved order terms/status. Retained phase7 and other developers' stacks were untouched.
- Historical **currently deployed 0f10894** generated API served real local Auth/read checks before/after upgrade. Post-upgrade bounded writes also passed: project CAS save, same-payload retry, stale/changed-payload 409; RFQ draft creation/retry/publication/retry; later project edits left the published spec unchanged; document-byte accounting stayed correct. Evidence: `tmp/marketplace-upgrade-local/{result.json,write-result.json,check.log,write-check.log}`. Servers stopped, dedicated stack retained.
- Additional independent operations concurrency tests passed 2/2 on the retained isolated phase7 database, with synthetic cleanup and maintenance effects rolled back. New file: `tests/integration/operations.concurrent.test.ts`. No remote effects.
- Preparation checks passed: full unit 1,618 tests with 6 existing skips, TypeScript, script syntax, 19 readiness-parser tests, 64 deployment-routing cases and diff whitespace checks. Full regression log: `tmp/marketplace-phase7-local/staging-prep-unit-tests.log`.
- The old bundle is now matched to the verified deployed commit, but its local smoke does **not** prove old-browser/Vercel-runtime compatibility or unexercised deletion, upload, billing and other writes. Validate those required paths before treating application rollback as generally safe.

## 2. Authorize exact external changes

First verify the Vercel project, deployment ID/source, branch/slot and candidate URL. Prefer a separate Preview without replacing the current public alias.

The next external authorization must specify:
1. Upload/deploy the reviewed candidate to a separate Preview in the verified PackIt staging project, without changing production or replacing the current public alias.
2. Apply the reviewed **15 missing migrations: 009 and 016–029**, to Supabase `gen-package-staging` (`feuwdzgixarxpsscrwxp`), after populated-upgrade and backup checks. Migration 009 backfills existing project byte counts; it does not turn on the currently disabled Editor quota enforcement.
3. Which synthetic accounts/records may be created for staging acceptance, without using private existing records as test data.

This scope does not authorize source push/merge, paid resources, staff grants, new persistent/security access, production changes, data deletion or contacting pilot participants. Obtain exact target/scopes/origins when separate confirmation is required. Local tests and read-only inspection do not need a new permission request.

## 3. Backup and remote upgrade, not executed

- Verify recent recoverable backup and a non-destructive restore target. Include database, existing Editor Storage bytes, managed Auth/provider configuration boundaries and new private commerce bytes. Name recovery owner and recovery-time/data-loss objectives.
- Recheck migration history and actual objects immediately before applying anything. If drift appears, stop and reconcile. Never blindly replay 009 or mark absent objects as applied.
- Review dry-run against exactly 009 and 016–029. A historical gap may need explicitly reviewed include-all behavior. Never use remote reset or history repair as an upgrade shortcut.
- Apply only reviewed SQL to the confirmed target after authorization. On uncertain execution, inspect history/objects before retry. Do not publish credentials or private row contents in evidence.
- Recheck grants/RLS/constraints and old-app health/non-destructive existing-project access before moving to the candidate.

## 4. Candidate deployment and acceptance, not executed

- Node 24/npm 11, Cloud `npm run build`, never `build:local` for a hosted Cloud app.
- Verify variable names/scopes without printing secrets: `VITE_APP_MODE=cloud`, API base `/api/v1`, browser publishable key only, matching staging Supabase URLs, server-only secret, `APP_ENV=staging`, precise allowed origins and synchronized `VITE_MARKETPLACE_SUPPLIERS_ENABLED` build/runtime value. Do not copy local test keys or use development/test on shared remote apps.
- Verify exact Preview origin before any separately authorized Auth redirect/security setting change. Existing local/public login does not prove Preview login.
- Record immutable deployment ID and source identity. Test direct SPA routes, API JSON/auth/error boundaries, missing assets, private downloads and native Sharp packaging on actual Vercel. Local route tests are not Vercel evidence.
- Test OAuth return/deep links and fresh MFA enrollment/challenge with approved test accounts. Provision only named required staff scopes. Supplier ownership never grants staff privileges.
- Complete the synthetic buyer/two-supplier scenario before real commitments.

## Rollback and incident limits

`VITE_MARKETPLACE_SUPPLIERS_ENABLED=false` is a **complete Marketplace outage**, not a fulfillment-preserving intake pause. It removes existing order/chat/private-file/Admin UI and APIs. Frontend is build-time; backend reads runtime config, so they can disagree. Existing rows, deadlines and Realtime policies remain, and separately configured workers do not stop.

Before admitting real commitments, implement/test a way to stop new requests/selections while preserving existing fulfillment/support, or explicitly accept total downtime with an incident owner and deadline/recovery procedure. The selective pause is not present in this candidate. Do not call flag-off a zero-loss rollback.

Prefer validated compatible app rollback or forward fix. Migrations replace RPCs and add constraints/backfills; schema downgrade is not demonstrated. Restoring an earlier backup after new writes loses those transactions and requires separately authorized reconciliation. A flag/supplier suspension does not cancel accepted commercial obligations.

## 5. Operations, people and actual devices, not executed

Name incident/support owners; agree bounded notification retry/expiry cadence, backlog/failure alerts, quota/abandoned-upload policy, retention and backup objectives. No remote scheduler or retention job was configured. Manual maintenance is scoped and MFA-protected; do not store user sessions in cron.

Record deployment ID, migration manifest, roles, physical device/browser versions and evidence for:

1. Buyer publishes/revises frozen RFQ; two suppliers receive only their own access and send quotes. No buyer access to unsent quotes or supplier access to competitors.
2. Compare/select/bilateral confirmation; stale quote, double-click/retry, expiry/cancel/decline, one-order invariant, immutable accepted terms.
3. Private chat/files across reload and network failure; receipt/dedupe, membership revocation in existing/new sessions, real hidden-tab return, account/workspace switch, download denial.
4. Latest-proof and acknowledged external-deposit production gates; shipping/completion. Payment reports are records, not bank verification or money movement.
5. Fresh staff MFA, least privileges, assigned expiring support cases, reasons/audit, reversible moderation and maintenance; case expiry/scope withdrawal.
6. Actual iPhone/Android, iPad/Safari and desktop: navigation, focus/keyboard, direct links/back/refresh, Thai text, rotation, files, unsaved forms and degraded network. Emulated widths do not satisfy hardware acceptance.
7. Staging restore/open and incident rehearsal. Two local expiry/confirmation lock-order cases passed: confirmation holds its request lock through the deadline while maintenance skips it; expiry locking blocks a competitor that then rejects the expired attempt. The second maintenance transaction intentionally rolled back, so committed expiry/restart recovery and external operational behavior remain unproven. Cross-room quota concurrency and abandoned-upload policy remain open.

Approve a limited real-user pilot only after these gates. Neither passing local tests nor deploying the app completes phase7.
