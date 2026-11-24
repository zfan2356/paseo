import { createElement, useLayoutEffect, useRef } from "react";
import { Platform } from "react-native";

interface ResidentPage {
  surface: HTMLDivElement;
  view: HTMLElement;
  url: string;
  owner: symbol | null;
  failed: boolean;
  onError: (() => void) | null;
}

// Browser state belongs to the renderer, not a route or a plugin installation.
declare const window: Window & {
  paseoDesktop?: { browser?: { profilePartition?: string } };
  __paseoMagpiePages?: Map<string, ResidentPage>;
};

interface MagpieWebViewProps {
  hostId: string;
  url: string;
  onError(): void;
}

const anchorStyle = { flex: 1, width: "100%", height: "100%", minHeight: 0 };

export function residentMagpieUrl(hostId: string): string | undefined {
  if (Platform.OS !== "web") return undefined;
  return window.__paseoMagpiePages?.get(hostId)?.url;
}

export function resetMagpiePage(hostId: string): void {
  if (Platform.OS !== "web") return;
  const pages = window.__paseoMagpiePages;
  const page = pages?.get(hostId);
  if (!page) return;
  page.surface.remove();
  pages?.delete(hostId);
}

function park(page: ResidentPage): void {
  // Keep the guest in the DOM without resizing its viewport to a hidden 1x1 pane.
  page.surface.setAttribute("aria-hidden", "true");
  page.surface.inert = true;
  Object.assign(page.surface.style, {
    left: "0px",
    top: "0px",
    width: "1px",
    height: "1px",
    pointerEvents: "none",
  });
}

function createPage(hostId: string, url: string): ResidentPage {
  const partition = window.paseoDesktop?.browser?.profilePartition;
  const surface = document.createElement("div");
  surface.setAttribute("data-magpie-host", hostId);
  // Same paint plane as Paseo's resident browsers; overlay-root uses z-index 1.
  Object.assign(surface.style, {
    position: "fixed",
    zIndex: "0",
    overflow: "hidden",
    display: "block",
  });
  const view = document.createElement(partition ? "webview" : "iframe");
  view.setAttribute("title", "Magpie");
  Object.assign(view.style, {
    display: "inline-flex",
    position: "absolute",
    left: "0px",
    top: "0px",
    width: "1280px",
    height: "800px",
    border: "0",
  });
  if (partition) {
    view.setAttribute("partition", partition);
  } else {
    view.setAttribute("allow", "clipboard-read; clipboard-write");
    view.setAttribute("referrerpolicy", "no-referrer");
    view.setAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads",
    );
  }
  const src =
    !partition && window.location.hostname === "localhost"
      ? url.replace("http://127.0.0.1:", "http://localhost:")
      : url;
  view.setAttribute("src", src);
  const page: ResidentPage = { surface, view, url, owner: null, failed: false, onError: null };
  view.addEventListener(partition ? "did-fail-load" : "error", (event) => {
    // Magpie's cookie redirect aborts the initial navigation in Chromium.
    if ("errorCode" in event && event.errorCode === -3) return;
    page.failed = true;
    page.onError?.();
  });
  park(page);
  surface.appendChild(view);
  document.body.appendChild(surface);
  return page;
}

function present(page: ResidentPage, anchor: HTMLDivElement): void {
  const rect = anchor.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    park(page);
    return;
  }
  page.surface.setAttribute("aria-hidden", "false");
  page.surface.inert = false;
  Object.assign(page.surface.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    pointerEvents: "auto",
  });
  page.view.style.width = `${rect.width}px`;
  page.view.style.height = `${rect.height}px`;
}

export function MagpieWebView({ hostId, url, onError }: MagpieWebViewProps) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (Platform.OS !== "web" || !ref.current) return;
    const anchor = ref.current;
    const pages = (window.__paseoMagpiePages ??= new Map());
    let page = pages.get(hostId);
    if (!page) {
      page = createPage(hostId, url);
      pages.set(hostId, page);
    }
    const current = page;
    const owner = Symbol(hostId);
    current.owner = owner;
    current.onError = onError;
    if (current.failed) onError();
    let frame = 0;
    const update = () => {
      if (current.owner === owner) present(current, anchor);
    };
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(update);
    observer.observe(anchor);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.cancelAnimationFrame(frame);
      if (current.owner === owner) {
        current.owner = null;
        current.onError = null;
        park(current);
      }
    };
  }, [hostId, url, onError]);
  if (Platform.OS !== "web") return null;
  return createElement("div", { ref, style: anchorStyle, "data-magpie-anchor": hostId });
}
