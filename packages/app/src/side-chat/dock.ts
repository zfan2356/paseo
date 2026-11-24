import {
  collectAllTabs,
  findPaneById,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { workspaceTabTargetsEqual } from "@/workspace-tabs/identity";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { openWorkspaceTargetBeside } from "@/workspace-tabs/open-beside";

export function revealSideChatTab(input: {
  workspaceKey: string | null;
  target: WorkspaceTabTarget;
}): void {
  openWorkspaceTargetBeside({
    workspaceKey: input.workspaceKey,
    target: input.target,
  });
}

export function toggleSideChatTab(input: {
  workspaceKey: string | null;
  target: WorkspaceTabTarget;
}): void {
  if (!input.workspaceKey) {
    return;
  }
  const store = useWorkspaceLayoutStore.getState();
  const layout = store.layoutByWorkspace[input.workspaceKey];
  const paneId = store.sidePaneIdByWorkspace[input.workspaceKey];
  const pane = layout && paneId ? findPaneById(layout.root, paneId) : null;
  const focusedTab =
    layout && pane?.focusedTabId
      ? collectAllTabs(layout.root).find((tab) => tab.tabId === pane.focusedTabId)
      : null;
  const visible =
    pane != null &&
    pane.hidden !== true &&
    focusedTab != null &&
    workspaceTabTargetsEqual(focusedTab.target, input.target);
  if (visible) {
    store.hideSidePane(input.workspaceKey);
    return;
  }
  revealSideChatTab(input);
}
