(function () {
  const existing = globalThis.BlackbaudNext || {};

  function define(path, value) {
    const parts = path.split(".");
    let cursor = existing;

    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index];
      cursor[part] = cursor[part] || {};
      cursor = cursor[part];
    }

    cursor[parts[parts.length - 1]] = value;
  }

  function read(path) {
    return path.split(".").reduce((cursor, part) => cursor?.[part], existing);
  }

  existing.define = existing.define || define;
  existing.read = existing.read || read;
  existing.version = existing.version || "2.0.0-foundation";

  globalThis.BlackbaudNext = existing;
})();
