# Live Blackbaud investigation

Investigated Polytechnic on 2026-10-12 with Chrome for Testing 155 and Blackbaud Next enabled. The review fixes were committed first as `b361078` (`fix: harden native extension workflows and cleanup`). Sign-in through the extension's Google button succeeded. CDP then provided DOM, network timing, and native JavaScript inspection in the same dedicated test profile.

Only implementation structure, endpoint paths, aggregate counts, and timings are recorded here. No credentials, session tokens, student records, assignment content, or copied responses are saved. Timings are individual observations on one session, not a controlled performance benchmark.

## How pages work

| Page | Native structure and data flow | Observed extension behavior |
| --- | --- | --- |
| Progress | Legacy `p3` application with Backbone models/views and a hash route. Initial school/account context precedes grade, term, course, attendance, and group reads. | Appearance and navigation enhancements mount on the native page. |
| Schedule | Same legacy application; `#accordionSchedules` and `#assignment-center-btn` identify the native controls. Schedule uses announcement and calendar-list endpoints. | The extension inserted a bounded prerender rule. Following Assignment Center produced a positive navigation `activationStart`, confirming actual prerender activation. |
| Assignment Center | Separate `/lms-assignment/assignment-center/student` shell with SKY repeater rows and status controls. | 24 preview controls mounted. Observed statuses were `Completed` and `To do`; due labels contained four-digit years, matching the adapters. |
| Assignment preview | `/api/webapp/context` validates the current student before `/api/assignment2/UserAssignmentDetailsGetAllStudentData`. | Reopening a preview repeated both sequential reads before optimization. |
| Resource Board | Legacy `lms/resourceboard` module loads user levels and containers. Isotope owns positioning and container height. | Search showed one matching card out of 12. Native geometry returned correctly after filtering, resizing, clearing, and waiting for animation to finish. |
| Student directory | Native directory startup fetches configuration, then creates its view and loads results/facets. The independent extension view bypasses that startup while enabled. | A complete 891-person snapshot mounted. Local filtering added no API requests. Original-directory recovery exposed a late native startup race when immediately navigating away. |
| Athletic roster | Legacy `LMS/athleticroster` view and `#roster-term-picker`. Its option value identifies the team; `data-term-id` identifies the season separately. | Picker identity can recover the selected team after roster tools are re-enabled, without waiting for another native request. |

## Investigated improvements

### RE1: Reuse validated preview identity briefly

An observed reopened preview issued a 127 ms context request followed by a 122 ms detail request. The extension now retains only a successfully validated student ID for 15 seconds in the mounted preview reader. Every open still fetches fresh assignment details. Expiration, a current failure, and cleanup discard the identity; canceled older reads cannot replace or erase a newer identity.

Synthetic coverage includes expiration, fresh details, invalid targets, failure recovery, context cancellation, stale reads, and remounts. In the final live retest, the first open took 261 ms with context (115 ms) and details (116 ms). Three consecutive reopens took 145, 154, and 146 ms, each making only a fresh detail request. This confirms elimination of the extra context round trip within the cache lifetime, rather than caching assignment content.

### RE2: Resource Board relayout candidate ruled out

The initial check counted overlapping cards 600 ms after clearing a filter at a changed viewport width. Inspection then established that native Isotope uses an 800 ms transform animation. Repeating the original implementation with 1,800 ms settling intervals showed zero overlapping pairs at the same width.

A trial explicit-relayout bridge did not improve the transition and was removed, including its tests. This candidate required no production change. Native geometry checks must allow the actual animation duration before classifying a persistent layout defect.

### RE3: Recover the athletic picker’s selected team

The live native picker value matched the roster request's `teamId`, while its `data-term-id` differed. Native `changeTermPicker` assigns the option value to the view and collection's section identifier. The adapter now interprets numeric values of the verified athletic picker as team IDs, alongside the existing academic-section mapping.

The account exposed one season. Disabling roster tools preserved the native picker; re-enabling restored both copy controls. Alternate-team selection, stale-copy cancellation, and re-enable without a new request are covered with synthetic fixtures rather than claimed as live multi-season tests. No live roster records were copied to the clipboard.

