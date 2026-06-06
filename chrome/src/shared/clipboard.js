(function () {
  const BN = globalThis.BlackbaudNext;

  async function writeText(value) {
    await navigator.clipboard.writeText(value);
  }

  BN.define("shared.clipboard", {
    writeText,
  });
})();
