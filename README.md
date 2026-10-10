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
| Page appearance | Improve native course layouts, table spacing, typography, and keyboard focus. |
| Simpler sign-in | Add a direct Google sign-in button while keeping native login controls. |
| Automatic login | Continue through Blackbaud and select one matching school Google account. |
| Sign-in progress | Show a dismissible status with a **Continue manually** action. |
| Tab icon | Add a recognizable icon without deleting the school’s own icon. |
| Useful tab titles | Identify the page, class, or assignment in the browser tab. |
| Assignment shortcuts | Show all loaded assignments, unfinished work, or work due today or tomorrow. |
| Assignment previews | Read instructions, due dates, course names, links, and file attachments beside the list. |
| Faster Assignment Center | Prepare the native Assignment Center while you view Schedule. |
| Resource Board search | Filter resource cards by name or description with a compact matching layout. |
| Roster tools | Copy names or emails from the selected class and term. |
| Better class switching | Search the native Classes menu and keep Assignments or Roster open when switching classes. |
| Full-size profile photos | Open the original directory photo in a separate tab. |
| Better directories | Search names, sort, and browse compact results across all native directories. |
| Legacy assignment center | Optionally route assignment navigation to the older native view. |
| Assignment loading recovery | Offer a manual reload after prolonged loading; never reload automatically. |

The **Enabled** switch pauses all enhancements and restores their native controls and styles. Individual feature choices are retained. Old Normal settings migrate to paused; Enhanced and Next Beta migrate to enabled, preserving existing feature switches.

Assignment shortcuts work on the modern Assignment Center’s loaded rows; native search and filters still apply. Today and tomorrow use your local calendar date. Preview buttons keep the native assignment links available, and the full assignment remains the place for submissions and embedded content. Previews load only when opened and keep their data in memory.

Faster Assignment Center uses Chrome's prerendering to load one native destination after Schedule settles. Preparation lasts at most 30 seconds, runs once per Schedule visit, and stops when the tab is hidden or the feature is disabled. The prepared page can include assignment data loaded during that short window. Chrome may skip preparation because of its Preload pages setting, resource limits, or page compatibility; the original link always remains usable. The extension's features and sign-in automation start only after a prepared page activates. Preparing a page uses additional memory and network traffic; turn this feature off in the popup to stop it.

Class search works in the desktop and narrow-window Classes menus. Switching classes preserves Bulletin Board, Assignments, or Roster; other sections keep the native destination. Original link actions, including opening a new tab, remain available.

Better directories starts a direct, authenticated people read during a native directory click. Once enabled settings and the native directory integration are ready, it builds a small directory container through Blackbaud's normal view lifecycle and fetches configuration asynchronously alongside the people read. Native introduction, filter, and duplicate initial results requests are deferred. **Use original directory** starts the full native directory when requested. If startup already ran before the integration became ready, or the native integration is unsupported, the existing native-container enhancement remains available instead. The first load still depends on Blackbaud's response time.

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

`rtk pnpm dev` watches TypeScript and imported styles. Restart it after editing the manifest, popup HTML, or source assets. The build verifies that every manifest resource and popup bundle exists.

## Source layout

```text
src/
  entrypoints/       LMS, authentication, popup, and native Directory adapter bundles
  runtime/           Navigation, settings changes, feature lifecycle
  blackbaud/         Routes, account matching, and native page/data adapters
  features/          Independent native-page enhancements
  popup/             Settings interface
  shared/            Typed settings, DOM observation, extension API boundary
extension/           Source manifest
assets/              Source icons
scripts/             Production build
tests/               Node test runner and synthetic JSDOM fixtures
chrome/              Built unpacked extension
```

Each feature declares its supported routes and the settings it reads, mounts with an abort signal, and supplies cleanup. Unchanged features stay mounted across unrelated preference changes. Styles and other route-independent features can remain mounted across compatible navigation; route-dependent features cancel old work when their URL changes. Undeclared dependencies default to conservative remounting.

