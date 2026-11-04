# Contributing to Blackbaud Next

For installation and a feature overview, see the [README](README.md).

Blackbaud Next is a TypeScript Manifest V3 Chrome extension. Development focuses on improving native Blackbaud pages while preserving their navigation, permissions, forms, and actions. Read [AGENTS.md](AGENTS.md) for the repository's implementation and verification requirements.

Use synthetic data in tests and keep private LMS records, credentials, and browser profiles out of Git. Use Conventional Commits for commit subjects and PR titles, and name branches `<type>/<kebab-case-title>`.

## Build and load

Use Node.js 24.15+ (24.x) or 26+, and pnpm 12:

```sh
pnpm install
pnpm check
pnpm test
pnpm build
```

Load `chrome/` as an unpacked extension from `chrome://extensions/`. After rebuilding, reload the extension and refresh the Blackbaud tab so Chrome loads the new content scripts. Existing settings switches apply immediately once those scripts are running.

`pnpm dev` watches TypeScript, imported styles, and the preloaded header stylesheet. Restart it after editing the manifest, popup/settings HTML, or source assets. The build verifies that every manifest resource and settings bundle exists.

For automatic browser development:

```sh
pnpm dev:browser
```

This downloads the matching Chrome for Testing on the first run, opens a dedicated test browser, and loads the extension automatically. Sign into Blackbaud in that window. The dedicated profile is saved between runs, preserving extension preferences and browser sign-in data. Blackbaud or Google can still expire the session or require a fresh sign-in. Your everyday Chrome profile is separate.

Saving changes in `src/`, `extension/`, `assets/`, or `scripts/build.ts` builds all seven JavaScript bundles and their styles, reloads the extension, and refreshes tabs on the configured school's origin. Google sign-in and unrelated tabs are left alone. Chrome closes open extension popup/settings pages during reload; reopen them afterward. Rapid edits are combined and builds never overlap. A compile failure keeps the last complete development build available; the next edit retries. Press Ctrl+C or close the test browser to stop.

The browser download, dedicated profile, and development builds live in ignored `.local/dev-browser/`. The runner builds into staging and publishes only a validated complete extension; production output in `chrome/` is still generated with `pnpm build`. Restart the runner after changing its own scripts or dependencies. Native browser reloads refresh the page, so save any work in the test tab before editing extension source.

Options (paths with spaces must be quoted):

```sh
pnpm dev:browser --url https://your-school.myschoolapp.com
pnpm dev:browser --profile /path/to/a/dedicated-test-profile
pnpm dev:browser --executable "/path/to/Chrome for Testing"
```

`--executable` skips downloading; use a compatible Chrome for Testing (the default version matches the pinned Puppeteer dependency). `--headless` supports automated checks and `--help` lists the options. Browser automation uses a local CDP pipe, with no debugging port or additional extension permissions. Credentials and browser profile files must stay out of Git.

After manual CDP/Puppeteer viewport checks, restore the browser's actual viewport with `await page.setViewport(null)`. An emulated viewport taller than the visible window can make the bottom of a page appear cut off when using the browser manually.

`pnpm test:browser` verifies the real extension in headless Chrome with synthetic pages and disposable profiles. It exercises source and popup rebuilds, scoped tab refresh, retained settings, and recovery after a compile error. It also checks legacy and modern navigation/icons, responsive Progress summaries, aligned content gutters, narrow Schedule controls, native collapse/day navigation actions, and layout restoration with appearance disabled or Off mode selected. Coordinator checks cover popup saves after closure, tab-isolated sign-in, redirect-only Google completion, and worker restart. Build-watch checks wait for validated output readiness and exercise initial-error recovery before immediate source edits. It downloads/reuses the same browser binary and makes no requests to the real LMS.

To compare sign-in code changes, save a production build before editing, rebuild afterward, then run:

```sh
node scripts/benchmark-signin.ts --baseline /path/to/saved-extension --candidate chrome --profile
```

The benchmark prepares each flow through the real school-login content script in the same test tab, then uses native click handlers on synthetic Blackbaud and Google pages. Five alternating runs per build cover domain and exact-email selection, including a controlled 600 ms native initialization delay. It reports navigation-to-click and native-ready-to-click medians and ranges, checks for premature or duplicate clicks, and verifies persisted attempt state. Separate warmup traces are excluded from the measurements. Results and traces go to ignored `.local/dev-browser/signin-benchmark/`. This measures extension overhead, not complete live sign-in or provider network latency.

## Source layout

