import type { PluginClientContext } from "@getpaseo/plugin/client";
import { MobileProbe } from "./client/probe.js";

export default function contribute(client: PluginClientContext) {
  client.addSurface("main", MobileProbe);
  client.addSidebarItem({
    id: "magpie-mobile-probe",
    title: "Magpie 手机测试",
    icon: "Smartphone",
    surface: "main",
  });
  return () => {};
}
