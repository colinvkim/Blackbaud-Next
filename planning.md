# Blackbaud Next architecture

## Product

Improve everyday student workflows directly in native Blackbaud pages. Preserve native navigation and actions. Changes range from scoped presentation fixes to local controls; a separate LMS shell is outside this version’s scope.

## Implemented foundation

- One TypeScript project builds LMS, authentication, and popup IIFE bundles.
- `extension/manifest.json` and `assets/` are the sources for the unpacked `chrome/` output.
- A feature has an ID, settings predicate, route predicate, and synchronous mount returning cleanup.
- Context supplies the current URL, normalized settings, and an abort signal.
- Features declare mount-time settings dependencies and a page or document route scope. Missing declarations conservatively depend on every setting and the exact URL.
- Updates reconcile each feature independently. Unchanged features retain their controls, state, and abort signal; changed or disabled features cancel and clean up before replacements mount.
- Hash/Back navigation is handled immediately. URL polling also detects native history changes without patching Blackbaud’s JavaScript environment.
- Native DOM changes are observed in batches; incremental discovery examines added subtrees and identifying attributes. Feature controls are removed when their anchors disappear.
- A failing feature does not prevent other features from mounting.

## Settings

Schema version 2 replaces UI modes with `enabled` and independent feature switches. Normal normalizes to disabled; Enhanced and Next normalize to enabled. Legacy switch aliases are read without rewriting a full settings snapshot, so simultaneous first loads cannot overwrite newer choices. Saves write individual patches and the schema marker rather than overwriting other tabs’ choices. A Google account preference accepts a full email address or exact domain.

## Retained features

Login is an explicit, bounded flow across the school, Blackbaud sign-in, and a verified Google OAuth callback. Direct sign-in preserves native form controls. Exact school/account matching refuses ambiguity. Users can cancel automation across the flow, and metadata expires after five minutes. Error recovery is manual and limited.

Roster tools read the current native term picker, accept only semantic route identifiers or fresh requests belonging to the mounted roster, validate response shapes, deduplicate copy values, and abort obsolete requests. One mounted picker owns a single in-flight or completed read shared between copy actions for up to 15 seconds. Its key includes the view, selected term, roster kind, and roster ID; term/view changes, failures, and cleanup invalidate it. Raw roster data is never persisted.

Roster picker discovery stays within native class content, and directory discovery stays within its results container. Profile updates observe individual native rows/cards. Profile photo actions use an unambiguous native profile boundary and open only recognizable HTTPS photo URLs. Assignment compatibility is optional and restores native links on cleanup. Loading recovery offers a manual action after a sustained wait mask, suppresses explicit native errors, and uses a per-tab cooldown.

Appearance styles target native legacy components and retain school branding and native controls. Newer SKY components keep their own layouts. Every appearance change can be removed through the popup.

## Everyday workflow improvements

The modern Assignment Center has local shortcuts for all loaded rows, unfinished work, and work due today or tomorrow. Adapters read labeled due dates and native status text; shortcuts preserve native search, filters, collapsed groups, and server settings. Date comparisons use the local calendar and refresh at midnight.

Assignment previews add an explicit button beside native title links. A cancellable same-origin request validates the current student identity and requested assignment, retaining only display fields. Instructions are rebuilt with a limited set of text-formatting elements and safe links. The panel supports retry, Escape, focus return, and full native navigation for submissions and embedded content. No preview payload is persisted.

Helpful tab titles follow the current page and late native course or assignment headings. Resource Board search filters existing cards by title and description, temporarily compacts matching cards, and retains native actions. It preserves native card dimensions so Blackbaud can still calculate its layout when the window resizes during a search. Both features restore native state on cleanup.

The native desktop and mobile Classes menus gain local search. Class links retain their destination class, term, query parameters, and native click behavior while preserving the current Bulletin Board, Assignments, or Roster section. Unsupported sections keep the native destination. Cleanup restores native hrefs and filtered rows without overwriting newer native link changes.

Rendering containment such as `content-visibility: auto` remains an experiment for future profiling; it is not applied by this release.

## Verification and extension points

Run `rtk pnpm check`, `rtk pnpm test`, and `rtk pnpm build`. Synthetic fixtures contain no copied student records. Use the README smoke checklist against authenticated Blackbaud pages.

Future improvements should be a feature module plus a narrowly scoped adapter and regression coverage for its meaningful behavior. Expand school and page coverage from observed DOM evidence. Add richer rendered components only when a workflow requires them.
