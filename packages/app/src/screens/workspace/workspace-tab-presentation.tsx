import type { Theme } from "@/styles/theme";
import { StatusIcon } from "@/components/status-icon";
import { useCallback, useMemo, type ReactElement, type ReactNode } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { Check, GitFork } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import invariant from "tiny-invariant";
import { getPanelRegistration, type PanelIconProps } from "@/panels/panel-registry";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import type { SurfaceBackdrop } from "@/styles/surface-backdrop";
import { usePanelInstanceAttributes } from "@/panels/panel-instance-attributes";
import { useRunningSubagentCount } from "@/subagents/activity-context";
import { getStatusDotColor } from "@/utils/status-dot-color";

export interface WorkspaceTabPresentation {
  key: string;
  kind: WorkspaceTabDescriptor["kind"];
  label: string;
  subtitle: string;
  tooltip: string;
  modified: boolean;
  showCloseButton: boolean;
  titleState: "ready" | "loading";
  icon: React.ComponentType<PanelIconProps>;
  statusBucket: SidebarStateBucket | null;
  runningSubagents?: number;
}

interface WorkspaceTabPresentationResolverProps {
  tab: WorkspaceTabDescriptor;
  serverId: string;
  workspaceId: string;
  children: (presentation: WorkspaceTabPresentation) => ReactNode;
}

type WorkspaceTabPresentationResolverInnerProps = WorkspaceTabPresentationResolverProps & {
  registration: NonNullable<ReturnType<typeof getPanelRegistration>>;
};

export function WorkspaceTabPresentationResolver({
  tab,
  serverId,
  workspaceId,
  children,
}: WorkspaceTabPresentationResolverProps): ReactElement {
  const registration = getPanelRegistration(tab.kind);
  invariant(registration, `No panel registration for kind: ${tab.kind}`);

  return (
    <WorkspaceTabPresentationResolverInner
      key={`${tab.key}:${tab.kind}`}
      registration={registration}
      tab={tab}
      serverId={serverId}
      workspaceId={workspaceId}
    >
      {children}
    </WorkspaceTabPresentationResolverInner>
  );
}

function WorkspaceTabPresentationResolverInner({
  registration,
  tab,
  serverId,
  workspaceId,
  children,
}: WorkspaceTabPresentationResolverInnerProps): ReactElement {
  const descriptor = registration.useDescriptor(tab.target as never, {
    serverId,
    workspaceId,
    tabId: tab.tabId,
  });
  const attributes = usePanelInstanceAttributes({ serverId, workspaceId, tabId: tab.tabId });
  const runningSubagents = useRunningSubagentCount(
    serverId,
    tab.target.kind === "agent" ? tab.target.agentId : null,
  );

  const presentation = useMemo(
    () => ({
      key: tab.key,
      kind: tab.kind,
      label: descriptor.label,
      subtitle: descriptor.subtitle,
      tooltip: descriptor.tooltip,
      modified: attributes.modified,
      showCloseButton: registration.showCloseButton,
      titleState: descriptor.titleState,
      icon: descriptor.icon,
      statusBucket: descriptor.statusBucket,
      runningSubagents,
    }),
    [
      descriptor.icon,
      descriptor.label,
      descriptor.tooltip,
      descriptor.statusBucket,
      descriptor.subtitle,
      descriptor.titleState,
      tab.key,
      tab.kind,
      attributes.modified,
      registration.showCloseButton,
      runningSubagents,
    ],
  );

  return <>{children(presentation)}</>;
}

interface WorkspaceTabIconProps {
  presentation: WorkspaceTabPresentation;
  active?: boolean;
  size?: number;
  strokeWidth?: number;
  statusDotBorderColor?: string;
  /**
   * The surface this icon is sitting on, so the running ring can knock out of it. This icon is
   * shared by the desktop tab strip, the tab switcher trigger, the split drag chip and the
   * subagents track, which are on different surfaces and some of which change surface on hover —
   * it cannot work the colour out for itself.
   */
  backdrop: SurfaceBackdrop;
}

const ThemedCheckIcon = withUnistyles(Check);
const ThemedGitFork = withUnistyles(GitFork);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const runningColorMapping = (theme: Theme) => ({
  color: getStatusDotColor({ theme, bucket: "running" }) ?? theme.colors.foregroundMuted,
});

