# Blackbaud Next Planning

## Current State

Blackbaud Next has been rewritten into a mode-based Chrome extension:

- `original`: no changes to native Blackbaud.
- `enhanced`: current Blackbaud Next native UI enhancements.
- `next`: extension-mounted Next Beta React app.

The first Next foundation exists:

- Vite + React + TypeScript app in `apps/next-extension`.
- Static build output in `chrome/dist/next`.
- Shadow DOM mount via `chrome/src/next/host.js`.
- Bridge actions for bootstrap, session refresh, and native visibility toggle.
- `/api/webapp/userstatus` connectivity verified manually.

## Cleanup Path

1. Keep `native-enhancements/` as the home for native Blackbaud UI patches.
2. Use root-level commands for routine checks and builds.
3. Decide whether `chrome/dist/next/` remains committed release output or becomes package-time generated output.
4. Add a short manual smoke checklist to `README.md`.
5. Add automated checks for manifest references and content-script syntax.

## Next Phase 1: Host Reliability

Goal: make Next safe to mount on real student sessions before adding product surface area.

Work:

- Confirm Next mount on legacy and SKY routes.
- Confirm native fallback when the Next bundle fails or API reads fail.
- Add route-change awareness for Blackbaud hash navigation.
- Add a visible fallback state inside Next when user status is unavailable.
- Add a minimal extension smoke test or repeatable manual test script.

Exit criteria:

- Normal, Enhanced, and Next Beta modes remain independently usable.
- Next never strands the user without access to native Blackbaud.
- Host bridge failures are visible and recoverable.

## Next Phase 2: Dashboard Lite

Goal: build the first useful Next screen without owning the full app.

Candidate data:

- `/api/webapp/userstatus`
- `/api/webapp/context`
- `/api/webapp/schoolcontext`
- My Day classes/activity groups from existing Next research

UI:

- App shell with sidebar and header.
- Session/account summary.
- Class summary.
- Small "open native" / "show native" affordance.

Exit criteria:

- Next provides useful at-a-glance information.
- Native Blackbaud remains available.
- All data access is same-origin with credentials.

## Next Phase 3: Data Source Layer

Goal: turn Blackbaud endpoint research into reusable extension data clients.

Structure:

- `chrome/src/sources/api/`: known same-origin endpoint clients.
- `chrome/src/sources/network/`: page-loaded request discovery and future payload bridge.
- `chrome/src/sources/dom/`: last-resort native DOM extraction.
- `chrome/src/data/normalize/`: stable Next models from raw Blackbaud data.

Rules:

- Use API sources first.
- Use observed network/page state only when API inputs are not independently discoverable.
- Use DOM extraction only as a fallback.
- Do not persist raw LMS payloads in sync storage.

## Next Phase 4: Route Ownership

Goal: let Next own routes one at a time.

Likely order:

1. Dashboard
2. Classes / course overview
3. Rosters
4. Assignments
5. Calendar
6. Messages / official notes
7. Directory / profile tools

For each route:

- Define "Next can own this route" conditions.
- Fetch and normalize required data.
- Render Next route.
- Keep native fallback.
- Add a route-specific smoke check.

## Open Decisions

- Whether to commit generated `chrome/dist/next` assets long term.
- Whether the extension host should eventually be bundled too.
- Whether to use React Router or a small custom router for Next.
- Whether to support Chrome versions below 148 with a `browser` namespace fallback.
- Whether Google account domain selection should be configurable per school.

## Non-Goals For Now

- Do not port the whole experimental standalone Next.js app into the extension.
- Do not hide native Blackbaud by default until Next owns a route safely.
- Do not add broad extension permissions unless a concrete feature requires them.
- Do not store sensitive student data in `browser.storage.sync`.
