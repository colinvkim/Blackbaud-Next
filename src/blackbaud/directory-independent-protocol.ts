// This bridge owns only a native directory route and its reversible shell.
// It exposes no credentials, extension APIs, or arbitrary page operations.
export const INDEPENDENT_DIRECTORY_REQUEST_EVENT = 'blackbaud-next:independent-directory-request-v1';
export const INDEPENDENT_DIRECTORY_RESPONSE_EVENT = 'blackbaud-next:independent-directory-response-v1';
export const INDEPENDENT_DIRECTORY_ATTRIBUTE = 'data-blackbaud-next-independent-directory';
export const INDEPENDENT_DIRECTORY_PENDING_ATTRIBUTE = 'data-blackbaud-next-independent-pending';
export const INDEPENDENT_DIRECTORY_GATE_LIFETIME = 60_000;

export type IndependentDirectoryRequest =
  | { action: 'enable' | 'heartbeat' | 'disable'; token: string }
  | { action: 'acquire' | 'original' | 'release'; token: string; directoryId: string };

export function independentDirectoryRequest(value: unknown): IndependentDirectoryRequest | null {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const request = JSON.parse(value) as Record<string, unknown>;
    if (!request || typeof request !== 'object' || Array.isArray(request) ||
      typeof request.token !== 'string' || !/^[a-z0-9-]{16,80}$/i.test(request.token)) return null;
    if (['enable', 'heartbeat', 'disable'].includes(String(request.action))) {
      if (request.directoryId !== undefined) return null;
      return request as unknown as IndependentDirectoryRequest;
    }
    if (!['acquire', 'original', 'release'].includes(String(request.action)) ||
      typeof request.directoryId !== 'string' || !/^[1-9]\d{0,14}$/.test(request.directoryId)) return null;
    return request as unknown as IndependentDirectoryRequest;
  } catch { return null; }
}
