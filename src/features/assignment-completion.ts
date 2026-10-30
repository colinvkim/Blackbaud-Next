import { ASSIGNMENT_ROW_SELECTOR } from '../blackbaud/assignment-list.ts';
import { AssignmentCompletionError, COMPLETION_NATIVE_ATTRIBUTE, completionSettledEvent, isAssignmentCompletionBusy, isAssignmentCompletionPage, readAssignmentCompletionTarget, setAssignmentCompletion } from '../blackbaud/assignment-status.ts';
import type { AssignmentCompletionTarget, ManualAssignmentStatus } from '../blackbaud/assignment-status.ts';
import { assignmentPreviewReturnFocus } from '../blackbaud/assignment-preview.ts';
import { createAttributeOwnership } from '../shared/attribute-ownership.ts';
import { createButton, isActionable, markOwned, observeElementContext, watchAddedElements } from '../shared/dom.ts';
import { createScope } from '../shared/scope.ts';
import type { Feature } from '../shared/types.ts';

const styles = `
[${COMPLETION_NATIVE_ATTRIBUTE}="true"] { display: none !important; }
.bn-completion-control { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 8px; color: var(--bn-text); font: inherit; }
.bn-completion-control label { display: inline-flex; align-items: center; gap: 8px; min-height: 32px; margin: 0; cursor: pointer; }
.bn-completion-control input { width: 18px; height: 18px; margin: 0; accent-color: var(--bn-accent); }
.bn-completion-control input:focus-visible { outline: 2px solid var(--bn-accent); outline-offset: 4px; }
.bn-completion-control input:disabled { cursor: wait; }
.bn-completion-overdue { font-size: 12px; color: var(--bn-muted); }
.bn-completion-feedback { font-size: 12px; color: var(--bn-muted); }
.bn-completion-control [hidden] { display: none !important; }
.bn-completion-notice { position: fixed; right: 20px; bottom: 20px; z-index: 100001; display: flex; align-items: center; flex-wrap: wrap; gap: 10px; box-sizing: border-box; max-width: min(460px, calc(100vw - 32px)); padding: 12px 16px; border: 1px solid var(--bn-border); border-radius: var(--bn-radius); background: var(--bn-surface); color: var(--bn-text); box-shadow: 0 4px 20px #222a3520; font: 14px/1.5 var(--bn-font); }
.bn-completion-notice > span { flex: 1 1 160px; overflow-wrap: anywhere; }
.bn-completion-notice .bn-button { min-height: 32px; }
@media (max-width: 480px), (pointer: coarse) { .bn-completion-control label, .bn-completion-notice .bn-button { min-height: 44px; } .bn-completion-notice { right: 16px; bottom: 16px; } }
`;

interface CompletionControl {
  target: AssignmentCompletionTarget;
  ui: HTMLSpanElement;
  input: HTMLInputElement;
  caption: HTMLSpanElement;
  overdue: HTMLSpanElement;
  feedback: HTMLSpanElement;
  scope: ReturnType<typeof createScope>;
}