export function useRunningSubagentLabel(count = 0): string | undefined {
  const { t } = useTranslation();
  if (count === 0) return undefined;
  return count === 1 ? t("subagents.runningOne") : t("subagents.runningMany", { count });
}

export function WorkspaceTabSubagentBadge({ count = 0 }: { count?: number }) {
  if (count === 0) return null;
  return (
    <View style={styles.subagentBadge} aria-hidden testID="workspace-tab-running-subagents">
      <ThemedGitFork size={12} uniProps={runningColorMapping} />
      <Text style={styles.subagentCount}>{count > 99 ? "99+" : count}</Text>
    </View>
  );
}

export function WorkspaceTabIcon({
  presentation,
  active = false,
  size = 14,
  strokeWidth,
  statusDotBorderColor,
  backdrop,
}: WorkspaceTabIconProps): ReactElement {
  const Icon = presentation.icon;
  const iconColor = active ? styles.iconActive.color : styles.iconInactive.color;
  return (
    <StatusIcon
      statusBucket={presentation.statusBucket}
      size={size}
      statusDotBorderColor={statusDotBorderColor}
      backdrop={backdrop}
    >
      <Icon size={size} color={iconColor} strokeWidth={strokeWidth} />
    </StatusIcon>
  );
}

interface WorkspaceTabOptionRowProps {
  presentation: WorkspaceTabPresentation;
  selected: boolean;
  active: boolean;
  onPress: () => void;
  trailingAccessory?: ReactNode;
}

export function WorkspaceTabOptionRow({
  presentation,
  selected,
  active,
  onPress,
  trailingAccessory,
}: WorkspaceTabOptionRowProps): ReactElement {
  const { t } = useTranslation();
  const subagentLabel = useRunningSubagentLabel(presentation.runningSubagents);
  const isOptionActive = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) =>
      Boolean(hovered) || pressed || active,
    [active],
  );
  const pressableStyle = useCallback(
    (state: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.optionMainPressable,
      isOptionActive(state) && styles.optionRowActive,
    ],
    [isOptionActive],
  );
  const optionRowStyle = useMemo(
    () => [styles.optionRow, active && styles.optionRowActive],
    [active],
  );
  return (
    <View style={optionRowStyle}>
      <Pressable onPress={onPress} style={pressableStyle} accessibilityHint={subagentLabel}>
        {(state) => {
          const optionActive = isOptionActive(state);
          return (
            <>
              <View style={styles.optionLeadingSlot}>
                <WorkspaceTabIcon
                  presentation={presentation}
                  active={selected || active}
                  backdrop={optionActive ? "surface1" : "surface0"}
                />
              </View>
              <View style={styles.optionContent}>
                <Text numberOfLines={1} style={styles.optionLabel}>
                  {presentation.titleState === "loading"
                    ? t("workspace.tabs.loading")
                    : presentation.label}
                </Text>
              </View>
              <WorkspaceTabSubagentBadge count={presentation.runningSubagents} />
            </>
          );
        }}
      </Pressable>
      {presentation.modified ? (
        <View style={styles.optionModifiedDot} accessibilityLabel={t("workspace.tabs.modified")} />
      ) : null}
      {selected ? (
        <View style={styles.optionTrailingSlot}>
          <ThemedCheckIcon size={16} uniProps={mutedColorMapping} />
        </View>
      ) : null}
      {trailingAccessory ? (
        <View style={styles.optionTrailingAccessorySlot}>{trailingAccessory}</View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  subagentBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    flexShrink: 0,
    pointerEvents: "none",
  },
  subagentCount: {
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
    color: runningColorMapping(theme).color,
  },
  iconActive: {
    color: theme.colors.foreground,
  },
  iconInactive: {
    color: theme.colors.foregroundMuted,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 36,
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    borderRadius: 0,
    marginHorizontal: theme.spacing[1],
    marginBottom: theme.spacing[1],
  },
  optionMainPressable: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  optionRowActive: {
    backgroundColor: theme.colors.surface1,
  },
  optionLeadingSlot: {
    width: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  optionContent: {
    flex: 1,
    flexShrink: 1,
  },
  optionLabel: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  optionTrailingSlot: {
    width: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  optionModifiedDot: {
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.foregroundMuted,
  },
  optionTrailingAccessorySlot: {
    alignItems: "center",
    justifyContent: "center",
  },
}));
