<p align="center">
  <img src="./assets/128x128.png" alt="Blackbaud Next" width="120">
</p>

# Blackbaud Next

A Chrome extension that improves Blackbaud’s existing student portal with clearer layouts, simpler sign-in, and useful tools.

Version 2 rewrites the extension in TypeScript. Blackbaud keeps its native navigation, permissions, and workflows; the extension adds reversible improvements directly to its pages. There is no separate dashboard or replacement LMS app.

## Features

All features are controlled from the extension popup. Changes apply to open tabs without a refresh.

| Feature | Behavior |
| --- | --- |
| Page appearance | Apply a shared visual system to supported native pages, with clearer navigation, responsive course layouts, consistent controls, and keyboard focus. |
| Simpler sign-in | Add a direct Google sign-in button while keeping native login controls. |
| Automatic login | Continue through Blackbaud and select one matching school Google account. |
| Sign-in progress | Show a dismissible status with a **Continue manually** action. |
| Tab icon | Add a recognizable icon without deleting the school’s own icon. |
| Useful tab titles | Identify the page, class, or assignment in the browser tab. |
| Assignment shortcuts | Show all loaded assignments, unfinished work, or work due today or tomorrow. |
| Completion checkboxes | Mark assignments completed or to do in one click, with save feedback, Retry, and Undo. |
| Assignment previews | Read instructions, due dates, course names, links, and file attachments beside the list. |
| Faster Assignment Center | Prepare the native Assignment Center on Schedule or when you hover over or focus its link. |
| Resource Board search | Filter resource cards by name or description with a compact matching layout. |
| Roster tools | Copy names or emails from the selected class and term. |
| Better class switching | Search the native Classes menu and keep Assignments or Roster open when switching classes. |
| Full-size profile photos | Open the original directory photo in a separate tab. |
| Better directories | Search names, sort, and browse compact results across all native directories. |
| Legacy assignment center | Optionally route assignment navigation to the older native view. |
| Assignment loading recovery | Offer a manual reload after prolonged loading; never reload automatically. |

The **Enabled** switch pauses all enhancements and restores their native controls and styles. Individual feature choices are retained. Old Normal settings migrate to paused; Enhanced and Next Beta migrate to enabled, preserving existing feature switches.

On individual student assignment pages, **Assignments** links directly to Assignment Center, including the legacy view when selected. It works independently of browser history and supports normal keyboard and new-tab navigation.

Page appearance gives the portal and extension tools a shared Blackbaud-style font stack, blue accents, neutral surfaces, consistent borders, and readable spacing. Supported legacy views include Progress, Schedule, class Bulletin Board/Assignments/Roster, Resource Board, and directories. Progress uses quieter Performance and Attendance summaries and displays verified native courses as two columns of cards on wide screens, stacking them on smaller screens. All native course fields, grade and term controls, teacher contacts, and message actions stay in place; the extension does not rebuild their data or workflows. Schedule, class pages, and Resource Board retain their native actions. The modern Assignment Center, full student assignment pages, and user calendar reached from Schedule's month/week views share verified header/navigation styling while preserving their native content layouts. Assignment Center also receives matching tool styling and restrained color/border updates; its grouping, search, and filters stay native. Directory and preview controls use larger touch targets on phones. Preview tables scroll within the panel, with instruction headings kept distinct from the assignment title. The popup follows the same visual system and supports light/dark appearance.

The desktop header uses three horizontal rows: a navy school/account bar, content-sized primary navigation without totals, and page tabs with blue selected text and an underline. Verified dropdowns share readable rows, section labels, and viewport-bounded scrolling; Classes uses a wider single-column list with its search area pinned while scrolling. Open menus and keyboard focus have distinct trigger states. Long tab labels stay on one horizontally scrollable row, and keyboard focus brings their links into view. Native school branding, menus, search, unread badges, account photo, and links stay in place. Zero unread badges and navigation totals are hidden visually; their native data stays intact and returns when appearance is disabled. Long account names use an ellipsis while preserving their full accessible text. Each school's original logo keeps its proportions and can shrink within shared desktop/mobile size limits. My Day uses the house icon while retaining its live native date badge for restoration. Phones retain Blackbaud's native drawer. Shared header dimensions determine menu limits, sticky-search clearance, and content spacing. The fixed rows and their content spacer update together; an unfamiliar header structure restores the previous layout rather than applying partial offsets.

