let injected = false;

export function ensureTuiDocumentStyles(): void {
  if (injected || typeof document === "undefined") {
    return;
  }
  injected = true;
  const style = document.createElement("style");
  style.dataset.conversationSurface = "tui-document";
  style.textContent = `
    [data-testid="conversation-surface-tui"] {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace !important;
    }
    [data-testid="conversation-surface-tui"] div,
    [data-testid="conversation-surface-tui"] span,
    [data-testid="conversation-surface-tui"] p,
    [data-testid="conversation-surface-tui"] textarea {
      font-family: inherit !important;
    }
  `;
  document.head.appendChild(style);
}
