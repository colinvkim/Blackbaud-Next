export type OrbitConnectionState = "checking" | "connected" | "fallback";

export interface OrbitUserStatus {
  UnreadMessageCount?: number;
  TokenValid?: boolean;
  MinutesSinceActive?: number;
  AuthUsingBbid?: boolean;
  MaxConcurrentId?: number;
  CurrentVersion?: string;
}

export interface OrbitBootstrapPayload {
  connection: OrbitConnectionState;
  errorMessage: string;
  nativeHidden: boolean;
  route: {
    href: string;
    hash: string;
    schoolHostname: string;
    shellKind: string;
  };
  session: OrbitUserStatus | null;
  settings: {
    uiMode: string;
  };
  updatedAt: string;
}

type OrbitBridgeAction = "bootstrap" | "refresh-session" | "toggle-native";

interface OrbitBridgeResponse<TPayload> {
  channel: typeof responseChannel;
  requestId: string;
  ok: boolean;
  payload?: TPayload;
  error?: string;
}

const requestChannel = "blackbaud-next-orbit:request";
const responseChannel = "blackbaud-next-orbit:response";
let requestIndex = 0;

export function requestHost<TPayload>(
  action: OrbitBridgeAction,
): Promise<TPayload> {
  return new Promise((resolve, reject) => {
    const requestId = `${Date.now()}-${requestIndex + 1}`;
    requestIndex += 1;

    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", handleResponse);
      reject(new Error("Next host did not respond."));
    }, 8000);

    function handleResponse(event: MessageEvent<OrbitBridgeResponse<TPayload>>) {
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