Roster and directory discovery checks added elements and relevant identifying attributes, then observes the native view or individual profile card. Same-origin roster requests validate response shapes. Copying names and then emails reuses one in-memory read for up to 15 seconds for the same class and term; changing the selection, replacing the view, or disabling the feature discards it. Preferences are the only synced data. Short-lived sign-in flow metadata is stored locally and expires after five minutes.

The Directory's MAIN-world adapter wraps only the verified native module's directory startup function after a settings handshake. Native routing and previous-view disposal remain in charge. The independent container is restricted to a current directory in Blackbaud's authorized navigation context; configuration and records are validated separately before results appear. Explicit fallback, failure, disablement, and watchdog expiry resume native startup once for the current directory; departure never resumes an obsolete directory. The native-container fallback verifies the current native view and pauses its expensive rendering only after records are ready, retaining its original results request for recovery. The click-captured read is consumed once, expires after 15 seconds, and is discarded on cancellation, route departure, or disable; it is not a reusable data cache. Neither adapter exposes extension APIs or patches network requests. The manifest requires no additional permissions.

## Manual smoke checks

- Pause and resume the extension; verify native styles and controls return and no duplicate tools appear.
- Sign in using the added Google button, then sign out and sign in again immediately. Verify account selection, native password/challenge handling, and **Continue manually**.
- Navigate to Progress and exercise native grade, term, course, and message controls.
- Open a class roster, copy names/emails, and switch semesters. Verify the new section is used.
- Navigate between classes and use Back/Forward; tools must stay associated with the current page.
- Search the desktop and narrow-window Classes menus; switch from Assignments and Roster, open a class in a new tab, and disable the feature to check native link restoration.
- Change an unrelated feature switch while a preview, assignment shortcut, or Resource Board search is active; its state should remain intact.
- Open a directory; verify each photo action belongs to that row.
- From Progress, open each native directory through the desktop/mobile Directories menu. Verify supported navigation mounts an independent loading container and starts one configuration read plus one people read, with no native introductions, facets, or duplicate people read. Hard-reload a directory to verify the native-container fallback when startup was missed. The enhanced view must have no Directory picker. Complete directories search locally; partial directories use cancellable server name search, recover from failed or superseded searches, and preserve their query on Refresh. Sort/page actions stay local. Grade is absent when unavailable and handles each grade for Faculty. Choose original while loading and after rows appear; verify full native initialization and search, including rapid departure while original loading is pending. Open a contact card and use Back; test narrow layouts, image/copy failures, rapid navigation, re-enable, and the feature/master switches.
- Toggle legacy assignment navigation; verify native links are restored when disabled.
- From Schedule, allow preparation, then open Assignment Center through its native link. Verify Chrome prerender activation, assignment tools, native filters, detail navigation, and Back. Test without an extension-based debugger attached to the source page, since it can suppress prerendering. Check disabled/legacy mode, hidden tabs, and preparation expiry.
- In the modern Assignment Center, try each shortcut, native search/filter changes, and expanded/collapsed groups. Check the loaded-row count.
- Open and switch assignment previews; verify instructions, links/files, full assignment navigation, Escape, focus return, and cleanup when disabled.
- Search the Resource Board, clear the search, and check that cards retain their native actions and layout, including after resizing.
- Navigate between classes, assignment details, and student pages; verify tab titles update and restore when disabled.
- Verify that prolonged assignment loading offers a manual recovery action and that completed loading removes it.
- Check the popup with keyboard navigation and light/dark appearance.

Automated tests cover settings migration, account matching and cancellation, selective feature lifecycle, prerender activation and bounded preparation, incremental DOM discovery, roster selection/read reuse and validation, directory completeness/privacy/local filtering and reversible ownership, profile association, bounded recovery, class switching and search, assignment dates and preview cancellation/sanitization, resource filtering, title restoration, and popup storage failures.

## Compatibility

Chrome 120+ on schools using `*.myschoolapp.com`. Appearance improvements target the legacy student portal; newer SKY pages keep their native layout. Different school configurations may require adapter updates.

## License

MIT. See [LICENSE](LICENSE).