Native cosmetics require a recognized route and the expected page containers. Progress summary and course layouts additionally require their known native structures, so unfamiliar widgets and rows keep their original layout individually. The course list becomes a Cards grid only when it is nonempty and every item is a recognized course row. An unexpected sibling, changed row, or loading control restores the full-width list layout. Navigation or replacement of a native view clears obsolete layout markers. Turning **Page appearance** off restores native page styling while enabled feature tools keep their consistent styling; the **Enabled** master switch removes all enhancements and restores the native page.

Supported page containers share 16px inner gutters; phone layouts use a single 16px outer inset. Verified cards remove duplicate padding from their sole native content section so headings and body content align. Schedule's verified date/control header uses a separate date line on narrow screens, and native day navigation remains available. Directory rows, preview content, and popup sections use compact, consistent spacing while phone controls retain 44px touch targets.

Lucide SVG icons give verified native navigation, extension actions, search labels, and popup sections a consistent appearance. Navigation replacements keep native links, labels, carets, and My Day's date badge; disabling Page appearance restores the original graphics. Extension icons keep their text labels and are decorative for screen readers. Only the named icon set in `src/shared/icons.ts` is bundled, with no external font or CDN requests; its license is included in `assets/licenses/lucide.txt`.

Assignment shortcuts work on the modern Assignment Center’s loaded rows; native search and filters still apply. Today and tomorrow use your local calendar date. Preview buttons keep the native assignment links available, and the full assignment remains the place for submissions and embedded content. Previews load only when opened and keep their data in memory.

Completion checkboxes replace editable native status buttons in the modern student Assignment Center. Check **To do** to mark completed; uncheck **Completed** to return it to unfinished work. Overdue work keeps a separate **Overdue** label. Existing In progress assignments appear unchecked; Undo restores their original native state. Saving uses Blackbaud's status dialog and request, with no separate extension write. A confirmed failure offers **Retry**, and a confirmed change offers **Undo**. Native filtering and the Unfinished shortcut update after the save is confirmed. If a native filter removes the assignment entirely, show it in the list again to use Undo. Grading, submission, and unavailable status controls stay native. Turn **Completion checkboxes** off to restore the original status controls; the master switch and legacy Assignment Center preference also remove the checkbox UI.

Preview titles, their accessible labels, and assignment tab titles display whole-title rich-text formatting as plain text and decode explicit HTML entities once. Literal code and already-rendered native titles retain their text; the extension does not insert title HTML into the live page.

Faster Assignment Center uses Chrome's prerendering to load one native destination after Schedule settles, or when its link receives hover, keyboard focus, or pointer/touch intent on another supported Blackbaud LMS page. Sign-in and Assignment Center itself are excluded. Preparation lasts at most 30 seconds, runs once per page visit, and stops when the tab is hidden, the source becomes unavailable, or the feature is disabled. Equivalent native links share the original preparation without extending its lifetime. The prepared page can include assignment data loaded during that short window. Chrome may skip preparation because of its Preload pages setting, resource limits, or page compatibility; the original link always remains usable. The extension's features and sign-in automation start only after a prepared page activates. Preparing a page uses additional memory and network traffic; turn this feature off in the popup to stop it.

Class search works in the desktop and narrow-window Classes menus. Switching classes preserves Bulletin Board, Assignments, or Roster; other sections keep the native destination. Original link actions, including opening a new tab, remain available.

Better directories arms its integration as soon as enabled preferences are known. Supported directory clicks, deep links, and full reloads use a small container through Blackbaud's normal view lifecycle. Configuration loads asynchronously alongside the authenticated people read. Native introduction, filter, and duplicate initial results requests are deferred. **Use original directory** starts the full native directory when requested. If startup already ran before the integration became ready, or the native integration is unsupported, the existing native-container enhancement remains available instead. The first load still depends on Blackbaud's response time.

Complete directories search names and preferred names locally. When Blackbaud returns fewer records than it reports, name search uses a short debounce and cancellable server requests so people outside the initial list can still be found. Directories configured to show no initial results invite a server name search instead of treating the empty list as complete. Sorting and pages of 50 rows stay local, and Grade appears only when published grades are available. Faculty members with multiple grades match each grade separately. Published emails can be copied, profile names keep native contact-card links, and small photos load as needed. Refresh preserves the current search. Choose another directory through Blackbaud's native **Directories** menu; the enhanced view has no duplicate directory picker. The original directory retains native introductions, filters, broader searches, additional contact information, and other actions. Publication flags are honored and directory records are never persisted.

Automatic account selection requires one exact matching email address or domain. Polytechnic students have a school-specific default. Other schools can set their Google email or account domain in the popup. Multiple matches, authentication challenges, and missing accounts leave selection manual. The extension never enters passwords or bypasses Google challenges.

