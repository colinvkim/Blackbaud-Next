import { ASSIGNMENT_TOOLBAR_SELECTOR, isNativeAssignmentVisible, matchesAssignmentShortcut, readAssignmentRows } from '../blackbaud/assignment-list.ts';
import type { AssignmentShortcut } from '../blackbaud/assignment-list.ts';
import { isAssignmentCenter } from '../blackbaud/routes.ts';
import { addStyle, createButton, observeDom, watchElements } from '../shared/dom.ts';
import type { IconName } from '../shared/icons.ts';
import type { Feature } from '../shared/types.ts';

const hiddenAttribute = 'data-blackbaud-next-shortcut-hidden';
const shortcuts: Array<{ key: AssignmentShortcut; label: string; icon: IconName }> = [
  { key: 'all', label: 'All loaded', icon: 'clipboard-list' },
  { key: 'unfinished', label: 'Unfinished', icon: 'list-filter' },
  { key: 'today', label: 'Due today', icon: 'calendar' },
  { key: 'tomorrow', label: 'Due tomorrow', icon: 'calendar' },
];

const styles = `
[${hiddenAttribute}="true"] { display: none !important; }
.bn-assignment-shortcuts { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--bn-border, #dde3e8); background: var(--bn-surface, #fff); color: var(--bn-text, #222a35); font: 14px/1.5 var(--bn-font, "Blackbaud Sans", "Helvetica Neue", Arial, sans-serif); }
.bn-assignment-shortcuts .bn-button[aria-pressed="true"] { background: var(--bn-accent-soft, #eef6fa); color: var(--bn-accent-hover, #004d7a); border-color: var(--bn-accent, #0066a1); }
.bn-assignment-shortcuts .bn-button[aria-pressed="true"]:hover { background: var(--bn-accent, #0066a1); color: #fff; border-color: var(--bn-accent, #0066a1); }
.bn-assignment-shortcuts .bn-tool-status { margin-left: 4px; }
@media (max-width: 480px) { .bn-assignment-shortcuts { padding: 12px; } .bn-assignment-shortcuts .bn-tool-status { flex-basis: 100%; margin: 2px 0 0; } }
`;

export const assignmentShortcutsFeature: Feature = {
  id: 'assignment-shortcuts',
  settingsKeys: [],
  routeScope: 'document',
  enabled: (settings) => settings.assignmentShortcuts,
  matches: isAssignmentCenter,
  mount: ({ signal }) => {
    if (signal.aborted) return;
    const removeStyle = addStyle('assignment-shortcuts', styles);
    let selected: AssignmentShortcut = 'all';
    const stopWatching = watchElements<HTMLElement>(ASSIGNMENT_TOOLBAR_SELECTOR, (nativeToolbar) => {
      const page = nativeToolbar.ownerDocument;
      const toolbar = page.createElement('div');
      toolbar.className = 'bn-assignment-shortcuts';
      toolbar.setAttribute('role', 'group');
      toolbar.setAttribute('aria-label', 'Assignment shortcuts');
      toolbar.title = 'Shortcuts apply to the assignments loaded by the native filters.';
      const status = page.createElement('span');
      status.className = 'bn-tool-status';
      status.setAttribute('role', 'status');
      const controls = shortcuts.map(({ key, label, icon }) => {
        const button = createButton(label, icon);
        const choose = () => {
          if (disposed || signal.aborted) return;
          selected = key;
          update();
        };
        button.addEventListener('click', choose);
        toolbar.append(button);
        return { key, button, choose };
      });
      toolbar.append(status);
      const hidden = new Set<HTMLElement>();
      let textRows = new Set<HTMLElement>();
      let disposed = false;
      let rolloverTimer: ReturnType<typeof setTimeout> | undefined;
      // Angular also updates existing text nodes without replacing children.
      // Watch that metadata only in the known assignment rows.
      const textObserver = new MutationObserver(() => update());

      const clearHidden = () => {
        for (const element of hidden) {
          if (element.getAttribute(hiddenAttribute) === 'true') element.removeAttribute(hiddenAttribute);
        }
        hidden.clear();
      };
      const hide = (element: HTMLElement) => {
        element.setAttribute(hiddenAttribute, 'true');
        hidden.add(element);
      };
      const update = () => {
        if (disposed || signal.aborted || !nativeToolbar.isConnected) return;
        if (toolbar.previousElementSibling !== nativeToolbar) nativeToolbar.insertAdjacentElement('afterend', toolbar);
        // Clear only our presentation before inspecting native visibility. This
        // is synchronous and its attribute is not watched by the shared hub.
        clearHidden();
        const loaded = readAssignmentRows(page);
        const nextTextRows = new Set(loaded.map((row) => row.element));
        if (textRows.size !== nextTextRows.size || [...textRows].some((row) => !nextTextRows.has(row))) {
          textObserver.disconnect();
          for (const row of nextTextRows) textObserver.observe(row, { subtree: true, characterData: true });
          textRows = nextTextRows;
        }
        const rows = loaded.filter((row) => isNativeAssignmentVisible(row.element));
        const now = new Date();
        let count = 0;
        const groups = new Map<HTMLElement, boolean>();
        for (const row of rows) {
          const matches = matchesAssignmentShortcut(row, selected, now);
          if (matches) count += 1;
          else hide(row.element);
          if (row.group) groups.set(row.group, (groups.get(row.group) ?? false) || matches);
        }
        for (const [group, hasMatches] of groups) if (!hasMatches && selected !== 'all') hide(group);
        for (const { key, button } of controls) {
          const pressed = String(key === selected);
          if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
        }
        const message = `Showing ${count} of ${rows.length} loaded assignments${count === 0 && rows.length > 0 ? '. No matches; native filters still apply.' : '.'}`;
        if (status.textContent !== message) status.textContent = message;
      };
      const scheduleRollover = () => {
        clearTimeout(rolloverTimer);
        const now = new Date();
        const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        rolloverTimer = setTimeout(() => {
          if (disposed || signal.aborted) return;
          update();
          scheduleRollover();
        }, Math.max(1, nextDay.getTime() - now.getTime()));
      };
      const visible = () => { update(); scheduleRollover(); };
      page.addEventListener('visibilitychange', visible);
      const stop = observeDom(update, signal);
      scheduleRollover();
      return () => {
        disposed = true;
        stop();
        textObserver.disconnect();
        textRows.clear();
        clearTimeout(rolloverTimer);
        page.removeEventListener('visibilitychange', visible);
        for (const { button, choose } of controls) button.removeEventListener('click', choose);
        clearHidden();
        toolbar.remove();
      };
    }, signal);
    const cleanup = () => {
      stopWatching();
      removeStyle();
      signal.removeEventListener('abort', cleanup);
    };
    signal.addEventListener('abort', cleanup, { once: true });
    return cleanup;
  },
};
