import { isLmsPage } from './routes.ts';

export const ASSIGNMENT_STATUS_REQUEST_EVENT = 'blackbaud-next:assignment-status-request-v1';
export const ASSIGNMENT_STATUS_RESPONSE_EVENT = 'blackbaud-next:assignment-status-response-v1';

export type AssignmentStatusValue = -1 | 0 | 1 | 2;
export type AssignmentStatusRequest =
  | { action: 'arm'; token: string; assignmentIndexId: number; assignmentStatus: AssignmentStatusValue }
  | { action: 'cancel'; token: string };
export type AssignmentStatusResponse =
  | { token: string; status: 'ready' | 'sent' | 'saved' | 'released' }
  | { token: string; status: 'failed'; httpStatus: number }
  | { token: string; status: 'unavailable'; reason: 'busy' | 'unsupported' | 'timeout' };

export function isAssignmentStatusPage(url: URL): boolean {
  return isLmsPage(url) && !url.username && !url.password &&
    /^\/lms-assignment\/assignment-center\/student\/?$/.test(url.pathname);
}

function protocolValue(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

function validToken(value: unknown): value is string {
  return typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value);
}

export function assignmentStatusRequest(value: unknown): AssignmentStatusRequest | null {
  const request = protocolValue(value);
  if (!request || !validToken(request.token)) return null;
  if (request.action === 'cancel') return { action: 'cancel', token: request.token };
  if (request.action !== 'arm' || typeof request.assignmentIndexId !== 'number' ||
    !Number.isSafeInteger(request.assignmentIndexId) || request.assignmentIndexId <= 0 ||
    (request.assignmentStatus !== -1 && request.assignmentStatus !== 0 && request.assignmentStatus !== 1 && request.assignmentStatus !== 2)) return null;
  return { action: 'arm', token: request.token, assignmentIndexId: request.assignmentIndexId, assignmentStatus: request.assignmentStatus };
}

export function assignmentStatusResponse(value: unknown): AssignmentStatusResponse | null {
  const response = protocolValue(value);
  if (!response || !validToken(response.token)) return null;
  switch (response.status) {
    case 'ready': case 'sent': case 'saved': case 'released':
      return { token: response.token, status: response.status };
    case 'failed':
      return typeof response.httpStatus === 'number' && Number.isInteger(response.httpStatus) && response.httpStatus >= 0 && response.httpStatus <= 999
        ? { token: response.token, status: 'failed', httpStatus: response.httpStatus } : null;
    case 'unavailable':
      return response.reason === 'busy' || response.reason === 'unsupported' || response.reason === 'timeout'
        ? { token: response.token, status: 'unavailable', reason: response.reason } : null;
    default: return null;
  }
}
