import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useMutation } from "@tanstack/react-query";
import {
  Component,
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
  type NativeSyntheticEvent,
} from "react-native";
import { pageMessage, reportRpc, type ProbeStage } from "../shared/probe.js";
import { probeHtml } from "./document.js";

interface ProbeEvent {
  stage: ProbeStage;
  detail: string;
}

interface ProbeState {
  attempt: number;
  events: ProbeEvent[];
}

function reduceProbe(state: ProbeState, event: ProbeEvent): ProbeState {
  if (event.stage === "started") {
    return { attempt: state.attempt + 1, events: [event] };
  }
  return { ...state, events: [...state.events.slice(-7), event] };
}

const initialState: ProbeState = { attempt: 0, events: [] };
const source = { html: probeHtml, baseUrl: "about:blank" };
const labels: Record<ProbeStage, string> = {
  inspected: "已检查原生组件",
  started: "正在挂载网页",
  loaded: "网页加载完成",
  ready: "JavaScript 已运行，回传成功",
  clicked: "网页点击已回传到插件",
  "native-error": "网页加载失败",
  "render-error": "原生组件挂载失败",
};

function inspectRuntime() {
  if (Platform.OS !== "ios") {
    return {
      nativeView: false,
      reactNativeVersion: "unavailable",
      detail: "This probe targets iOS.",
    };
  }
  const version = Platform.constants.reactNativeVersion;
  const reactNativeVersion = `${version.major}.${version.minor}.${version.patch}`;
  try {
    const nativeView = UIManager.hasViewManagerConfig("RNCWebView");
    return { nativeView, reactNativeVersion, detail: `RNCWebView registered: ${nativeView}` };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { nativeView: false, reactNativeVersion, detail };
  }
}

interface FrameBoundaryProps {
  children: ReactNode;
  onFailure(message: string): void;
}

class FrameBoundary extends Component<FrameBoundaryProps, { error: string }> {
  state = { error: "" };

  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }

  componentDidCatch(error: Error) {
    this.props.onFailure(error.message);
  }

  render() {
    if (this.state.error) {
      return <Text style={styles.failure}>{this.state.error}</Text>;
    }
    return this.props.children;
  }
}

interface MessageEvent {
  data: string;
}

interface LoadingError {
  description: string;
}

export function MobileProbe({ theme }: PluginSurfaceProps) {
  const runtime = useMemo(inspectRuntime, []);
  const run = useMemo(
    () => `${Platform.OS}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    [],
  );
  const [state, dispatch] = useReducer(reduceProbe, initialState);
  const report = useRpc(reportRpc);
  const { mutate, error } = useMutation({ mutationFn: report });
  const foreground = useMemo(() => ({ color: theme.colors.foreground }), [theme.colors.foreground]);
  const record = useCallback(
    (stage: ProbeStage, detail = "") => {
      const event = { stage, detail: detail.slice(0, 1000) };
      dispatch(event);
      mutate({
        run,
        platform: Platform.OS,
        osVersion: String(Platform.Version),
        reactNativeVersion: runtime.reactNativeVersion,
        nativeView: runtime.nativeView,
        ...event,
      });
    },
    [mutate, run, runtime],
  );
  useEffect(() => {
    if (Platform.OS === "ios") record("inspected", runtime.detail);
  }, [record, runtime]);
  const start = useCallback(() => record("started"), [record]);
  const loaded = useCallback(() => record("loaded"), [record]);
  const failed = useCallback((message: string) => record("render-error", message), [record]);
  const loadError = useCallback(
    (event: NativeSyntheticEvent<LoadingError>) => {
      record("native-error", event.nativeEvent.description);
    },
    [record],
  );
  const message = useCallback(
    (event: NativeSyntheticEvent<MessageEvent>) => {
      const parsed = pageMessage.safeParse(event.nativeEvent.data);
      if (parsed.success) record(parsed.data);
    },
    [record],
  );
  const eventLines = state.events.map(
    (event) => `${labels[event.stage]}${event.detail ? `：${event.detail}` : ""}`,
  );
  const eventText = eventLines.join("\n");
  if (Platform.OS !== "ios") {
    return (
      <View style={styles.container}>
        <Text style={foreground}>请在 iPhone 的 Paseo 中打开此测试。</Text>
      </View>
    );
  }
  // The app already registers this host view through its built-in WebView consumers.
  const frame =
    state.attempt > 0 &&
    createElement("RNCWebView", {
      style: styles.frame,
      source,
      newSource: source,
      javaScriptEnabled: true,
      messagingEnabled: true,
      messagingModuleName: "",
      scrollEnabled: true,
      incognito: true,
      cacheEnabled: false,
      javaScriptCanOpenWindowsAutomatically: false,
      setSupportMultipleWindows: false,
      onMessage: message,
      onLoadingFinish: loaded,
      onLoadingError: loadError,
    });
  return (
    <View style={styles.container}>
      <Text style={foreground}>第一步：验证现有 App 能否内嵌网页</Text>
      <Text style={foreground}>
        iOS {String(Platform.Version)} · React Native {runtime.reactNativeVersion}
        {"\n"}RNCWebView：{runtime.nativeView ? "已注册" : "不可用"}
      </Text>
      <Text style={foreground}>开始后，在绿色网页里点击“点击测试回传”。</Text>
      {runtime.nativeView ? (
        <Pressable accessibilityRole="button" onPress={start} style={styles.button}>
          <Text style={styles.buttonText}>
            {state.attempt === 0 ? "开始离线网页测试" : "重新测试"}
          </Text>
        </Pressable>
      ) : (
        <Text style={foreground}>{runtime.detail}</Text>
      )}
      {state.attempt > 0 ? (
        <FrameBoundary key={state.attempt} onFailure={failed}>
          {frame}
        </FrameBoundary>
      ) : null}
      <View style={styles.events}>
        <Text style={foreground}>{eventText}</Text>
      </View>
      {error ? <Text style={styles.failure}>诊断回传失败：{error.message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 12 },
  button: { alignSelf: "flex-start", backgroundColor: "#dce9af", padding: 12, borderRadius: 10 },
  buttonText: { color: "#123b35", fontWeight: "600" },
  frame: { flex: 1, minHeight: 220, backgroundColor: "#123b35" },
  events: { gap: 4 },
  failure: { color: "#d75151" },
});