```text
src/
  entrypoints/       Early appearance, LMS, authentication, popup, settings, Directory, and worker bundles
  background/        Durable preference writes and serialized sign-in flow mutations
  runtime/           Navigation, settings changes, feature lifecycle
  blackbaud/         Routes, account matching, and native page/data adapters
  features/          Independent native-page enhancements
  popup/             Three-mode selector
  options/           Advanced feature and account settings
  shared/            Typed settings, DOM observation, extension API boundary
extension/           Source manifest
assets/              Source icons
scripts/             Production build and automatic development browser
tests/               Node tests, synthetic JSDOM fixtures, and Chrome smoke checks
chrome/              Built unpacked extension
```

Each feature declares its supported routes and the settings it reads, mounts with an abort signal, and supplies cleanup. Unchanged features stay mounted across unrelated preference changes. Styles and other route-independent features can remain mounted across compatible navigation; route-dependent features cancel old work when their URL changes. Undeclared dependencies default to conservative remounting.

The popup selects Off, Essentials (automatic sign-in and assignment previews), or Full. On the first settings read after this upgrade, the worker applies Full defaults once and saves a version marker in the same write. Later mode and feature changes are retained, including after worker restarts. The runtime derives the Essentials preset without overwriting saved Full feature choices. Full includes Calendar, List, and Classic assignment views. The last selected view is remembered independently; resetting Full preserves the active mode, account preference, and assignment view. Settings opens in its own tab through the popup or Chrome's extension options. Both interfaces share the mode controls in `src/shared/settings-modes.ts`. Individual preferences appear in one list inside an Advanced disclosure that starts closed. Off, Essentials, and Full provide the only master control; Advanced contains feature preferences and the account field. The Assignment return link switch controls the assignment detail breadcrumb independently of appearance.

Completion checkboxes and Assignment status labels have separate feature lifetimes, as do Classes search and Remember class tab. Changing label styling preserves pending completion work; changing remembered class tabs preserves an active class search. The upgrade writes canonical feature keys, allowing retired setting aliases to be ignored. The migration and preference writes share the worker's serialized queue. The optional Google account preference and explicit Calendar/List/Classic choice are preserved; the retired Assignment Center toggle is ignored.

The service worker accepts preference patches immediately, then saves them in order even if the settings page closes. Both settings interfaces share a session that subscribes before its initial read and keeps optimistic choices until their replies settle. The worker also owns one sign-in flow per tab, using Chrome-supplied tab and frame identities to isolate reads and writes across origins. Attempts are saved before clicking and remain spent across worker restarts; unused claims roll back by token, including when a claim reply is lost. Native `redirectUrl` and `redirecturl` parameters both identify the school, with conflicting values left manual. The coordinator restricts preference edits to this extension's popup and settings page, validates supported LMS/sign-in contexts for migration and view requests, and keeps auth operations tied to their verified provider and tab. It exposes no page bridge and uses the existing storage permission.

An authenticated native student shell completes only the flow observed by that document, including when Google returns a redirect without displaying an account chooser. A late completion cannot remove a newer flow. The direct Google button reuses an unused prepared flow; an explicit restart creates a fresh identity. Auth intents and pauses end when Chrome or the extension restarts, while saved preferences remain. Old auth metadata in persistent local storage is not reused.

Header CSS is preloaded through the manifest, and `src/entrypoints/appearance.ts` starts appearance at `document_start`, separately from the other LMS tools. Preference reads run immediately while the parser creates the document root. Styles activate only after saved switches are known and the native header plus spacer are verified together. This can reduce the native-header flash before `DOMContentLoaded`; it does not guarantee first-paint styling before Blackbaud creates its complete header. Late controls and spacers are discovered as they arrive. Prerendered pages wait for activation, and BFCache restores start with current preferences.

Shared visual tokens live in `src/shared/theme.ts`, and extension tool styles are defined in `src/features/page-appearance.ts`. Progress styles live in `src/features/progress-styles.ts`; Assignment Center and assignment detail styles live in `src/features/assignment-styles.ts` and `src/features/assignment-detail-styles.ts`. Native page styles are scoped by reversible markers from `src/features/appearance-layout.ts`, using route/container and course-row validation in `src/blackbaud/appearance.ts`. Header styles live in `src/features/header-styles.ts`; `src/blackbaud/header-appearance.ts` validates native controls and the fixed-row spacer, while `src/features/header-appearance.ts` owns reversible markers, utility icons, and text spacing. Unknown structures retain native layouts, and cleanup restores previous marker values. Feature-specific styles use the same tokens; the popup and settings page share their system font, light/dark palette, and controls in `src/shared/settings-ui.css`.

Navigation icon targets are validated in `src/blackbaud/appearance-icons.ts`. `src/features/navigation-icons.ts` retains and restores the original elements, repairs native rerenders, and releases replacements when the native graphic gains an accessible name or interaction.

