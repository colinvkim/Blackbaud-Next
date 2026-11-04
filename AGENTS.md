# Blackbaud Next

Blackbaud Next is a TypeScript Manifest V3 Chrome extension for Blackbaud's student portal. [README.md](README.md) describes the product; [CONTRIBUTING.md](CONTRIBUTING.md) covers development setup, architecture, and manual smoke checks.

## Source layout

- `src/blackbaud/`: native routes, selectors, data validation, adapters, and MAIN-world bridges.
- `src/features/`: feature behavior, injected UI, and native-page styles.
- `src/runtime/` and `src/entrypoints/`: feature lifetimes, navigation, activation, and bundle startup.
- `src/shared/`: settings, extension APIs, DOM/lifecycle helpers, theme tokens, and icons.
- `src/background/`: serialized preference writes and tab-isolated sign-in state.
- `src/popup/` and `src/options/`: mode selector and Advanced settings.
- `extension/manifest.json` and `assets/`: source manifest and assets. `scripts/build.ts` generates the tracked unpacked extension in `chrome/`.

## Implementation rules

- Inspect the current source, working-tree changes, and native markup before editing. Preserve unrelated user changes. Prefer small refactors with a concrete benefit; retain caller-specific validation when sharing helpers.
- Use strict TypeScript, named exports, explicit `.ts` imports, and 2-space indentation.
- Preserve native navigation, permissions, forms, actions, and hidden/disabled states. Changed or unsupported markup must leave native pages usable; custom views need native fallback.
- Implement `Feature` from `src/shared/types.ts`. Declare settings read by `mount` or its callbacks in `settingsKeys`. Document scope is only for features that survive navigation without stale route data; preserve prerender and BFCache handling.
- Use shared scopes, observers, location tracking, and attribute ownership. Cleanup must remove injected UI, styles, observers, and timers, and restore owned state without overwriting later native changes. Cancel obsolete reads and ignore late results after navigation, replacement, selection changes, or disablement.
- Discover elements incrementally and observe the smallest useful scope. Handle delayed controls, rerenders, reparenting, and ancestor visibility changes without repeated full-page scans.
- Apply `markOwned` only to extension-created UI; shared observers ignore owned subtrees. Use reversible styling markers, shared tokens, and icons. Tools must work with **Page appearance** off, and Off mode must restore native behavior.
- Validate responses and bridge messages at their boundaries. Keep extension APIs out of MAIN-world bridges. Reuse native save flows and prevent duplicate writes.

## Preferences and data

- Define feature preferences in `src/shared/settings.ts`. Essentials must preserve saved Full customizations; unrelated changes must not remount active tools.
- Keep migration and preference writes serialized through the worker. Apply Full defaults once, preserve later choices and account/view preferences, and never derive Classic from the retired Assignment Center toggle.
- Keep LMS records in memory, honor publication flags, and sync only preferences. Keep credentials, session data, browser profiles, and private records out of Git and release archives.
- Preserve tab-isolated authentication and manual password/challenge handling. Permissions must serve actual feature needs; honor the manifest's minimum Chrome version.

## Build and verify

Use the Node.js and pnpm versions declared in `package.json`. For code changes, run:

```sh
pnpm check
pnpm test
pnpm build
```

- Test observable behavior, especially cancellation, stale results, rerenders, failure recovery, and cleanup. Use synthetic data.
- Run `pnpm test:browser` for browser-dependent changes. Check native actions, feature switches, Off mode, navigation, pending work, and narrow layouts in Chrome for Testing. Prefer CDP/Puppeteer; clear viewport emulation with `await page.setViewport(null)` afterward.
- Rebuild from source; do not edit `chrome/` directly. Reload the extension and refresh the LMS tab, or use `pnpm dev:browser` for automatic builds/reloads with a persistent test profile.
- Inspect live pages at `https://polytechnic.myschoolapp.com`. Use synthetic fixtures for status writes, submission saves, and failure scenarios; do not modify real school records for testing.
- Report checks actually run and separate synthetic coverage from live verification. Documentation-only edits need no build or browser test.

## Git and releases

- Use Conventional Commits for commit subjects and PR titles; name branches `<type>/<kebab-case-title>`.
- Commit only intended changes, including generated `chrome/` output when affected. Keep package and manifest versions consistent for releases.
- PRs should describe resulting behavior, verification, generated bundle status, and remaining limitations.
