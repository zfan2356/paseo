const fs = require("fs");
const base = "packages/app/src/";
function edit(p, f) {
  fs.writeFileSync(base + p, f(fs.readFileSync(base + p, "utf8")));
}
edit("session-navigation/sidebar.tsx", (s) => {
  for (const a of [
    'import {\n  useWorkspaceLayoutStore,\n  selectExplorerSidebarPaneId,\n} from "@/stores/workspace-layout-store";\n',
    'import { findPaneById, collectAllTabs } from "@/stores/workspace-layout-actions";\n',
    'import { useIsExplorerSidebarOpen } from "@/workspace-tabs/explorer-sidebar";\n',
    'import { useFetchQueries } from "@/data/query";\n',
    'import { AgentStatusDot } from "@/components/agent-status-dot";\n',
    'import { useRetainedPanelActive } from "@/components/retained-panel";\n',
    'import { readDirectoryFacts, sessionDirectories, groupDirectories } from "./model";\n',
    'import { Button } from "@/components/ui/button";\n',
    'import {\n  DropdownMenu,\n  DropdownMenuTrigger,\n  DropdownMenuContent,\n  DropdownMenuItem,\n} from "@/components/ui/dropdown-menu";\n',
    'import { checkoutStatusQueryKey } from "@/git/query-keys";\n',
    'import { shortenPath } from "@/utils/shorten-path";\n',
    'import { useIsCompactFormFactor } from "@/constants/layout";\n',
    'import { usePanelStore } from "@/stores/panel-store";\n',
  ])
    s = s.replace(a, "");
  s = s.replace(
    'import {\n  BindDirectory,\n  SessionSettings,\n  CreateSessionWorktree,\n  useContextMutation,\n} from "./actions";',
    'import { SessionSettings } from "./actions";',
  );
  s = s
    .replace("  navigateToWorkspace,\n", "")
    .replace(
      "  const activeWorkspaceKey = activeWorkspace\n    ? `${activeWorkspace.serverId}:${activeWorkspace.workspaceId}`\n    : null;\n",
      "",
    );
  s = s.replace(
    "  const { t } = useTranslation();\n  const displayName = name;",
    "  const displayName = name;",
  );
  s = s.replace(
    "paddingHorizontal: density.space(2), paddingVertical: density.space(1),",
    "paddingHorizontal: theme.spacing[2], paddingVertical: theme.spacing[2], minHeight: density.rowHeight,",
  );
  s = s.replace(
    "styles.card, selected && styles.selected, hovered && styles.hovered",
    "styles.card, hovered && styles.hovered, selected && styles.selected",
  );
  s = s.replace(
    "backgroundColor: theme.colors.interactionHighlight",
    "backgroundColor: theme.colors.surfaceSidebarSelected",
  );
  return s;
});
edit("components/left-sidebar.tsx", (s) =>
  s.replace(
    /<SessionSidebar dismiss=\{closeSidebar\}>[\s\S]*?<\/SessionSidebar>/g,
    "<SessionSidebar dismiss={closeSidebar} />",
  ),
);
