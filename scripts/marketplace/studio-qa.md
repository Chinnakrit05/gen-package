# PackIt Studio local browser QA

These scripts run real routed React components in Chromium with synthetic API and Auth responses. They do not prove live Supabase, OAuth, database, production authorization, native Safari, or deployment integration. No real accounts or external mutations are used. Browser widths simulate desktop (1440), iPad portrait (834), and phones (390 and 320).

## Run

1. `node scripts/marketplace/studio-server.mjs --build`
2. `node scripts/marketplace/serve-build.mjs tmp/studio/build 56392`
3. `STUDIO_BASE=http://127.0.0.1:56392 node scripts/marketplace/studio-fixture.mjs`
4. `PACKIT_E2E_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node scripts/marketplace/studio-lifecycle.mjs http://127.0.0.1:56392/`

The build bypasses repository Vite config and environment files. It defines only fake public Cloud configuration and has no backend middleware. The browser fixture blocks non-local requests and intercepts API requests in memory. The default browser executable is Chrome on macOS; set PACKIT_E2E_CHROME to use another locally installed Chromium executable.

For feature-disabled route/navigation checks, build with `--build --feature-off`, serve `tmp/studio/build-feature-off` on 56393, and run:

`STUDIO_BASE=http://127.0.0.1:56393 STUDIO_FEATURE_OFF=1 STUDIO_CASES=projects,feature-off-factory,feature-off-admin STUDIO_WIDTHS=1440,390 node scripts/marketplace/studio-fixture.mjs`

Feature-off evidence is kept separately and does not overwrite normal screenshots.

## Coverage

- Buyer: projects, request list, new draft, details/supplier picker, confirmation, published receipt, empty/error/invalid states.
- Supplier: overview/onboarding, approved/draft profile and documents, team/invites, received request list/detail, invitation acceptance screen, public profile, quote notifications.
- Staff: supplier review queue, document expansion, reviewer MFA gate, permission denied.
- Entry: login, signed-out deep-link return target, not found.
- Permissions: viewer request/team navigation restrictions, outsider reviewer link absence, feature-disabled routes absent.
- Actions: selected supplier confirmation/back/publish, quote mark-read, review-document expansion. Writes reach only the in-memory fixture.
- Drawer: repeated Tab, Escape and focus restoration, close button, backdrop click, route change, browser Back/Forward, content focus retention, reload.
- Existing 33 Phase 1 lifecycle assertions: lazy loading, pagination, exact editor ID, invalid/missing IDs, idempotent creation/retry, save-before-navigation/debounce recovery, workspace isolation, offline/error recovery, refreshed/expired auth token handling.

The Studio lifecycle copy changes only selectors scoped to project titles and the redesigned workspace control. The original harness remains untouched.

## Outputs

- `tmp/studio/qa-results.json`: route/state/responsive and action results.
- `tmp/studio/screenshots/index.html`: normal feature-enabled screenshot gallery.
- `tmp/studio/feature-off-results.json` and `tmp/studio/screenshots-feature-off/`: feature-disabled evidence.
- `tmp/studio/phase1-built-regression.log`: lifecycle output.

Optional STUDIO_CASES selects comma-separated scenario names; STUDIO_WIDTHS selects widths; STUDIO_SKIP_INTERACTIONS skips action scenarios. STUDIO_REPORT changes the JSON report path. STUDIO_DRAWER_ONLY skips publication/document actions. For diagnostics only, STUDIO_NATIVE_FOCUS permits the native Chromium dialog cycle through browser chrome (BODY is active while the dialog remains modal) and requires the next Tab to return inside. Strict default testing does not permit that excursion.

## Limits

The only current staff route is `/admin/suppliers`. Orders, conversations, additional admin pages and a separate `/auth/callback` route are not implemented routes in this checkout and are not fabricated by the redesign or fixture. Editor functionality is covered by the lifecycle fixture, but Editor V1/V2 is intentionally not reskinned by these Marketplace styles. Synthetic status/permission outcomes validate frontend behavior only, not backend authorization enforcement.
