export function backgroundWorkText(
  item: { description: string | null; command?: string },
  kind: string,
): { title: string; command: string | null } {
  const title = item.description ?? item.command ?? kind;
  return { title, command: item.command && item.command !== title ? item.command : null };
}

/**
 * Lead-in for a background-work row's second line. The same agent facts the subagent list uses
 * (model, then thinking) come first, so a running shell identifies who started it. The kind is
 * only a fallback until that agent has a model.
 */
export function backgroundWorkStatusLead(agentFacts: string | null, kind: string): string {
  const facts = agentFacts?.trim();
  return facts ? `${facts} · ` : `${kind} · `;
}
