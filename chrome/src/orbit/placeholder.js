(function () {
  const BN = globalThis.BlackbaudNext;

  const rootId = "blackbaud-next-orbit-root";
  const styleId = "blackbaud-next-orbit-placeholder-style";

  function ensureRoot() {
    let root = document.getElementById(rootId);
    if (root) {
      return root;
    }

    root = document.createElement("div");
    root.id = rootId;
    (document.body || document.documentElement).appendChild(root);
    return root;
  }

  function render(root, state) {
    const shellKind = BN.sources.dom.nativeShell.getShellKind();
    const nativeHidden = BN.native.controller.isNativeHidden();

    root.innerHTML = `
      <aside class="blackbaud-next-orbit-panel" aria-label="Orbit diagnostics">
        <div>
          <strong>Orbit Beta</strong>
          <span>${state.status}</span>
        </div>
        <dl>
          <div>
            <dt>API</dt>
            <dd>${state.api}</dd>
          </div>
          <div>
            <dt>Native</dt>
            <dd>${shellKind}</dd>
          </div>
        </dl>
        <button type="button" data-blackbaud-next-native-toggle>
          ${nativeHidden ? "Show Native" : "Hide Native"}
        </button>
      </aside>
    `;

    root
      .querySelector("[data-blackbaud-next-native-toggle]")
      ?.addEventListener("click", () => {
        BN.native.controller.toggleNativeVisibility();
        render(root, state);
      });
  }

  function installStyles() {
    BN.shared.dom.injectStyle(
      styleId,
      `
.blackbaud-next-orbit-panel {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 999998;
  width: min(320px, calc(100vw - 32px));
  border: 1px solid rgba(15, 23, 42, 0.14);
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.18);
  color: #172033;
  font: 13px/1.4 Arial, sans-serif;
  padding: 12px;
}

.blackbaud-next-orbit-panel > div:first-child {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.blackbaud-next-orbit-panel strong {
  font-size: 14px;
}

.blackbaud-next-orbit-panel span {
  color: #2563eb;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.blackbaud-next-orbit-panel dl {
  display: grid;
  gap: 6px;
  margin: 12px 0;
}

.blackbaud-next-orbit-panel dl > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.blackbaud-next-orbit-panel dt {
  color: #64748b;
}

.blackbaud-next-orbit-panel dd {
  margin: 0;
  font-weight: 700;
}

.blackbaud-next-orbit-panel button {
  width: 100%;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #f8fafc;
  color: #172033;
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  padding: 8px 10px;
}
`,
    );
  }

  async function mount(settings) {
    if (!BN.shared.routes.isAuthenticatedLmsPage()) {
      return;
    }

    const root = ensureRoot();
    installStyles();
    BN.native.controller.installEscapeHatch();
    render(root, { status: "Starting", api: "Checking" });

    try {
      await BN.sources.api.client.getUserStatus();
      render(root, { status: "Mounted", api: "Connected" });
    } catch {
      BN.native.controller.revealForFallback("orbit-userstatus-failed");
      render(root, { status: "Fallback", api: "Unavailable" });
    }
  }

  BN.define("orbit.placeholder", {
    mount,
  });
})();
