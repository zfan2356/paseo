const fs = require("fs");
function edit(p, f) {
  const q = "packages/app/src/" + p;
  fs.writeFileSync(q, f(fs.readFileSync(q, "utf8")));
}
edit("components/left-sidebar.tsx", (s) => {
  s = s.replace(
    'import { SidebarWorkspaceList } from "@/components/sidebar-workspace-list";\n',
    "",
  );
  for (const name of [
    "workspaceGroups",
    "projectIconTargets",
    "pinnedGroups",
    "projects",
    "hasProjectsBeforeFilter",
    "hasActiveProjectFilter",
    "workspaceEntriesByKey",
    "isRevalidating",
    "isManualRefresh",
    "groupMode",
    "collapsedProjectKeys",
    "shortcutIndexByWorkspaceKey",
    "toggleProjectCollapsed",
    "handleRefresh",
    "handleImportSession",
  ]) {
    // Remove the obsolete prop drilling throughout the shell, retaining controller properties where still consumed.
    s = s
      .replaceAll("  " + name + ",\n", "")
      .replace(new RegExp("^\\s*" + name + "=\\{" + name + "\\}\\n", "gm"), "");
  }
  s = s
    .replace(
      "function MobileLeftSidebar({\n  active,",
      "function MobileLeftSidebar({\n  active: _active,",
    )
    .replace(
      "closeGestureRef } = useMobilePanelGesture",
      "closeGestureRef: _closeGestureRef } = useMobilePanelGesture",
    );
  return s;
});
edit("panels/files-panel.tsx", (s) =>
  s
    .replaceAll("target.directory", "directory")
    .replaceAll("target.sessionAgentId", "sessionAgentId")
    .replace("sessionAgentId: sessionAgentId", "sessionAgentId"),
);
edit("session-navigation/directory-toolbar.tsx", (s) => {
  s = s.replace('import { Button } from "@/components/ui/button";\n', "");
  s = s
    .replace(
      "  const targets = useMemo(() => agent ? [{ serverId, agentId: agent.id,",
      "  const agentId = agent?.id;\n  const targets = useMemo(() => agentId ? [{ serverId, agentId,",
    )
    .replace("[serverId, agent?.id, client,", "[serverId, agentId, client,");
  s = s.replace(
    "  const { t } = useTranslation();\n  const { target, retargetCurrentTab }",
    "  const { target, retargetCurrentTab }",
  );
  s = s.replace(
    "  if (!agent || !context || !client ||",
    '  const agentId = agent?.id;\n  const selectDirectory = useCallback((path: string) => {\n    if (!agentId || (target.kind !== "files" && target.kind !== "changes_tree" && target.kind !== "working_diff")) return;\n    useSessionNavigationPreferences.getState().selectDirectory(`${serverId}:${agentId}`, path);\n    retargetCurrentTab({ kind: target.kind, directory: path, sessionAgentId: agentId });\n  }, [serverId, agentId, target.kind, retargetCurrentTab]);\n  if (!agent || !context || !client ||',
  );
  s = s.replace(
    /onBind=\{openBinding\} onSelect=\{\(path\) => \{[\s\S]*?\}\}>/,
    "onBind={openBinding} onSelect={selectDirectory}>",
  );
  s = s.replace(
    '{directories.map(({ path, launch }) => <DropdownMenuItem key={path} onSelect={() => onSelect(path)}>\n            {path}{launch ? ` · ${t("sessionNavigation.launchExecution")}` : ""}\n          </DropdownMenuItem>)}',
    "{directories.map(({ path, launch }) => <DirectoryChoice key={path} path={path} launch={launch} select={onSelect} />)}",
  );
  s +=
    '\nfunction DirectoryChoice({ path, launch, select }: { path: string; launch: boolean; select(path: string): void }) {\n  const { t } = useTranslation();\n  const choose = useCallback(() => select(path), [path, select]);\n  return <DropdownMenuItem onSelect={choose}>{path}{launch ? ` · ${t("sessionNavigation.launchExecution")}` : ""}</DropdownMenuItem>;\n}\n';
  return s;
});
// Hoist JSX values out of prop expressions to preserve the repository's render contract.
edit("components/sidebar/sidebar-workspace-row-content.tsx", (s) => {
  const begin = s.indexOf("  return (\n    <SidebarCardContent");
  const end = s.indexOf("\nexport function SidebarCardContent", begin);
  let sub = s.slice(begin, end);
  const lStart = sub.indexOf("leading={");
  const lEnd = sub.indexOf("\n      metadata={", lStart);
  const leading = sub.slice(lStart + 9, lEnd - 1);
  const mStart = lEnd + 1;
  const mEnd = sub.indexOf("\n      trailing=", mStart);
  const meta = sub.slice(mStart + 16, mEnd - 1);
  sub = sub.slice(0, lStart) + "leading={leading}\n      metadata={metadata}" + sub.slice(mEnd);
  return (
    s.slice(0, begin) +
    "  const leading = " +
    leading +
    ";\n  const metadata = " +
    meta +
    ";\n" +
    sub +
    s.slice(end)
  );
});
edit("session-navigation/sidebar.tsx", (s) => {
  const pos = s.indexOf("  return (\n    <View testID={`session-row-");
  const lStart = s.indexOf("leading={", pos);
  const mStart = s.indexOf("\n            metadata={", lStart);
  const trStart = s.indexOf("\n            trailing={", mStart);
  const trEnd = s.indexOf("\n          />", trStart);
  const leading = s.slice(lStart + 9, mStart - 1);
  const metadata = s.slice(mStart + "\n            metadata={".length, trStart - 1);
  const trailing = s.slice(trStart + "\n            trailing={".length, trEnd - 1);
  return (
    s.slice(0, pos) +
    "  const leading = " +
    leading +
    ";\n  const metadata = " +
    metadata +
    ";\n  const trailingContent = " +
    trailing +
    ";\n" +
    s.slice(pos, lStart) +
    "leading={leading}\n            metadata={metadata}\n            trailing={trailingContent}" +
    s.slice(trEnd)
  );
});
