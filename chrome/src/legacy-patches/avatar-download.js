(function () {
  const BN = globalThis.BlackbaudNext;

  function getAvatarCandidates(scope = document) {
    const selector = "img[src*='/user/large_user_']";
    return [...scope.querySelectorAll(selector)].filter((image) => Boolean(image.src));
  }

  function getRectDistanceScore(source, target) {
    const sourceX = source.left + source.width / 2;
    const sourceY = source.top + source.height / 2;
    const targetX = target.left + target.width / 2;
    const targetY = target.top + target.height / 2;
    return Math.hypot(targetX - sourceX, targetY - sourceY);
  }

  function getBestAvatarUrl(optionsButton) {
    let current = optionsButton;

    while (current && current !== document.body && current !== document.documentElement) {
      const local = getAvatarCandidates(current);
      if (local.length === 1) {
        return BN.data.normalize.avatar.getFullAvatarUrl(local[0].src);
      }

      current = current.parentElement;
    }

    const global = getAvatarCandidates();
    if (!global.length) {
      return null;
    }

    const buttonRect = optionsButton.getBoundingClientRect();
    const nearest = global.sort((a, b) => {
      const distanceA = getRectDistanceScore(buttonRect, a.getBoundingClientRect());
      const distanceB = getRectDistanceScore(buttonRect, b.getBoundingClientRect());
      return distanceA - distanceB;
    })[0];

    return BN.data.normalize.avatar.getFullAvatarUrl(nearest.src);
  }

  function injectDownloadButtons() {
    if (!BN.shared.routes.isDirectoryPage()) {
      return;
    }

    const optionButtons = document.querySelectorAll(".user-options-button");
    optionButtons.forEach((optionsButton) => {
      if (!BN.shared.dom.markOnce(optionsButton, "DownloadAvatar")) {
        return;
      }

      const button = BN.shared.dom.createButton({
        text: "Download Full Avatar",
      });
      button.style.marginTop = "8px";
      button.style.marginLeft = "0";
      button.style.display = "block";

      button.addEventListener("click", () => {
        const fullUrl = getBestAvatarUrl(optionsButton);
        if (fullUrl) {
          window.open(fullUrl, "_blank");
        }
      });

      const anchor =
        optionsButton.closest(".btn-group, .dropdown, .user-options") ||
        optionsButton.parentElement ||
        optionsButton;

      anchor.insertAdjacentElement("afterend", button);
    });
  }

  BN.define("legacyPatches.avatarDownload", {
    injectDownloadButtons,
  });
})();