The custom school welcome lives in `src/features/login-page.ts`. `src/blackbaud/auth-dom.ts` verifies the initial native username step before it is hidden and made inert. Password steps, native errors, and unrecognized controls retain the school form. Disabling School sign-in page or the extension restores the same native nodes, values, and handlers. The welcome button reuses the coordinated sign-in flow; provider pages keep their native authentication controls.

Roster and directory discovery checks added elements and relevant identifying attributes, then observes the native view or individual profile card. Same-origin roster requests validate response shapes. Copying names and then emails reuses one in-memory read for up to 15 seconds for the same class and term; changing the selection, replacing the view, or disabling the feature discards it. Name copying preserves distinct members who share a name; email copying removes duplicate addresses. Preferences are the only synced data. Sign-in flow metadata stays in Chrome's memory-only session storage and expires after five minutes.

The Directory's MAIN-world adapter wraps only the verified native module's directory startup function after a settings handshake. Native routing and previous-view disposal remain in charge. The independent container is restricted to a current directory in Blackbaud's authorized navigation context; configuration and records are validated separately before results appear. Explicit fallback, failure, disablement, and watchdog expiry resume native startup once for the current directory; departure never resumes an obsolete directory. The native-container fallback verifies the current native view and pauses its expensive rendering only after records are ready, retaining its original results request for recovery. The click-captured read is consumed once, expires after 15 seconds, and is discarded on cancellation, route departure, or disable; it is not a reusable data cache. Neither adapter exposes extension APIs or patches network requests. The manifest requires no additional permissions.

Directory acquisition and native fallback live in `src/features/directory.ts`; search, pagination, and rendering live in `src/features/directory-view.ts`. Search-first configuration cancels the speculative blank read and mounts an empty search invitation without depending on that read's success. The page bridge transfers only validated metadata. Filtered/sorted results are derived once per snapshot/query/grade/sort change; pagination reuses them. Assignment tools likewise discover native rows and titles incrementally and observe their small scopes. Resource search measures cards in a batch and reacts to ancestor visibility changes. Appearance shares reversible attribute ownership and one validated page/navigation snapshot per update.

Directory contact details reuse the native results endpoint's server-filtered address and phone fields for published individual profiles without household relationships. Validation retains bounded plain-text addresses and phone numbers with safe `tel:` links; address IDs, coordinates, and relationship data are discarded. Published job titles appear beneath names. A native `details` disclosure shows contact information without another request, and name searches do not match addresses, phones, or titles.

Directory Columns/Rows controls change only the layout of the existing results. They preserve filters, pagination, focus, and expanded contacts without another read or render. The layout choice stays in memory for the current document and survives same-document directory navigation; a full reload restores the Columns default.

Assignment completion validates native controls in `src/blackbaud/assignment-status.ts`. A MAIN-world observer temporarily wraps native XHR open/send only while the native dialog saves a specific assignment/status pair, restores the hooks when that request starts, and reports its terminal result without retaining assignment data. It never changes the request or issues its own write. A save is confirmed only after both a successful response and the native list update. Only one completion operation can run at a time, including through feature cleanup while a native request remains pending. Unknown controls or an unconfirmed save restore the native status button.

## Manual smoke checks

