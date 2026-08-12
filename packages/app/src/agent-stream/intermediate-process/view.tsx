import { memo, useCallback, useMemo, type ReactNode } from "react";
import { View } from "react-native";
import { ListTree } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { ExpandableBadge } from "@/components/message";
import type { IntermediateProcessGroup } from "./model";

interface IntermediateProcessGroupViewProps {
  group: IntermediateProcessGroup;
  expanded: boolean;
  onExpandedChange: (groupId: string, expanded: boolean) => void;
  children: ReactNode;
}

export const IntermediateProcessGroupView = memo(function IntermediateProcessGroupView({
  group,
  expanded,
  onExpandedChange,
  children,
}: IntermediateProcessGroupViewProps) {
  const { t } = useTranslation();
  const toggle = useCallback(() => {
    onExpandedChange(group.id, !expanded);
  }, [expanded, group.id, onExpandedChange]);
  const secondaryLabel = useMemo(
    () =>
      group.isActive
        ? t("intermediateProcess.running")
        : t("intermediateProcess.steps", { count: group.stepCount }),
    [group.isActive, group.stepCount, t],
  );
  const renderDetails = useCallback(
    () => <View style={styles.content}>{children}</View>,
    [children],
  );

  return (
    <ExpandableBadge
      testID="intermediate-process-group"
      label={t("intermediateProcess.label")}
      secondaryLabel={secondaryLabel}
      icon={ListTree}
      isExpanded={expanded}
      isLoading={group.isActive}
      isError={group.hasError}
      onToggle={toggle}
      renderDetails={renderDetails}
      borderlessWhenExpanded
      isLastInSequence
    />
  );
});

const styles = StyleSheet.create((theme) => ({
  content: {
    gap: theme.spacing[1],
    paddingTop: theme.spacing[1],
    paddingHorizontal: 13,
  },
}));
