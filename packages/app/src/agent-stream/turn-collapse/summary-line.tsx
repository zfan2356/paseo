import { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ListTree, Summary } from "lucide-react-native";
import { ExpandableBadge } from "@/components/message";
import { useOverviewSummaryLabel } from "@/tool-calls/detail-level/overview/label";
import type { CollapsedTurn } from "./model";

/**
 * The row a collapsed turn leaves under its user message, styled like a tool-call group.
 * Pressing it opens the turn's rows beneath it.
 */
export const TurnSummaryLine = memo(function TurnSummaryLine({
  turn,
  onExpandedChange,
}: {
  turn: CollapsedTurn;
  onExpandedChange: (hostId: string, expanded: boolean) => void;
}) {
  const { t } = useTranslation();
  const summaryLabel = useOverviewSummaryLabel(turn.summary.tools) || t("turnSummary.details");
  const label = turn.process ? t("intermediateProcess.label") : summaryLabel;
  const toggle = useCallback(
    () => onExpandedChange(turn.hostId, !turn.expanded),
    [onExpandedChange, turn.expanded, turn.hostId],
  );

  let secondaryLabel: string | undefined;
  if (turn.process)
    secondaryLabel = turn.process.active
      ? t("intermediateProcess.running")
      : t("intermediateProcess.steps", { count: turn.process.stepCount });
  return (
    <ExpandableBadge
      testID={turn.process ? "intermediate-process-group" : "turn-summary"}
      label={label}
      icon={turn.process ? ListTree : Summary}
      secondaryLabel={secondaryLabel}
      isLoading={turn.process?.active}
      isError={turn.process?.hasError}
      isExpanded={turn.expanded}
      onToggle={toggle}
      borderlessWhenExpanded
    />
  );
});
