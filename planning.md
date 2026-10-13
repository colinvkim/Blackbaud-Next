# Blackbaud Next architecture

## Product

Improve everyday student workflows directly in native Blackbaud pages. Preserve native navigation and actions. Changes range from scoped presentation fixes to local controls; a separate LMS shell is outside this version’s scope.

## Implemented foundation

- One TypeScript project builds early appearance, LMS, authentication, popup, native Directory adapter, and service worker IIFE bundles.
- `extension/manifest.json` and `assets/` are the sources for the unpacked `chrome/` output.
- A feature has an ID, settings predicate, route predicate, and synchronous mount returning cleanup.
- Context supplies the current URL, normalized settings, and an abort signal.
- Features declare mount-time settings dependencies and a page or document route scope. Missing declarations conservatively depend on every setting and the exact URL.
- Updates reconcile each feature independently. Unchanged features retain their controls, state, and abort signal; changed or disabled features cancel and clean up before replacements mount.
- Hash/Back navigation is handled immediately. URL polling also detects native history changes without patching Blackbaud’s JavaScript environment.
- Native DOM changes are observed in batches; incremental discovery examines added subtrees and identifying attributes. Feature controls are removed when their anchors disappear.
- A failing feature does not prevent other features from mounting.
- LMS and authentication runtimes wait for prerender activation before reading settings, mounting features, or changing sign-in flow metadata. Ordinary background tabs start normally, and BFCache restores start a fresh runtime.

## Settings

Schema version 2 replaces UI modes with `enabled` and independent feature switches. Normal normalizes to disabled; Enhanced and Next normalize to enabled. Legacy switch aliases are read without rewriting a full settings snapshot, so simultaneous first loads cannot overwrite newer choices. Saves write individual patches and the schema marker rather than overwriting other tabs’ choices. A Google account preference accepts a full email address or exact domain.

## Retained features

Preference updates are submitted immediately to a service worker queue that outlives popup closure. Auth flow storage, pauses, recovery, and token claims have a single worker owner across provider documents. Attempts persist across worker restarts; unconfirmed reservations roll back after cancellation or a lost reply. The popup subscribes before its first read. The coordinator uses the existing storage permission and accepts only internal, validated senders. Detailed findings and their resolutions are tracked in `REVIEW.md`.

Login is an explicit, bounded flow across the school, Blackbaud sign-in, and a verified Google OAuth callback. Direct sign-in preserves native form controls. Exact school/account matching refuses ambiguity. Users can cancel automation across the flow, and metadata expires after five minutes. Error recovery is manual and limited.

Roster tools read the current native term picker, accept only semantic route identifiers or fresh requests belonging to the mounted roster, validate response shapes, preserve every member name, deduplicate email addresses, and abort obsolete requests. One mounted picker owns a single in-flight or completed read shared between copy actions for up to 15 seconds. Its key includes the view, selected term, roster kind, and roster ID; term/view changes, failures, and cleanup invalidate it. Raw roster data is never persisted.

Roster picker discovery stays within native class content, and directory discovery stays within its results container. Profile updates observe individual native rows/cards. Profile photo actions use an unambiguous native profile boundary and open only recognizable HTTPS photo URLs. Assignment compatibility is optional and restores native links on cleanup. Loading recovery offers a manual action after a sustained wait mask, suppresses explicit native errors, and uses a per-tab cooldown.

Appearance styles target native legacy components and retain school branding and native controls. Newer SKY components keep their own layouts. Every appearance change can be removed through the popup.

## Everyday workflow improvements

The modern Assignment Center has local shortcuts for all loaded rows, unfinished work, and work due today or tomorrow. Adapters read labeled due dates and native status text; shortcuts preserve native search, filters, collapsed groups, and server settings. Date comparisons use the local calendar and refresh at midnight.

Assignment previews add an explicit button beside native title links. A cancellable same-origin request validates the current student identity and requested assignment, retaining only display fields. Instructions are rebuilt with a limited set of text-formatting elements and safe links. The panel supports retry, Escape, focus return, and full native navigation for submissions and embedded content. No preview payload is persisted.

Helpful tab titles follow the current page and late native course or assignment headings. Resource Board search filters existing cards by title and description, temporarily compacts matching cards, and retains native actions. It preserves native card dimensions so Blackbaud can still calculate its layout when the window resizes during a search. Both features restore native state on cleanup.