- Pause and resume the extension; verify native styles and controls return and no duplicate tools appear.
- Turn Page appearance off while directory, Resource Board search, class search, or assignment tools remain enabled. Verify native page styling returns while the tools remain readable and usable. Turn it back on, then select Off to verify complete native restoration.
- Check Progress, Schedule, class Bulletin Board/Assignments/Roster, Resource Board, and directories at desktop and narrow-window sizes. Verify navigation/dropdowns, selected tabs, controls, tables, photos, and keyboard focus remain readable without horizontal page overflow. In Progress, verify summary cards align and stack, collapse controls still work, and course cards stack correctly and retain native course, grade, term, email, and message actions. Check unpublished grades, long labels, native hidden/disabled states, and a school-specific extra field. Unexpected list content must leave the full-width native list usable.
- Sign in using the custom school welcome, then sign out and sign in again immediately. Check desktop, narrow and short windows, keyboard activation, and School sign-in page with Page appearance off. Verify the native form returns when the feature or extension is disabled, or a native password step, error, or unexpected field appears. Verify account selection, native password/challenge handling, and **Continue manually** on provider pages.
- Navigate to Progress and exercise native grade, term, course, and message controls.
- Open a class roster, copy names/emails, and switch semesters. Verify the new section is used.
- Navigate between classes and use Back/Forward; tools must stay associated with the current page.
- Search the desktop and narrow-window Classes menus; switch from Assignments and Roster and open a class in a new tab. Toggle Remember class tab with a search active; the input and query must remain. Toggle Classes search independently; native destinations should still follow Remember class tab. Disable both to check full native restoration.
- Change an unrelated feature switch while a preview, assignment shortcut, or Resource Board search is active; its state should remain intact.
- Open a directory; verify each photo action belongs to that row. Switch Columns/Rows with the pointer and keyboard, including while a server search is pending; check preserved filters, pages, open contacts, and same-document view choice. Expand and collapse available contact details; check both layouts at narrow widths, telephone link targets and touch sizes, no additional requests, and removal on navigation or disablement. Check published staff titles and rows with only an address or phone number. Name-only profiles and rows without supported contact information must have no disclosure.
- From Progress, open each native directory through the desktop/mobile Directories menu. Verify supported navigation mounts an independent loading container and starts one configuration read plus one people read, with no native introductions, facets, or duplicate people read. Hard-reload a supported directory to verify the independent loading container and a single people read. Verify the native-container fallback when native startup began before the gate was ready or the integration is unsupported. The enhanced view must have no Directory picker. Complete directories search locally; partial directories use cancellable server name search, recover from failed or superseded searches, and keep search and sort controls stable as results change. Sort/page actions stay local. Grade is absent when unavailable and handles each grade for Faculty. Use the pending-load fallback while loading, and disable Directory redesign after rows appear; verify full native initialization and search, including rapid departure while original loading is pending. Open a contact card and use Back; test narrow layouts, image/copy failures, rapid navigation, re-enable, and the feature switches and Off mode.
- Switch between Calendar, List, and Classic in Assignment Center, then reload and revisit the page to check the remembered view. Verify Classic uses native filters/actions and offers the original page if embedding fails. Switch to Essentials or Off and check native restoration; return to Full and confirm the view preference is retained.
- Open a full assignment directly or from Progress; its **Assignments** breadcrumb must open Assignment Center rather than the previous page. Check keyboard/new-tab navigation, remembered view restoration, and native href restoration with Assignment return link disabled, Essentials active, or Off mode selected.
- From Schedule, allow automatic preparation; from Progress, class pages, or a modern user calendar, hover over or keyboard-focus the native Assignment Center link. Open it and verify Chrome prerender activation, assignment tools, native filters, detail navigation, and Back. Test without an extension-based debugger attached to the source page, since it can suppress prerendering. Check disabled preparation, Essentials and Off modes, hidden tabs, unavailable or changed links, and preparation expiry.
- In the modern Assignment Center, try each shortcut, native search/filter changes, and expanded/collapsed groups. Check empty-result feedback.
- Check and uncheck an editable assignment, then repeat with Unfinished selected, using All loaded to show completed rows again. Verify Saving, failure/Retry, keyboard Space, overdue labels, and native grading/submission controls. Move focus to Search while a save is pending; completion must preserve that focus. Toggle Assignment status labels during a pending save; the existing checkbox and request must remain. Disable Completion checkboxes, then select Off during another pending save; native controls must return, and a late response must not restore removed UI. Re-enable and confirm no duplicate controls. Verify status labels can remain enhanced with native completion controls and vice versa.
- Check modern Assignment Center, full student assignment pages, and Schedule's month/week user calendar at desktop and narrow-window sizes. Shared header/navigation styling must preserve native menus and navigation. Assignment Center grouping, row layout, search, filters, and assignment links must remain functional with Page appearance enabled and disabled; full assignment content, task/submission controls, hidden fields, and status colors must remain native. Check graded/ungraded details, long titles, optional sidebar content, and an open task form while toggling appearance and Off mode. Calendar content remains native.
- Open and switch assignment previews; verify instructions, links/files, full assignment navigation, Escape, focus return, and cleanup when disabled.
- Search the Resource Board, clear the search, and check that cards retain their native actions and layout, including after resizing.
- Navigate between classes, assignment details, and student pages; verify tab titles update and restore when disabled.
- Verify that prolonged assignment loading offers a manual recovery action and that completed loading removes it.
- Check the popup and settings page with keyboard navigation, light/dark appearance, and narrow windows. Verify Advanced starts closed, opens with the keyboard, and preserves edits when collapsed. Reset Full defaults should return focus to the active mode. Switch between Off, Essentials, and Full on an open LMS page. Verify Full customizations survive mode changes, both pages update each other, and Reset Full defaults preserves the Google account and active mode.
- With synthetic fixtures, replace a recognized native view or change a Progress row's expected column structure. Verify obsolete layout markers are removed and unfamiliar rows fall back to native layout without affecting valid rows.

Automated tests cover settings migration, account matching and cancellation, selective feature lifecycle, guarded appearance routes/containers/course rows and reversible layout ownership, prerender activation and bounded preparation, incremental DOM discovery, roster selection/read reuse and validation, directory completeness/privacy/local filtering and reversible ownership, profile association, bounded recovery, class switching and search, assignment dates and preview cancellation/sanitization, resource filtering, title restoration, and popup storage failures.
