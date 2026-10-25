import type { PluginServerContext } from "@getpaseo/plugin/server";
import { reportRpc } from "./shared/probe.js";

export default function contribute(server: PluginServerContext) {
  server.handle(reportRpc, (report) => {
    console.info("[magpie-mobile-probe]", JSON.stringify(report));
    return { ok: true as const };
  });
  return () => {};
}
