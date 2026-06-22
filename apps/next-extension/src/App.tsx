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
import { requestHost, subscribeHostEvents } from "./bridge";
import type { NextBootstrapPayload, NextConnectionState } from "./bridge";

const initialPayload: NextBootstrapPayload = {
  connection: "checking",
  errorMessage: "",
  nativeHidden: false,
  route: {
    href: window.location.href,
    hash: window.location.hash,
    nextPage: null,
    schoolHostname: window.location.hostname,
    shellKind: "unknown",
  },
  session: null,
  settings: {
    uiMode: "next",
  },
  updatedAt: new Date().toISOString(),
};

export function App() {
  const [payload, setPayload] = useState<NextBootstrapPayload>(initialPayload);
  const [busy, setBusy] = useState(true);

  const load = useCallback(async (action: "bootstrap" | "refresh-session") => {
    setBusy(true);

    try {
      setPayload(await requestHost<NextBootstrapPayload>(action));
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

  useEffect(() => subscribeHostEvents<NextBootstrapPayload>(setPayload), []);

  const toggleNative = useCallback(async () => {
    setBusy(true);

    try {
      setPayload(await requestHost<NextBootstrapPayload>("toggle-native"));
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
  const pageTitle = payload.route.nextPage?.label || "Next session";
  const isProgressPage = payload.route.nextPage?.id === "student-progress";

  return (
    <div
      className={`next-shell ${
        payload.nativeHidden ? "next-shell-full" : "next-shell-compact"
      }`}
    >
      <aside className="next-sidebar" aria-label="Next">
        <div className="next-brand">
          <span className="next-brand-mark" aria-hidden="true">
            N
          </span>
          <div>
            <h1>Next</h1>
            <p>{payload.route.schoolHostname || "Blackbaud"}</p>
          </div>
        </div>

        <nav aria-label="Next navigation" className="next-nav">
          <a
            href={isProgressPage ? "#studentmyday/progress" : "#next-session"}
            aria-current="page"
          >
            <Activity size={18} aria-hidden="true" />
            {pageTitle}
          </a>
        </nav>

        <div className="next-sidebar-footer">
          <span className={`next-dot next-dot-${payload.connection}`} />
          <span>{status.label}</span>
        </div>
      </aside>

      <main className="next-main">
        <header className="next-header">
          <div>
            <p className="next-eyebrow">Blackbaud Next</p>
            <h2>{pageTitle}</h2>
          </div>

          <div className="next-actions">
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

        {isProgressPage ? (
          <ProgressPage payload={payload} statusLabel={status.label} />
        ) : (
          <SessionPage payload={payload} statusLabel={status.label} />
        )}
      </main>
    </div>
  );
}

function ProgressPage({
  payload,
  statusLabel,
}: {
  payload: NextBootstrapPayload;
  statusLabel: string;
}) {
  return (
    <section
      id="student-progress"
      className="next-grid"
      aria-label="Student progress"
    >
      <Panel title="Course Progress" icon={<Activity size={18} aria-hidden="true" />}>
        <StatusPill state="checking" label="Not loaded" />
        <p className="next-panel-copy">No progress data loaded.</p>
      </Panel>

      <Panel title="Route" icon={<Activity size={18} aria-hidden="true" />}>
        <dl className="next-facts">
          <Fact label="Page" value={payload.route.nextPage?.label || "Unknown"} />
          <Fact label="Hash" value={payload.route.hash || "None"} />
          <Fact label="Shell" value={payload.route.shellKind} />
        </dl>
      </Panel>

      <ConnectionPanel payload={payload} statusLabel={statusLabel} />
    </section>
  );
}

function SessionPage({
  payload,
  statusLabel,
}: {
  payload: NextBootstrapPayload;
  statusLabel: string;
}) {
  return (
    <section id="next-session" className="next-grid" aria-label="Session summary">
      <ConnectionPanel payload={payload} statusLabel={statusLabel} />
      <AccountPanel payload={payload} />
      <SurfacePanel payload={payload} />
    </section>
  );
}

function ConnectionPanel({
  payload,
  statusLabel,
}: {
  payload: NextBootstrapPayload;
  statusLabel: string;
}) {
  return (
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
      <StatusPill state={payload.connection} label={statusLabel} />
      <p className="next-panel-copy">
        {payload.connection === "connected"
          ? "Authenticated same-origin API reads are available."
          : payload.errorMessage || "Checking the current Blackbaud session."}
      </p>
    </Panel>
  );
}

function AccountPanel({ payload }: { payload: NextBootstrapPayload }) {
  const session = payload.session;

  return (
    <Panel title="Account" icon={<ShieldCheck size={18} aria-hidden="true" />}>
      <dl className="next-facts">
        <Fact label="Token" value={formatBoolean(session?.TokenValid)} />
        <Fact label="BBID" value={formatBoolean(session?.AuthUsingBbid)} />
        <Fact label="Unread" value={formatNumber(session?.UnreadMessageCount)} />
        <Fact label="Idle" value={formatMinutes(session?.MinutesSinceActive)} />
      </dl>
    </Panel>
  );
}

function SurfacePanel({ payload }: { payload: NextBootstrapPayload }) {
  return (
    <Panel title="Surface" icon={<Activity size={18} aria-hidden="true" />}>
      <dl className="next-facts">
        <Fact label="Native UI" value={payload.nativeHidden ? "Hidden" : "Visible"} />
        <Fact label="Shell" value={payload.route.shellKind} />
        <Fact label="Mode" value={formatUiMode(payload.settings.uiMode)} />
        <Fact label="Version" value={payload.session?.CurrentVersion || "Unknown"} />
      </dl>
    </Panel>
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
    <article className="next-panel">
      <div className="next-panel-title">
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
  state: NextConnectionState;
}) {
  return <span className={`next-status next-status-${state}`}>{label}</span>;
}

function getStatus(state: NextConnectionState) {
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
  return uiMode === "next" ? "Next Beta" : uiMode || "Unknown";
}
