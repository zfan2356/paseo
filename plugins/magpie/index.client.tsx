import type { PluginClientContext } from "@getpaseo/plugin/client";
import { MagpieSurface } from "./client/magpie.js";
import { registerComposerControls } from "./client/composer-extension.js";

export default function contribute(client: PluginClientContext) {
  client.addSurface("main", MagpieSurface);
  client.addSidebarItem({
    id: "magpie",
    title: "Magpie",
    icon: "Bird",
    surface: "main",
  });
  client.addWorkspacePanel({
    id: "magpie",
    title: "Magpie",
    icon: "Bird",
    context: "workspace",
    locations: ["workspace"],
    Component: MagpieSurface,
  });
  client.addCommandCenterItem({
    id: "open-magpie",
    title: "打开 Magpie · 账号与额度",
    icon: "Bird",
    keywords: ["magpie", "quota", "额度", "账号"],
    context: "global",
    onSelect: ({ openSurface }) => openSurface("main"),
  });
  client.addSlashCommand({
    name: "magpie",
    description: "打开 Magpie 账号与额度面板",
    argumentHint: "",
    context: "workspace",
    onSubmit: ({ openPanel }) => openPanel("magpie"),
  });
  return registerComposerControls(client);
}
