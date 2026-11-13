import { z } from "zod";

export const SessionContextSchema = z.object({
  agentId: z.string(),
  launchDirectory: z.string(),
  projectId: z.string().nullable(),
  pinnedAt: z.string().nullable(),
  sidebarLabelNames: z.array(z.string()),
  linkedDirectories: z.array(
    z.object({
      path: z.string(),
      source: z.enum(["manual", "worktree"]),
      addedAt: z.string(),
      evidence: z.string().optional(),
    }),
  ),
  autoLinkDirectories: z.boolean(),
  excludedDirectoryPaths: z.array(z.string()),
});
export type SessionContext = z.infer<typeof SessionContextSchema>;

export const SessionContextMutationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project"), projectId: z.string().nullable() }),
  z.object({ kind: z.literal("pin"), pinned: z.boolean() }),
  z.object({ kind: z.literal("label"), name: z.string(), assigned: z.boolean() }),
  z.object({ kind: z.literal("link"), path: z.string() }),
  z.object({ kind: z.literal("unlink"), path: z.string() }),
  z.object({ kind: z.literal("auto_link"), enabled: z.boolean() }),
]);
export type SessionContextMutation = z.infer<typeof SessionContextMutationSchema>;