For the fastest account selection, enter your full Google email in the popup. Exact email preferences select the intended account as soon as it becomes available; domain preferences wait briefly for the account list to settle so a second school account is not overlooked. Sign-in scripts start when the page DOM is ready and react to controls becoming enabled.

## Development

Use Node.js 24+ and pnpm 11:

```sh
rtk pnpm install
rtk pnpm check
rtk pnpm test
rtk pnpm build
```

Load `chrome/` as an unpacked extension from `chrome://extensions/`. After rebuilding, reload the extension and refresh the Blackbaud tab so Chrome loads the new content scripts. Existing settings switches apply immediately once those scripts are running.

`rtk pnpm dev` watches TypeScript, imported styles, and the preloaded header stylesheet. Restart it after editing the manifest, popup HTML, or source assets. The build verifies that every manifest resource and popup bundle exists.

For automatic browser development:

```sh
rtk pnpm dev:browser
```

This downloads the matching Chrome for Testing on the first run, opens a dedicated test browser, and loads the extension automatically. Sign into Blackbaud in that window. The dedicated profile is saved between runs, preserving extension preferences and browser sign-in data. Blackbaud or Google can still expire the session or require a fresh sign-in. Your everyday Chrome profile is separate.

Saving changes in `src/`, `extension/`, `assets/`, or `scripts/build.ts` builds all six JavaScript bundles and their styles, reloads the extension, and refreshes tabs on the configured school's origin. Google sign-in and unrelated tabs are left alone. Chrome closes open extension popup/settings pages during reload; reopen them afterward. Rapid edits are combined and builds never overlap. A compile failure keeps the last complete development build available; the next edit retries. Press Ctrl+C or close the test browser to stop.

The browser download, dedicated profile, and development builds live in ignored `.local/dev-browser/`. The runner builds into staging and publishes only a validated complete extension; production output in `chrome/` is still generated with `rtk pnpm build`. Restart the runner after changing its own scripts or dependencies. Native browser reloads refresh the page, so save any work in the test tab before editing extension source.

Options (paths with spaces must be quoted):

```sh
rtk pnpm dev:browser --url https://your-school.myschoolapp.com
rtk pnpm dev:browser --profile /path/to/a/dedicated-test-profile
rtk pnpm dev:browser --executable "/path/to/Chrome for Testing"
```

`--executable` skips downloading; use a compatible Chrome for Testing (the default version matches the pinned Puppeteer dependency). `--headless` supports automated checks and `--help` lists the options. Browser automation uses a local CDP pipe, with no debugging port or additional extension permissions. Credentials and browser profile files must stay out of Git.

`rtk pnpm test:browser` verifies the real extension in headless Chrome with synthetic pages and disposable profiles. It exercises source and popup rebuilds, scoped tab refresh, retained settings, and recovery after a compile error. It also checks legacy and modern navigation/icons, responsive Progress summaries, aligned content gutters, narrow Schedule controls, native collapse/day navigation actions, and layout restoration when appearance or the master switch is disabled. Coordinator checks cover popup saves after closure, concurrent provider attempts, and worker restart. Build-watch checks wait for validated output readiness and exercise initial-error recovery before immediate source edits. It downloads/reuses the same browser binary and makes no requests to the real LMS.

## Source layout

```text
src/
  entrypoints/       Early appearance, LMS, authentication, popup, Directory, and worker bundles
  background/        Durable preference writes and serialized sign-in flow mutations
  runtime/           Navigation, settings changes, feature lifecycle
  blackbaud/         Routes, account matching, and native page/data adapters
  features/          Independent native-page enhancements
  popup/             Settings interface
  shared/            Typed settings, DOM observation, extension API boundary
extension/           Source manifest
assets/              Source icons
scripts/             Production build and automatic development browser
tests/               Node test runner and synthetic JSDOM fixtures
chrome/              Built unpacked extension
```

Each feature declares its supported routes and the settings it reads, mounts with an abort signal, and supplies cleanup. Unchanged features stay mounted across unrelated preference changes. Styles and other route-independent features can remain mounted across compatible navigation; route-dependent features cancel old work when their URL changes. Undeclared dependencies default to conservative remounting.

The service worker accepts preference patches immediately, then saves them in order even if the popup closes. The popup subscribes before its initial settings read and keeps optimistic choices until their replies settle. Auth storage and claims have the same single worker owner, so concurrent provider tabs cannot consume the same attempt. Attempts are persisted before clicking and remain spent across worker restarts; unused claims roll back by token, including when a claim reply is lost. Native `redirectUrl` and `redirecturl` parameters both identify the school, with conflicting values left manual. The coordinator accepts only this extension's popup or verified sign-in content scripts, exposes no page bridge, and uses the existing storage permission.

