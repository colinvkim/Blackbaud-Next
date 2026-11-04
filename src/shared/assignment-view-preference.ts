import { requestCoordinator } from './coordinator.ts';

export type AssignmentCenterView = 'calendar' | 'list' | 'classic';

export function isAssignmentCenterView(value: unknown): value is AssignmentCenterView {
  return value === 'calendar' || value === 'list' || value === 'classic';
}

export async function getAssignmentCenterView(): Promise<AssignmentCenterView | null> {
  const view = await requestCoordinator<unknown>({ channel: 'blackbaud-next-coordinator-v1', kind: 'assignment-view', request: { action: 'get' } });
  return isAssignmentCenterView(view) ? view : null;
}

export function rememberAssignmentCenterView(view: AssignmentCenterView): Promise<void> {
  return requestCoordinator({ channel: 'blackbaud-next-coordinator-v1', kind: 'assignment-view', request: { action: 'set', view } });
}
