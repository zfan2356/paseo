import { createElement, useEffect, useRef } from "react";
import { Platform } from "react-native";

// Keep browser globals in this module; native clients use the external opener.
declare const window: {
  location: { hostname: string };
  paseoDesktop?: { browser?: { profilePartition?: string } };
};
interface WebViewElement {
  addEventListener(name: string, listener: (event: unknown) => void): void;
  removeEventListener(name: string, listener: (event: unknown) => void): void;
}
interface MagpieWebViewProps {
  url: string;
  onError(): void;
}

export function MagpieWebView({ url, onError }: MagpieWebViewProps) {
  const ref = useRef<WebViewElement>(null);
  const partition =
    Platform.OS === "web" ? window.paseoDesktop?.browser?.profilePartition : undefined;
  useEffect(() => {
    const view = ref.current;
    if (!view || !partition) return;
    const failed = (event: unknown) => {
      // Chromium aborts the first navigation when Magpie trades its key for a cookie.
      if (typeof event === "object" && event && "errorCode" in event && event.errorCode === -3)
        return;
      onError();
    };
    view.addEventListener("did-fail-load", failed);
    return () => view.removeEventListener("did-fail-load", failed);
  }, [partition, onError]);
  if (Platform.OS !== "web") return null;
  const style = { display: "flex", flex: 1, width: "100%", height: "100%", border: 0 };
  if (partition) {
    // Reuse Paseo's sandboxed browser profile and its existing webview attachment policy.
    return createElement("webview", { ref, src: url, partition, style, title: "Magpie" });
  }
  // Same-site loopback keeps Magpie's SameSite=Lax login cookie usable in web previews.
  const src =
    window.location.hostname === "localhost"
      ? url.replace("http://127.0.0.1:", "http://localhost:")
      : url;
  /* eslint-disable react/iframe-missing-sandbox -- Magpie needs its cookie origin and scripts; its fixed port is cross-origin to Paseo. */
  return createElement("iframe", {
    src,
    style,
    title: "Magpie",
    allow: "clipboard-read; clipboard-write",
    sandbox:
      "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads",
    referrerPolicy: "no-referrer",
    onError,
  });
  /* eslint-enable react/iframe-missing-sandbox */
}
