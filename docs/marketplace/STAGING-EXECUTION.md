# Phase 7 staging execution — 9 November 2026

**Database upgrade and protected Preview deployed. Google sign-in, existing staff MFA and read-only access-boundary checks passed. Full authenticated transaction/pilot acceptance is still incomplete.** This record supersedes the earlier pending staging steps in STAGING-ROLLOUT.md, not the scope limits in PHASE-7-ACCEPTANCE.md.

## Exact destinations and preserved boundaries

- Supabase: `gen-package-staging`, ref `feuwdzgixarxpsscrwxp`.
- Protected Preview: https://packit-studio-preview-chinnakrit05.vercel.app
- Current Preview deployment: `dpl_FtYFPS6CaarKAb3GE8avEJL4dgah`.
- Immutable URL: https://gen-package-staging-8p49w2jb5-chinnakrit05s-projects.vercel.app
- Existing public deployment remains `dpl_Ad2QnUkDBWwHXU9m6eMonZB4jybM`, main commit `0f108942638fdf7d924c2bdb9bc8596be78bd2e1`. Its code, aliases and environment configuration were not changed. The explicitly approved staging database is shared with that app and was upgraded as recorded below.
- No Git commit, push or merge occurred. Original notification worktree's 14 inherited files still match the saved baseline byte for byte.

The source was uploaded only to the approved Vercel project, not to the dot cloud computer or a VPS. Private database backups, sessions and environment files were excluded from upload. Anonymous Preview visitors still receive Vercel SSO protection; no bypass token or broader sharing was created.

## Migration and recovery evidence

Applied exactly 15 pending files: 009 and 016–029, with explicit project ref, `--include-all` for the historical 009 gap, `--skip-vault`, and no seed/role application. All 29 migration versions are now present. Reviewed source migration-set SHA-256:

`7cd70e922c39d76b77c70fea86d1a0c00a61d34f4665ba1a117094b6bed37621`

Before applying, one consistent custom-format pg_dump archive was restored into a new container with no network or published ports. All 36 archived application/public/ledger tables matched their private row counts/hashes and affected constraints validated. A second restored copy successfully applied all 15 migrations and preserved original data projections. Independent review cleared this **migration-scoped recovery** gate.

- Snapshot window: 2026-11-09 03:26:56–03:27:12 UTC.
- Archive: 1,401,174 bytes; SHA-256 `e3faf384e78fd18e721eea32063b8f4bbd21ad245139bfadde21d31168f7d055`.
- Private recovery evidence: `tmp/staging-recovery-20261109/`; do not upload or attach its data files.
- Recovery covers the affected application schemas, definitions, ACLs and migration ledger. Rollback must also remove the newly added Realtime policy. Unchanged Auth data/configuration, Storage bytes/metadata and transient Realtime data are excluded; this is not whole-Supabase disaster recovery.
- Recovery returns to the snapshot. Later writes require reconciliation; zero-loss rollback is not claimed.

After the real staging apply, all 35 original business-table projections were unchanged; only migration history changed. Checks found zero invalid constraints, document-byte mismatches or exposed Marketplace tables. The expected private Realtime policy exists and no new Admin grants were created. The existing public root/health remained successful. Recovery container was stopped with data/archive/evidence retained; credential-bearing temporary helpers were removed.

## Preview source and configuration

The deployment uses base `0f10894` plus the verified 130-file local overlay, not an unmodified checkout of that commit. Complete staged source: 605 files, tree SHA-256:

`bcc350dc616e63f67fbe541e369d9311381a207538671ef9a69b312e79949b1c`

Reviewed upload inventory: 603 files / 9,470,899 bytes, with no backup, tmp, environment, session, node_modules or Git contents. Source overlay manifest SHA-256:

`458e3b51545f177922d5ecdb36c9539361dd6359f63199afad0a45c2b198a50f`

The local branch is not on remote Git, so Vercel rejected branch-level environment creation without making a change. Configuration was instead limited to the approved Preview deployment itself. The existing staging server key was reused after specific user approval; no key was generated/rotated, no Production or broad Preview variables changed, and no Anthropic key was copied. Initial origin configuration denied writes until the exact protected alias was established. The final allowed app origin is only the approved alias.

Supabase Auth gained exactly that alias as one additional redirect: six total, original five retained. Site URL remains `https://packit-design.vercel.app`; Google provider settings were not changed.

## Configuration defect found and corrected

Supabase CLI 2.117.0 returned a Unicode-middle-dot masked `sb_secret_` value without `--reveal`. An ASCII-only mask check initially missed it. Provider validation demonstrated 401 for the masked value and 200 for the supported explicitly revealed existing key. Only Preview configuration was corrected; source code was unchanged. Temporary plaintext key payloads were removed afterward.

Future deployment checks must reject masking/non-key characters for the known key format **and verify a safe provider read**, rather than trust a prefix or string length. Do not print keys, put them in command-line arguments, include them in source, or use a VITE-prefixed variable for a server credential.

An independent local build using fake sentinels scanned 234 emitted frontend files: zero server-secret sentinel or `SUPABASE_SECRET_KEY` matches, and one expected public-key sentinel match. Evidence: `tmp/server-key-isolation/result.json`. This checks the real build pipeline; it is not a byte-level scan of the hosted deployment with a real secret.

## Verified remote behavior and remaining work

