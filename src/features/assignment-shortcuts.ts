import { ASSIGNMENT_ROW_SELECTOR, ASSIGNMENT_TOOLBAR_ELEMENT_SELECTOR, ASSIGNMENT_TOOLBAR_SELECTOR, isNativeAssignmentVisible, matchesAssignmentShortcut, readAssignmentRow } from '../blackbaud/assignment-list.ts';
import type { AssignmentShortcut, NativeAssignmentRow } from '../blackbaud/assignment-list.ts';
import { isAssignmentCenter } from '../blackbaud/routes.ts';
import { createAttributeOwnership } from '../shared/attribute-ownership.ts';
import { createButton, markOwned, observeDom, observeElementContext, watchAddedElements } from '../shared/dom.ts';
import { createScope } from '../shared/scope.ts';
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
.bn-assignment-shortcuts { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--bn-border); background: var(--bn-surface); color: var(--bn-text); font: 14px/1.5 var(--bn-font); }
.bn-assignment-shortcuts .bn-button[aria-pressed="true"] { background: var(--bn-accent-soft); color: var(--bn-accent-hover); border-color: var(--bn-accent); }
.bn-assignment-shortcuts .bn-button[aria-pressed="true"]:hover { background: var(--bn-accent); color: #fff; border-color: var(--bn-accent); }
.bn-assignment-shortcuts .bn-tool-status { margin-left: 4px; }
@media (max-width: 480px) { .bn-assignment-shortcuts { padding: 12px; } .bn-assignment-shortcuts .bn-tool-status { flex-basis: 100%; margin: 2px 0 0; } }
`;

export const assignmentShortcutsFeature: Feature = {
  id: 'assignment-shortcuts',
  settingsKeys: [],
  routeScope: 'document',
  enabled: (settings) => settings.assignmentShortcuts,
  matches: isAssignmentCenter,
  mount: ({ signal: parentSignal }) => {
    if (parentSignal.aborted) return;
    const scope = createScope(parentSignal);
    const { signal } = scope;
    scope.style('assignment-shortcuts', styles);
    const ownership = createAttributeOwnership();
    scope.add(ownership.clear);
    let selected: AssignmentShortcut = 'all';
    let rolloverTimer: ReturnType<typeof setTimeout> | undefined;
    const loaded = new Map<HTMLElement, NativeAssignmentRow | null>();
    const toolbars = new Map<HTMLElement, {
      toolbar: HTMLDivElement;
      status: HTMLSpanElement;
      controls: Array<{ key: AssignmentShortcut; button: HTMLButtonElement }>;
    }>();
    const hide = (element: HTMLElement) => ownership.mark(element, hiddenAttribute, 'true');
    const update = () => {
      if (signal.aborted) return;
      ownership.clear();
      if (!toolbars.size) return;
      const rows = [...loaded.values()].filter((row): row is NativeAssignmentRow => row !== null && isNativeAssignmentVisible(row.element));
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
      const message = `Showing ${count} of ${rows.length} loaded assignments${count === 0 && rows.length > 0 ? '. No matches; native filters still apply.' : '.'}`;
      for (const [nativeToolbar, { toolbar, status, controls }] of toolbars) {
        if (toolbar.previousElementSibling !== nativeToolbar) nativeToolbar.insertAdjacentElement('afterend', toolbar);
        for (const { key, button } of controls) {
          const pressed = String(key === selected);
          if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
        }
        if (status.textContent !== message) status.textContent = message;
      }
    };
    let queued = false;
    const queueUpdate = () => {
      if (queued || signal.aborted) return;
      queued = true;
      queueMicrotask(() => { queued = false; update(); });
    };

    const stopRows = watchAddedElements<HTMLElement>(ASSIGNMENT_ROW_SELECTOR, (element) => {
      loaded.set(element, readAssignmentRow(element));
      queueUpdate();
      const stopContext = observeElementContext(element, ({ moved, contents }) => {
        if (moved || contents) loaded.set(element, readAssignmentRow(element));
        queueUpdate();
      }, { subtree: true });
      return () => {
        stopContext();
        loaded.delete(element);
        queueUpdate();
      };
    }, signal);

    const stopToolbars = watchAddedElements<HTMLElement>(ASSIGNMENT_TOOLBAR_ELEMENT_SELECTOR, (nativeToolbar) => {
      const page = nativeToolbar.ownerDocument;
      const toolbarScope = createScope(signal);
      const toolbar = markOwned(page.createElement('div'));
      toolbarScope.add(() => toolbar.remove());
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
          if (signal.aborted || !toolbars.has(nativeToolbar)) return;
          selected = key;
          update();
        };
        toolbarScope.listen(button, 'click', choose);
        toolbar.append(button);
        return { key, button };
      });
      toolbar.append(status);
      let parent: HTMLElement | null = null;
      let stopParent = () => {};
      const refresh = (immediate = false) => {
        if (signal.aborted || !nativeToolbar.isConnected) return;
        if (nativeToolbar.parentElement !== parent) {
          stopParent();
          parent = nativeToolbar.parentElement;
          if (parent) stopParent = observeDom(() => {
            if (nativeToolbar.parentElement !== parent ||
              (toolbars.has(nativeToolbar) && toolbar.previousElementSibling !== nativeToolbar)) refresh();
          }, toolbarScope.signal, parent);
        }
        if (nativeToolbar.matches(ASSIGNMENT_TOOLBAR_SELECTOR)) toolbars.set(nativeToolbar, { toolbar, status, controls });
        else { toolbars.delete(nativeToolbar); toolbar.remove(); }
        if (immediate) update();
        else queueUpdate();
      };
      toolbarScope.add(() => stopParent());
      toolbarScope.add(observeElementContext(nativeToolbar, () => refresh(), { subtree: true }));
      refresh(true);
      toolbarScope.add(() => {
        toolbars.delete(nativeToolbar);
        queueUpdate();
      });
      return toolbarScope.dispose;
    }, signal);

    const scheduleRollover = () => {
      clearTimeout(rolloverTimer);
      const now = new Date();
      const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      rolloverTimer = setTimeout(() => {
        if (signal.aborted) return;
        update();
        scheduleRollover();
      }, Math.max(1, nextDay.getTime() - now.getTime()));
    };
    const visible = () => { update(); scheduleRollover(); };
    scope.listen(document, 'visibilitychange', visible);
    scheduleRollover();
    scope.add(() => clearTimeout(rolloverTimer));
    scope.add(stopRows);
    scope.add(stopToolbars);
    return scope.dispose;
  },
};
