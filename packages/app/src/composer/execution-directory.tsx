import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { Folder } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { AgentControlTrigger } from "@/composer/agent-controls/control";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { useSessionStore } from "@/stores/session-store";
import { executionDirectoryLabel } from "@/session-navigation/model";

export function ExecutionDirectory({
  serverId,
  cwd,
  compact,
}: {
  serverId: string;
  cwd: string;
  compact: boolean;
}) {
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
          <AgentControlTrigger
            icon={Folder}
            surface="toolbar"
            label={label}
            showToolbarLabel={!compact}
            onPress={openDetails}
            accessibilityLabel={fullLabel}
            testID="composer-execution-directory"
          />
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
  container: { maxWidth: 144, flexShrink: 1 },
  path: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
