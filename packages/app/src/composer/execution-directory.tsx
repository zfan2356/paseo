import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { Folder } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { useSessionStore } from "@/stores/session-store";
import { executionDirectoryLabel } from "@/session-navigation/model";

export function ExecutionDirectory({ serverId, cwd }: { serverId: string; cwd: string }) {
  const { t } = useTranslation();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const agents = useSessionStore((state) => state.sessions[serverId]?.agents);
  const label = useMemo(() => {
    const paths = agents ? [...agents.values()].map((agent) => agent.cwd) : [];
    return executionDirectoryLabel(cwd, paths);
  }, [agents, cwd]);
  const openDetails = useCallback(() => setDetailsOpen(true), []);
  const closeDetails = useCallback(() => setDetailsOpen(false), []);
  const fullLabel = t("sessionNavigation.execution", { path: cwd });
  const header = useMemo(() => ({ title: t("sessionNavigation.executionReadOnly") }), [t]);
  return (
    <View style={styles.container}>
      <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={Folder}
            onPress={openDetails}
            accessibilityLabel={fullLabel}
            testID="composer-execution-directory"
            style={styles.button}
          >
            <Text numberOfLines={1} style={styles.label}>
              {label}
            </Text>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <Text selectable style={styles.path}>
            {fullLabel}
          </Text>
        </TooltipContent>
      </Tooltip>
      <AdaptiveModalSheet
        visible={detailsOpen}
        onClose={closeDetails}
        header={header}
        testID="execution-directory-details"
      >
        <Text selectable style={styles.path} testID="execution-directory-full-path">
          {cwd}
        </Text>
      </AdaptiveModalSheet>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { alignItems: "flex-start", paddingHorizontal: theme.spacing[2] },
  button: { maxWidth: "100%", flexShrink: 1 },
  label: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm, flexShrink: 1 },
  path: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