The native desktop and mobile Classes menus gain local search. Class links retain their destination class, term, query parameters, and native click behavior while preserving the current Bulletin Board, Assignments, or Roster section. Unsupported sections keep the native destination. Cleanup restores native hrefs and filtered rows without overwriting newer native link changes.

Standard native directories gain a contained replacement for search, filters, and results. A document-scoped native-link capture starts a direct authenticated read before navigation; the route feature consumes that one-shot read or starts one alongside metadata readiness. A narrow MAIN-world adapter verifies the current native Directory view, facet-array shape, initial collection presence, and directory identity across a versioned DOM channel without waiting for its records. The isolated adapter validates unique IDs, consistent reported totals, names, publication flags, emails, and recognizable photo URLs. It distinguishes complete responses from limited responses instead of treating a reported total as loaded people. It retains safe photo filenames until native metadata supplies a verified photo prefix. The UI derives filtered/sorted results once per changed snapshot/query/grade/sort and reuses them for pagination. Search-first metadata cancels the unused speculative people read and mounts an empty search invitation without waiting for that read. Only projected display records remain in memory. Refresh and server name searches use a strictly current-route cancellable endpoint; intent reads tolerate only the captured source-to-destination transition and expire after 15 seconds.

The replacement provides name/preferred-name search, optional query-aware grade counts, deterministic sorting, bounded pages, small lazy photos, published email copying, and native profile links. Complete directories search locally; limited responses use debounced, cancellable server name search without reapplying the local name matcher to server results. Native Directories navigation chooses the directory, with no redundant enhanced picker. Once enabled settings and the supported native integration are ready, the independent path wraps only the module's directory startup function and mounts a lightweight view through the native main-page lifecycle. Configuration and people reads run concurrently without native introduction/facet requests or a duplicate people read. Original startup is saved for explicit fallback, failure, disablement, or watchdog recovery. Navigation never resumes a departed directory.

If initial native startup already ran or independent integration is unsupported, the native-container path remains available. It leaves native methods usable until the isolated records are ready, then pauses only that view's results, result rendering, facet-value methods, and matching DirectoryList scrolling. This fallback retains Blackbaud's initial results request for recovery. Current-view release restores methods and replays owed row/filter work without another results GET; navigation/pagehide skip obsolete replay. Network APIs remain untouched in both paths. Unsupported configurations fail open to the original directory.

Directory ownership restores method descriptors only while owned wrappers remain installed. Cleanup runs on hash/history changes, view replacement, pagehide, explicit release, and heartbeat expiry; the page adapter can independently reveal native content and remove the replacement if the isolated runtime disappears. Its inert listener survives BFCache restoration. All directory data stays in memory, with no new manifest permissions or extension APIs exposed to the page.

### Directory startup investigation (2026-10-08)

A direct GET to `/api/directory/directoryresultsget?directoryId=<native-id>&searchVal=&facets=&searchAll=false` succeeds from an authenticated Progress page even when no Directory view or result collection has been initialized. The live check returned HTTP 200 and the complete student list using normal same-origin session cookies and an Accept header; omitting cookies returned HTTP 403. No Directory-page token or preceding metadata request was needed in this session. The response uses `Cache-Control: no-cache, no-store, must-revalidate`.

Native startup is sequential: `renderDirectory` reads directory metadata, the view's initializer synchronously reads the introduction, `getFacets` synchronously reads filter definitions, and `renderTemplate` starts the asynchronous results read. Results success computes contact display fields, renders native rows, and synchronously reads filter values. `p3.renderMainPage` assigns `_currentMainView` after rendering the new view, so the first native results request has already started before the existing ownership check can succeed.

One temporary click-capture experiment started a direct request before the native navigation handler. All times below are milliseconds after the same click; these are development samples, not performance guarantees.

| Milestone | Time |
| --- | ---: |
| Early direct request started | 0 |
| Early response finished transferring | 701 |
| Native facets finished / shell setup continued | 723 |
| Native results request started | 726 |
| Early records validated, sorted, and prepared for search | 773 |
| Native results response finished transferring | 1385 |
| Native row rendering finished | 1491 |
| Native synchronous filter-values method returned | 2011 |