Header CSS is preloaded through the manifest, and `src/entrypoints/appearance.ts` starts appearance at `document_start`, separately from the other LMS tools. Preference reads run immediately while the parser creates the document root. Styles activate only after saved switches are known and the native header plus spacer are verified together. This can reduce the native-header flash before `DOMContentLoaded`; it does not guarantee first-paint styling before Blackbaud creates its complete header. Late controls and spacers are discovered as they arrive. Prerendered pages wait for activation, and BFCache restores start with current preferences.

Shared visual tokens and extension tool styles are defined in `src/features/page-appearance.ts`; Progress-specific typography and native Cards styles are in `src/features/progress-styles.ts`. Native page styles are scoped by reversible markers from `src/features/appearance-layout.ts`, using route/container and course-row validation in `src/blackbaud/appearance.ts`. Header styles live in `src/features/header-styles.ts`; `src/blackbaud/header-appearance.ts` validates native controls and the fixed-row spacer, while `src/features/header-appearance.ts` owns reversible markers, utility icons, and text spacing. Unknown structures retain native layouts, and cleanup restores previous marker values. Feature-specific styles use the same tokens; the popup defines a matching independent palette for its light/dark document.

Navigation icon targets are validated in `src/blackbaud/appearance-icons.ts`. `src/features/navigation-icons.ts` retains and restores the original elements, repairs native rerenders, and releases replacements when the native graphic gains an accessible name or interaction.

Roster and directory discovery checks added elements and relevant identifying attributes, then observes the native view or individual profile card. Same-origin roster requests validate response shapes. Copying names and then emails reuses one in-memory read for up to 15 seconds for the same class and term; changing the selection, replacing the view, or disabling the feature discards it. Name copying preserves distinct members who share a name; email copying removes duplicate addresses. Preferences are the only synced data. Short-lived sign-in flow metadata is stored locally and expires after five minutes.

The Directory's MAIN-world adapter wraps only the verified native module's directory startup function after a settings handshake. Native routing and previous-view disposal remain in charge. The independent container is restricted to a current directory in Blackbaud's authorized navigation context; configuration and records are validated separately before results appear. Explicit fallback, failure, disablement, and watchdog expiry resume native startup once for the current directory; departure never resumes an obsolete directory. The native-container fallback verifies the current native view and pauses its expensive rendering only after records are ready, retaining its original results request for recovery. The click-captured read is consumed once, expires after 15 seconds, and is discarded on cancellation, route departure, or disable; it is not a reusable data cache. Neither adapter exposes extension APIs or patches network requests. The manifest requires no additional permissions.

Directory acquisition and native fallback live in `src/features/directory.ts`; search, pagination, and rendering live in `src/features/directory-view.ts`. Search-first configuration cancels the speculative blank read and mounts an empty search invitation without depending on that read's success. The page bridge transfers only validated metadata. Filtered/sorted results are derived once per snapshot/query/grade/sort change; pagination reuses them. Assignment tools likewise discover native rows and titles incrementally and observe their small scopes. Resource search measures cards in a batch and reacts to ancestor visibility changes. Appearance shares reversible attribute ownership and one validated page/navigation snapshot per update.

Assignment completion validates native controls in `src/blackbaud/assignment-status.ts`. A MAIN-world observer temporarily wraps native XHR open/send only while the native dialog saves a specific assignment/status pair, restores the hooks when that request starts, and reports its terminal result without retaining assignment data. It never changes the request or issues its own write. The UI waits for both a successful response and the native list update before offering Undo. Only one completion operation can run at a time, including through feature cleanup while a native request remains pending. Unknown controls or an unconfirmed save restore the native status button.

## Manual smoke checks