Passed:
- Protected alias and API health through the existing Vercel-authenticated Safari session.
- Deep-link return target, private API JSON auth denial, unknown API 404 and missing-asset 404.
- Fresh Google sign-in after configuration correction, returning to the saved orders route. One intervening Google 400 did not persist on a fresh flow; no provider change was needed.
- Authenticated orders, RFQs and chat show honest empty states in the current user's workspace.
- Existing staff MFA succeeded after the user entered the code directly and remained valid after a full route reload. The supplier-review queue loads with no pending profiles.
- `/admin`, `/admin/users` and `/admin/support` deny the current account because it lacks their scopes. Only supplier review is advertised; no approval/rejection or scope grant was performed.

Not yet passed:
- Deployed quotation/chat/file/order/proof/payment/support workflows with verified synthetic counterparties.
- Expanded staff positive workflows need separately authorized test scopes; current access is supplier review only.
- Real-user pilot, physical phone/tablet testing, operational scheduling/retention and full platform recovery.

No actual business messages, quotes, orders, payments, approval/moderation actions or new account/role grants were performed. Normal login/session and application bootstrap activity occurred during the approved test. Keep testing separate from real counterparties and obtain any specific account/privilege authorization that is still required. Do not claim phase 7 complete from this checkpoint.

## Synthetic transaction test preparation

Read-only reserved-domain checks found no clearly identified synthetic Auth accounts, app users or supplier contacts. Older progress references synthetic staging suppliers, but the cited temporary evidence is absent from this worktree and current narrow test-label checks found no attributable reusable IDs. This does not prove historical fixtures never existed or were removed. Never classify an ordinary-domain account as synthetic without supporting provenance.

If no reusable authorized fixtures can be verified, the minimum core transaction setup is a dedicated buyer and two supplier-manager test accounts, their workspaces/profiles, and clearly labeled synthetic RFQs, quotes, chat/files and orders. The existing MFA reviewer can approve only those test suppliers after that action is authorized. Core transaction testing does not require new platform-admin scopes. Creating credentials/persistent test access and optional expanded Admin scopes needs specific approval. Do not point the loopback-only local fixture runner at staging or run global maintenance against unrelated staging data.

The user explicitly approved creating three labeled staging accounts (buyer and two supplier managers), their workspaces/profiles, approving only those two suppliers, and synthetic RFQ/quotation/chat/file/production-order tests. No broad staff grants or real counterparties are authorized. Setup is paused before mutation while the user signs into Vercel normally in a separate test-browser window. The existing Safari reviewer session is preserved; no protection bypass token or copied real session is used.

Staging email confirmation is enabled. Reserved-domain synthetic accounts need narrowly scoped administrative creation with `email_confirm:true`, not provider-setting changes or real email delivery. This setup is not email-delivery acceptance. Credentials must remain transient and private, with a separate non-secret fixture ownership manifest. No new accounts, profiles or grants exist at this checkpoint.

## Protected synthetic-test access checkpoint

Normal Safari remains signed into the approved reviewer account, but isolated test access is not yet established. With explicit user approval, Safari remote automation was temporarily enabled and an official isolated test session was created. Safari automation blocks manual input; taking manual control ends the driver connection, so that is not a workable manual-login handoff. Vercel later reached its genuine six-digit email OTP page and the matching message arrived, but the mail connector exposed only a protected handle and no supported handle-fill tool was available. No alternate format or route was used to reveal the code; it was not entered or saved.

The owned test session was ended and Safari remote automation was verified OFF again. The non-secret session ledger records baseline OFF, currentVerified OFF and restoreRequired false. Existing normal Safari reviewer and Chrome windows were preserved. No test Auth accounts, profiles, grants or transaction records were created. Further test access needs a supported handoff route; do not weaken Preview protection, copy real sessions or create a bypass credential without specific approval. A properly controlled temporary Chrome session can support manual login, subject to the user accepting that alternative to their Safari preference.

## Hosted transaction acceptance through Safari — 12 November 2026 ICT

The protected alias was verified before and after the run against deployment `dpl_FtYFPS6CaarKAb3GE8avEJL4dgah`. Safari carried the requests using its existing Vercel sign-in. PackIt requests used ten dedicated synthetic accounts with per-role tokens held in memory. This checkpoint covers hosted API workflows. Interactive UI evidence is recorded separately in the local acceptance and earlier authenticated Preview checks.

- The buyer published one frozen RFQ to two approved test suppliers and compared two sent quotations. Supplier drafts, the source project, and the other supplier's details stayed private.
- Each supplier had a separate conversation. The buyer and selected supplier exchanged messages and an attachment, verified the file bytes and read state, and reused the room after accepting the quotation.
- One order reached `completed` after supplier confirmation, proof approval, simulated transfer reporting and acknowledgment, production and shipment. Negative tests rejected premature production and access by the unselected supplier.
- Separate supplier-reviewer, operations, support-supervisor, support, auditor and moderator accounts exercised their own permissions. Tests checked AAL1 denial, AAL2, exact supplier approvals, metadata-only operations access, assigned-case file access, case closure, moderation and denial after support scope revocation. Global maintenance coverage remains in the isolated local tests.
- An independent read-only staging query confirmed the completed order, two quotations, two conversations, one proof approval, one transfer acknowledgment and two closed support cases. The run's ten synthetic accounts and scoped records were removed after reviewing the cleanup plan.

The release source combines the Studio overlay with main `c8cdf2b`. Cloud build, TypeScript and the combined Vitest suite passed with 1,637 tests passing and six existing skips. Physical-device acceptance and a real-user pilot remain separate phase 7 work.
