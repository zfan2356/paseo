const fs = require("fs");
function edit(p, f) {
  const q = "packages/app/src/" + p;
  fs.writeFileSync(q, f(fs.readFileSync(q, "utf8")));
}
edit("components/left-sidebar.tsx", (s) => {
  const start = s.indexOf("  const { resolvedProjectFilters");
  const end = s.indexOf("  const openProjectPicker", start);
  s = s.slice(0, start) + "  const { isInitialLoad } = useSidebarModel();\n\n" + s.slice(end);
  s = s
    .replace("    hasActiveProjectFilter: resolvedProjectFilters.length > 0,\n", "")
    .replace('import { SidebarWorkspaceList } from "./sidebar-workspace-list";\n', "");
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
  ])
    s = s.replace(new RegExp("^  " + name + ":[^\\n]+\\n", "m"), "");
  s = s.replace("    handleImportSession: openImportSession,\n", "");
  s = s.replace(
    "  const { open: openImportSession, sheet: importSessionSheet } = useImportSession();",
    "  const { sheet: importSessionSheet } = useImportSession();",
  );
  s = s.replace(
    "function MobileSidebar({\n  active,",
    "function MobileSidebar({\n  active: _active,",
  );
  s = s.replace(
    "gestureRef: closeGestureRef } = useCloseAgentListGesture(overlay)",
    "gestureRef: _closeGestureRef } = useCloseAgentListGesture(overlay)",
  );
  s = s.replace(
    /import \{\n  type SidebarProjectEntry,[\s\S]*?from "@\/hooks\/use-sidebar-workspaces-list";\n/,
    "",
  );
  for (const str of [
    'import type { PinnedSidebarGroups } from "@/hooks/use-sidebar-pins";\n',
    'import type { SidebarWorkspaceGroup } from "@/components/sidebar/sidebar-labels";\n',
    'import type { SidebarProjectIconTarget } from "@/utils/sidebar-project-row-model";\n',
  ])
    s = s.replace(str, "");
  s = s.replace(
    "import { type SidebarGroupMode, useSidebarViewStore }",
    "import { useSidebarViewStore }",
  );
  return s;
});
edit("components/sidebar/sidebar-workspace-row-content.tsx", (s) =>
  s
    .replace(
      "  const leading = leadingProjectName ? (",
      "  const leading = useMemo(() => leadingProjectName ? (",
    )
    .replace("  const metadata = (", "  const metadata = useMemo(() => (")
    .replace(
      "  );\n  const metadata",
      "  ), [leadingProjectName, leadingProjectIconDataUri, workspace, backdrop, isLoading, reserveIdleStatusIndicatorSpace]);\n  const metadata",
    )
    .replace(
      "  );\n  return (\n    <SidebarCardContent",
      "  ), [workspace, leadingProjectName, hostBadge, serviceSummary, labels]);\n  return (\n    <SidebarCardContent",
    ),
);
edit("session-navigation/sidebar.tsx", (s) =>
  s
    .replace("      const leading = (", "      const leading = useMemo(() => (")
    .replace("      const metadata =", "      const metadata = useMemo(() =>")
    .replace("      const trailingContent = (", "      const trailingContent = useMemo(() => (")
    .replace(
      "      );\n      const metadata",
      "      ), [agent, project, projectIcon, hovered, selected, t]);\n      const metadata",
    )
    .replace(
      "        ) : null;\n      const trailingContent",
      "        ) : null, [showLabels, context]);\n      const trailingContent",
    )
    .replace(
      "      );\n      return (\n        <View testID={`session-row-",
      "      ), [trailing, agent, hostBadge, finePointer, actions, hovered, pages]);\n      return (\n        <View testID={`session-row-",
    ),
);
edit("session-navigation/model.test.ts", (s) =>
  s
    .replace("project/status grouping", "project/directory grouping")
    .replace('group: "project" },', 'group: "project" as const },')
    .replace('group: "status", labels:', 'group: "directory", labels:'),
);
const translations = {
  ar: [
    "مساحات العمل والطرفيات",
    "افتح الطرفيات والخدمات وتخطيطات مساحات العمل الحالية.",
    "مجلدات الجلسة",
    "حسب المشروع",
    "حسب المجلد",
  ],
  es: [
    "Espacios de trabajo y terminales",
    "Abre terminales, servicios y diseños de espacios de trabajo existentes.",
    "Directorios de la sesión",
    "Por proyecto",
    "Por directorio",
  ],
  fr: [
    "Espaces de travail et terminaux",
    "Ouvrir les terminaux, services et dispositions existants.",
    "Dossiers de la session",
    "Par projet",
    "Par dossier",
  ],
  ja: [
    "ワークスペースとターミナル",
    "既存のターミナル、サービス、ワークスペースのレイアウトを開きます。",
    "セッションのディレクトリ",
    "プロジェクト別",
    "ディレクトリ別",
  ],
  ko: [
    "작업 공간 및 터미널",
    "기존 터미널, 서비스 및 작업 공간 레이아웃을 엽니다.",
    "세션 디렉터리",
    "프로젝트별",
    "디렉터리별",
  ],
  "pt-BR": [
    "Espaços de trabalho e terminais",
    "Abra terminais, serviços e layouts de espaços de trabalho existentes.",
    "Diretórios da sessão",
    "Por projeto",
    "Por diretório",
  ],
  ru: [
    "Рабочие области и терминалы",
    "Открыть существующие терминалы, службы и рабочие области.",
    "Каталоги сеанса",
    "По проектам",
    "По каталогам",
  ],
};
for (const [locale, values] of Object.entries(translations))
  edit("i18n/resources/" + locale + ".ts", (s) =>
    s.replace(
      "  sessionNavigation: {",
      "  sessionNavigation: {\n" +
        [
          "workspaceResources",
          "workspaceResourcesHint",
          "selectDirectory",
          "byProject",
          "byDirectory",
        ]
          .map((k, i) => "    " + k + ": " + JSON.stringify(values[i]) + ",")
          .join("\n"),
    ),
  );
