import { ASSIGNMENT_ROW_SELECTOR, ASSIGNMENT_TOOLBAR_ELEMENT_SELECTOR, ASSIGNMENT_TOOLBAR_SELECTOR, isNativeAssignmentVisible, matchesAssignmentShortcut, readAssignmentRow } from '../blackbaud/assignment-list.ts';
import type { AssignmentShortcut, NativeAssignmentRow } from '../blackbaud/assignment-list.ts';
import { isAssignmentCenter } from '../blackbaud/routes.ts';
import { addStyle, createButton, watchAddedElements } from '../shared/dom.ts';
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
    let disposed = false;
    let rolloverTimer: ReturnType<typeof setTimeout> | undefined;
    const loaded = new Map<HTMLElement, NativeAssignmentRow | null>();
    const hidden = new Set<HTMLElement>();
    const toolbars = new Map<HTMLElement, {
      toolbar: HTMLDivElement;
      status: HTMLSpanElement;
      controls: Array<{ key: AssignmentShortcut; button: HTMLButtonElement; choose: () => void }>;
    }>();
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
      if (disposed || signal.aborted) return;
      clearHidden();
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
      if (queued || disposed || signal.aborted) return;
      queued = true;
      queueMicrotask(() => { queued = false; update(); });
    };

    // Discovery examines added subtrees. Each row owns its metadata and the
    // ancestor visibility that can change without replacing that row.
    const stopRows = watchAddedElements<HTMLElement>(ASSIGNMENT_ROW_SELECTOR, (element) => {
      let ancestors: HTMLElement[] = [];
      const currentAncestors = () => {
        const result: HTMLElement[] = [];
        for (let parent = element.parentElement; parent; parent = parent.parentElement) result.push(parent);
        return result;
      };
      const observer = new MutationObserver((records) => {
        const nextAncestors = currentAncestors();
        const moved = ancestors.length !== nextAncestors.length || ancestors.some((parent, index) => parent !== nextAncestors[index]);
        const metadataChanged = records.some((record) => element.contains(record.target));
        const visibilityChanged = records.some((record) => record.type === 'attributes' && ancestors.includes(record.target as HTMLElement));
        if (!moved && !metadataChanged && !visibilityChanged) return;
        if (moved) observeRow();
        if (moved || metadataChanged) loaded.set(element, readAssignmentRow(element));
        queueUpdate();
      });
      const observeRow = () => {
        observer.disconnect();
        observer.observe(element, {
          childList: true, subtree: true, characterData: true, attributes: true,
          attributeFilter: ['class', 'href', 'hidden', 'style', 'aria-hidden'],
        });
        ancestors = currentAncestors();
        for (const parent of ancestors) {
          // Direct child changes also identify moves into a different group.
          observer.observe(parent, {
            childList: true, attributes: true,
            attributeFilter: ['class', 'hidden', 'style', 'aria-hidden'],
          });
        }
      };
      observeRow();
      loaded.set(element, readAssignmentRow(element));
      queueUpdate();
      return () => {
        observer.disconnect();
        loaded.delete(element);
        queueUpdate();
      };
    }, signal);

    const stopToolbars = watchAddedElements<HTMLElement>(ASSIGNMENT_TOOLBAR_ELEMENT_SELECTOR, (nativeToolbar) => {
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
          if (disposed || signal.aborted || !toolbars.has(nativeToolbar)) return;
          selected = key;
          update();
        };
        button.addEventListener('click', choose);
        toolbar.append(button);
        return { key, button, choose };
      });
      toolbar.append(status);
      let parent: HTMLElement | null = null;
      const observer = new MutationObserver((records) => {
        if (nativeToolbar.parentElement !== parent ||
          (toolbars.has(nativeToolbar) && toolbar.previousElementSibling !== nativeToolbar) ||
          records.some((record) => nativeToolbar.contains(record.target))) refresh();
      });
      const refresh = (immediate = false) => {
        if (disposed || signal.aborted || !nativeToolbar.isConnected) return;
        if (nativeToolbar.parentElement !== parent) {
          parent = nativeToolbar.parentElement;
          observer.disconnect();
          observer.observe(nativeToolbar, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label'] });
          if (parent) observer.observe(parent, { childList: true });
        }
        if (nativeToolbar.matches(ASSIGNMENT_TOOLBAR_SELECTOR)) toolbars.set(nativeToolbar, { toolbar, status, controls });
        else { toolbars.delete(nativeToolbar); toolbar.remove(); }
        if (immediate) update();
        else queueUpdate();
      };
      refresh(true);
      return () => {
        observer.disconnect();
        toolbars.delete(nativeToolbar);
        for (const { button, choose } of controls) button.removeEventListener('click', choose);
        toolbar.remove();
        queueUpdate();
      };
    }, signal);

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
    document.addEventListener('visibilitychange', visible);
    scheduleRollover();
    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      stopToolbars();
      stopRows();
      clearTimeout(rolloverTimer);
      document.removeEventListener('visibilitychange', visible);
      clearHidden();
      removeStyle();
      signal.removeEventListener('abort', cleanup);
    };
    signal.addEventListener('abort', cleanup, { once: true });
    return cleanup;
  },
};
