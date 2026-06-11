import {
  Activity,
  Eye,
  EyeOff,
  RefreshCw,
  ShieldCheck,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { requestHost } from "./bridge";
import type { OrbitBootstrapPayload, OrbitConnectionState } from "./bridge";

const initialPayload: OrbitBootstrapPayload = {
  connection: "checking",
  errorMessage: "",
  nativeHidden: false,
  route: {
    href: window.location.href,
    hash: window.location.hash,
    schoolHostname: window.location.hostname,
    shellKind: "unknown",
  },
  session: null,
  settings: {
    uiMode: "orbit",
  },
  updatedAt: new Date().toISOString(),
};

export function App() {
  const [payload, setPayload] = useState<OrbitBootstrapPayload>(initialPayload);
  const [busy, setBusy] = useState(true);

  const load = useCallback(async (action: "bootstrap" | "refresh-session") => {
    setBusy(true);

    try {
      setPayload(await requestHost<OrbitBootstrapPayload>(action));
    } catch (error) {
      setPayload((current) => ({
        ...current,
        connection: "fallback",
        errorMessage:
          error instanceof Error ? error.message : "Next host request failed.",
        updatedAt: new Date().toISOString(),
      }));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load("bootstrap");
  }, [load]);

  const toggleNative = useCallback(async () => {
    setBusy(true);

    try {
      setPayload(await requestHost<OrbitBootstrapPayload>("toggle-native"));
    } catch (error) {
      setPayload((current) => ({
        ...current,
        errorMessage:
          error instanceof Error ? error.message : "Native visibility request failed.",
        updatedAt: new Date().toISOString(),
      }));
    } finally {
      setBusy(false);
    }
  }, []);

  const status = useMemo(() => getStatus(payload.connection), [payload.connection]);
  const session = payload.session;

  return (
    <div
      className={`orbit-shell ${
        payload.nativeHidden ? "orbit-shell-full" : "orbit-shell-compact"
      }`}
    >
      <aside className="orbit-sidebar" aria-label="Next">
        <div className="orbit-brand">
          <span className="orbit-brand-mark" aria-hidden="true">
            N
          </span>
          <div>
            <h1>Next</h1>
            <p>{payload.route.schoolHostname || "Blackbaud"}</p>
          </div>
        </div>

        <nav aria-label="Next navigation" className="orbit-nav">
          <a href="#orbit-session" aria-current="page">
            <Activity size={18} aria-hidden="true" />
            Session
          </a>
        </nav>

        <div className="orbit-sidebar-footer">
          <span className={`orbit-dot orbit-dot-${payload.connection}`} />
          <span>{status.label}</span>
        </div>
      </aside>

      <main className="orbit-main">
        <header className="orbit-header">
          <div>
            <p className="orbit-eyebrow">Blackbaud Next</p>
            <h2>Next session</h2>
          </div>

          <div className="orbit-actions">
            <button type="button" onClick={() => void load("refresh-session")} disabled={busy}>
              <RefreshCw size={16} aria-hidden="true" />
              Refresh
            </button>
            <button type="button" onClick={() => void toggleNative()} disabled={busy}>
              {payload.nativeHidden ? (
                <Eye size={16} aria-hidden="true" />
              ) : (
                <EyeOff size={16} aria-hidden="true" />
              )}
              {payload.nativeHidden ? "Show native" : "Hide native"}
            </button>
          </div>
        </header>

        <section id="orbit-session" className="orbit-grid" aria-label="Session summary">
          <Panel
            title="Connection"
            icon={
              payload.connection === "connected" ? (
                <Wifi size={18} aria-hidden="true" />
              ) : (
                <WifiOff size={18} aria-hidden="true" />
              )
            }
          >
            <StatusPill state={payload.connection} label={status.label} />
            <p className="orbit-panel-copy">
              {payload.connection === "connected"
                ? "Authenticated same-origin API reads are available."
                : payload.errorMessage || "Checking the current Blackbaud session."}
            </p>
          </Panel>

          <Panel title="Account" icon={<ShieldCheck size={18} aria-hidden="true" />}>
            <dl className="orbit-facts">
              <Fact label="Token" value={formatBoolean(session?.TokenValid)} />
              <Fact label="BBID" value={formatBoolean(session?.AuthUsingBbid)} />
              <Fact
                label="Unread"
                value={formatNumber(session?.UnreadMessageCount)}
              />
              <Fact
                label="Idle"
                value={formatMinutes(session?.MinutesSinceActive)}
              />
            </dl>
          </Panel>

          <Panel title="Surface" icon={<Activity size={18} aria-hidden="true" />}>
            <dl className="orbit-facts">
              <Fact label="Native UI" value={payload.nativeHidden ? "Hidden" : "Visible"} />
              <Fact label="Shell" value={payload.route.shellKind} />
              <Fact label="Mode" value={formatUiMode(payload.settings.uiMode)} />
              <Fact label="Version" value={session?.CurrentVersion || "Unknown"} />
            </dl>
          </Panel>
        </section>
      </main>
    </div>
  );
}

function Panel({
  children,
  icon,
  title,
}: {
  children: ReactNode;
  icon: ReactNode;
  title: string;
}) {
  return (
    <article className="orbit-panel">
      <div className="orbit-panel-title">
        <span>{icon}</span>
        <h3>{title}</h3>
      </div>
      {children}
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function StatusPill({
  label,
  state,
}: {
  label: string;
  state: OrbitConnectionState;
}) {
  return <span className={`orbit-status orbit-status-${state}`}>{label}</span>;
}

function getStatus(state: OrbitConnectionState) {
  if (state === "connected") {
    return { label: "Connected" };
  }

  if (state === "fallback") {
    return { label: "Native fallback" };
  }

  return { label: "Checking" };
}

function formatBoolean(value: boolean | undefined) {
  if (typeof value !== "boolean") {
    return "Unknown";
  }

  return value ? "Valid" : "Unavailable";
}

function formatNumber(value: number | undefined) {
  return typeof value === "number" ? String(value) : "Unknown";
}

function formatMinutes(value: number | undefined) {
  if (typeof value !== "number") {
    return "Unknown";
  }

  return `${value} min`;
}

function formatUiMode(uiMode: string) {
  return uiMode === "orbit" ? "Next Beta" : uiMode || "Unknown";
}
