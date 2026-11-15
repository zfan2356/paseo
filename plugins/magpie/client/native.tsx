import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { copyText } from "@getpaseo/plugin/client/ui";
import { Component, createElement, useCallback, useMemo, useRef, type ReactNode } from "react";
import {
  findNodeHandle,
  Platform,
  StyleSheet,
  Text,
  TurboModuleRegistry,
  UIManager,
  View,
  type NativeSyntheticEvent,
} from "react-native";
import { mobileMessage, mobileOrigin, mobileRequestRpc } from "../shared/mobile.js";
import {
  answerNavigation,
  type NavigationController,
  type NavigationRequest,
} from "./native-navigation.js";

interface NativePageProps {
  html: string;
  onError(message: string): void;
}

class PageBoundary extends Component<
  NativePageProps & { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError(error.message);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

interface PageMessage {
  data: string;
}

interface PageError {
  description: string;
}

function NativePage({ html, onError }: NativePageProps) {
  const view = useRef<View | null>(null);
  const request = useRpc(mobileRequestRpc);
  const source = useMemo(() => ({ html, baseUrl: mobileOrigin + "/" }), [html]);
  const navigation = useMemo(() => {
    if (Platform.OS !== "ios" || !UIManager.hasViewManagerConfig("RNCWebView")) return null;
    return TurboModuleRegistry.get<NavigationController>("RNCWebViewModule");
  }, []);
  const reply = useCallback((value: unknown) => {
    if (!view.current) return;
    const tag = findNodeHandle(view.current);
    if (tag === null) return;
    const script = `window.__paseoMagpieReceive(${JSON.stringify(value)}); true;`;
    UIManager.dispatchViewManagerCommand(tag, "injectJavaScript", [script]);
  }, []);
  const receive = useCallback(
    (event: NativeSyntheticEvent<PageMessage>) => {
      let value: unknown;
      try {
        value = JSON.parse(event.nativeEvent.data);
      } catch {
        onError("Magpie 页面消息格式不正确。");
        return;
      }
      const parsed = mobileMessage.safeParse(value);
      if (!parsed.success) {
        onError("Magpie 页面请求不受支持。");
        return;
      }
      const message = parsed.data;
      if (message.type === "request") {
        void request(message.request).then(
          (response) => reply({ id: message.id, response }),
          () => reply({ id: message.id, error: "Magpie 请求失败，请检查远端连接后重试。" }),
        );
      } else if (message.type === "copy") {
        void copyText(message.text).then(
          () => reply({ id: message.id, response: null }),
          () => reply({ id: message.id, error: "无法复制到手机剪贴板。" }),
        );
      } else if (message.type === "open") {
        void openExternalUrl(message.url).catch(() => onError("无法打开浏览器。"));
      } else if (message.type === "error") {
        onError(message.message);
      }
    },
    [onError, reply, request],
  );
  const allow = useCallback(
    (event: NativeSyntheticEvent<NavigationRequest>) => {
      if (!navigation) return;
      const allowed = answerNavigation(navigation, event.nativeEvent);
      if (!allowed) onError("请通过 Magpie 页面中的链接打开外部浏览器。");
    },
    [navigation, onError],
  );
  const failed = useCallback(
    (event: NativeSyntheticEvent<PageError>) => onError(event.nativeEvent.description),
    [onError],
  );
  if (!navigation) {
    return <Text style={styles.error}>当前手机 App 未提供 Magpie 所需的网页组件。</Text>;
  }
  return createElement("RNCWebView", {
    ref: view,
    style: styles.frame,
    newSource: source,
    source,
    javaScriptEnabled: true,
    messagingEnabled: true,
    messagingModuleName: "",
    scrollEnabled: true,
    incognito: true,
    cacheEnabled: false,
    setSupportMultipleWindows: false,
    javaScriptCanOpenWindowsAutomatically: false,
    onMessage: receive,
    onShouldStartLoadWithRequest: allow,
    onLoadingError: failed,
  });
}

export function MagpieNativePage(props: NativePageProps) {
  return (
    <PageBoundary {...props}>
      <NativePage {...props} />
    </PageBoundary>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: "#111111" },
  error: { color: "#c55353", padding: 20 },
});
