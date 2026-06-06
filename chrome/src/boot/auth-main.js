(function () {
  const BN = globalThis.BlackbaudNext;

  async function run() {
    const settings = await BN.shared.settings.getSettings();
    await BN.auth.index.run(settings);
  }

  run().catch((error) => {
    console.error("Blackbaud Next auth helpers failed to start", error);
  });
})();
