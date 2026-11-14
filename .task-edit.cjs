const fs = require("fs");
function edit(path, f) {
  fs.writeFileSync(path, f(fs.readFileSync(path, "utf8")));
}
const base = "packages/app/src/";
edit(base + "session-navigation/preferences.ts", (s) =>
  s
    .replace(
      "const PreferencesSchema = z.object({",
      'export type SessionGrouping = "project" | "directory";\nconst PreferencesSchema = z.object({\n  grouping: z.enum(["project", "directory"]).optional(),',
    )
    .replace(
      "  search: string;",
      "  search: string;\n  setGrouping(grouping: SessionGrouping): void;",
    )
    .replace(
      "      expanded: {},",
      '      grouping: "project",\n      setGrouping: (grouping) => set({ grouping }),\n      expanded: {},',
    )
    .replace(
      "        expanded: state.expanded,",
      "        grouping: state.grouping,\n        expanded: state.expanded,",
    ),
);
edit(base + "session-navigation/projection.ts", (s) =>
  s
    .replace(
      "import { sessionDirectories }",
      "import { sessionDirectories, executionDirectoryLabel }",
    )
    .replace("    group: string;", '    group: "project" | "directory";')
    .replace(
      '    } else if (input.preferences.group === "status") {\n      key = sessionStatus(agent);\n      name = key.replaceAll("_", " ");',
      '    } else if (input.preferences.group === "directory") {\n      key = directorySessionGroupKey(input.serverId, agent.cwd);\n      name = executionDirectoryLabel(agent.cwd, input.roots.map((root) => root.cwd));',
    )
    .replace(
      '  const order =\n    input.preferences.group === "status"\n      ? ["needs_input", "failed", "attention", "running", "done"]\n      : input.projectOrder;',
      '  const order = input.preferences.group === "project" ? input.projectOrder : [];',
    )
    .replace(
      "export const PINNED_SESSION_GROUP",
      'export function directorySessionGroupKey(serverId: string, cwd: string): string {\n  return JSON.stringify(["directory", serverId, cwd]);\n}\nexport const PINNED_SESSION_GROUP',
    ),
);
edit(base + "session-navigation/collection.ts", (s) =>
  s
    .replace(
      "  const hosts = useHosts();",
      '  const hosts = useHosts();\n  const grouping = useSessionNavigationPreferences((state) => state.grouping ?? "project");',
    )
    .replace("      group: state.groupMode,", "      group: grouping,")
    .replace(
      '    preferences.group === "status" ? state.collapsedWorkspaceGroupKeys : state.collapsedProjectKeys,',
      "    state.collapsedProjectKeys,",
    )
    .replace(
      '    const order =\n      preferences.group === "status"\n        ? ["needs_input", "failed", "attention", "running", "done"]\n        : projectOrder;',
      '    const order = preferences.group === "project" ? projectOrder : [];',
    )
    .replace(
      "        return order.indexOf(a.key) - order.indexOf(b.key);",
      "        const rank = (key: string) => { const index = order.indexOf(key); return index < 0 ? Infinity : index; };\n        return rank(a.key) - rank(b.key);",
    ),
);
// Reuse the existing title, icon rail, trailing and metadata geometry for both row kinds.
edit(base + "components/sidebar/sidebar-workspace-row-content.tsx", (s) => {
  const start = s.indexOf("  const workspaceBranchTextStyle = useMemo(");
  const end = s.indexOf("\nfunction WorkspaceStatusIndicator(", start);
  return (
    s.slice(0, start) +
    `  return (
    <SidebarCardContent
      title={workspaceLabel}
      titleTestID={\`sidebar-workspace-title-\${workspace.workspaceKey}\`}
      isHovered={isHovered}
      isCreating={isCreating}
      shortcutNumber={showShortcutBadge ? shortcutNumber : null}
      leading={leadingProjectName ? (
        <ProjectStatusIndicator
          iconDataUri={leadingProjectIconDataUri}
          displayName={leadingProjectName}
          projectViewKey={workspace.projectViewKey}
          statusBucket={workspace.statusBucket}
          backdrop={backdrop}
          loading={isLoading}
          testID={\`sidebar-row-project-icon-\${workspace.workspaceKey}\`}
        />
      ) : (
        <WorkspaceStatusIndicator bucket={workspace.statusBucket} workspaceKind={workspace.workspaceKind}
          loading={isLoading} reserveIdleSpace={reserveIdleStatusIndicatorSpace} />
      )}
      metadata={<WorkspaceMetaRow currentBranch={workspace.currentBranch} projectName={leadingProjectName}
        hostBadge={hostBadge ?? null} prHint={workspace.prHint} serviceSummary={serviceSummary} labels={labels} />}
      trailing={children}
    />
  );
});

export function SidebarCardContent({ title, titleTestID, leading, metadata, trailing,
  isHovered, isCreating = false, shortcutNumber = null }: {
  title: string; titleTestID?: string; leading: ReactNode; metadata?: ReactNode; trailing?: ReactNode;
  isHovered: boolean; isCreating?: boolean; shortcutNumber?: number | null;
}) {
  const titleStyle = useMemo(() => [styles.workspaceBranchText,
    isHovered && styles.workspaceBranchTextHovered, isCreating && styles.workspaceBranchTextCreating],
    [isHovered, isCreating]);
  return (
    <View style={styles.workspaceRowContent}>
      <View style={styles.workspaceRowMain}>
        {leading}
        <View style={styles.workspaceContentColumn}>
          <View style={styles.workspaceTitleRow}>
            <Text style={titleStyle} numberOfLines={1} testID={titleTestID}>{title}</Text>
            <View style={sidebarWorkspaceRowStyles.rowRight}>{trailing}</View>
          </View>
          {metadata}
        </View>
      </View>
      {shortcutNumber !== null ? <View style={styles.shortcutBadgeOverlay} pointerEvents="none">
        <SidebarWorkspaceShortcutBadge number={shortcutNumber} />
      </View> : null}
    </View>
  );
}
` +
    s.slice(end)
  );
});
// Preserve the directory implementation for relocation; sidebar loses the entire path subtree.
const sidebar = fs.readFileSync(base + "session-navigation/sidebar.tsx", "utf8");
fs.writeFileSync(".task-original-sidebar.tsx", sidebar);
edit(base + "session-navigation/sidebar.tsx", (s) => {
  s = s.replace("import { Fragment, memo,", "import { memo,");
  s = s.replace(
    "import { getStatusBucketLabel, STATUS_BUCKET_ORDER }",
    "import { getStatusBucketLabel }",
  );
  s = s.replace(
    'import { HostBadge } from "@/hosts/host-badge";',
    'import { HostBadge } from "@/hosts/host-badge";\nimport { SidebarCardContent } from "@/components/sidebar/sidebar-workspace-row-content";\nimport { ProjectStatusIndicator } from "@/components/sidebar/project-leading-visual";\nimport { useProjectIcons } from "@/projects/icons";\nimport { resolveSidebarProjectIconTargets } from "@/utils/sidebar-project-row-model";\nimport { density } from "@/styles/density";\nimport { getSidebarRowBackdrop } from "@/components/sidebar/sidebar-row-backdrop";\nimport type { SessionGrouping } from "./preferences";',
  );
  s = s.replace(
    '  const [view, setView] = useState<"sessions" | "resources">("sessions");\n  const resources = view === "resources";',
    '  const view = useSessionNavigationPreferences((state) => state.grouping ?? "project");\n  const setView = useSessionNavigationPreferences((state) => state.setGrouping);\n  const iconTargets = useMemo(() => resolveSidebarProjectIconTargets(allProjects), [allProjects]);\n  const projectIcons = useProjectIcons({ projects: iconTargets });',
  );
  s = s.replace(
    'SegmentedControlOption<"sessions" | "resources">',
    "SegmentedControlOption<SessionGrouping>",
  );
  s = s.replace(
    'value: "sessions",\n        label: t("sessionNavigation.sessions"),\n        testID: "session-navigation-sessions",',
    'value: "project",\n        label: t("sessionNavigation.byProject"),\n        testID: "session-group-by-project",',
  );
  s = s.replace(
    'value: "resources",\n        label: t("sessionNavigation.resources"),\n        testID: "directory-terminal-resources",',
    'value: "directory",\n        label: t("sessionNavigation.byDirectory"),\n        testID: "session-group-by-directory",',
  );
  const dirStart = s.indexOf("  const compact = useIsCompactFormFactor();");
  const dirEnd = s.indexOf("  const savedSelectedKey", dirStart);
  s = s.slice(0, dirStart) + s.slice(dirEnd);
  s = s.replace(
    "<SidebarDisplayPreferencesMenu sessions={!resources} />",
    "<SidebarDisplayPreferencesMenu sessions />",
  );
  const resourceStart = s.indexOf("      {resources ? (");
  const resourceEnd = s.indexOf("          <View style={styles.search}>", resourceStart);
  s = s.slice(0, resourceStart) + s.slice(resourceEnd);
  s = s.replace(
    "                    directoryTarget={directoryTarget}",
    "                    projectIcons={projectIcons}",
  );
  s = s.replace("        </>\n      )}\n    </View>", "    </View>");
  s = s.replace(
    "  const bucket = STATUS_BUCKET_ORDER.find((candidate) => candidate === groupKey);\n  const displayName = bucket ? getStatusBucketLabel(bucket, t) : name;\n  const mode = useSidebarModel().groupMode;",
    "  const displayName = name;",
  );
  s = s
    .replace(
      '    if (mode === "status") return state.collapsedWorkspaceGroupKeys.has(groupKey);\n',
      "",
    )
    .replace('    if (mode === "status") return state.toggleWorkspaceGroupCollapsed;\n', "");
  s = s.replace("  activeDirectoryPath,", "  project,\n  projectIcon,");
  s = s.replace(
    "  activeDirectoryPath?: string;",
    "  project?: SidebarProjectEntry;\n  projectIcon: string | null;",
  );
  s = s.replace(
    "  const rowStyle = useMemo(() => [styles.row, selected && styles.selected], [selected]);",
    "",
  );
  s = s.replace(
    "  const expanded = useSessionNavigationPreferences((state) => state.expanded[key] === true);\n  const toggle = useSessionNavigationPreferences((state) => state.toggleExpanded);\n",
    "",
  );
  s = s.replace(
    'useState<"settings" | "bind" | "rename" | null>',
    'useState<"settings" | "rename" | null>',
  );
  s = s
    .replace("  const toggleSessionExpanded = useCallback(() => toggle(key), [toggle, key]);\n", "")
    .replace('  const openBindDirectory = useCallback(() => setDialog("bind"), []);\n', "")
    .replace("      bind: openBindDirectory,\n", "")
    .replace("      openBindDirectory,\n", "");
  const contentStart = s.indexOf("        <View style={rowStyle}>");
  const contentEnd = s.indexOf("      </SessionRowMenuFrame>", contentStart);
  s =
    s.slice(0, contentStart) +
    `        <PressHighlight
          style={[styles.card, selected && styles.selected, hovered && styles.hovered]}
          onPress={openChat} accessibilityRole="button" accessibilityState={selectedState} aria-selected={selected}
        >
          <SidebarCardContent
            title={agent.title ?? t("sessionNavigation.untitled")}
            titleTestID={\`session-title-\${agent.id}\`}
            isHovered={hovered}
            shortcutNumber={shortcutNumber}
            leading={<View testID={\`session-status-\${agent.id}\`} accessibilityRole="image"
              accessibilityLabel={getStatusBucketLabel(sessionStatus(agent), t)}>
              <ProjectStatusIndicator iconDataUri={projectIcon}
                displayName={project?.projectName ?? t("sessionNavigation.ungrouped")}
                projectViewKey={project?.viewKey ?? "ungrouped"}
                statusBucket={sessionStatus(agent)}
                backdrop={getSidebarRowBackdrop({selected, isHovered: hovered})}
                testID={\`session-project-icon-\${agent.id}\`} />
            </View>}
            metadata={showLabels && context?.sidebarLabelNames.length ? <Text numberOfLines={1} style={styles.hint}>
              {context.sidebarLabelNames.join(", ")}
            </Text> : null}
            trailing={<>
              {trailing === "timestamp" ? <SessionTimestamp date={agent.lastUserMessageAt ?? agent.createdAt} /> : null}
              {hostBadge ? <HostBadge badge={hostBadge} /> : null}
              {finePointer ? <SessionArchiveButton actions={actions} visible={hovered} /> : null}
              <SessionMenu actions={actions} pages={pages} />
            </>}
          />
        </PressHighlight>
` +
    s.slice(contentEnd);
  const expandStart = s.indexOf("      {supported && expanded");
  const expandEnd = s.indexOf('      {dialog === "rename"', expandStart);
  s = s.slice(0, expandStart) + s.slice(expandEnd);
  const dirsStart = s.indexOf("function SessionDirectories(");
  const dirsEnd = s.indexOf("const styles = ", dirsStart);
  s = s.slice(0, dirsStart) + s.slice(dirsEnd);
  s = s.replace(
    "  resources: { flex: 1 },",
    "  card: { paddingHorizontal: density.space(2), paddingVertical: density.space(1), borderRadius: theme.borderRadius.md },\n  hovered: { backgroundColor: theme.colors.surfaceSidebarHover },",
  );
  const dirRowStart = s.indexOf("interface DirectoryRowProps");
  const dirRowEnd = s.indexOf("function SessionTimestamp", dirRowStart);
  s = s.slice(0, dirRowStart) + s.slice(dirRowEnd);
  s = s.replace("  directoryTarget,", "  projectIcons,");
  const propStart = s.indexOf("  directoryTarget: Extract<");
  const propEnd = s.indexOf("  activeWorkspace:", propStart);
  s =
    s.slice(0, propStart) +
    "  projectIcons: ReadonlyMap<string, string | null>;\n" +
    s.slice(propEnd);
  const activeStart = s.indexOf("      activeDirectoryPath={");
  const activeEnd = s.indexOf("      client=", activeStart);
  s =
    s.slice(0, activeStart) +
    "      project={project}\n      projectIcon={project ? projectIcons.get(project.viewKey) ?? null : null}\n" +
    s.slice(activeEnd);
  s = s.slice(0, s.indexOf("\nfunction SessionMetadata("));
  // remove sidebar binding dialog and stale props/imports
  s = s.replace("  children,\n", "").replace("  children: ReactNode;\n  dismiss?", "  dismiss?");
  s = s
    .replace("  projectLabel,\n", "")
    .replace("  projectLabel?: string;\n", "")
    .replace(
      "      projectLabel={model.rowItems.project ? project?.projectName : undefined}\n",
      "",
    );
  s = s
    .replace("  supported,\n", "")
    .replace("  supported: boolean;\n", "")
    .replace("      supported={hostActions.supported === true}\n", "");
  s = s.replace("  const key = `${agent.serverId}:${agent.id}`;\n", "");
  s = s.replace('dialog: "settings" | "bind" | null;', 'dialog: "settings" | null;');
  const bindStart = s.indexOf('  if (dialog === "bind")');
  if (bindStart >= 0) s = s.slice(0, bindStart) + s.slice(s.indexOf("  return null;", bindStart));
  return s;
});
edit(base + "session-navigation/menu.tsx", (s) =>
  s
    .replace("  bind(): void;\n", "")
    .replace(
      '      <MenuItem disabled={!actions.canManage || busy} onSelect={actions.bind}>\n        {t("sessionNavigation.bind")}\n      </MenuItem>\n',
      "",
    ),
);
for (const [locale, labels] of Object.entries({
  en: ["By project", "By directory"],
  "zh-CN": ["按项目", "按目录"],
}))
  edit(base + "i18n/resources/" + locale + ".ts", (s) =>
    s.replace(
      "  sessionNavigation: {",
      "  sessionNavigation: {\n    byProject: " +
        JSON.stringify(labels[0]) +
        ",\n    byDirectory: " +
        JSON.stringify(labels[1]) +
        ",",
    ),
  );
edit(base + "components/sidebar/display-preferences/menu.tsx", (s) =>
  s
    .replace(
      '          <MenuSubTrigger\n            id="grouping"',
      '          {sessions ? null : <MenuSubTrigger\n            id="grouping"',
    )
    .replace(
      '{t("sidebar.display.grouping.label")}\n          </MenuSubTrigger>',
      '{t("sidebar.display.grouping.label")}\n          </MenuSubTrigger>}',
    )
    .replace(
      '{preferences.grouping === "project" ? (',
      '{sessions || preferences.grouping === "project" ? (',
    )
    .replace(
      '    if (preferences.grouping === "project") {',
      '    if (sessions || preferences.grouping === "project") {',
    ),
);