### RE4: Cancel departed original-directory recovery

Clicking **Use original directory** and immediately navigating to Resources let a late directory configuration callback replace the Resource Board under its new hash. The native startup's model-fetch success callback calls `renderMainPage` without checking that the directory route remains current. The recovery adapter now captures and guards that specific resumed metadata request. It restores the temporary model-prototype shadow synchronously, aborts on departure, and ignores stale success/error callbacks after navigation or view replacement. The normal app router and unrelated model reads remain native.

The final live reproduction retained the Resource Board route, native Resource Board view, and all 12 cards after the old response window. Normal original-directory recovery still completed and mounted native search controls. Both checks confirmed immediate restoration of the model's inherited `fetch` method. Synthetic regressions additionally cover same-directory return, unrelated reads, descriptor preservation, teardown, and a later-frozen prototype shadow.

## Verification

- `rtk pnpm check`: passed on final frozen source.
- `rtk pnpm test`: **557 tests passed**.
- `rtk pnpm build`: passed; generated `chrome/` bundles were rebuilt and loaded into Chrome for Testing.
- `rtk pnpm test:browser`: **five tests passed** on final source, covering synthetic UI/native actions, build/reload/recovery, popup saves, auth exclusivity, and worker restart.
- Live Google sign-in through the extension succeeded.
- Live Schedule → Assignment Center activated prerendering; observed status/date markup matched current adapters.
- Live preview reopen timing/request counts confirmed the identity optimization.
- Disabling previews removed controls and the open panel while preserving all 24 native assignment links. The master switch also removed shortcuts and the panel; re-enable restored all 24 preview controls.
- Live independent-directory local filtering made no additional API request. Original-directory normal completion and rapid navigation after recovery both passed.
- Live athletic picker semantics and tool disable/re-enable passed for the account's single available season; multiple seasons use synthetic coverage.
- Resource Board filtering/resize/clear settled correctly using the original implementation. The speculative relayout bridge was removed.
- Independent peer review covered preview identity handling and directory startup ownership/cancellation. `git diff --check` passed.

The test profile's feature preferences were returned to their original enabled values. No manifest permissions or remote publication were added.

## Hover preparation and rendering follow-up

Assignment Center preparation now also responds to hover, keyboard focus, and pointer/touch intent on its validated native link across supported secure Blackbaud LMS pages. Sign-in and Assignment Center itself are excluded. Schedule keeps automatic preparation after its existing settling delay. One attempt per page visit lasts at most 30 seconds; equivalent links share the original rule without extending its lifetime. Delegated events avoid scanning every link in the document. Source availability, href changes, ancestor movement/visibility, Save-Data, navigation, feature switches, and cleanup remain authoritative.

The live Progress test had no rule before interaction, then inserted the expected rule after actual pointer movement onto the native link. Profiling attachments initially caused Chrome to report `PrerenderingDisabledByDevTools`. Repeating in a clean test browser activated the prepared page (`activationStart` approximately 3,501 ms after prerender startup); all 24 previews and assignment shortcuts mounted. Fresh keyboard focus also prepared the destination. Feature/master switches removed the rule, and master re-enable allowed a new focus preparation. The profile's original enabled preferences were restored.

The rendering investigation instrumented query methods only in the extension's isolated execution context, preserving native query results and recording counts/times rather than DOM contents. An initial faulty instrumentation run was discarded. Corrected observations:

| Check | Before | After |
| --- | --- | --- |
| One observed Progress startup: selector calls | 10,137 | 3,232 |
| Same startup: measured selector time | About 18 ms | About 2 ms |
| Controlled 20 content-mutation batches: selector calls | 5,200 | 500 |
| Those batches: document-wide Classes discovery queries | 20 | 0 |
| Those batches: dropdown structure queries | 180 | 0 |

The controlled batches added and removed temporary comment nodes under the native course container; no student data or native actions were changed. Startup traces can differ with native request timing, and query timing has limited precision. These results establish reduced local rendering work, not a percentage improvement in total page-load time.

