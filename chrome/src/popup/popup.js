(function () {
  const BN = globalThis.BlackbaudNext;
  const settingsApi = BN.shared.settings;

  let currentSettings = settingsApi.DEFAULT_SETTINGS;

  function modeSummary(uiMode) {
    const definition = settingsApi.MODE_DEFINITIONS.find(({ key }) => key === uiMode);
    return definition?.description || "";
  }

  function renderModes() {
    const container = document.getElementById("mode-options");
    container.innerHTML = "";

    settingsApi.MODE_DEFINITIONS.forEach((mode) => {
      const label = document.createElement("label");
      label.className = "mode-option";

      const input = document.createElement("input");
      input.type = "radio";
      input.name = "ui-mode";
      input.value = mode.key;
      input.checked = currentSettings.uiMode === mode.key;
      input.addEventListener("change", async () => {
        await settingsApi.setUiMode(mode.key);
        currentSettings = {
          ...currentSettings,
          uiMode: mode.key,
        };
        render();
      });

      const text = document.createElement("span");
      text.textContent = mode.label;

      label.append(input, text);
      container.appendChild(label);
    });
  }

  function renderFeatures() {
    const container = document.getElementById("feature-options");
    container.innerHTML = "";

    settingsApi.FEATURE_DEFINITIONS.forEach((feature) => {
      const disabled =
        currentSettings.uiMode === settingsApi.UI_MODES.ORIGINAL ||
        !settingsApi.modeSupportsFeature(currentSettings.uiMode, feature);

      const row = document.createElement("label");
      row.className = "feature-row";
      row.setAttribute("aria-disabled", String(disabled));

      const copy = document.createElement("span");
      copy.className = "feature-copy";

      const title = document.createElement("strong");
      title.textContent = feature.label;

      const description = document.createElement("span");
      description.textContent = feature.description;

      copy.append(title, description);

      const switchLabel = document.createElement("span");
      switchLabel.className = "switch";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = Boolean(currentSettings[feature.key]);
      input.disabled = disabled;
      input.addEventListener("change", async () => {
        await settingsApi.setFeature(feature.key, input.checked);
        currentSettings = {
          ...currentSettings,
          [feature.key]: input.checked,
        };
      });

      const track = document.createElement("span");
      switchLabel.append(input, track);

      row.append(copy, switchLabel);
      container.appendChild(row);
    });
  }

  function render() {
    document.getElementById("mode-summary").textContent = modeSummary(
      currentSettings.uiMode,
    );
    renderModes();
    renderFeatures();
  }

  document.addEventListener("DOMContentLoaded", async () => {
    currentSettings = await settingsApi.getSettings();
    render();
  });
})();
