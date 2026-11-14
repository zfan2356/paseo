import type { PluginClientContext } from "@getpaseo/plugin/client";
import { codexTheme } from "./shared/palette.js";

export default function contribute(client: PluginClientContext) {
  // COMPAT(themeOverrides): older fork clients retain their built-in Codex palette; remove after 2027-04-29.
  if (client.features?.themeOverrides !== true) return () => {};
  return client.addTheme(codexTheme);
}
