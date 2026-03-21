const settingsSchema = [
  { key: "automaticLogin", id: "automatic-login", defaultValue: true },
  { key: "loadBetweenPages", id: "load-between-pages", defaultValue: true },
  { key: "fixFavicon", id: "fix-favicon", defaultValue: true },
  {
    key: "oldAssignmentCenter",
    id: "old-assignment-center",
    defaultValue: false,
  },
  { key: "loginFix", id: "login-fix", defaultValue: true },
  { key: "wideUI", id: "wide-ui", defaultValue: false },
];

const defaultOptions = Object.fromEntries(
  settingsSchema.map(({ key, defaultValue }) => [key, defaultValue]),
);

const keyToId = Object.fromEntries(
  settingsSchema.map(({ key, id }) => [key, id]),
);

const idToKey = Object.fromEntries(
  settingsSchema.map(({ key, id }) => [id, key]),
);

function restoreOptions() {
  chrome.storage.sync.get(defaultOptions, (items) => {
    settingsSchema.forEach(({ key, id }) => {
      const checkbox = document.getElementById(id);
      if (!checkbox) {
        return;
      }

      checkbox.checked = Boolean(items[key]);
    });
  });
}

function checkboxChange(e) {
  const key = idToKey[e.target.id];
  if (key) {
    chrome.storage.sync.set({ [key]: e.target.checked });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  restoreOptions();
  settingsSchema.forEach(({ id }) => {
    const checkbox = document.getElementById(id);
    if (checkbox) {
      checkbox.addEventListener("change", checkboxChange);
    }
  });
});
