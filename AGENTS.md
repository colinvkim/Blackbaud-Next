# Blackbaud Next

Blackbaud Next is a TypeScript Chrome extension that enhances native Blackbaud LMS pages. Keep native navigation and actions usable; build small, reversible features rather than a replacement LMS.

## Source and builds

- `src/` contains entrypoints, runtime, Blackbaud adapters, features, shared utilities, and popup.
- `extension/manifest.json` and `assets/` are source files. `scripts/build.ts` generates the unpacked extension in `chrome/`.
- Edit source files, then rebuild. Do not edit generated `chrome/dist/` bundles directly.
- Use Node.js 24+ and pnpm 11. Prefix routine build/test commands with `rtk`; use raw output to diagnose failures.
- Required checks for code changes: `rtk pnpm check`, `rtk pnpm test`, and `rtk pnpm build`.

## Implementation

- Use strict TypeScript, named exports, explicit `.ts` imports, and 2-space indentation.
- Put Blackbaud selectors, route parsing, and response validation in `src/blackbaud/` adapters.
- Features use the runtime's abort signal and return cleanup. Remove injected UI and restore native state when disabled or unmounted.
- Reuse shared DOM helpers. Handle delayed controls, rerenders, navigation, and stale asynchronous results.
- Keep LMS data in memory. Store only preferences in synced storage; never commit credentials, session data, or copied student responses.
- Keep manifest permissions limited to actual feature needs.

## Verification

- Use synthetic fixtures for meaningful behavior: cancellation, rerenders, stale data, failure recovery, and settings migration. Do not mirror trivial implementation details in tests.
- Manually test changed UI in Chrome. Load `chrome/` through `chrome://extensions/`, reload the extension after rebuilding, and refresh the LMS tab.
- For Polytechnic inspection, use `https://polytechnic.myschoolapp.com`. With the extension enabled, click **Sign in with Google** and wait for automatic selection. Without it, enter any email, continue to Google, and select the account ending in `@students.polytechnic.org`.
- Verify feature switches and cleanup, including the extension's master switch. Preserve native password and challenge handling.

## Git

- Use the installed `commit` skill and Conventional Commits. Keep subjects imperative and under 72 characters.
- Name new branches `<type>/<kebab-case-title>`, such as `feat/assignment-previews`.
- Commit only the intended checkpoint or feature changes. PRs should describe the resulting behavior, relevant checks, manual Chrome testing, and whether generated bundles were rebuilt.
