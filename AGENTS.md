# Repository Guidelines

## Project Structure & Module Organization

Blackbaud Next is a Chrome extension with a pnpm workspace. `chrome/` contains the shipped extension: `manifest.json`, popup UI, content scripts, native enhancements, shared utilities, and generated Next assets in `chrome/dist/next/`. `apps/next-extension/` contains the React/Vite Next Beta host app; its build output is written into `chrome/dist/next/`. `branding/` stores Affinity source artwork. Root files define workspace metadata, lockfile, license, README, and planning notes.

## Build, Test, and Development Commands

- `rtk pnpm install` installs workspace dependencies using pnpm 11.
- `rtk pnpm build` runs type checking and builds Next assets into `chrome/dist/next/`.
- `rtk pnpm build:next` runs only the Vite Next build.
- `rtk pnpm check` runs `tsc --noEmit` for `apps/next-extension`.

For local manual testing, open `chrome://extensions/`, enable Developer mode, choose Load unpacked, and select `chrome/`.

## Coding Style & Naming Conventions

Use TypeScript and React conventions in `apps/next-extension/src`: 2-space indentation, named exports, PascalCase components, camelCase functions and values, and strict TypeScript types. JSX uses the React automatic runtime. Legacy extension code under `chrome/src` is plain JavaScript organized by feature area; keep modules small and names descriptive, such as `login-flow.js` or `avatar-download.js`. Prefer existing shared helpers in `chrome/src/shared/` before adding new utility code.

## Testing Guidelines

No automated test runner is currently configured. Treat `rtk pnpm check` and `rtk pnpm build` as required verification before submitting code. Manually test extension behavior in Chrome after changes to `chrome/src`, `chrome/manifest.json`, popup files, or generated Next assets. For UI changes, verify relevant modes: Normal, Enhanced, and Next Beta.

## Commit & Pull Request Guidelines

Git history uses Conventional Commits, for example `feat: add mode-based Next extension`, `fix(next): load Inter and hide native`, and `feat!: rewrite code base to prepare for v2`. Keep subjects imperative and under 72 characters when practical. Use scopes for focused areas, such as `next`, `auth`, or `popup`.

Pull requests should include a short summary, verification steps, linked issues when available, and screenshots or recordings for visible UI changes. Note any manual Chrome testing, affected UI mode, and whether `chrome/dist/next/` was regenerated.

## Security & Configuration Tips

Do not commit school-specific credentials, session data, or copied Blackbaud responses. Keep host permissions limited to documented extension needs, and review `chrome/manifest.json` when changing network, DOM, or authentication behavior.
