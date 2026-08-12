export const ASSISTANT_MESSAGE_BOUNDARY_MARKDOWN = "---\n";

const LEGACY_ASSISTANT_MESSAGE_BOUNDARY_MARKDOWN = "\n\n---\n\n";

export function normalizeAssistantMessageBoundary(text: string): string {
  if (!text.startsWith(LEGACY_ASSISTANT_MESSAGE_BOUNDARY_MARKDOWN)) {
    return text;
  }
  return `${ASSISTANT_MESSAGE_BOUNDARY_MARKDOWN}${text.slice(
    LEGACY_ASSISTANT_MESSAGE_BOUNDARY_MARKDOWN.length,
  )}`;
}