The early sample spent about 5 ms parsing and 36 ms preparing records. It deliberately allowed both results requests; no first-paint or interactive-time improvement has been shipped or established by this experiment. The temporary instrumentation and data were confined to a disposable tab.

The implemented pipeline now follows that experiment: one cancellable read on verified native Directory intent, metadata/support validation separate from collection readiness, and rendering once both metadata and prepared records are ready. Initial native loading remains for reliable fallback, with unnecessary row/filter-value work suppressed only after activation of the verified owned view. Measure first usable enhanced rows before optimizing duplicate traffic. Any future reusable memory cache needs session identity checks; this version consumes each captured result once and never caches it across navigation.

Live verification of the installed build measured one Progress-to-Student click with native metadata ready at 948 ms, ownership acknowledged at 1512 ms, and the first 50 enhanced rows present at 1546 ms. The second animation frame after those rows was 1580 ms, with search enabled; this is a usable-frame observation, not a precise paint timestamp. The retained native results transfer finished at 2295 ms. Network events confirmed exactly two results requests (one extension and one native), no native filter-value request after ownership, and no directory requests for local search, grade filtering, sorting, or clearing filters. Server and session timings vary, so this sample does not establish a fixed speedup.

Native fallback was verified both before and after the retained results request completed. Returning after completion replayed native filter work without another results request; returning while pending let the existing native callback finish normally. Profile navigation and Back restored enhanced rows, and Faculty remained native without an error notice. A synthetic queued-hashchange regression additionally verifies that a rapid destination-to-source return aborts the abandoned intent before a later click can claim it.

Switching directories after the retained request completed exposed an obsolete filter-value request: releasing the Student lease while its URL was still current replayed work immediately before navigating to Faculty. The selector now changes the hash before synchronous cleanup, so the old lease restores methods without recovering a departed view. An integration fixture verifies this behavior through the real page bridge and isolated client.

After the final extension reload, live Network events confirmed that immediate Student-to-Progress departure cancels the captured extension request. A subsequent Student visit started a fresh extension read alongside the retained native read and displayed all 891 students in bounded pages. Switching to Faculty after native completion made zero requests for the departed Student directory. Original/enhanced toggling restored both views, and local search and sorting again made no directory requests. All 267 regression tests, type checking, and the production build passed.

### All-directory support investigation (2026-10-08)

The native menu exposes Alumni, Faculty, Staff, Student, and Parent. Faculty returned 161 records with a matching total, and Staff returned 90 with a matching total. Their name/publication fields follow the Student format. Faculty's published `GradeDisplay` can contain multiple comma-separated grades; these must contribute to individual grade counts and filter membership rather than become combined dropdown options. The enhanced Directory picker is removed; native Directories navigation remains the only picker.

Alumni's native collection and direct blank-query JSON both contained 2,016 unique records while reporting 6,137 matches; its native maximum-2,000 warning was visible. Parent's blank query returned 127 unique records while reporting 1,268, while its native `a` name search returned 106 records and a matching total. That query's records were all present in the initial 127; the cause of Parent's initial count difference is not established. A greater reported total therefore marks the response as limited without assuming a specific server cap, authorization rule, or complete local index. Larger totals no longer reject an otherwise validated response; contradictory/unsafe totals and duplicate IDs still fail. Limited directories retain cancellable server name search, and the UI counts received names instead of implying that every reported person is loaded.

The common native Directory view initializes its results collection inside `getResults`; the collection exists before the normal current-view ownership check. However, `renderTemplate` intentionally skips that read when `DefaultResults` is false and no search has run. Metadata recognizes that explicit search-first configuration without requiring a collection, and its enhanced view keeps server search even when the initial blank response is empty. Returning to native restores the original search-first behavior without inventing a results request. Normal configurations still require collection presence, but never wait for records to finish loading.

Rendering containment such as `content-visibility: auto` remains an experiment for future profiling; it is not applied by this release.

### Independent directory prototype (2026-10-09)

Checkpoint `cca8758` preserves the native-container enhancement and all-directory support before this experiment. Live inspection confirmed that native route registration invokes `shared/directory.Us.renderDirectory` dynamically, so a wrapper there can defer directory startup while preserving router authorization/events. `p3.renderMainPage` and `clearContainer` remain responsible for previous-view removal, event disposal, Page disposal, and current-view assignment. The independent view supplies the expected render/dispose methods and a bounded token-scoped lease.

