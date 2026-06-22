export type NextConnectionState = "checking" | "connected" | "fallback";

export interface NextUserStatus {
  UnreadMessageCount?: number;
  TokenValid?: boolean;
  MinutesSinceActive?: number;
  AuthUsingBbid?: boolean;
  MaxConcurrentId?: number;
  CurrentVersion?: string;
}

export interface NextPageRoute {
  id: "student-progress";
  label: string;
}

export interface NextBootstrapPayload {
  connection: NextConnectionState;
  errorMessage: string;
  nativeHidden: boolean;
  route: {
    href: string;
    hash: string;
    nextPage: NextPageRoute | null;
    schoolHostname: string;
    shellKind: string;
  };
  session: NextUserStatus | null;
  settings: {
    uiMode: string;
  };
  updatedAt: string;
}

type NextBridgeAction = "bootstrap" | "refresh-session" | "toggle-native";

interface NextBridgeResponse<TPayload> {
  channel: typeof responseChannel;
  requestId: string;
  ok: boolean;
  payload?: TPayload;
  error?: string;
}

const requestChannel = "blackbaud-next:request";
const responseChannel = "blackbaud-next:response";
const eventChannel = "blackbaud-next:event";
let requestIndex = 0;

export function requestHost<TPayload>(
  action: NextBridgeAction,
): Promise<TPayload> {
  return new Promise((resolve, reject) => {
    const requestId = `${Date.now()}-${requestIndex + 1}`;
    requestIndex += 1;

    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", handleResponse);
      reject(new Error("Next host did not respond."));
    }, 8000);

    function handleResponse(event: MessageEvent<NextBridgeResponse<TPayload>>) {
      if (event.source !== window || event.origin !== window.location.origin) {
        return;
      }

      const detail = event.data;
      if (
        !detail ||
        detail.channel !== responseChannel ||
        detail.requestId !== requestId
      ) {
        return;
      }

      window.clearTimeout(timeout);
      window.removeEventListener("message", handleResponse);

      if (detail.ok && detail.payload) {
        resolve(detail.payload);
        return;
      }

      reject(new Error(detail.error || "Next host request failed."));
    }

    window.addEventListener("message", handleResponse);
    window.postMessage(
      {
        action,
        channel: requestChannel,
        requestId,
      },
      window.location.origin,
    );
  });
}

export function subscribeHostEvents<TPayload>(
  onPayload: (payload: TPayload) => void,
) {
  function handleEvent(event: MessageEvent<{ channel?: string; payload?: TPayload }>) {
    if (event.source !== window || event.origin !== window.location.origin) {
      return;
    }

    const detail = event.data;
    if (!detail || detail.channel !== eventChannel || !detail.payload) {
      return;
    }

    onPayload(detail.payload);
  }

  window.addEventListener("message", handleEvent);

  return () => {
    window.removeEventListener("message", handleEvent);
  };
}
