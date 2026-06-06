(function () {
  const BN = globalThis.BlackbaudNext;

  BN.boot.runtime.run().catch((error) => {
    console.error("Blackbaud Next failed to start", error);
    BN.native?.controller?.revealForFallback?.("boot-error");
  });
})();
