# Blackbaud Next Agent Notes

## Product Shape

Blackbaud Next is a Manifest V3 Chrome extension for `*.myschoolapp.com`.

It has three UI modes:

- `original`: native Blackbaud only.
- `enhanced`: native Blackbaud plus Blackbaud Next enhancements.
- `orbit`: experimental Next Beta React UI mounted by the extension.

Next Beta is not a separate hosted web app. It is built into static extension assets and mounted on authenticated Blackbaud pages. The internal mode key and paths still use the `orbit` codename.

The extension targets Chrome 148+ and uses `browser.*`, not `chrome.*`.

## Agent Workflow

- Prefix shell commands with `rtk`.
- Use Conventional Commits for commit messages.

## Important Paths

- `chrome/manifest.json`: Chrome extension manifest.
- `chrome/src/boot/`: content-script startup and mode selection.
- `chrome/src/auth/`: Blackbaud/Google login helpers and loading overlay.
- `chrome/src/native/`: native Blackbaud visibility, fallback, and escape hatch.
- `chrome/src/native-enhancements/`: current native Blackbaud UI enhancements.
- `chrome/src/orbit/host.js`: content-script host for the Next app bundle.
- `chrome/src/shared/`: settings, route, DOM, and clipboard helpers.
- `chrome/src/sources/`: Blackbaud API, network, and DOM source adapters.
- `chrome/src/data/`: normalizers and future shared Next data models.
- `chrome/src/popup/`: extension popup.
- `apps/orbit-extension/`: Vite + React + TypeScript Next app.
- `chrome/dist/orbit/`: built Next assets loaded by the extension.

## Build Commands

```sh
pnpm check
pnpm build
```

`pnpm build` type-checks `apps/orbit-extension` and builds:

- `chrome/dist/orbit/orbit.js`
- `chrome/dist/orbit/orbit.css`

## Architecture Rules

- Keep extension host code boring and small.
- Do not mix Next product UI into `chrome/src/boot`, `chrome/src/auth`, or `chrome/src/native`.
- Put React UI in `apps/orbit-extension`.
- Put Blackbaud native UI patches in `chrome/src/native-enhancements`.
- Keep auth/session helpers separate from UI mode behavior.
- Keep student/LMS data out of `browser.storage.sync`; settings only.
- Do not load remote JavaScript or React from a CDN.
- Preserve native Blackbaud fallback for Next failures.

## Current Verified Behavior

The user has manually verified:

- Normal mode leaves Blackbaud alone.
- Enhanced mode runs current features.
- Next Beta mode mounts the React app.
- `/api/webapp/userstatus` returns connected state.
- Hide native / show native controls work.

## Next Bridge

`chrome/src/orbit/host.js` creates the Next root, attaches Shadow DOM, loads `chrome/dist/orbit/orbit.js`, and handles app requests over `window.postMessage`.

Current bridge actions are `bootstrap`, `refresh-session`, and `toggle-native`.

The Next app should request host capabilities through `apps/orbit-extension/src/bridge.ts`, not by reaching into `window.BlackbaudNext` directly.