- Pause and resume the extension; verify native styles and controls return and no duplicate tools appear.
- Turn Page appearance off while directory, Resource Board search, class search, or assignment tools remain enabled. Verify native page styling returns while the tools remain readable and usable. Turn it back on, then pause the master switch to verify complete native restoration.
- Check Progress, Schedule, class Bulletin Board/Assignments/Roster, Resource Board, and directories at desktop and narrow-window sizes. Verify navigation/dropdowns, selected tabs, controls, tables, photos, and keyboard focus remain readable without horizontal page overflow. In Progress, verify summary cards align and stack, collapse controls still work, and course cards stack correctly and retain native course, grade, term, email, and message actions. Check unpublished grades, long labels, native hidden/disabled states, and a school-specific extra field. Unexpected list content must leave the full-width native list usable.
- Sign in using the added Google button, then sign out and sign in again immediately. Verify account selection, native password/challenge handling, and **Continue manually**.
- Navigate to Progress and exercise native grade, term, course, and message controls.
- Open a class roster, copy names/emails, and switch semesters. Verify the new section is used.
- Navigate between classes and use Back/Forward; tools must stay associated with the current page.
- Search the desktop and narrow-window Classes menus; switch from Assignments and Roster, open a class in a new tab, and disable the feature to check native link restoration.
- Change an unrelated feature switch while a preview, assignment shortcut, or Resource Board search is active; its state should remain intact.
- Open a directory; verify each photo action belongs to that row.
- From Progress, open each native directory through the desktop/mobile Directories menu. Verify supported navigation mounts an independent loading container and starts one configuration read plus one people read, with no native introductions, facets, or duplicate people read. Hard-reload a supported directory to verify the independent loading container and a single people read. Verify the native-container fallback when native startup began before the gate was ready or the integration is unsupported. The enhanced view must have no Directory picker. Complete directories search locally; partial directories use cancellable server name search, recover from failed or superseded searches, and preserve their query on Refresh. Sort/page actions stay local. Grade is absent when unavailable and handles each grade for Faculty. Choose original while loading and after rows appear; verify full native initialization and search, including rapid departure while original loading is pending. Open a contact card and use Back; test narrow layouts, image/copy failures, rapid navigation, re-enable, and the feature/master switches.
- Toggle legacy assignment navigation; verify native links are restored when disabled.
- Open a full assignment directly or from Progress; its **Assignments** breadcrumb must open Assignment Center rather than the previous page. Check keyboard/new-tab navigation, legacy routing, and native href restoration with the master switch.
- From Schedule, allow automatic preparation; from Progress, class pages, or a modern user calendar, hover over or keyboard-focus the native Assignment Center link. Open it and verify Chrome prerender activation, assignment tools, native filters, detail navigation, and Back. Test without an extension-based debugger attached to the source page, since it can suppress prerendering. Check disabled/legacy mode, hidden tabs, unavailable or changed links, and preparation expiry.
- In the modern Assignment Center, try each shortcut, native search/filter changes, and expanded/collapsed groups. Check the loaded-row count.
- Check and uncheck an editable assignment, use Undo, and repeat with Unfinished selected. Verify Saving, failure/Retry, keyboard Space, overdue labels, and native grading/submission controls. Move focus to Search while a save is pending; completion must preserve that focus. Disable Completion checkboxes and the master switch during a pending save; native controls must return, and a late response must not restore removed UI. Re-enable and confirm no duplicate controls.
- Check modern Assignment Center, full student assignment pages, and Schedule's month/week user calendar at desktop and narrow-window sizes. Shared header/navigation styling must preserve native menus and navigation. Assignment Center grouping, row layout, search, filters, and assignment links must remain functional with Page appearance enabled and disabled; full assignment and calendar content layouts must remain native.
- Open and switch assignment previews; verify instructions, links/files, full assignment navigation, Escape, focus return, and cleanup when disabled.
- Search the Resource Board, clear the search, and check that cards retain their native actions and layout, including after resizing.
- Navigate between classes, assignment details, and student pages; verify tab titles update and restore when disabled.
- Verify that prolonged assignment loading offers a manual recovery action and that completed loading removes it.
- Check the popup with keyboard navigation and light/dark appearance.
- With synthetic fixtures, replace a recognized native view or change a Progress row's expected column structure. Verify obsolete layout markers are removed and unfamiliar rows fall back to native layout without affecting valid rows.

Automated tests cover settings migration, account matching and cancellation, selective feature lifecycle, guarded appearance routes/containers/course rows and reversible layout ownership, prerender activation and bounded preparation, incremental DOM discovery, roster selection/read reuse and validation, directory completeness/privacy/local filtering and reversible ownership, profile association, bounded recovery, class switching and search, assignment dates and preview cancellation/sanitization, resource filtering, title restoration, and popup storage failures.

## Compatibility

Chrome 120+ on schools using `*.myschoolapp.com`. The native visual redesign targets recognized student-portal shells and Progress, Schedule, supported class views, Resource Board, and directory containers. Verified modern shells for SKY Assignment Center, full student assignment pages, and the user calendar (`/sis-scheduling/user-calendar`, opened from Schedule's month/week views) share header/navigation styling while retaining native content layouts. Assignment Center additionally receives matching tools and limited cosmetics. Unknown routes or changed native structures keep their original layout; other compatible feature tools can continue independently. Different school configurations may require adapter updates.

## License

MIT. See [LICENSE](LICENSE).
