# Blackbaud Next

Blackbaud Next is a TypeScript Manifest V3 Chrome extension that improves Blackbaud's native student portal. The native-extension rewrite is incomplete.

## Continue the native rewrite

- Preserve native navigation, permissions, forms, and actions. Changes must be reversible when a feature or the extension is disabled.
- Check the native structure before modifying it. Unsupported pages and changed markup must remain usable, with native fallback for custom views.
- Inspect the current source and working-tree changes before continuing unfinished work. Distinguish implemented behavior from verified behavior and remaining work.

## Source layout

- `src/entrypoints/` initializes bundles; `src/runtime/` manages activation, navigation, settings changes, and feature lifetimes.
- `src/blackbaud/` contains Blackbaud selectors, routes, response validation, and native page adapters, including MAIN-world bridges.
- `src/features/` contains feature behavior, injected UI, and native-page styles.
- `src/shared/` contains settings, extension API access, DOM and lifecycle helpers, theme tokens, and icons.
- `src/background/` coordinates preference writes and sign-in state across extension contexts.
- `src/popup/` contains the settings UI. Feature preferences are defined in `src/shared/settings.ts`.
- `extension/manifest.json` and `assets/` are source files. `scripts/build.ts` generates the unpacked extension in `chrome/`; edit the sources, then rebuild.

## Implement features

- Follow the existing strict TypeScript style, with named exports, explicit `.ts` imports, and 2-space indentation.
- Implement the `Feature` contract in `src/shared/types.ts`. Declare settings used by `mount` and its callbacks in `settingsKeys`. Use document scope only when a feature can survive navigation without capturing stale route data.
- Reuse `createScope`, DOM observation, location tracking, and attribute ownership helpers from `src/shared/`. Bind resources to the feature's abort signal and return cleanup.
- Cleanup must remove injected UI, release styles, stop observers and timers, and restore owned native state. Preserve changes Blackbaud makes after the extension's edits.
- Cancel obsolete requests and ignore late results after navigation, view replacement, selection changes, or disablement. Preserve prerender activation and BFCache handling in the runtime.
- Discover native elements incrementally and observe the smallest useful scope. Handle delayed controls, rerenders, reparenting, and ancestor visibility changes without repeated full-page scans.
- Mark extension-created UI with `markOwned`, never native containers. Shared observers ignore owned subtrees.
- Scope native styling with reversible markers. Reuse shared theme tokens and icons. Feature tools must remain usable when **Page appearance** is off.
- Keep settings migration and worker-coordinated writes intact. Changing an unrelated preference must not reset an active tool.
- Validate external responses and bridge messages at their boundaries. Keep extension APIs out of MAIN-world bridges and reuse native save flows without duplicate writes.
- Keep LMS data in memory and sync only preferences. Honor publication flags and keep credentials, session data, browser profiles, and private LMS records out of Git.
- Keep manifest permissions tied to actual feature needs. Preserve manual sign-in, password entry, and authentication challenges.

## Build and verify

Use Node.js 24+ and pnpm 11. For code changes, run:

```sh
pnpm check
pnpm test
pnpm build
```

- Add tests for meaningful changed behavior, particularly cancellation, stale results, native rerenders, failure recovery, and cleanup. Use synthetic data.
- Run `pnpm test:browser` when the change depends on browser behavior. Test changed UI in Chrome, including native actions, feature and master switches, navigation, pending work, and narrow layouts.
- Load `chrome/` through `chrome://extensions/`; reload the extension and refresh the LMS tab after rebuilding. Alternatively, `pnpm dev:browser` uses a dedicated Chrome for Testing profile with automatic rebuilds and reloads.
- Use `https://polytechnic.myschoolapp.com` for live inspection. See `README.md` for development options and detailed smoke checks.
- Report checks actually run and any unverified behavior. Documentation-only edits do not require a build or browser test.

## Git

- Use Conventional Commits for commit subjects and PR titles.
- Name branches `<type>/<kebab-case-title>`, such as `feat/assignment-previews`.
- Keep commits scoped to the intended changes. PRs should describe resulting behavior, verification, generated bundle status, and remaining work.
