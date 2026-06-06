(function () {
  const BN = globalThis.BlackbaudNext;

  async function run(settings) {
    await BN.auth.loginFlow.run(settings);
  }

  BN.define("auth.index", {
    run,
  });
})();