The configuration endpoint is `/api/directory/directoryget?directoryId=<native-id>`. Its observed object includes `DirectoryID`, `DirectoryName`, and boolean `DefaultResults`. The new isolated adapter validates identity, projects only name/search-first behavior, and refuses stale navigation, cancellation, redirects, and unsupported shapes. It runs alongside the existing authenticated people request. Native introductions and full filters remain available in the original view rather than blocking compact results.

A disposable browser experiment created its independent container in 5.2 ms, finished configuration parsing at 281.8 ms, and finished people parsing at 1,400.2 ms. Its ready message appeared at 1,400.3 ms and the second following animation frame at 1,431.9 ms. These were one-session observations, not measurements of the completed extension UI or a controlled speed comparison. No native introduction/filter requests occurred during the experiment. The temporary hook and view were restored afterward. Server response time remained the dominant wait in this sample.

The implemented gate starts only after enabled preferences are confirmed. Hard reloads/deep links that start native routing before the document-end handshake deliberately keep the native-container path. No preferences or privileged extension APIs are exposed by the page bridge. Recovery calls saved startup once only for the current application/directory, including a late native callback that replaces the independent view; departure cancels recovery. Frozen/replaced native methods, module replacement, feature/master disablement, pagehide/BFCache, and watchdog expiry restore native behavior.

The first installed-build navigation exposed a startup-order race: the isolated hashchange handler could acquire before Backbone created the view, then wait on the native bridge while the router created an independent container. Acquisition now waits for both the preference gate and the route handoff, with bounded cancellation and native recovery. Canceling before shell creation allows the delayed native callback through once. Shared directory state follows Blackbaud's own reset semantics, fallback controls survive delayed native root replacement, and persisted browser-history restoration resumes native startup without requests during departure.

All 378 synthetic tests, type checking, production build, and diff checks passed. Installed-build Chrome testing verified first navigation to Student, Faculty, Staff, Alumni, and Parent; a hard reload retained the native-container fallback. One configuration request and one people request loaded the independent Student view, with no native introduction/facet requests. Its container appeared at 40.3 ms, rows at 766 ms, and the second following animation frame at 800.9 ms. CDP measured people transfer finishing at 701.2 ms and configuration transfer at 145.3 ms relative to the first directory request. One 61 ms main-thread task occurred before the result frame. The earlier native-container sample had a 774.7 ms frame and 285 ms of tasks before that frame: these samples demonstrate deferred native work, not a controlled reduction in total latency; server transfer remains the dominant wait.

Complete Faculty search, grade filtering, and sorting made no additional directory requests. Superseded Parent input produced only the latest server search. Original/enhanced switching retained its control across native replacement, and choosing Original while the independent view was loading preserved the user's fallback without a later error. Rapid departure from an initializing original Parent view still ended at the correct Faculty view. Native contact-card navigation and Back restored Faculty with its current shared directory state. A 390-pixel layout had no horizontal overflow; the temporary viewport was reset and diagnostic observers were removed. Feature/master cleanup and persisted-document lifecycle were covered by synthetic fixtures rather than live extension-popup tests.

Assignment Center preparation uses one browser-managed prerender of the exact same-origin native student link. Schedule retains its short automatic settle timer; delegated hover, keyboard-focus, and pointer/touch intent can prepare valid links on other supported LMS pages. Sign-in and Assignment Center itself are excluded. No page-wide link discovery is needed for intent. A 30-second expiry bounds data age and resource use; equivalent native links preserve the original rule and lifetime. Hidden tabs, unavailable sources, changed destinations, disabled settings, legacy routing, and navigation remove only the owned rule. There are no background tabs, page bridges, request overrides, or extra manifest permissions. Chrome retains control over eligibility and activation; native navigation remains available when preparation is skipped. The destination's own initialization and session requests may run while prepared, while extension work waits until activation.

## Verification and extension points

Run `rtk pnpm check`, `rtk pnpm test`, and `rtk pnpm build`. Synthetic fixtures contain no copied student records. Use the README smoke checklist against authenticated Blackbaud pages.

Future improvements should be a feature module plus a narrowly scoped adapter and regression coverage for its meaningful behavior. Expand school and page coverage from observed DOM evidence. Add richer rendered components only when a workflow requires them.
