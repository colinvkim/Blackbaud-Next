(function () {
  const BN = globalThis.BlackbaudNext;

  function getFullAvatarUrl(imageUrl, baseUrl = window.location.href) {
    if (!imageUrl) {
      return null;
    }

    try {
      const full = new URL(imageUrl, baseUrl);
      full.searchParams.delete("resize");
      return full.toString();
    } catch {
      return String(imageUrl).replace(/\?resize=[^&]+/, "");
    }
  }

  BN.define("data.normalize.avatar", {
    getFullAvatarUrl,
  });
})();
