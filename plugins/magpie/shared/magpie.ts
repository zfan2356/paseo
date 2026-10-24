import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const accountKind = z.enum(["codex", "claude"]);
export const sourceMode = z.enum(["auto", "personal", "ichat"]);
export const signInSchema = z.object({
  id: z.string(),
  agent: accountKind,
  state: z.enum(["installing", "waiting", "done", "failed", "canceled"]),
  url: z.string(),
  code: z.string().optional(),
  pasteCallback: z.boolean(),
  pasteCode: z.boolean(),
  user: z.string().optional(),
  plan: z.string().optional(),
  error: z.string().optional(),
});
export type SignIn = z.infer<typeof signInSchema>;

export const snapshotSchema = z.object({
  available: z.boolean(),
  issue: z.string().optional(),
  checkedAt: z.string(),
  speedControlReady: z.boolean().default(false),
  providers: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      ready: z.boolean(),
      modelCount: z.number().int().nonnegative().default(0),
      accounts: z.array(
        z.object({
          user: z.string(),
          plan: z.string(),
          enabled: z.boolean(),
          needsLogin: z.boolean(),
        }),
      ),
    }),
  ),
  groups: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      routing: z.string(),
      affinity: z.string(),
      ready: z.boolean(),
      members: z.array(z.object({ id: z.string(), ready: z.boolean() })),
      source: z.enum(["auto", "personal", "ichat", "custom"]).default("custom"),
      controllable: z.boolean().default(false),
      ultraEnabled: z.boolean().default(false),
      ultraAvailable: z.boolean().default(false),
    }),
  ),
  quotas: z.array(
    z.object({
      provider: z.string(),
      name: z.string(),
      user: z.string(),
      plan: z.string(),
      balance: z.string(),
      readAt: z.string(),
      error: z.string(),
      windows: z.array(
        z.object({
          name: z.string(),
          used: z.number(),
          remaining: z.number(),
          unlimited: z.boolean(),
          resetsAt: z.string(),
          display: z.string(),
        }),
      ),
    }),
  ),
  signIn: signInSchema.nullable(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

export const snapshotRpc = defineRpc({
  name: "magpie.snapshot",
  input: z.object({ refresh: z.boolean().default(false) }),
  output: snapshotSchema,
});
export const startRpc = defineRpc({
  name: "magpie.start",
  input: z.object({}),
  output: snapshotSchema,
});
const groupId = z.string().regex(/^[a-z0-9][a-z0-9.-]{0,127}$/);
export const sourceRpc = defineRpc({
  name: "magpie.source.set",
  input: z.object({ groupId, source: sourceMode }),
  output: snapshotSchema,
});
export const ultraRpc = defineRpc({
  name: "magpie.ultra.set",
  input: z.object({ groupId, enabled: z.boolean() }),
  output: snapshotSchema,
});
export const signInStartRpc = defineRpc({
  name: "magpie.signin.start",
  input: z.object({ agent: accountKind }),
  output: signInSchema,
});
const flowId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const signInPollRpc = defineRpc({
  name: "magpie.signin.poll",
  input: z.object({ id: flowId }),
  output: signInSchema,
});
export const signInSubmitRpc = defineRpc({
  name: "magpie.signin.submit",
  input: z.object({ id: flowId, callback: z.string().trim().min(1).max(16384) }),
  output: z.object({ ok: z.literal(true) }),
});
export const signInCancelRpc = defineRpc({
  name: "magpie.signin.cancel",
  input: z.object({ id: flowId }),
  output: z.object({ ok: z.literal(true) }),
});
