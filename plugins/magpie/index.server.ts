import type { PluginServerContext } from "@getpaseo/plugin/server";
import { localRequest, MagpieBridge } from "./server/magpie.js";
import { webUiLink } from "./server/web.js";
import { SshBridge, sshConfig } from "./server/ssh.js";
import { mobileDocument, readManagement } from "./server/mobile.js";
import { mobilePageRpc, mobileRequestRpc } from "./shared/mobile.js";
import {
  snapshotRpc,
  webUiRpc,
  startRpc,
  sourceRpc,
  ultraRpc,
  signInStartRpc,
  signInPollRpc,
  signInSubmitRpc,
  signInCancelRpc,
} from "./shared/magpie.js";

export default function contribute(server: PluginServerContext) {
  const config = sshConfig(process.env);
  const bridge = config ? new SshBridge(config) : new MagpieBridge();
  server.handle(mobilePageRpc, async () => {
    if (config) throw new Error("请在手机上选择直接连接的 Magpie 主机。");
    return mobileDocument();
  });
  server.handle(mobileRequestRpc, (input) => {
    if (config) throw new Error("请在手机上选择直接连接的 Magpie 主机。");
    return readManagement(input);
  });
  server.handle(webUiRpc, async () => {
    if (config) {
      throw new Error("远程 Magpie 原生页面需要先转发管理端口，请在该主机打开管理页面。");
    }
    try {
      await localRequest("/api/state");
      return await webUiLink();
    } catch {
      throw new Error("无法打开 Magpie 原生页面，请在本机运行 magpie-start 后重试。");
    }
  });
  server.handle(snapshotRpc, ({ refresh }) => bridge.snapshot(refresh));
  server.handle(startRpc, () => bridge.start());
  server.handle(sourceRpc, async ({ groupId, source }) => {
    await bridge.controls.source(groupId, source);
    return bridge.snapshot();
  });
  server.handle(ultraRpc, async ({ groupId, enabled }) => {
    await bridge.controls.ultra(groupId, enabled);
    return bridge.snapshot();
  });
  server.handle(signInStartRpc, ({ agent }) => bridge.begin(agent));
  server.handle(signInPollRpc, ({ id }) => bridge.poll(id));
  server.handle(signInSubmitRpc, ({ id, callback }) => bridge.submit(id, callback));
  server.handle(signInCancelRpc, ({ id }) => bridge.cancel(id));
  return () => bridge.dispose();
}
