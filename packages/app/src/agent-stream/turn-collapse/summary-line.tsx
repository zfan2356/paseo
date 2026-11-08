import { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ListTree, Summary } from "lucide-react-native";
import { useDisclosureHold } from "@/agent-stream/disclosure";
import { ExpandableBadge } from "@/components/message";
import { useOverviewSummaryLabel } from "@/tool-calls/detail-level/overview/label";
import type { TurnSummaryItem } from "@/types/stream";

/**
 * The row a collapsed turn leaves under its user message, styled like a tool-call group.
 * Pressing it opens the turn's rows beneath it.
 */
export const TurnSummaryLine = memo(function TurnSummaryLine({
  item,
  onExpandedChange,
}: {
  item: TurnSummaryItem;
  onExpandedChange: (hostId: string, expanded: boolean) => void;
}) {
  const { t } = useTranslation();
  const summaryLabel = useOverviewSummaryLabel(item.tools) || t("turnSummary.details");
  const label = item.process ? t("intermediateProcess.label") : summaryLabel;
  const hold = useDisclosureHold();
  const toggle = useCallback(
    () => hold(() => onExpandedChange(item.hostId, !item.expanded)),
    [hold, onExpandedChange, item.expanded, item.hostId],
  );

  let secondaryLabel: string | undefined;
  if (item.process)
    secondaryLabel = item.process.active
      ? t("intermediateProcess.running")
      : t("intermediateProcess.steps", { count: item.process.stepCount });
  return (
    <ExpandableBadge
      testID={item.process ? "intermediate-process-group" : "turn-summary"}
      label={label}
      icon={item.process ? ListTree : Summary}
      secondaryLabel={secondaryLabel}
      isLoading={item.process?.active}
      isError={item.process?.hasError}
      isExpanded={item.expanded}
      onToggle={toggle}
      borderlessWhenExpanded
    />
  );
});
