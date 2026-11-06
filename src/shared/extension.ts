// A small typed boundary for the extension APIs used by this project.
export interface StorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

export interface StorageArea {
  get: (keys?: string | string[] | null) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (keys: string | string[]) => Promise<void>;
}

export interface MessageSender {
  id?: string;
  url?: string;
  documentId?: string;
  tab?: { id?: number };
  frameId?: number;
}

export type MessageListener = (message: unknown, sender: MessageSender, respond: (response: unknown) => void) => boolean | void;

export interface ExtensionApi {
  storage: {
    sync: StorageArea;
    local: StorageArea;
    session: StorageArea;
    onChanged: {
      addListener: (listener: (changes: Record<string, StorageChange>, area: string) => void) => void;
      removeListener: (listener: (changes: Record<string, StorageChange>, area: string) => void) => void;
    };
  };
  runtime: {
    id: string;
    getURL: (path: string) => string;
    sendMessage: (message: unknown) => Promise<unknown>;
    onMessage: {
      addListener: (listener: MessageListener) => void;
      removeListener: (listener: MessageListener) => void;
    };
  };
}

function currentExtensionApi(): ExtensionApi | undefined {
  const scope = globalThis as typeof globalThis & { chrome?: ExtensionApi; browser?: ExtensionApi };
  return scope.chrome ?? scope.browser;
}

export function hasExtensionContext(): boolean {
  return Boolean(currentExtensionApi()?.runtime?.id);
}

export function extensionApi(): ExtensionApi {
  const api = currentExtensionApi();
  if (!api?.storage) throw new Error('Extension storage is unavailable.');
  return api;
}
