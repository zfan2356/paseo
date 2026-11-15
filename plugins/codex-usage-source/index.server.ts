import type { PluginServerContext } from "@getpaseo/plugin/server";
import { discover, fetchUsage } from "./server/usage.js";
import { MagpieCodexUsage, usageInputSchema } from "./server/magpie.js";

export default function contribute(server: PluginServerContext) {
  const magpie = new MagpieCodexUsage();
  server.registerUsageSource({
    id: "codex",
    label: "Codex",
    icon: "icon.svg",
    input: usageInputSchema,
    discover: async (scope) => magpie.discover(scope, await discover(scope)),
    fetch: (input) => {
      const { route } = usageInputSchema.parse(input);
      return route.store === "magpie" ? magpie.fetch(route) : fetchUsage({ route });
    },
  });
  return () => {};
}
