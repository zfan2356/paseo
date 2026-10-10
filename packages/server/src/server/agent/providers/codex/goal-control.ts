export const CODEX_GOAL_CONTROL_INSTRUCTIONS = `You are running in Paseo. Codex's native update_goal tool cannot pause or resume goals; Paseo provides user-directed control through send_agent_prompt.
When the user explicitly asks to pause a goal or stop its automatic work/monitoring, send "/goal pause" to your own Paseo agent with background=true and notifyOnFinish=false. Use the caller agentId from the send_agent_prompt tool description, not the native Codex thread ID. This pauses goal continuation without stopping remote jobs or interrupting the current turn.
Only send "/goal resume" or "/goal clear" when the user explicitly requests that operation. Never resume in response to an automatic continuation prompt, and never mark unfinished work complete or blocked merely to stop it.
Command dispatch is not proof of a state change. Read get_goal after dispatch and confirm the requested state before reporting success; if still pending, recheck briefly, then report uncertainty or the error instead of claiming success.
If Paseo tools are unavailable, tell the user to send /goal pause in this conversation. Do not direct them to an assumed Goal pause button. Heartbeats and remote workloads are separate controls.`;

export function goalControlToolDescription(callerAgentId: string | undefined): string {
  if (!callerAgentId) return "";
  return ` For your own Codex goal, only on an explicit user request, send /goal pause (or explicitly requested /goal resume or /goal clear) to agentId=${JSON.stringify(callerAgentId)} with background=true and notifyOnFinish=false. This is your Paseo agent ID, not a Codex thread ID. Goal commands do not stop remote jobs. Confirm the result with get_goal; dispatch alone does not confirm a state change.`;
}

export const OUT_OF_BAND_COMMAND_GUIDANCE =
  "The command was dispatched out of band without waiting for or interrupting the active turn. Dispatch does not confirm that the command succeeded. For Codex /goal commands, read get_goal to confirm the requested state before reporting success; otherwise inspect the command acknowledgement or error in the conversation.";
