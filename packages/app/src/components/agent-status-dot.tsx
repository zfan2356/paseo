import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { getStatusDotColor } from "@/utils/status-dot-color";
import { STATUS_INDICATOR_FILLED_DOT_SIZE } from "@/utils/status-indicator-geometry";

export function AgentStatusDot({
  bucket,
  showInactive = false,
}: {
  bucket: SidebarStateBucket;
  showInactive?: boolean;
}) {
  if (bucket === "done" && !showInactive) return null;
  return <View style={styles.dot(bucket, showInactive)} />;
}

const styles = StyleSheet.create((theme) => ({
  dot: (bucket: SidebarStateBucket, showInactive: boolean) => ({
    width: STATUS_INDICATOR_FILLED_DOT_SIZE,
    height: STATUS_INDICATOR_FILLED_DOT_SIZE,
    borderRadius: theme.borderRadius.full,
    backgroundColor:
      getStatusDotColor({ theme, bucket, showDoneAsInactive: showInactive }) ?? undefined,
  }),
}));
