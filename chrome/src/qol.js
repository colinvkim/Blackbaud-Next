(() => {
  if (!window.location.href.includes("myschoolapp.com")) {
    return;
  }

  function isDirectoryPage() {
    return /^#directory\/\d+/i.test(window.location.hash || "");
  }

  function getBestAvatarUrl(scope) {
    const selector = "img[src*='/user/large_user_']";
    const local = scope ? [...scope.querySelectorAll(selector)] : [];
    const global = local.length
      ? local
      : [...document.querySelectorAll(selector)];

    if (!global.length) {
      return null;
    }

    const best = global.sort((a, b) => {
      const aa = a.getBoundingClientRect();
      const bb = b.getBoundingClientRect();
      return bb.width * bb.height - aa.width * aa.height;
    })[0];

    try {
      const full = new URL(best.src, window.location.href);
      full.searchParams.delete("resize");
      return full.toString();
    } catch {
      return best.src.replace(/\?resize=[^&]+/, "");
    }
  }

  function injectButton() {
    if (!isDirectoryPage()) {
      return;
    }

    const optionButtons = document.querySelectorAll(".user-options-button");
    optionButtons.forEach((optionsButton) => {
      if (optionsButton.dataset.blackbaudNextDownloadBound === "1") {
        return;
      }

      optionsButton.dataset.blackbaudNextDownloadBound = "1";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-default";
      button.textContent = "Download Full Avatar";
      button.style.marginTop = "8px";
      button.style.marginLeft = "0";
      button.style.display = "block";

      button.addEventListener("click", () => {
        const scope =
          optionsButton.closest("section, article, div") ||
          document.body ||
          document.documentElement;
        const fullUrl = getBestAvatarUrl(scope);
        if (!fullUrl) {
          return;
        }

        window.open(fullUrl, "_blank");
      });

      const anchor =
        optionsButton.closest(".btn-group, .dropdown, .user-options") ||
        optionsButton.parentElement ||
        optionsButton;

      anchor.insertAdjacentElement("afterend", button);
    });
  }

  const observer = new MutationObserver(injectButton);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  injectButton();
})();
