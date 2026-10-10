// This channel carries only directory data already available to the page.
// It exposes no extension APIs, credentials, or arbitrary page operations.
export const DIRECTORY_REQUEST_EVENT = 'blackbaud-next:directory-request-v1';
export const DIRECTORY_RESPONSE_EVENT = 'blackbaud-next:directory-response-v1';
export const DIRECTORY_OWNER_ATTRIBUTE = 'data-blackbaud-next-directory-owner';
export const DIRECTORY_NATIVE_ATTRIBUTE = 'data-blackbaud-next-directory-native';
export const DIRECTORY_UI_ATTRIBUTE = 'data-blackbaud-next-directory-ui';
export const DIRECTORY_LEASE_LIFETIME = 60_000;

export interface DirectoryRequest {
  action: 'acquire' | 'activate' | 'heartbeat' | 'release';
  token: string;
  directoryId: string;
  mode?: 'metadata';
}

export function directoryRequest(value: unknown): DirectoryRequest | null {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const request = JSON.parse(value) as Record<string, unknown>;
    if (!['acquire', 'activate', 'heartbeat', 'release'].includes(String(request.action)) ||
      typeof request.token !== 'string' || !/^[a-z0-9-]{16,80}$/i.test(request.token) ||
      typeof request.directoryId !== 'string' || !/^[1-9]\d{0,14}$/.test(request.directoryId) ||
      (request.mode !== undefined && request.mode !== 'metadata')) return null;
    return request as unknown as DirectoryRequest;
  } catch { return null; }
}
