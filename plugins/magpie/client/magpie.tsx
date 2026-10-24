import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { webUiRpc } from "../shared/magpie.js";
import { MagpieWebView, residentMagpieUrl, resetMagpiePage } from "./web.js";

export function MagpieSurface({ host, theme }: PluginSurfaceProps) {
  const getWebUi = useRpc(webUiRpc);
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);
  const residentUrl = residentMagpieUrl(host.id);
  const page = useQuery({
    queryKey: ["magpie", "web", host.id],
    queryFn: () => getWebUi({}),
    retry: false,
    gcTime: Infinity,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    initialData: residentUrl ? { url: residentUrl } : undefined,
  });
  const refetch = page.refetch;
  const error = page.error?.message || loadError;
  const foreground = useMemo(() => ({ color: theme.colors.foreground }), [theme.colors.foreground]);
  const failed = useCallback(() => setLoadError("无法加载 Magpie，请检查本机服务后重试。"), []);
  const retry = useCallback(() => {
    resetMagpiePage(host.id);
    setLoadError("");
    setRevision((value) => value + 1);
    void refetch();
  }, [host.id, refetch]);
  const open = useCallback(() => {
    if (page.data) {
      void openExternalUrl(page.data.url).catch(() => setLoadError("无法打开浏览器。"));
    }
  }, [page.data]);
  const status = page.data
    ? "在浏览器中使用 Magpie 原生管理页面。"
    : "正在打开 Magpie 原生管理页面…";
  if (page.data && !error && Platform.OS === "web") {
    return <MagpieWebView key={revision} hostId={host.id} url={page.data.url} onError={failed} />;
  }
  return (
    <View style={styles.container}>
      <Text style={foreground}>Magpie</Text>
      <Text style={foreground}>{error || status}</Text>
      {error ? (
        <Pressable accessibilityRole="button" onPress={retry}>
          <Text style={foreground}>重试</Text>
        </Pressable>
      ) : null}
      {page.data ? (
        <Pressable accessibilityRole="button" onPress={open}>
          <Text style={foreground}>在浏览器打开 Magpie</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 16 },
});
