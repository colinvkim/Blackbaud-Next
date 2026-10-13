# Native extension rewrite review

Reviewed `feat/native-extension-rewrite` against `main`, including the existing uncommitted appearance work. This log records the original findings and tracks their resolution. Reproductions use synthetic records only.

## Confirmed findings

| ID | Priority | Finding | Resolution |
| --- | --- | --- | --- |
| F1 | P2 | Closing the popup can lose changes queued behind an unfinished storage write. | Fixed: every accepted patch is sent immediately to a worker-owned save queue. |
| F2 | P2 | Native lowercase `redirecturl` loses the school identity, breaking direct entry and concurrent-school selection. | Fixed: both spellings are recognized; conflicting or unsafe redirects stay manual. |
| F3 | P2 | Per-document auth claims allow two provider documents to consume one automatic attempt. | Fixed: worker-owned storage and claim serialization, ownership confirmation, and token-checked rollback. |
| F4 | P2 | Search-first directories require a successful blank people read, then discard its records. | Fixed: metadata mounts an empty incomplete search view and cancels the unused speculative read. |
| F5 | P2 | Resource filters can stay empty after a hidden ancestor becomes visible. | Fixed: ancestor visibility and reparenting refresh the mounted board. |
| F6 | P2 | Copying names drops distinct roster members who share a name. | Fixed: name occurrences are preserved; email addresses remain deduplicated. |
| F7 | P3 | The popup subscribes after its initial storage read and can miss an intervening change. | Fixed: subscription precedes the initial read; intervening notifications invalidate stale snapshots. |
| F8 | P3 | Appearance observation misses native `aria-current` updates. | Fixed: semantic observation includes `aria-current`. |

F1 reproduces by holding the first save, accepting two toggles, and closing the popup: only the first patch reaches storage. F2 requires accepting both observed redirect parameter spellings while rejecting conflicts. F3 reproduces in independent documents sharing one synthetic flow: two clicks occur while the stored attempt count is one. F4 reproduces with valid `DefaultResults: false` configuration and a blank-query HTTP 503. F5 reproduces with an active search, ancestor hide, native text update, and ancestor show. F6 reproduces with two same-name students having different email addresses. F7 reproduces with a settings update during the held initial read. F8 reproduces with an `aria-current`-only native mutation.

## Beneficial refactors

- [x] R1: Removed unused nonmetadata directory bridge mode and its tests-only record projection paths.
- [x] R2: Split acquisition/fallback lifecycle into `features/directory.ts` and UI/search into `features/directory-view.ts`.
- [x] R3: Extracted the worker's `background/auth-store.ts` and the cancellable `shared/auth-flow.ts` client from login UI.
- [x] R4: Assignment title/row/toolbar discovery is incremental, with scoped observation and coalesced presentation updates.
- [x] R5: Appearance updates reuse a validated page/navigation/Progress snapshot.
- [x] R6: Added `shared/attribute-ownership.ts` for reversible cosmetic markers.
- [x] R7: Directory pagination/status changes reuse derived results; Resource Board clears, measures, and writes in batches.
- [x] R8: Native loading/error and login-anchor discovery live in Blackbaud adapters.
- [x] R9: Shared `tests/fixtures/header.ts` builders serve unit and browser tests without removing behavioral assertions.
- [x] R10: Production builds remove stale assets and verify the emitted worker resource.

## Additional hardening to evaluate

- Athletic picker identity was subsequently verified in Chrome for Testing: native option values identify teams, while `data-term-id` identifies seasons. The adapter now recovers the selected team after re-enable. Multi-season behavior has synthetic coverage because the live account exposed one season; see [REVERSE_ENGINEERING.md](REVERSE_ENGINEERING.md).
- Fixed same-root directory notice reattachment, with rerender and cleanup regression coverage.
- Fixed spacer text revalidation, with a regression for a reused text node gaining meaningful content.
- Fixed decorative-icon recognition and observation of `aria-labelledby`, preserving natively named graphics.

These concerns were not classified as confirmed live LMS defects during the initial review. The three bounded DOM hardening changes are covered; athletic picker interpretation was deferred until the subsequent live investigation provided native markup and handler evidence.

## Implementation notes

The worker has separate preference and auth queues; failures do not poison later operations. Auth attempts remain in local storage across worker restart, while directory/roster/assignment records stay in memory. An unused claim whose reply is lost is released by token, and denied claims retain the latest flow identity for manual pause. Retry-sign-in failures are handled without unhandled promises or duplicate clicks. No manifest permissions were added.

The coordinator uses synchronous listener registration and callback responses for Chrome 120 compatibility. See the primary [Chrome messaging documentation](https://developer.chrome.com/docs/extensions/develop/concepts/messaging) and [worker restart testing guide](https://developer.chrome.com/docs/extensions/how-to/test/test-serviceworker-termination-with-puppeteer).

Combined verification exposed an additional watch startup race. Readiness now follows successful bundle cleanup, output validation, and an event-loop handoff; failure feedback follows per-build error cleanup so an immediate corrective edit is observed. The watcher stays open after an initial compilation error. Both normal startup and initial-error recovery have regression coverage.

## Baseline validation

- Type checking passed.
- All 507 unit tests passed outside the filesystem sandbox; the sandbox prevented development watcher events.
- All three Chrome smoke tests passed with synthetic pages and disposable profiles.
- Production output built in a temporary directory and matched the current generated extension.
- Authenticated LMS workflows were not exercised during the review.

## Implementation validation

- `rtk pnpm check`: passed.
- `rtk pnpm test`: all **537** tests passed.
- `rtk pnpm build`: passed; all six bundles, manifest, assets, and popup were rebuilt in `chrome/`.
- `rtk pnpm test:browser`: all **five** concurrent smoke tests passed, covering appearance/native actions and switches, development reload/recovery, normal watch startup, initial compile-error recovery, popup closure, simultaneous auth tabs, and worker restart.
- `git diff --check`: passed.
- Directory and coordinator changes received independent peer review after implementation.
- Original uncommitted Cards/progress appearance changes were preserved and included in validation.
- Live authenticated LMS smoke testing remains unverified: browser URL policy denied opening `chrome://extensions/`, so the rebuilt extension could not be reloaded into the everyday Chrome session through UI automation. Synthetic tests used disposable profiles and intercepted requests.
- These validation results describe the review checkpoint before the subsequent live investigation. Athletic picker semantics and authenticated workflows were inspected afterward, as recorded in [REVERSE_ENGINEERING.md](REVERSE_ENGINEERING.md).
- The completed review checkpoint was committed as `b361078`; no external publication was performed.