Classes discovery now stays inside native desktop/mobile navigation roots. Incremental identity tracking preserves modern uniqueness guards even when duplicate controls appear outside those roots. Header and content appearance updates have separate dirty scopes; navigation, root ambiguity, and root-role changes still reconcile the required branches. Peer review caught and fixed a still-matching root-ID transition that could leave stale markers. Regression coverage includes both transition directions, delayed/rerendered menus, hidden mobile search, native text/ARIA/visibility changes, and cleanup.

Final follow-up validation: `rtk pnpm check`, all **583** unit tests, production build, all **five** Chrome smoke tests, and `git diff --check` passed. Generated bundles and popup copy were rebuilt. No permissions were added; directory/preview read behavior was not expanded by this follow-up.

## Assignment breadcrumb correction

The live student assignment details component (`app-assignment-view-details`) renders its heading's **Assignments** anchor with `href="javascript:history.back()"`. CDP inspection found no separate click listener on that anchor. The action therefore depends on how the assignment was reached, and can return to an unrelated page or fail to return to Assignment Center after direct entry.

The extension replaces only that verified native back-action anchor on exact student assignment detail routes with the same-origin student Assignment Center URL. The legacy Assignment Center preference selects its direct legacy URL instead. This is a real href change with no event interception, preserving keyboard activation, modified clicks, and new-tab behavior. Scoped discovery handles delayed and rerendered native details; cleanup restores owned hrefs, while later native changes remain authoritative. The master switch controls this navigation correction.

Live checks passed after rebuilding and reloading the extension: opening a full assignment after Progress and clicking **Assignments** reached the modern center with all 24 native links; middle-click opened the center in a separate tab while retaining the assignment; keyboard Enter reached the prepared center (`activationStart` approximately 361 ms). Chrome swapped the target during activation, so the final keyboard result was verified through the active target rather than the superseded Puppeteer page. Legacy mode linked directly to and opened the legacy center. Master disable restored the native JavaScript href; re-enable restored the direct center link. Test preferences were returned to their original values.

Validation: `rtk pnpm check`, all **596** unit tests (including 13 breadcrumb regressions), `rtk pnpm build`, all **five** Chrome smoke tests, and `git diff --check` passed. Independent review found no further issue. The generated LMS bundle was rebuilt; no permissions were added.

## Formatted assignment titles

On 2026-10-13, the native Assignment Center's title anchors already contained rendered span elements in the inspected session. The extension's preview API reader previously displayed `ShortDescription` verbatim, so a title supplied as a rich-text span could expose its tags and numeric punctuation references in the preview. Preview labels and tab-title reads also needed consistent handling of literal rich strings.

Title normalization now recognizes a single whole-title formatting wrapper, extracts text in an unattached template, and decodes explicit entities exactly once after removing markup. Plain comparisons, generic types, mixed prose/code, unknown entity names, and nested encoding remain literal where appropriate. Already-rendered native child markup is read as text without another decoding pass. Title limits apply after normalization; an empty formatted API title falls back to the native preview target. Native title nodes, attributes, links, and event handlers remain untouched.

Peer review caught and corrected three boundary cases: semicolonless entity prefixes being decoded when another complete entity was present, separate sibling spans being mistaken for a single wrapper, and missing spacing before block elements. Additional regressions cover already-rendered literal tags/entities and unknown complete entity names. Synthetic fixtures use invented titles and responses rather than saved LMS content.

In Chrome for Testing with the rebuilt extension, a synthetic raw-span title produced the decoded Preview accessible label and a formatted API response produced a plain-text preview heading with zero child elements. Embedded script/event/image markup produced no execution, injected elements, or external requests. Assignment tab titles decoded correctly, preserved already-rendered literal code, followed native updates, and restored/recovered through both the title feature and master switches. The profile's original preferences were restored.

Validation: `rtk pnpm check`, all **612** unit tests (16 new regressions), `rtk pnpm build`, all **five** Chrome smoke tests, and `git diff --check` passed. The generated LMS bundle was rebuilt. This adds no requests, storage, or manifest permissions.
