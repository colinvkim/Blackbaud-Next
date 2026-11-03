import { ASSIGNMENT_ROW_SELECTOR, readAssignmentStaticStatus, readAssignmentRow } from '../blackbaud/assignment-list.ts';
import { isAssignmentCompletionPage, isNativeAssignmentStatusAvailable } from '../blackbaud/assignment-status.ts';
import { createAttributeOwnership } from '../shared/attribute-ownership.ts';
import { observeElementContext, watchAddedElements } from '../shared/dom.ts';
import { createIcon } from '../shared/icons.ts';
import { createScope } from '../shared/scope.ts';
import type { Feature } from '../shared/types.ts';

const styles = `
app-assignment-status-display:has(> [data-bn-assignment-status]) { font: inherit; }
[data-bn-assignment-status] { align-items: center; gap: 8px; min-height: 32px; color: var(--bn-text); font-weight: 600; line-height: 1.1; }
[data-bn-assignment-status="Graded"] > .bn-icon { color: #27613a; }
[data-bn-assignment-status="Missing"] > .bn-icon { color: #b42318; }
[data-bn-assignment-status="In progress"] > .bn-icon { color: #8a5700; }
[data-bn-assignment-native-icon="true"] { display: none !important; }
@media (max-width: 480px), (pointer: coarse) { [data-bn-assignment-status] { min-height: 44px; } }
`;
const staticStatusIcons = { Graded: 'clipboard-check', Missing: 'circle-alert', 'In progress': 'clock-3' } as const;

export const assignmentStatusLabelsFeature: Feature = {
  id: 'assignment-status-labels',
  settingsKeys: [],
  enabled: (settings) => settings.assignmentStatusLabels && !settings.oldAssignmentCenter,
  matches: isAssignmentCompletionPage,
  mount: ({ url, signal: parentSignal }) => {
    if (parentSignal.aborted) return;
    const scope = createScope(parentSignal);
    const { signal } = scope;
    const ownership = createAttributeOwnership();
    scope.style('assignment-status-labels', styles);
    scope.add(ownership.clear);
    scope.add(watchAddedElements<HTMLElement>(ASSIGNMENT_ROW_SELECTOR, (row) => {
      let staticStatus: (NonNullable<ReturnType<typeof readAssignmentStaticStatus>> & { graphic: SVGSVGElement }) | null = null;
      const restoreStaticStatus = () => {
        if (!staticStatus) return;
        staticStatus.graphic.remove();
        ownership.restore(staticStatus.container, 'data-bn-assignment-status');
        ownership.restore(staticStatus.icon, 'data-bn-assignment-native-icon');
        staticStatus = null;
      };
      const update = () => {
        if (signal.aborted || window.location.href !== url.href) return;
        const nativeStatic = readAssignmentRow(row) && readAssignmentStaticStatus(row);
        const visibleStatic = nativeStatic && isNativeAssignmentStatusAvailable(nativeStatic.caption) ? nativeStatic : null;
        if (staticStatus && (staticStatus.container !== visibleStatic?.container || staticStatus.icon !== visibleStatic?.icon || staticStatus.status !== visibleStatic?.status)) restoreStaticStatus();
        if (visibleStatic) {
          if (!staticStatus) staticStatus = { ...visibleStatic, graphic: createIcon(staticStatusIcons[visibleStatic.status], row.ownerDocument) };
          ownership.mark(staticStatus.container, 'data-bn-assignment-status', visibleStatic.status);
          ownership.mark(staticStatus.icon, 'data-bn-assignment-native-icon', 'true');
          if (staticStatus.graphic.parentElement !== staticStatus.container) staticStatus.container.insertBefore(staticStatus.graphic, staticStatus.icon);
        }
      };
      const stopContext = observeElementContext(row, update, { subtree: true });
      update();
      return () => { stopContext(); restoreStaticStatus(); };
    }, signal));
    return scope.dispose;
  },
};