export const assignmentCompletionFeature: Feature = {
  id: 'assignment-completion',
  settingsKeys: [],
  enabled: (settings) => settings.assignmentCompletion && !settings.oldAssignmentCenter,
  matches: isAssignmentCompletionPage,
  mount: ({ url, signal: parentSignal }) => {
    if (parentSignal.aborted) return;
    const scope = createScope(parentSignal);
    const { signal } = scope;
    scope.style('assignment-completion', styles);
    const ownership = createAttributeOwnership();
    scope.add(ownership.clear);
    const controls = new Map<HTMLElement, CompletionControl>();
    const updates = new Set<() => void>();
    const nativeOnly = new Set<string>();
    let noticeScope: ReturnType<typeof createScope> | null = null;
    const current = () => !signal.aborted && window.location.href === url.href;
    const updateAll = () => { for (const update of updates) update(); };
    const findTarget = (id: string) => [...controls.values()].find((control) => control.target.assignmentIndexId === id);
    const clearNotice = () => { noticeScope?.dispose(); noticeScope = null; };
    scope.add(clearNotice);
    const showNotice = (message: string, action?: { label: string; run(): void }, error = false) => {
      clearNotice();
      const panel = markOwned(document.createElement('div'));
      const panelScope = createScope(signal);
      noticeScope = panelScope;
      panelScope.add(() => panel.remove());
      panel.className = 'bn-completion-notice';
      panel.setAttribute('role', error ? 'alert' : 'status');
      const text = document.createElement('span');
      text.textContent = message;
      panel.append(text);
      let actionButton: HTMLButtonElement | null = null;
      if (action) {
        actionButton = createButton(action.label);
        panelScope.listen(actionButton, 'click', () => { if (current() && !isAssignmentCompletionBusy()) action.run(); });
        panel.append(actionButton);
      }
      const dismiss = createButton('Dismiss', 'x');
      panelScope.listen(dismiss, 'click', clearNotice);
      panel.append(dismiss);
      (document.body ?? document.documentElement).append(panel);
      return actionButton;
    };
    const restoreControl = (control: CompletionControl) => control.scope.dispose();
    const focusAfterChange = (id: string) => {
      const source = findTarget(id);
      if (source && isActionable(source.input)) { source.input.focus({ preventScroll: true }); return; }
      const ordered = [...controls.values()];
      const index = ordered.findIndex((control) => control.target.assignmentIndexId === id);
      const next = [...ordered.slice(index + 1), ...ordered.slice(0, index)].find((control) => isActionable(control.input) && !control.input.disabled);
      (next?.input ?? assignmentPreviewReturnFocus(document))?.focus({ preventScroll: true });
    };
    const changeStatus = async (target: AssignmentCompletionTarget, desired: 'unfinished' | ManualAssignmentStatus, undo = false) => {
      if (!current() || isAssignmentCompletionBusy()) return;
      const row = target.row;
      const focused = document.activeElement;
      const hadFocus = focused === controls.get(row)?.input || undo;
      const restoreFocus = () => hadFocus && (document.activeElement === focused ||
        document.activeElement === document.body || document.activeElement === document.documentElement);
      clearNotice();
      try {
        const save = setAssignmentCompletion(target, desired, signal);
        updateAll();
        const result = await save;
        if (!current()) return;
        updateAll();
        const runUndo = () => {
          const control = findTarget(target.assignmentIndexId);
          const latest = control && readAssignmentCompletionTarget(control.target.row);
          if (!latest) {
            showNotice('Show this assignment in the native list to undo its status change.', { label: 'Undo', run: runUndo });
          } else if (latest.status !== result.current) {
            showNotice('The assignment status changed again. Use its current completion control.');
          } else {
            void changeStatus(latest, result.previous, true);
          }
        };
        showNotice(result.current === 'completed' ? 'Marked completed.' : 'Marked to do.',
          result.previous === result.current ? undefined : { label: 'Undo', run: runUndo });
        if (restoreFocus()) queueMicrotask(() => { if (current() && restoreFocus()) focusAfterChange(target.assignmentIndexId); });
      } catch (error) {
        if (!current()) return;
        if (error instanceof AssignmentCompletionError && (error.kind === 'unsupported' || error.kind === 'unconfirmed')) {
          nativeOnly.add(target.assignmentIndexId);
          updateAll();
          showNotice(error.kind === 'unconfirmed'
            ? 'The save could not be confirmed. Check the native assignment status before changing it again.'
            : 'Use the native status control for this assignment.', undefined, true);
          const native = readAssignmentCompletionTarget(row)?.button;
          if (restoreFocus() && native && isActionable(native)) native.focus({ preventScroll: true });
        } else {
          const retry = showNotice('Could not save the assignment status.', { label: 'Retry', run: () => {
            const control = findTarget(target.assignmentIndexId);
            const latest = control && readAssignmentCompletionTarget(control.target.row);
            if (latest) void changeStatus(latest, desired, undo);
            else showNotice('Show this assignment in the native list to retry its status change.', undefined, true);
          } }, true);
          if (restoreFocus()) retry?.focus({ preventScroll: true });
        }
      } finally {
        if (current()) updateAll();
      }
    };
    const stopRows = watchAddedElements<HTMLElement>(ASSIGNMENT_ROW_SELECTOR, (row) => {
      let control: CompletionControl | null = null;
      const update = () => {
        if (!current()) return;
        const target = readAssignmentCompletionTarget(row);
        if (!target || nativeOnly.has(target.assignmentIndexId) ||
          (control && (target.component !== control.target.component || target.button !== control.target.button))) {
          if (control) { restoreControl(control); controls.delete(row); control = null; }
        }
        if (!target || nativeOnly.has(target.assignmentIndexId)) return;
        if (!control) {
          const ui = markOwned(document.createElement('span'));
          const controlScope = createScope(signal);
          controlScope.add(() => { ui.remove(); ownership.restore(target.component, COMPLETION_NATIVE_ATTRIBUTE); });
          ui.className = 'bn-completion-control';
          const label = document.createElement('label');
          const input = document.createElement('input');
          input.type = 'checkbox';
          const caption = document.createElement('span');
          const overdue = document.createElement('span');
          overdue.className = 'bn-completion-overdue';
          overdue.textContent = 'Overdue';
          const feedback = document.createElement('span');
          feedback.className = 'bn-completion-feedback';
          feedback.setAttribute('role', 'status');
          label.append(input, caption);
          ui.append(label, overdue, feedback);
          const change = () => {
            const latest = readAssignmentCompletionTarget(row);
            const checked = input.checked;
            if (latest && isActionable(input) && !input.disabled) void changeStatus(latest, checked ? 'completed' : 'unfinished');
            update();
          };
          const stopClick = (event: MouseEvent) => event.stopPropagation();
          const stopKey = (event: KeyboardEvent) => { if (event.key === ' ' || event.key === 'Enter') event.stopPropagation(); };
          controlScope.listen(input, 'change', change);
          controlScope.listen(ui, 'click', stopClick);
          controlScope.listen(ui, 'keydown', stopKey);
          control = { target, ui, input, caption, overdue, feedback, scope: controlScope };
          controls.set(row, control);
          ownership.mark(target.component, COMPLETION_NATIVE_ATTRIBUTE, 'true');
        }
        control.target = target;
        if (control.ui.previousElementSibling !== target.component) target.component.insertAdjacentElement('afterend', control.ui);
        const checked = target.status === 'completed';
        if (control.input.checked !== checked) control.input.checked = checked;
        const busy = isAssignmentCompletionBusy();
        if (control.input.disabled !== busy) control.input.disabled = busy;
        const accessible = `Completed: ${target.title || 'Assignment'}`;
        if (control.input.getAttribute('aria-label') !== accessible) control.input.setAttribute('aria-label', accessible);
        const caption = target.status === 'completed' ? 'Completed' : 'To do';
        if (control.caption.textContent !== caption) control.caption.textContent = caption;
        const overdue = target.status === 'overdue';
        if (control.overdue.hidden === overdue) control.overdue.hidden = !overdue;
        const saving = isAssignmentCompletionBusy(target.assignmentIndexId) ? 'Saving…' : '';
        if (control.feedback.textContent !== saving) control.feedback.textContent = saving;
      };
      const stopContext = observeElementContext(row, update, { subtree: true });
      updates.add(update);
      update();
      return () => {
        stopContext();
        updates.delete(update);
        if (control) restoreControl(control);
        controls.delete(row);
      };
    }, signal);
    scope.add(stopRows);
    scope.listen(document, completionSettledEvent, updateAll);
    return scope.dispose;
  },
};
