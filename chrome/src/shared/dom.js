(function () {
  const BN = globalThis.BlackbaudNext;

  async function waitForElement(selector, timeout = 4000, root = document) {
    return new Promise((resolve) => {
      const existingElement = root.querySelector(selector);
      if (existingElement) {
        resolve(existingElement);
        return;
      }

      let observer;
      const timer = setTimeout(() => {
        observer?.disconnect();
        resolve(null);
      }, timeout);

      observer = new MutationObserver(() => {
        const element = root.querySelector(selector);
        if (!element) {
          return;
        }

        clearTimeout(timer);
        observer.disconnect();
        resolve(element);
      });

      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
      });
    });
  }

  function injectStyle(id, cssText) {
    const existing = document.getElementById(id);
    if (existing) {
      existing.textContent = cssText;
      return existing;
    }

    const style = document.createElement("style");
    style.id = id;
    style.textContent = cssText;
    (document.head || document.documentElement).appendChild(style);
    return style;
  }

  function removeElementById(id) {
    document.getElementById(id)?.remove();
  }

  function createButton({ id, className = "btn btn-default", text }) {
    const button = document.createElement("button");
    if (id) {
      button.id = id;
    }

    button.type = "button";
    button.className = className;
    button.textContent = text;
    return button;
  }

  function observeMutations(callback, options = {}) {
    const target = options.target || document.documentElement;
    let scheduled = false;

    const observer = new MutationObserver(() => {
      if (scheduled) {
        return;
      }

      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        callback();
      });
    });

    observer.observe(target, {
      childList: true,
      subtree: true,
      ...options.observerOptions,
    });

    return observer;
  }

  function markOnce(element, key) {
    const dataKey = `blackbaudNext${key}`;
    if (element.dataset[dataKey] === "1") {
      return false;
    }

    element.dataset[dataKey] = "1";
    return true;
  }

  BN.define("shared.dom", {
    createButton,
    injectStyle,
    markOnce,
    observeMutations,
    removeElementById,
    waitForElement,
  });
})();
