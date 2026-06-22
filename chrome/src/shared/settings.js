(function () {
  const BN = globalThis.BlackbaudNext;

  const UI_MODES = {
    ORIGINAL: "original",
    ENHANCED: "enhanced",
    NEXT: "next",
  };

  const MODE_DEFINITIONS = [
    {
      key: UI_MODES.ORIGINAL,
      label: "Normal",
      description: "Use the unmodified Blackbaud UI.",
    },
    {
      key: UI_MODES.ENHANCED,
      label: "Enhanced",
      description: "Use Blackbaud with Blackbaud Next fixes.",
    },
    {
      key: UI_MODES.NEXT,
      label: "Next Beta",
      description: "Mount the experimental Blackbaud Next UI layer.",
    },
  ];

  const FEATURE_DEFINITIONS = [
    {
      key: "automaticLogin",
      legacyKey: "automaticLogin",
      label: "Automatic Login",
      description: "Skip extra Blackbaud and Google sign-in clicks.",
      defaultValue: true,
      appliesTo: [UI_MODES.ENHANCED, UI_MODES.NEXT],
    },
    {
      key: "optimizeLoginPage",
      legacyKey: "loginFix",
      label: "Optimize Login Page",
      description: "Clean up the first Blackbaud login screen.",
      defaultValue: true,
      appliesTo: [UI_MODES.ENHANCED, UI_MODES.NEXT],
    },
    {
      key: "loadingOverlay",
      legacyKey: "loadBetweenPages",
      label: "Loading Overlay",
      description: "Show a transition overlay during automatic sign-in.",
      defaultValue: true,
      appliesTo: [UI_MODES.ENHANCED, UI_MODES.NEXT],
    },
    {
      key: "fixFavicon",
      legacyKey: "fixFavicon",
      label: "Fix Empty Favicon",
      description: "Add a proper Blackbaud tab icon.",
      defaultValue: true,
      appliesTo: [UI_MODES.ENHANCED, UI_MODES.NEXT],
    },
    {
      key: "oldAssignmentCenter",
      legacyKey: "oldAssignmentCenter",
      label: "Old Assignment Center",
      description: "Route assignment center links to the legacy view.",
      defaultValue: false,
      appliesTo: [UI_MODES.ENHANCED, UI_MODES.NEXT],
    },
    {
      key: "rosterTools",
      legacyKey: "copyRosterTools",
      label: "Roster Tools",
      description: "Copy roster names and emails from class pages.",
      defaultValue: true,
      appliesTo: [UI_MODES.ENHANCED, UI_MODES.NEXT],
    },
    {
      key: "downloadFullAvatar",
      legacyKey: "downloadFullAvatar",
      label: "Download Full Avatar",
      description: "Open full-resolution profile pictures.",
      defaultValue: true,
      appliesTo: [UI_MODES.ENHANCED, UI_MODES.NEXT],
    },
    {
      key: "fixInvalidPages",
      legacyKey: "fixBrokenAssignmentCenter",
      label: "Fix Invalid Pages",
      description: "Recover from broken assignment pages.",
      defaultValue: true,
      appliesTo: [UI_MODES.ENHANCED, UI_MODES.NEXT],
    },
  ];

  const FEATURE_DEFAULTS = Object.fromEntries(
    FEATURE_DEFINITIONS.map(({ key, defaultValue }) => [key, defaultValue]),
  );

  const DEFAULT_SETTINGS = {
    uiMode: UI_MODES.ENHANCED,
    ...FEATURE_DEFAULTS,
  };

  function isValidMode(mode) {
    return MODE_DEFINITIONS.some(({ key }) => key === mode);
  }

  function normalizeUiMode(uiMode) {
    return isValidMode(uiMode) ? uiMode : DEFAULT_SETTINGS.uiMode;
  }

  function normalizeBoolean(value, defaultValue) {
    return typeof value === "boolean" ? value : defaultValue;
  }

  function normalizeSettings(raw = {}) {
    const settings = {
      uiMode: normalizeUiMode(raw.uiMode),
    };

    FEATURE_DEFINITIONS.forEach(({ key, legacyKey, defaultValue }) => {
      const value = raw[key] ?? raw[legacyKey];
      settings[key] = normalizeBoolean(value, defaultValue);
    });

    return settings;
  }

  async function getSettings() {
    const raw = await browser.storage.sync.get(null);
    return normalizeSettings(raw);
  }

  async function setUiMode(uiMode) {
    if (!isValidMode(uiMode)) {
      throw new Error(`Unsupported Blackbaud Next UI mode: ${uiMode}`);
    }

    await browser.storage.sync.set({ uiMode });
  }

  async function setFeature(key, value) {
    const definition = FEATURE_DEFINITIONS.find((feature) => feature.key === key);
    if (!definition) {
      throw new Error(`Unsupported Blackbaud Next feature: ${key}`);
    }

    const update = {
      [definition.key]: Boolean(value),
    };

    if (definition.legacyKey && definition.legacyKey !== definition.key) {
      update[definition.legacyKey] = Boolean(value);
    }

    await browser.storage.sync.set(update);
  }

  function featureEnabled(settings, key) {
    if (settings.uiMode === UI_MODES.ORIGINAL) {
      return false;
    }

    return Boolean(settings[key]);
  }

  function modeSupportsFeature(uiMode, feature) {
    return feature.appliesTo.includes(uiMode);
  }

  BN.define("shared.settings", {
    DEFAULT_SETTINGS,
    FEATURE_DEFINITIONS,
    MODE_DEFINITIONS,
    UI_MODES,
    featureEnabled,
    getSettings,
    modeSupportsFeature,
    normalizeSettings,
    setFeature,
    setUiMode,
  });
})();
