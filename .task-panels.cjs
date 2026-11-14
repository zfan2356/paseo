const fs = require("fs");
function edit(p, f) {
  const b = "packages/app/src/" + p;
  fs.writeFileSync(b, f(fs.readFileSync(b, "utf8")));
}
edit("panels/files-panel.tsx", (s) =>
  s
    .replace(
      "import { Text, View }",
      'import { useSessionDirectoryTarget, SessionDirectoryToolbar } from "@/session-navigation/directory-toolbar";\nimport { Text, View }',
    )
    .replace(
      '  const directory = target.kind === "files" ? target.directory : undefined;',
      "  const selection = useSessionDirectoryTarget();\n  const { directory, sessionAgentId } = selection;",
    )
    .replace("target.directory", "directory")
    .replace("target.sessionAgentId", "sessionAgentId")
    .replace(
      "    <View style={styles.fill}>",
      "    <View style={styles.fill}>\n      <SessionDirectoryToolbar selection={selection} />",
    )
    .replace("          {serverId} · {directory}", "          {directory}"),
);
edit("panels/diff-panel.tsx", (s) => {
  s =
    'import { useSessionDirectoryTarget, SessionDirectoryToolbar } from "@/session-navigation/directory-toolbar";\n' +
    s;
  const start = s.indexOf("function ChangesPanel()");
  const end = s.indexOf("\nfunction CommitDiffPanel", start);
  let a = s
    .slice(start, end)
    .replace(
      '  const directory =\n    target.kind === "working_diff" || target.kind === "changes_tree" ? target.directory : undefined;',
      "  const selection = useSessionDirectoryTarget();\n  const { directory, sessionAgentId } = selection;",
    )
    .replaceAll("target.directory", "directory")
    .replaceAll("target.sessionAgentId", "sessionAgentId");
  a = a
    .replace(
      '  if (resolved.loading) return <PanelState message={t("common.loading")} />;',
      '  if (resolved.loading) return <View style={styles.container}><SessionDirectoryToolbar selection={selection} /><PanelState message={t("common.loading")} /></View>;',
    )
    .replace(
      '  if (resolved.error) return <PanelState message={resolved.error} tone="error" />;',
      '  if (resolved.error) return <View style={styles.container}><SessionDirectoryToolbar selection={selection} /><PanelState message={resolved.error} tone="error" /></View>;',
    );
  a = a.replace(
    "    <View style={styles.container} testID={testID}>",
    "    <View style={styles.container} testID={testID}>\n      <SessionDirectoryToolbar selection={selection} />",
  );
  a = a.replace("{serverId} · {directory}", "{directory}");
  return s.slice(0, start) + a + s.slice(end);
});
edit(
  "screens/workspace/explorer-sidebar.tsx",
  (s) =>
    'import { WorkspaceResourcesButton } from "@/session-navigation/workspace-resources";\n' +
    s.replace(
      "            {headerAction ?",
      "            <WorkspaceResourcesButton />\n            {headerAction ?",
    ),
);
edit(
  "screens/open-project-screen.tsx",
  (s) =>
    'import { WorkspaceResourcesSheet } from "@/session-navigation/workspace-resources";\n' +
    s
      .replace(
        "import { FolderOpen, Inbox, Plug, Smartphone }",
        "import { FolderOpen, Inbox, Plug, Smartphone, PanelsTopLeft }",
      )
      .replace(
        "  const [isPairDeviceOpen,",
        "  const [resourcesOpen, setResourcesOpen] = useState(false);\n  const openResources = useCallback(() => setResourcesOpen(true), []);\n  const closeResources = useCallback(() => setResourcesOpen(false), []);\n  const [isPairDeviceOpen,",
      )
      .replace(
        "          <View style={styles.tiles}>",
        '          <View style={styles.tiles}>\n            <HomeTile icon={PanelsTopLeft} title={t("sessionNavigation.workspaceResources")}\n              description={t("sessionNavigation.workspaceResourcesHint")} onPress={openResources}\n              testID="open-project-workspace-resources" />',
      )
      .replace(
        "      {importSession.sheet}",
        "      {resourcesOpen ? <WorkspaceResourcesSheet onClose={closeResources} /> : null}\n      {importSession.sheet}",
      ),
);
for (const [locale, labels] of Object.entries({
  en: [
    "Workspaces and terminals",
    "Open existing terminals, services and workspace layouts.",
    "Session directories",
  ],
  "zh-CN": ["工作区与终端", "打开已有终端、服务与工作区布局。", "会话关联目录"],
}))
  edit("i18n/resources/" + locale + ".ts", (s) =>
    s.replace(
      "  sessionNavigation: {",
      "  sessionNavigation: {\n    workspaceResources: " +
        JSON.stringify(labels[0]) +
        ",\n    workspaceResourcesHint: " +
        JSON.stringify(labels[1]) +
        ",\n    selectDirectory: " +
        JSON.stringify(labels[2]) +
        ",",
    ),
  );
