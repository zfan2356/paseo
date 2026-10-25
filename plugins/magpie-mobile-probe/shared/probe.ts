import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const pageMessage = z.enum(["ready", "clicked"]);
export const probeStage = z.enum([
  "inspected",
  "started",
  "navigation-allowed",
  "navigation-blocked",
  "loaded",
  "ready",
  "clicked",
  "native-error",
  "render-error",
  "timeout",
]);
export type ProbeStage = z.infer<typeof probeStage>;

export const reportRpc = defineRpc({
  name: "magpie.mobile.probe.report",
  input: z.object({
    run: z.string().max(80),
    platform: z.string().max(30),
    osVersion: z.string().max(80),
    reactNativeVersion: z.string().max(80),
    nativeView: z.boolean(),
    stage: probeStage,
    detail: z.string().max(1000),
  }),
  output: z.object({ ok: z.literal(true) }),
});
