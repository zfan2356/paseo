import { z } from "zod";

export const LinkedChangeRequestSchema = z.object({
  key: z.string(),
  forge: z.string(),
  host: z.string(),
  projectPath: z.string(),
  number: z.number().int().positive(),
  url: z.string(),
  source: z.enum(["manual", "attachment", "tool"]),
  addedAt: z.string(),
  callId: z.string().optional(),
});

export const AgentChangeRequestSettingsSchema = z.object({
  linkedChangeRequests: z.array(LinkedChangeRequestSchema).optional(),
  autoLinkChangeRequests: z.boolean().optional(),
  excludedChangeRequestKeys: z.array(z.string()).optional(),
});
export type LinkedChangeRequest = z.infer<typeof LinkedChangeRequestSchema>;
export type AgentChangeRequestSettings = z.infer<typeof AgentChangeRequestSettingsSchema>;
