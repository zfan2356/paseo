import { z } from "zod";
import type { AgentTimelineItem } from "../../agent-sdk-types.js";

const BashOutputSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  interrupted: z.boolean(),
  backgroundTaskId: z.string().optional(),
  backgroundedByUser: z.boolean().optional(),
  timedOutAfterMs: z.number().optional(),
  returnCodeInterpretation: z.string().optional(),
  isImage: z.boolean().optional(),
  exitCode: z.number().nullable().optional(),
  exit_code: z.number().nullable().optional(),
});

function completedBashOutput(raw: unknown): { text: string } | null {
  const parsed = BashOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const output = parsed.data;
  // A successful launch is not a command exit. BashOutput distinguishes backgrounding,
  // interruption, and specially interpreted nonzero exits from an ordinary finished success.
  if (
    output.interrupted ||
    output.backgroundTaskId !== undefined ||
    output.backgroundedByUser ||
    output.timedOutAfterMs !== undefined ||
    output.returnCodeInterpretation !== undefined ||
    output.isImage
  )
    return null;
  if (
    (output.exitCode !== undefined && output.exitCode !== 0) ||
    (output.exit_code !== undefined && output.exit_code !== 0)
  )
    return null;
  return { text: [output.stderr, output.stdout].filter(Boolean).join("\n") };
}

export function applyClaudeBashResult(
  items: AgentTimelineItem[],
  blocks: ReadonlyArray<unknown>,
  rawOutput: unknown,
): AgentTimelineItem[] {
  const results = blocks.filter(
    (block): block is Record<string, unknown> =>
      block !== null &&
      typeof block === "object" &&
      "type" in block &&
      block.type === "tool_result",
  );
  if (results.length !== 1 || results[0].is_error === true) return items;
  const output = completedBashOutput(rawOutput);
  if (!output) return items;
  const mapped: AgentTimelineItem[] = [];
  for (const item of items) {
    if (
      item.type === "tool_call" &&
      item.name === "Bash" &&
      item.callId === results[0].tool_use_id &&
      item.status === "completed" &&
      item.detail.type === "shell"
    ) {
      mapped.push({
        ...item,
        detail: { ...item.detail, exitCode: 0, output: output.text },
      });
    } else mapped.push(item);
  }
  return mapped;
}
