export const mobileRuntime = String.raw`(() => {
  const send = (message) => window.ReactNativeWebView.postMessage(JSON.stringify(message));
  const pending = new Map();
  let sequence = 0;
  const originalFetch = window.fetch.bind(window);
  const base = new URL(document.baseURI);
  if (location.origin !== base.origin) {
    for (const method of ["replaceState", "pushState"]) {
      const original = history[method].bind(history);
      history[method] = (state, title, value) => {
        if (value == null) return original(state, title, value);
        const url = new URL(String(value), base);
        if (url.origin !== base.origin) throw new DOMException("External navigation", "SecurityError");
        const local = location.origin === "null"
          ? undefined
          : new URL(url.pathname + url.search + url.hash, location.href).href;
        return original(state, title, local);
      };
    }
  }

  function call(message, signal) {
    if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const abort = () => finish(new DOMException("Aborted", "AbortError"));
      function finish(error, response) {
        const item = pending.get(id);
        if (!item) return;
        clearTimeout(item.timer);
        signal?.removeEventListener("abort", abort);
        pending.delete(id);
        if (error) reject(error);
        else resolve(response);
      }
      const timer = setTimeout(() => finish(new Error("Magpie request timed out")), 35000);
      pending.set(id, { finish, timer });
      signal?.addEventListener("abort", abort, { once: true });
      send({ ...message, id });
    });
  }

  window.__paseoMagpieReceive = (reply) => {
    const item = pending.get(reply.id);
    if (item) item.finish(reply.error ? new Error(reply.error) : null, reply.response);
  };

  function encode(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return btoa(binary);
  }

  window.fetch = async (input, init) => {
    const address = input instanceof Request ? input.url : String(input);
    const url = new URL(address, base);
    if (url.protocol === "data:" || url.protocol === "blob:") return originalFetch(input, init);
    if (url.origin !== base.origin) throw new TypeError("Only this Magpie service is available");
    const request = input instanceof Request ? new Request(input, init) : new Request(url, init);
    const body = request.method === "GET" ? "" : encode(new Uint8Array(await request.arrayBuffer()));
    const response = await call({
      type: "request",
      request: {
        path: url.pathname + url.search,
        method: request.method,
        body,
        contentType: request.headers.get("content-type") || "",
      },
    }, request.signal);
    const headers = { "Content-Type": response.contentType };
    if (response.reading) headers["X-Magpie-Reading"] = response.reading;
    const empty = [204, 205, 304].includes(response.status);
    const bytes = empty ? null : Uint8Array.from(atob(response.body), (c) => c.charCodeAt(0));
    return new Response(bytes, { status: response.status, headers });
  };

  window.open = (url) => {
    const target = new URL(String(url), base);
    if (target.protocol === "https:" || target.protocol === "http:") {
      send({ type: "open", url: target.href });
    }
    return null;
  };
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: (text) => call({ type: "copy", text: String(text) }) },
  });

  const originalSource = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
  const images = new Map();
  function loadImage(path) {
    let read = images.get(path);
    if (!read) {
      read = fetch(new URL(path, base)).then(async (response) => {
        if (!response.ok) throw new Error("Image unavailable");
        const bytes = new Uint8Array(await response.arrayBuffer());
        return "data:" + response.headers.get("content-type") + ";base64," + encode(bytes);
      });
      images.set(path, read);
    }
    return read;
  }
  function imageSource(image, value) {
    const url = new URL(value, base);
    if (url.origin !== base.origin) {
      if (url.protocol === "data:" || url.protocol === "blob:") originalSource.set.call(image, value);
      return;
    }
    const path = url.pathname + url.search;
    image.dataset.paseoSource = path;
    loadImage(path).then((data) => {
      if (image.dataset.paseoSource === path) originalSource.set.call(image, data);
    }).catch(() => {
      image.removeAttribute("src");
      image.dispatchEvent(new Event("error"));
    });
  }
  Object.defineProperty(HTMLImageElement.prototype, "src", {
    configurable: true,
    get() { return originalSource.get.call(this); },
    set(value) { imageSource(this, String(value)); },
  });
  const originalProperty = CSSStyleDeclaration.prototype.setProperty;
  const masks = new WeakMap();
  CSSStyleDeclaration.prototype.setProperty = function (name, value, priority) {
    if (name !== "--i") return originalProperty.call(this, name, value, priority);
    masks.delete(this);
    const match = /^url\(["']?([^"')]+)["']?\)$/.exec(value);
    if (!match) return originalProperty.call(this, name, value, priority);
    const url = new URL(match[1], base);
    if (url.origin !== base.origin) return originalProperty.call(this, name, value, priority);
    masks.set(this, value);
    originalProperty.call(this, name, "none", priority);
    loadImage(url.pathname + url.search).then((data) => {
      if (masks.get(this) === value) originalProperty.call(this, name, 'url("' + data + '")', priority);
    }).catch(() => masks.delete(this));
  };
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      const elements = mutation.type === "attributes" ? [mutation.target] : [...mutation.addedNodes];
      for (const element of elements) {
        if (!(element instanceof Element)) continue;
        const candidates = element.matches("img[src]") ? [element] : [...element.querySelectorAll("img[src]")];
        for (const image of candidates) {
          const value = image.getAttribute("src");
          if (value && !value.startsWith("data:") && !value.startsWith("blob:")) imageSource(image, value);
        }
      }
    }
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["src"] });
  window.addEventListener("error", (event) => {
    if (event.message) send({ type: "error", message: String(event.message).slice(0, 1000) });
  });
  window.addEventListener("DOMContentLoaded", () => send({ type: "ready" }), { once: true });
})();`;
