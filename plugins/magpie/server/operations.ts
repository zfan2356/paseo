import { z } from "zod";
import { MagpieBridge } from "./magpie.js";

export const operationSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("snapshot"), refresh: z.boolean() }),
  z.object({ method: z.literal("start") }),
  z.object({
    method: z.literal("source"),
    groupId: z.string(),
    source: z.enum(["auto", "personal", "ichat"]),
  }),
  z.object({ method: z.literal("ultra"), groupId: z.string(), enabled: z.boolean() }),
  z.object({ method: z.literal("begin"), agent: z.enum(["codex", "claude"]) }),
  z.object({ method: z.literal("poll"), id: z.string() }),
  z.object({ method: z.literal("submit"), id: z.string(), callback: z.string().max(16384) }),
  z.object({ method: z.literal("cancel"), id: z.string() }),
]);
export type Operation = z.infer<typeof operationSchema>;

export async function dispatch(bridge: MagpieBridge, operation: Operation) {
  switch (operation.method) {
    case "snapshot":
      return bridge.snapshot(operation.refresh);
    case "start":
      return bridge.start();
    case "source":
      await bridge.controls.source(operation.groupId, operation.source);
      return bridge.snapshot();
    case "ultra":
      await bridge.controls.ultra(operation.groupId, operation.enabled);
      return bridge.snapshot();
    case "begin":
      return bridge.begin(operation.agent);
    case "poll":
      return bridge.poll(operation.id);
    case "submit":
      return bridge.submit(operation.id, operation.callback);
    case "cancel":
      return bridge.cancel(operation.id);
  }
}
