import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Archive, CircleCheck, MoreVertical, Pencil, Pin, PinOff, Tag } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { SidebarRowArchiveButton } from "@/components/sidebar/sidebar-workspace-menu";
import { ContextMenu, ContextMenuTrigger, ContextMenuContent } from "@/components/ui/context-menu";
import { SessionRowHover } from "./hover";
import { View } from "react-native";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MenuItem, MenuSubTrigger, type MenuPageDefinition } from "@/components/ui/menu";
import { bySizing } from "@/components/ui/control-geometry";
import type { Theme } from "@/styles/theme";
import { WORKSPACE_LABEL_PAGE_ID } from "@/workspace-labels/picker";

const ThemedMoreVertical = withUnistyles(MoreVertical);
const ThemedArchive = withUnistyles(Archive);
const muted = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const icons = {
  rename: withUnistyles(Pencil),
  read: withUnistyles(CircleCheck),
  pin: withUnistyles(Pin),
  unpin: withUnistyles(PinOff),
  labels: withUnistyles(Tag),
  archive: ThemedArchive,
};

const Rename = icons.rename;
const Read = icons.read;
const PinIcon = icons.pin;
const UnpinIcon = icons.unpin;
const Labels = icons.labels;
const renameIcon = <Rename size={14} uniProps={muted} />;
const readIcon = <Read size={14} uniProps={muted} />;
const pinIcon = <PinIcon size={14} uniProps={muted} />;
const unpinIcon = <UnpinIcon size={14} uniProps={muted} />;
const labelIcon = <Labels size={14} uniProps={muted} />;
const archiveIcon = <ThemedArchive size={14} uniProps={muted} />;

export function SessionRowMenuFrame({
  actions,
  pages,
  children,
  onHoverChange,
}: {
  actions: SessionMenuActions;
  pages: readonly MenuPageDefinition[];
  children: ReactNode;
  onHoverChange(hovered: boolean): void;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger contextOnly enabledOnMobile={false}>
        <SessionRowHover onHoverChange={onHoverChange}>{children}</SessionRowHover>
      </ContextMenuTrigger>
      <ContextMenuContent width={260} pages={pages}>
        <SessionMenuItems actions={actions} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

export interface SessionMenuActions {
  canWrite: boolean;
  canRead: boolean;
  canManage: boolean;
  canArchive: boolean;
  pinned: boolean;
  pending: "rename" | "pin" | "read" | "archive" | null;
  rename(): void;
  pin(): void;
  read(): void;
  archive(): void;
  settings(): void;
  bind(): void;
}

export function SessionMenuItems({ actions }: { actions: SessionMenuActions }) {
  const { t } = useTranslation();
  const busy = actions.pending !== null;
  return (
    <>
      <MenuItem
        leading={renameIcon}
        disabled={!actions.canWrite || busy}
        onSelect={actions.rename}
        testID="session-menu-rename"
      >
        {t("sidebar.workspace.actions.rename")}
      </MenuItem>
      <MenuItem
        leading={actions.pinned ? unpinIcon : pinIcon}
        disabled={!actions.canManage || busy}
        onSelect={actions.pin}
        status={actions.pending === "pin" ? "pending" : "idle"}
        testID="session-menu-pin"
      >
        {t(actions.pinned ? "sessionNavigation.unpin" : "sessionNavigation.pin")}
      </MenuItem>
      <MenuSubTrigger
        id={WORKSPACE_LABEL_PAGE_ID}
        leading={labelIcon}
        disabled={!actions.canManage || busy}
        testID="session-menu-labels"
      >
        {t("workspaceLabels.title")}
      </MenuSubTrigger>
      <MenuItem
        leading={readIcon}
        disabled={!actions.canRead || busy}
        onSelect={actions.read}
        testID="session-menu-read"
      >
        {t("sessionNavigation.markRead")}
      </MenuItem>
      <MenuItem disabled={!actions.canManage || busy} onSelect={actions.settings}>
        {t("sessionNavigation.settings")}
      </MenuItem>
      <MenuItem disabled={!actions.canManage || busy} onSelect={actions.bind}>
        {t("sessionNavigation.bind")}
      </MenuItem>
      <MenuItem
        leading={archiveIcon}
        disabled={!actions.canArchive || busy}
        status={actions.pending === "archive" ? "pending" : "idle"}
        onSelect={actions.archive}
        testID="session-menu-archive"
      >
        {t("sessionNavigation.archive")}
      </MenuItem>
    </>
  );
}

export function SessionMenu({
  actions,
  pages,
}: {
  actions: SessionMenuActions;
  pages: readonly MenuPageDefinition[];
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu compactMode="sheet">
      <DropdownMenuTrigger
        accessibilityRole="button"
        accessibilityLabel={t("sessionNavigation.sessionMenu")}
        style={styles.trigger}
        testID="session-menu-trigger"
      >
        <ThemedMoreVertical size={16} uniProps={muted} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        width={260}
        pages={pages}
        sheetTitle={t("sessionNavigation.session")}
      >
        <SessionMenuItems actions={actions} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SessionArchiveButton({
  actions,
  visible,
}: {
  actions: SessionMenuActions;
  visible: boolean;
}) {
  const { t } = useTranslation();
  const style = useMemo(() => [styles.archive, !visible && styles.hidden], [visible]);
  const disabled = !visible || !actions.canArchive || actions.pending !== null;
  return (
    <View style={style} pointerEvents={visible ? "auto" : "none"}>
      <SidebarRowArchiveButton
        disabled={disabled}
        label={t("sessionNavigation.archive")}
        testID="session-hover-archive"
        onArchive={actions.archive}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    width: bySizing({ touch: 32, pointer: 18 }),
    height: bySizing({ touch: 32, pointer: 18 }),
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
  },
  archive: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
  },
  hidden: { opacity: 0 },
}));
